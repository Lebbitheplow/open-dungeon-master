// The rewrite that puts story text into English before it reaches an image
// backend: the instructions and the reply's one reading. Pure so
// scripts/test-image-english.mjs can load it directly.
//
// Image models read English prompts. At a table playing in another language
// the names, layouts, descriptions and traits a prompt is built from are in
// that language, so each image job sends them through one utility call
// first (src/lib/image-english.ts).

import { z } from "zod";

export const IMAGE_ENGLISH_SYSTEM =
  "You prepare text for an image generator that reads only English. You get a JSON object whose values are text from a tabletop RPG story, written in another language. Reply with only a JSON object with exactly the same keys, each value rewritten in plain English with the same meaning. Keep proper names as they are written. Add nothing and leave nothing out.";

const replySchema = z.record(z.string(), z.string());

// The rewritten values for exactly the keys asked, or null when the reply
// is not that: a missing key would send the untranslated text.
export function parseImageEnglish<K extends string>(raw: string, keys: readonly K[]): Record<K, string> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const reply = replySchema.safeParse(parsed);
  if (!reply.success || !keys.every((key) => reply.data[key]?.trim())) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, reply.data[key].trim()])) as Record<K, string>;
}
