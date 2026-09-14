// Transcription for human-DM tables (docs/vtt-parity-implementation-plan.md
// 13.3), the pure half. Each speaker's microphone is cut into rings of
// RING_SECONDS; a ring is sent for transcription as one batch, and the lines
// that come back are labelled with who was producing. Everything here is
// arithmetic on timestamps and strings so it can be tested without a room.

export const RING_SECONDS = 30;
// A ring shorter than this is silence or a click and not worth a request.
export const MIN_RING_SECONDS = 2;
export const RECENT_MINUTES = 5;

export type TranscriptLine = {
  speaker: string;
  text: string;
  // Real time the ring started, ISO.
  startedAt: string;
  // The in-world clock when it landed, for the beat and the chapter.
  clockLabel: string;
};

export type RingChunk = { speaker: string; startedAt: number; seconds: number; bytes: number };

// The rings worth sending: long enough to hold speech, in the order they
// were spoken, one per speaker per RING_SECONDS window.
export function batchRings(chunks: RingChunk[], now: number): RingChunk[] {
  return chunks
    .filter((chunk) => chunk.seconds >= MIN_RING_SECONDS && chunk.bytes > 0 && chunk.startedAt <= now)
    .sort((a, b) => a.startedAt - b.startedAt || a.speaker.localeCompare(b.speaker));
}

// What the transcriber returns, cleaned: blanks and the whisper "[BLANK_AUDIO]"
// marker drop; the rest is trimmed and split on sentence ends so a ring that
// held two thoughts lands as two lines.
export function labelLines(rawText: string, speaker: string, startedAt: string, clockLabel: string): TranscriptLine[] {
  const cleaned = rawText.replace(/\[[A-Z_ ]+\]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return [];
  }
  const parts = cleaned.split(/(?<=[.!?])\s+(?=[A-Z"'])/).map((part) => part.trim()).filter(Boolean);
  return parts.map((text) => ({ speaker, text: text.slice(0, 600), startedAt, clockLabel }));
}

// Adjacent lines from the same speaker read as one turn.
export function mergeAdjacent(lines: TranscriptLine[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    if (last && last.speaker === line.speaker && last.clockLabel === line.clockLabel) {
      last.text = `${last.text} ${line.text}`.slice(0, 1200);
      continue;
    }
    out.push({ ...line });
  }
  return out;
}

// The last few minutes, for "draft a beat from what was just said".
export function recentLines(lines: TranscriptLine[], now: number, minutes = RECENT_MINUTES): TranscriptLine[] {
  const since = now - minutes * 60_000;
  return lines.filter((line) => Date.parse(line.startedAt) >= since);
}

// One block of text a model can read, speaker-labelled, newest last.
export function renderTranscript(lines: TranscriptLine[], maxChars = 6_000): string {
  const rendered = mergeAdjacent(lines).map((line) => `${line.speaker}: ${line.text}`);
  let text = rendered.join("\n");
  if (text.length > maxChars) {
    text = text.slice(-maxChars);
  }
  return text;
}
