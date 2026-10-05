import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { publishPersisted } from "@/lib/events";
import { publishMediaStatus } from "@/lib/dm/images";
import { stripToolText } from "@/lib/dm/tool-text";
import { enqueueMediaJob } from "@/lib/media-queue";
import { describeSpeechFailure, synthesizeSpeech, ttsBackend, type TtsBackend } from "@/lib/tts-backend";
import { listNpcs } from "@/lib/db/npcs";
import type { Speaker } from "@/lib/dm/speech";
import { planSpeech, type CastVoice } from "@/lib/tts-segments";

// Narration TTS on the server's speech backend (src/lib/tts-backend.ts: the
// local Kokoro-FastAPI service on :8880 unless the admin chose another).
// Audio is rendered on the media queue's own "tts" lane after a DM message
// persists, so narration never waits behind a ComfyUI render, saved under
// public/generated-audio, and announced with a tts_ready event that clients
// autoplay (latest-only) with per-user mute. A render that fails says so to
// the table, with the reason (issue 88).

const CHUNK_CHAR_LIMIT = 1_800;

function stripForSpeech(text: string): string {
  return stripToolText(text)
    .replace(/\[roll:[^\]]+\]/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Split long narration at sentence boundaries so Kokoro gets sane inputs.
function chunkSentences(text: string): string[] {
  if (text.length <= CHUNK_CHAR_LIMIT) {
    return [text];
  }
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|.+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > CHUNK_CHAR_LIMIT) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

export function narrationAudioPath(campaignId: string, messageId: string): string {
  return path.join(process.cwd(), "public", "generated-audio", campaignId, `${messageId}.mp3`);
}

// The cast's own voices (docs/vtt-parity-implementation-plan.md 8.2),
// read when the job runs so a voice picked a moment ago is heard.
export function castVoices(campaignId: string): CastVoice[] {
  try {
    return listNpcs(campaignId)
      .filter((npc) => npc.voice && !npc.archived)
      .map((npc) => ({ name: npc.name, voiceId: npc.voice!.voiceId, speed: npc.voice!.speed }));
  } catch {
    return [];
  }
}

export function enqueueNarrationAudio(
  campaignId: string,
  messageId: string,
  text: string,
  voice: string,
  // The person the whole message is spoken as, when the DM said so.
  speaker: Speaker | null = null,
) {
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
      // Prose in the narrator's voice, each attributed line in its
      // speaker's own, concatenated into the one file the transcript keys.
      const plan = planSpeech(speech, { narratorVoice: voice, cast: castVoices(campaignId), speaker });
      const buffers: Buffer[] = [];
      // Read once per passage, so every chunk goes to the same server even
      // if the admin saves a change halfway through.
      const backend = ttsBackend();
      try {
        for (const part of plan) {
          for (const chunk of chunkSentences(part.text)) {
            buffers.push(await synthesizeSpeech(chunk, part.voice, part.speed, backend));
          }
        }
      } catch (error) {
        const reason = describeSpeechFailure(error, backend);
        lastFailures.set(messageId, reason);
        publishMediaStatus(campaignId, "tts", messageId, "failed", reason);
        throw error;
      }
      lastFailures.delete(messageId);
      // MP3 is plain MPEG frames; the chunks concatenate and play cleanly.
      const audio = Buffer.concat(buffers);
      const file = narrationAudioPath(campaignId, messageId);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, audio);
      narrationLists.delete(campaignId);
      publishPersisted(campaignId, "tts_ready", {
        messageId,
        url: `/generated-audio/${campaignId}/${messageId}.mp3`,
      });
    },
    "tts",
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
      audio[file.slice(0, -".mp3".length)] = `/generated-audio/${campaignId}/${file}`;
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
