import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { publishPersisted } from "@/lib/events";
import { publishMediaStatus } from "@/lib/dm/images";
import { stripToolText } from "@/lib/dm/tool-text";
import { enqueueMediaJob } from "@/lib/media-queue";
import { TTS_VOICES } from "@/lib/tts-voices";
import { configValue, getGlobalConfig } from "@/lib/app-config";
import { listNpcs } from "@/lib/db/npcs";
import type { Speaker } from "@/lib/dm/speech";
import { planSpeech, type CastVoice } from "@/lib/tts-segments";

// Narration TTS via the local Kokoro-FastAPI service (:8880). Audio is
// rendered on the media queue's own "tts" lane after a DM message persists,
// so narration never waits behind a ComfyUI render, saved under
// public/generated-audio, and announced with a tts_ready event that clients
// autoplay (latest-only) with per-user mute.

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

async function kokoroSpeech(input: string, voice: string, speed = 1): Promise<Buffer> {
  const base = configValue(getGlobalConfig().speech.kokoroUrl, "KOKORO_URL", "http://127.0.0.1:8880");
  const response = await fetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kokoro", voice, input, response_format: "mp3", ...(speed !== 1 ? { speed } : {}) }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`Kokoro TTS failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
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
  if (!speech) {
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
      try {
        for (const part of plan) {
          for (const chunk of chunkSentences(part.text)) {
            buffers.push(await kokoroSpeech(chunk, part.voice, part.speed));
          }
        }
      } catch (error) {
        publishMediaStatus(campaignId, "tts", messageId, "failed");
        throw error;
      }
      // Kokoro-FastAPI emits plain MPEG frames; concatenation plays cleanly.
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

// Voice previews: Kokoro ships no sample clips, but one short line renders in
// well under a second, so the first request for a voice generates it and every
// later one is served from disk. Kept off the media queue entirely on purpose,
// so a preview never waits behind narration either; Kokoro runs on CPU here and
// does not contend with the GPU jobs that queue exists to serialize.
const PREVIEW_LINE = "The tavern door creaks open. Roll for initiative, adventurer.";

const previewRenders = new Map<string, Promise<string>>();

export function isPreviewableVoice(voice: string): boolean {
  return TTS_VOICES.some((entry) => entry.id === voice);
}

export function voicePreviewPath(voice: string): string {
  return path.join(process.cwd(), "public", "generated-audio", "previews", `${voice}.mp3`);
}

export function renderVoicePreview(voice: string): Promise<string> {
  if (!isPreviewableVoice(voice)) {
    return Promise.reject(new Error(`Unknown voice: ${voice}`));
  }
  const file = voicePreviewPath(voice);
  if (existsSync(file)) {
    return Promise.resolve(file);
  }
  const inFlight = previewRenders.get(voice);
  if (inFlight) {
    return inFlight;
  }
  const render = (async () => {
    const audio = await kokoroSpeech(PREVIEW_LINE, voice);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, audio);
    return file;
  })().finally(() => {
    previewRenders.delete(voice);
  });
  previewRenders.set(voice, render);
  return render;
}
