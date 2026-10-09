// Which of the table's lines a narration crossed, read with the table
// language's Snowball stemmer and stop list (src/lib/language). Its own
// module, apart from safety-logic.ts, because the browser imports that one
// and the stemmer is server-only. Pure, so scripts/test-safety.mjs loads it
// directly.

import type { TableLanguage } from "../schemas/game-settings-options.ts";
import { stems } from "../language/language.ts";
import { hasWord } from "../language/text-logic.ts";

// A line is matched as a whole phrase or by any of its words' stems, so
// "spiders" catches "spider" and "ragni" catches "ragno", while "rat" never
// fires inside "pirate".
export function lineViolations(text: string, lines: string[], language: TableLanguage): string[] {
  const narration = new Set(stems(text, language));
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    if (hasWord(text, line) || stems(line, language).some((stem) => narration.has(stem))) {
      out.push(line);
    }
  }
  return out;
}
