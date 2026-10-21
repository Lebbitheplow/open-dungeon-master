// What the table reads of a turn the model narrated over several calls
// (src/lib/dm/turn.ts finalize): the fight's bookkeeping taken out of the
// story, and a sentence the turn already said not said again.
//
// Dependency-free so scripts/test-narration-tidy.mjs can import it directly.

import { textKey } from "../language/text-logic.ts";
import { DM_TOOL_NAME_PATTERN } from "./tool-text.ts";
import type { TableLanguage } from "../schemas/game-settings-options.ts";

// A sentence shorter than this may be said twice on purpose: a shouted
// "Run!", a chant, a name called again.
const MIN_REPEAT_CHARS = 30;

const SENTENCE = /[^.!?\n]+(?:[.!?]+["'”’)\]]*)?\s*|\s+/g;

function tidyBlankLines(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Each sentence once, in the order the turn first said it: a later call
// repeating an earlier call's prose (Qwen3.6-35B at Q2 printed a paragraph
// twice), or one reply repeating itself. A part left with nothing is dropped.
export function withoutRepeatedSentences(parts: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    let out = "";
    for (const piece of part.match(SENTENCE) ?? [part]) {
      const key = textKey(piece);
      if (key.length >= MIN_REPEAT_CHARS) {
        if (seen.has(key)) {
          out += /\s*$/.exec(piece)?.[0] ?? "";
          continue;
        }
        seen.add(key);
      }
      out += piece;
    }
    const tidy = tidyBlankLines(out);
    if (tidy) {
      kept.push(tidy);
    }
  }
  return kept;
}

// The DM's tools whose names no story uses: the ones with an underscore
// ("move_token", "pc_attack"); "heal", "travel" and "lift" are words too.
const TOOL_NAME = new RegExp(`\\b(?:${DM_TOOL_NAME_PATTERN.split("|").filter((name) => name.includes("_")).join("|")})\\b`);

// A sentence naming one of those tools is the model reasoning aloud ("the
// correct next step is to call move_token for Bram", gpt-oss-20b), never the
// story.
export function withoutToolTalk(text: string): string {
  if (!TOOL_NAME.test(text)) {
    return text;
  }
  let out = "";
  for (const piece of text.match(SENTENCE) ?? [text]) {
    out += TOOL_NAME.test(piece) ? (/\s*$/.exec(piece)?.[0] ?? "") : piece;
  }
  return tidyBlankLines(out);
}

// Whether a reply is mostly the last turn's narration said again: a player
// who repeats a line ("I attack it") got back the paragraph the model wrote
// last time, with no tool, so the new action never happened (gpt-oss-20b and
// Qwen3.6-35B both did it in a fight of identical lines). Two sentences at
// least, most of them the last narration's.
export function repeatsNarration(text: string, previous: string): boolean {
  const keys = (value: string) =>
    (value.match(SENTENCE) ?? []).map((piece) => textKey(piece)).filter((key) => key.length >= MIN_REPEAT_CHARS);
  const now = keys(text);
  if (now.length < 2) {
    return false;
  }
  const before = new Set(keys(previous));
  return now.filter((key) => before.has(key)).length / now.length >= 0.6;
}

export const REPEATED_NARRATION_PROMPT =
  "[System] That reply repeats your previous narration almost word for word. The player has acted again, and this is a new moment. Resolve what they just did with the tools (in a fight: the attack, move or spell they declared, on their turn), then narrate only what is new.";

// An English bold heading for a turn, a round or the fight itself, read only
// at an English table: "**Bram's Turn**", "**Round 1:**", "**Combat
// begins.**", "**End of Avery's Turn.**".
const ENGLISH_COMBAT_HEADING = /\*\*[^*\n]{0,40}?\b(?:turn|round|combat|initiative)\b[^*\n]{0,30}?\*\*[ \t]*[.:!]?/gi;
// What is left of a recited order once its names went: "1. 2. **Avery** **Bram**".
const NUMBERS_LEFT = /(?:^|(?<=\s))\d{1,2}\.(?:\s+\d{1,2}\.)+(?:\s+\*\*[^*\n]{1,40}\*\*)*/g;
// A bulleted line in a fight is a summary of it, not the story: "* **Masked
// Thug 1 attacks Bram.**".
const BULLET_LINE = /^[ \t]*[*•-][ \t]+(.+)$/gm;
const ITEM_NUMBER = /^\d{1,2}\.[ \t]*(?:\*\*)?[ \t]*/;
const ITEM_TAIL = /^(?:\*\*)?(?:[ \t]*\([^)\n]{1,12}\))?(?:\*\*)?/;

// Where a numbered item naming one of the fight's own combatants ends, or -1:
// "2. **Silent Cultist 2** (CURRENT)".
function namedItemEnd(text: string, at: number, names: readonly string[]): number {
  const number = ITEM_NUMBER.exec(text.slice(at));
  if (!number) {
    return -1;
  }
  const start = at + number[0].length;
  const name = names.find((candidate) => textKey(text.slice(start, start + candidate.length)) === textKey(candidate));
  if (!name) {
    return -1;
  }
  const end = start + name.length;
  return end + (ITEM_TAIL.exec(text.slice(end))?.[0].length ?? 0);
}

// The turn order recited as a numbered list of the fight's own names, on its
// own lines or run together: "1. Avery (14) 2. Silent Cultist 2 3. Bram (9)".
function withoutNamedRuns(text: string, names: readonly string[]): string {
  let out = "";
  let from = 0;
  while (from < text.length) {
    const found = text.slice(from).search(/\d{1,2}\./);
    if (found < 0) {
      out += text.slice(from);
      break;
    }
    const start = from + found;
    let end = namedItemEnd(text, start, names);
    let items = 0;
    let runEnd = start;
    while (end > 0) {
      items += 1;
      runEnd = end;
      const gap = /^\s*/.exec(text.slice(runEnd))?.[0].length ?? 0;
      end = namedItemEnd(text, runEnd + gap, names);
    }
    if (items >= 2) {
      // The clause that introduced the list goes with it: "The updated
      // order is:".
      out = (out + text.slice(from, start)).replace(/[^.!?\n]*:\s*$/, "");
      from = runEnd;
    } else {
      out += text.slice(from, start + 1);
      from = start + 1;
    }
  }
  return out;
}

// The fight's bookkeeping written into the story while a fight runs: the
// recited order and a bulleted summary, found by the fight's own names at
// every table, and the English headings above at an English table only. The
// board and the turn strip show both; Qwen3.6-35B at Q2 wrote them in most
// fights. `names` are the fight's combatants; none means no fight, and the
// text is left as it is.
export function withoutCombatBookkeeping(text: string, names: readonly string[], language: TableLanguage): string {
  const known = [...new Set(names.map((name) => name.trim()).filter((name) => name.length >= 2))].sort((a, b) => b.length - a.length);
  if (!known.length) {
    return text;
  }
  const keys = known.map((name) => textKey(name));
  const unbulleted = text.replace(BULLET_LINE, (line, body: string) => (keys.some((key) => ` ${textKey(body)} `.includes(` ${key} `)) ? "" : line));
  const headed = language === "english" ? unbulleted.replace(ENGLISH_COMBAT_HEADING, "") : unbulleted;
  const stripped = withoutNamedRuns(headed, known).replace(NUMBERS_LEFT, "");
  return tidyBlankLines(stripped.replace(/\*\*\s*\*\*/g, ""));
}
