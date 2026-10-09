import { createHash } from "node:crypto";
import { isPrivateBackendHost } from "@/lib/backend-host";
import { PaidAiRefusedError, paidAiAllowedNow } from "@/lib/shared-host";
import { recordUsage } from "@/lib/usage/ledger";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import { publishMediaStatus } from "@/lib/dm/images";
import { stripToolText } from "@/lib/dm/tool-text";
import { enqueueMediaJob } from "@/lib/media-queue";
import { describeSpeechFailure, synthesizeSpeech, ttsBackend, type TtsBackend } from "@/lib/tts-backend";
import { attributeSpeech, type Speaker } from "@/lib/dm/speech";
import { guessGender, type VoiceGender } from "@/lib/tts-cast";
import { closeLiveNarration, openLiveNarration, pushLiveNarration, renderSpeech } from "@/lib/tts-render";
import { castUnvoiced, voiceRoster, type RosterEntry } from "@/lib/tts-roster";
import { baseCreatureName, planSpeech, speechRequests, type CastVoice } from "@/lib/tts-segments";

// Narration TTS on the server's speech backend (src/lib/tts-backend.ts: the
// local Kokoro-FastAPI service on :8880 unless the admin chose another).
// Audio is rendered on the media queue's narration lanes after a DM message
// persists, so narration never waits behind a ComfyUI render: prose in the
// narrator's voice, each speaker's lines in their own (issue 97). The
// passage is offered to the table as a stream the moment its first clip
// exists (tts_stream), saved under public/generated-audio when the last one
// does, and announced with a tts_ready event; clients autoplay it
// (latest-only) with per-user mute. A render that fails says so to the
// table, with the reason (issue 88).

function stripForSpeech(text: string): string {
  return stripToolText(text)
    .replace(/\[roll:[^\]]+\]/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#>`]/g, "")
    // Line breaks stay: who said a line depends on the paragraph it opens
    // (src/lib/dm/speech.ts), and the voices must hear it as the
    // transcript shows it. planSpeech flattens each part it reads.
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n\s*/g, "\n")
    .trim();
}

export function narrationAudioPath(campaignId: string, messageId: string): string {
  return path.join(process.cwd(), "public", "generated-audio", campaignId, `${messageId}.mp3`);
}

// Where a take is listened to. The files are served to be kept for a year,
// so each take of a passage needs an address of its own: without the
// version, a passage that was narrated again (new prose, a new voice) kept
// playing its first take out of the browser's cache.
export function narrationAudioUrl(campaignId: string, messageId: string, version: number): string {
  return `/generated-audio/${campaignId}/${messageId}.mp3?v=${Math.floor(version)}`;
}

// What a passage is read with: the campaign's narration settings.
export type NarrationSettings = { ttsVoice: string; ttsSpeed?: number; ttsAutoCast?: boolean };

function castOf(roster: RosterEntry[]): CastVoice[] {
  return roster.map((entry) => ({
    name: entry.name,
    aliases: entry.aliases,
    voiceId: entry.voice?.voiceId ?? "",
    speed: entry.voice?.speed ?? 1,
  }));
}

// The cast's own voices (docs/vtt-parity-implementation-plan.md 8.2, issue
// 97), read when the job runs so a voice picked a moment ago is heard.
export function castVoices(campaignId: string): CastVoice[] {
  try {
    return castOf(voiceRoster(campaignId)).filter((entry) => entry.voiceId);
  } catch {
    return [];
  }
}

// Who speaks in this passage without a voice yet, and what the prose that
// pointed at them says about them ("she says", "Marla tucks her hair
// back"), never the words about whoever else the sentence names.
export function unvoicedSpeakers(
  speech: string,
  roster: RosterEntry[],
  speaker: Speaker | null,
): { keys: Set<string>; hints: Map<string, VoiceGender> } {
  const keys = new Set<string>();
  const near = new Map<string, string>();
  if (speaker && speaker.kind !== "narrator") {
    const wanted = [speaker.name.toLowerCase(), baseCreatureName(speaker.name).toLowerCase()];
    const entry = roster.find((candidate) => wanted.includes(candidate.name.toLowerCase()));
    if (entry && !entry.voice) {
      keys.add(entry.key);
    }
    return { keys, hints: new Map() };
  }
  const segments = attributeSpeech(
    speech,
    roster.map((entry) => ({ kind: "npc" as const, id: entry.key, name: entry.name, aliases: entry.aliases })),
  );
  for (const segment of segments) {
    if (segment.kind !== "speech") {
      continue;
    }
    const entry = roster.find((candidate) => candidate.key === segment.speaker.id);
    if (!entry || entry.voice) {
      continue;
    }
    keys.add(entry.key);
    near.set(entry.key, `${near.get(entry.key) ?? ""} ${segment.cue ?? ""}`);
  }
  return { keys, hints: new Map([...near].map(([key, text]) => [key, guessGender(text)])) };
}

