// The question asked before a cast ends a running concentration spell
// (issue 252). The rules already end the first spell when a second
// concentration spell is cast (src/lib/dm/cast-guard.ts); what was missing
// was the moment to decide: a card or a typed "I cast Bless" was posted and
// Spirit Guardians was gone. Pure, and free of alias imports so
// scripts/test-concentration-confirm.mjs reads it directly.

import { phraseOffsets, textKey } from "../language/text-logic.ts";

export type ConcentrationSwap = {
  characterId: string;
  // The spell running now, and the one the action would cast.
  current: string;
  next: string;
};

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The character's own spells a typed action names, in the order it names
// them. Whole names only ("Bless" is not found inside "Blessing").
export function spellsNamedIn(content: string, spells: readonly string[]): string[] {
  const found: Array<{ name: string; at: number }> = [];
  for (const name of spells) {
    if (textKey(name).length < 3) {
      continue;
    }
    const [at] = phraseOffsets(content, name);
    if (at !== undefined) {
      found.push({ name, at });
    }
  }
  // A longer name found at the same place wins ("Hold Person" over "Hold").
  return found
    .sort((a, b) => a.at - b.at || textKey(b.name).length - textKey(a.name).length)
    .filter((entry, index, list) => index === 0 || entry.at !== list[index - 1].at)
    .map((entry) => entry.name);
}

// A typed action that already says the running spell goes: "drop Spirit
// Guardians and cast Bless", "I let Hold Person end". Asking again would be
// a redundant question.
export function acknowledgesDrop(content: string, current: string): boolean {
  const text = textKey(content);
  const spell = escape(textKey(current));
  const verbs = "(?:drop|dropping|end|ending|release|releasing|dismiss|dismissing|let go of|letting go of|stop concentrating on|stop|stopping|replace|replacing|give up|giving up|abandon|abandoning)";
  return (
    new RegExp(`${verbs}\\s+(?:my\\s+|the\\s+)?${spell}`).test(text) ||
    new RegExp(`${spell}\\s+(?:end|ends|drop|drops|go|goes|fade|fades|lapse|lapses)\\b`).test(text) ||
    new RegExp(`let\\s+(?:my\\s+|the\\s+)?${spell}\\s+(?:end|drop|go|fade|lapse)`).test(text)
  );
}

// Whether a confirmation the player gave still answers this cast: the same
// character, the same running spell and the same spell to cast. Anything
// else changed since the question, so it is asked again.
export function confirmsSwap(swap: ConcentrationSwap, ack: Partial<ConcentrationSwap> | null | undefined): boolean {
  return Boolean(
    ack &&
      ack.characterId === swap.characterId &&
      typeof ack.current === "string" &&
      typeof ack.next === "string" &&
      textKey(ack.current) === textKey(swap.current) &&
      textKey(ack.next) === textKey(swap.next),
  );
}

// The question, as the confirmation and the refusal say it.
export function swapQuestion(swap: ConcentrationSwap, characterName?: string): string {
  const who = characterName ? `${characterName}'s` : "your";
  return `Casting ${swap.next} will end ${who} concentration on ${swap.current}. Replace ${swap.current}?`;
}
