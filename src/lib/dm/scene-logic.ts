// Pure scene chunking, kept free of alias imports so node test scripts
// (scripts/test-scene-chunk.mjs) can load it directly.
//
// A "scene" is a contiguous span of transcript kept VERBATIM for the
// semantic memory index: recall injects the original words, not a summary.
// Spans aim for 600-1200 characters and break early at system messages
// (chapter dividers, table notes mark scene seams) so a chunk rarely
// straddles two unrelated moments.

export type ChunkableMessage = {
  seq: number;
  authorType: string;
  content: string;
};

export type SceneChunk = {
  seqStart: number;
  seqEnd: number;
  text: string;
};

const TARGET_MIN = 600;
const TARGET_MAX = 1200;
// A dangling remainder shorter than this merges into the previous chunk
// rather than becoming a fragment with no context.
const MIN_FRAGMENT = 200;

function lineFor(message: ChunkableMessage): string {
  const speaker = message.authorType === "dm" ? "DM" : "Player";
  return `${speaker}: ${message.content}`;
}

export function chunkScenes(messages: ChunkableMessage[]): SceneChunk[] {
  const chunks: SceneChunk[] = [];
  let lines: string[] = [];
  let length = 0;
  let seqStart: number | null = null;
  let seqEnd = 0;

  const flush = () => {
    if (seqStart === null || !lines.length) {
      return;
    }
    const text = lines.join("\n\n");
    const previous = chunks[chunks.length - 1];
    if (text.length < MIN_FRAGMENT && previous) {
      previous.text = `${previous.text}\n\n${text}`;
      previous.seqEnd = seqEnd;
    } else {
      chunks.push({ seqStart, seqEnd, text });
    }
    lines = [];
    length = 0;
    seqStart = null;
  };

  for (const message of messages) {
    // System messages (table notes, dividers) are seams, not content.
    if (message.authorType === "system" || !message.content.trim()) {
      if (length >= MIN_FRAGMENT) {
        flush();
      }
      continue;
    }
    const line = lineFor(message);
    // A single oversized message becomes its own chunk, split hard.
    if (line.length > TARGET_MAX) {
      flush();
      for (let offset = 0; offset < line.length; offset += TARGET_MAX) {
        chunks.push({
          seqStart: message.seq,
          seqEnd: message.seq,
          text: line.slice(offset, offset + TARGET_MAX),
        });
      }
      continue;
    }
    if (length + line.length > TARGET_MAX && length >= TARGET_MIN) {
      flush();
    }
    if (seqStart === null) {
      seqStart = message.seq;
    }
    lines.push(line);
    length += line.length + 2;
    seqEnd = message.seq;
    if (length >= TARGET_MAX) {
      flush();
    }
  }
  flush();
  return chunks;
}