export function enqueueNarrationAudio(
  campaignId: string,
  messageId: string,
  text: string,
  // The campaign's narration settings, or just the narrator's voice.
  narration: NarrationSettings | string,
  // The person the whole message is spoken as, when the DM said so.
  speaker: Speaker | null = null,
) {
  const settings: NarrationSettings = typeof narration === "string" ? { ttsVoice: narration } : narration;
  const speech = stripForSpeech(text);
  // Narration switched off server-wide is not a failure: nothing is asked
  // for, so nothing is announced.
  if (!speech || ttsBackend().provider === "off") {
    return Promise.resolve();
  }
  publishMediaStatus(campaignId, "tts", messageId, "queued");
  return enqueueMediaJob(
    `tts ${messageId}`,
    async () => {
      publishMediaStatus(campaignId, "tts", messageId, "generating");
      // Read once per passage, so every clip goes to the same server even
      // if the admin saves a change halfway through.
      const backend = ttsBackend();
      const paid = backend.provider === "openai" && backend.apiKey !== "" && !isPrivateBackendHost(backend.v1);
      const version = Date.now();
      const url = narrationAudioUrl(campaignId, messageId, version);
      const live = openLiveNarration(campaignId, messageId);
      let clips: Buffer[];
      try {
        let roster: RosterEntry[] = [];
        try {
          roster = voiceRoster(campaignId);
        } catch {
          // No readable roster: the narrator reads it all.
        }
        if (settings.ttsAutoCast && roster.length) {
          const { keys, hints } = unvoicedSpeakers(speech, roster, speaker);
          if (keys.size) {
            await castUnvoiced(campaignId, roster, settings.ttsVoice, { only: keys, hints, backend });
          }
        }
        // OpenAI speech runs on the host's key; the shared-host policy
        // answers before a word is rendered (src/lib/shared-host.ts).
        if (paid && !paidAiAllowedNow()) {
          throw new PaidAiRefusedError("speech");
        }
        // Prose in the narrator's voice, each attributed line in its
        // speaker's own, concatenated into the one file the transcript keys.
        const plan = planSpeech(speech, {
          narratorVoice: settings.ttsVoice,
          narratorSpeed: settings.ttsSpeed,
          cast: castOf(roster),
          speaker,
        });
        clips = await renderSpeech(speechRequests(plan), backend, (audio, index) => {
          pushLiveNarration(live, audio);
          if (index === 0) {
            // The first words exist: the table may start listening now.
            // "live" tells a client that fetches its audio whole (the apps,
            // which send a token no audio element can) to read this one as
            // it arrives instead.
            publishEphemeral(campaignId, "tts_stream", { messageId, url: `${url}&live=1` });
          }
        });
      } catch (error) {
        closeLiveNarration(messageId, live, "failed");
        const reason = error instanceof PaidAiRefusedError ? error.message : describeSpeechFailure(error, backend);
        lastFailures.set(messageId, reason);
        publishMediaStatus(campaignId, "tts", messageId, "failed", reason);
        throw error;
      }
      lastFailures.delete(messageId);
      recordUsage({
        kind: "tts",
        role: "narration",
        backend: backend.provider,
        model: backend.model,
        paid,
        units: speech.length,
      });
      // MP3 is plain MPEG frames; the clips concatenate and play cleanly.
      const file = narrationAudioPath(campaignId, messageId);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, Buffer.concat(clips));
      closeLiveNarration(messageId, live, "done");
      narrationLists.delete(campaignId);
      publishPersisted(campaignId, "tts_ready", { messageId, url });
    },
    `tts:${campaignId}`,
  );
}

