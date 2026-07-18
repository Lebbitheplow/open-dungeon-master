import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { publishPersisted } from "@/lib/events";
import { publishMediaStatus } from "@/lib/dm/images";
import { stripToolText } from "@/lib/dm/tool-text";
import { enqueueMediaJob } from "@/lib/media-queue";
import { serverEnv } from "@/lib/server-env";

// Narration TTS via the local Kokoro-FastAPI service (:8880). Audio is
// rendered on the serial media queue after a DM message persists, saved
// under public/generated-audio, and announced with a tts_ready event that
// clients autoplay (latest-only) with per-user mute.

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

async function kokoroSpeech(input: string, voice: string): Promise<Buffer> {
  const base = serverEnv("KOKORO_URL", "http://127.0.0.1:8880");
  const response = await fetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kokoro", voice, input, response_format: "mp3" }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`Kokoro TTS failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function enqueueNarrationAudio(
  campaignId: string,
  messageId: string,
  text: string,
  voice: string,
) {
  const speech = stripForSpeech(text);
  if (!speech) {
    return Promise.resolve();
  }
  publishMediaStatus(campaignId, "tts", messageId, "queued");
  return enqueueMediaJob(`tts ${messageId}`, async () => {
    publishMediaStatus(campaignId, "tts", messageId, "generating");
    const chunks = chunkSentences(speech);
    const buffers: Buffer[] = [];
    try {
      for (const chunk of chunks) {
        buffers.push(await kokoroSpeech(chunk, voice));
      }
    } catch (error) {
      publishMediaStatus(campaignId, "tts", messageId, "failed");
      throw error;
    }
    // Kokoro-FastAPI emits plain MPEG frames; concatenation plays cleanly.
    const audio = Buffer.concat(buffers);
    const directory = path.join(process.cwd(), "public", "generated-audio", campaignId);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, `${messageId}.mp3`), audio);
    publishPersisted(campaignId, "tts_ready", {
      messageId,
      url: `/generated-audio/${campaignId}/${messageId}.mp3`,
    });
  });
}
