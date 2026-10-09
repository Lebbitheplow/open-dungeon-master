// Goal collisions between NPCs, read with the table language's Snowball
// stemmer and stop list (src/lib/language). Its own module, apart from
// npc-logic.ts, because the browser imports that one and the stemmer is
// server-only. Pure, so scripts/test-npc-agency.mjs loads it directly.

import type { TableLanguage } from "../schemas/game-settings-options.ts";
import { stems } from "../language/language.ts";
import { words } from "../language/text-logic.ts";

export type GoalCollision = { a: string; b: string; over: string };

// Each goal's words by stem, function words dropped, keeping the word as
// written for the fact that reports the rivalry.
function goalTerms(text: string, language: TableLanguage): Map<string, string> {
  const terms = new Map<string, string>();
  for (const word of words(text)) {
    const [stem] = stems(word, language);
    if (stem && word.length > 3 && !terms.has(stem)) {
      terms.set(stem, word);
    }
  }
  return terms;
}

// Two NPCs whose session goals name the same significant thing are after
// the same prize; the caller resolves each collision with opposed dice.
// "Significant" comes from the campaign's own goals, not a word list: a stem
// in more than half of `pool` (every goal its NPCs have) is what all its
// goals say ("wants", "the party"), while one only two goals share always
// counts, so a small campaign still sees its rivalries.
export function detectGoalCollisions(
  npcs: Array<{ name: string; goalText: string }>,
  language: TableLanguage,
  pool: readonly string[],
): GoalCollision[] {
  const frequency = new Map<string, number>();
  for (const goal of pool) {
    for (const stem of goalTerms(goal, language).keys()) {
      frequency.set(stem, (frequency.get(stem) ?? 0) + 1);
    }
  }
  const common = (stem: string) => {
    const count = frequency.get(stem) ?? 0;
    return count > 2 && count > pool.length / 2;
  };
  const terms = npcs.map((npc) => goalTerms(npc.goalText, language));
  const collisions: GoalCollision[] = [];
  for (let indexA = 0; indexA < npcs.length; indexA += 1) {
    for (let indexB = indexA + 1; indexB < npcs.length; indexB += 1) {
      const shared = [...terms[indexA]].find(([stem]) => terms[indexB].has(stem) && !common(stem));
      if (shared) {
        collisions.push({ a: npcs[indexA].name, b: npcs[indexB].name, over: shared[1] });
      }
    }
  }
  return collisions;
}