// Why the last render of a message failed, for the caller that awaited it
// (the on-demand narrate route): the media queue swallows job errors by
// design, so the reason has to be left somewhere. Small and self-clearing.
const lastFailures = new Map<string, string>();

export function takeNarrationFailure(messageId: string): string | null {
  const reason = lastFailures.get(messageId) ?? null;
  lastFailures.delete(messageId);
  return reason;
}

// Narration already on disk, keyed by message id. The snapshot carries this
// so a fresh page load knows which messages can actually be replayed: only
// DM turns narrated while TTS was on have a file, and a replay button over a
// message without one fails silently. tts_ready adds to it as takes land.
//
// The folder grows with every narrated turn, so the listing is kept in
// memory per campaign and trusted while the directory's mtime is unchanged:
// one stat per snapshot instead of a readdir. The directory mtime moves on
// every entry added or removed, by this process or any other, so the cache
// is only ever a hint that the file system confirms. The writer above also
// drops it outright the moment a take lands.
const narrationLists = new Map<string, { mtimeMs: number; audio: Record<string, string> }>();

export function listNarrationAudio(campaignId: string): Record<string, string> {
  const directory = path.join(process.cwd(), "public", "generated-audio", campaignId);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(directory).mtimeMs;
  } catch {
    narrationLists.delete(campaignId);
    return {};
  }
  const cached = narrationLists.get(campaignId);
  if (cached && cached.mtimeMs === mtimeMs) {
    return { ...cached.audio };
  }
  const audio: Record<string, string> = {};
  for (const file of readdirSync(directory)) {
    if (file.endsWith(".mp3")) {
      // Each take is addressed by when it was written (narrationAudioUrl).
      // One stat per file, paid only when the folder changed.
      let version = 0;
      try {
        version = statSync(path.join(directory, file)).mtimeMs;
      } catch {
        continue;
      }
      const messageId = file.slice(0, -".mp3".length);
      audio[messageId] = narrationAudioUrl(campaignId, messageId, version);
    }
  }
  narrationLists.set(campaignId, { mtimeMs, audio });
  return { ...audio };
}

// Voice previews: speech servers ship no sample clips, but one short line
// renders in about a second, so the first request for a voice generates it and
// every later one is served from disk. Kept off the media queue entirely on
// purpose, so a preview never waits behind narration either; Kokoro runs on
// CPU here and does not contend with the GPU jobs that queue exists to
// serialize.
export const PREVIEW_LINE = "The tavern door creaks open. Roll for initiative, adventurer.";

const previewRenders = new Map<string, Promise<string>>();

// Any voice a server might take: a listed id, a blend, a described voice.
// Printable, one line, and short enough to be a setting rather than a text.
export function isPreviewableVoice(voice: string): boolean {
  return voice.length > 0 && voice.length <= 120 && !/[\u0000-\u001f\u007f]/.test(voice);
}

// The clip is named for the server, model and voice together, so a clip from
// one server is never played as the sample of another's voice, and a custom
// voice string never becomes a file name.
export function voicePreviewName(voice: string, backend: Pick<TtsBackend, "v1" | "model">): string {
  return `${createHash("sha256").update(`${backend.v1}\n${backend.model}\n${voice}`).digest("hex").slice(0, 32)}.mp3`;
}

export function voicePreviewPath(name: string): string {
  return path.join(process.cwd(), "public", "generated-audio", "previews", name);
}

export function voicePreviewCached(voice: string): boolean {
  return existsSync(voicePreviewPath(voicePreviewName(voice, ttsBackend())));
}

// Resolves to the clip's file name under generated-audio/previews.
export function renderVoicePreview(voice: string): Promise<string> {
  if (!isPreviewableVoice(voice)) {
    return Promise.reject(new Error(`Unknown voice: ${voice}`));
  }
  const backend = ttsBackend();
  const name = voicePreviewName(voice, backend);
  const file = voicePreviewPath(name);
  if (existsSync(file)) {
    return Promise.resolve(name);
  }
  const inFlight = previewRenders.get(name);
  if (inFlight) {
    return inFlight;
  }
  const render = (async () => {
    const audio = await synthesizeSpeech(PREVIEW_LINE, voice, 1, backend);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, audio);
    return name;
  })().finally(() => {
    previewRenders.delete(name);
  });
  previewRenders.set(name, render);
  return render;
}
