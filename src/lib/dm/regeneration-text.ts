import { DAMAGE_WORDS } from "@/lib/dm/save-effect";

// A creature's Regeneration as numbers (SRD 5.1, the troll and the vampire;
// the packs' "Limited Regeneration", "Green Regeneration", A5e's "Bloodied
// Regeneration"): what it regains at the start of its turn, what stops it,
// and when it works at all. Pure; src/lib/dm/regeneration.ts and
// legendary-tools.ts run it.

// `diesOnlyAtTurnStart`: "The troll dies only if it starts its turn with 0
// hit points and doesn't regenerate" (src/lib/dm/regeneration.ts).
// `whileBloodied`: it regenerates only at half its hit points or fewer.
// `onlyIf`: a circumstance the block prints and the server cannot see ("isn't
// in sunlight or running water", "while in a forest"), told to the DM.
export type Regeneration = {
  amount: number;
  stoppedBy: string[];
  diesOnlyAtTurnStart?: boolean;
  whileBloodied?: boolean;
  onlyIf?: string;
};

// The condition a creature carries from the damage that stops its
// Regeneration until the start of its next turn.
export const REGENERATION_STOPPED = "regeneration stopped";

// A trait that heals at the start of the creature's turn, by its name: not
// "Rejuvenation", which brings a creature back days later.
export const REGENERATION_NAME = /^(?:[a-z'-]+ )?regeneration\b/i;

// "The troll regains 10 hit points at the start of its turn. If the troll
// takes acid or fire damage, this trait doesn't function at the start of
// the troll's next turn." Also "regains 10 HP" (Black Flag), "Gains 3 hp"
// (Tome of Beasts 3), "While the tarrasque is bloodied, it regains 50 hit
// points at the start of each of its turns" (A5e). Null for a text that heals
// something else (a tick's host) or by a count the server cannot keep ("5 hp
// for each worm").
export function parseRegeneration(raw: string): Regeneration | null {
  const text = raw.replace(/\s+/g, " ");
  const amount = /\b(?:re)?gains (\d{1,3}) (?:hit points?|hp)\b(?! for each)/i.exec(text);
  if (!amount || !/\bstart of (?:each of )?(?:its|his|her|their) turns?|\bstarts (?:its|his|her) turn\b/i.test(text) || /\bhost\b/i.test(text.slice(0, amount.index))) {
    return null;
  }
  const sentences = text.split(/(?<=[.!?])\s+/);
  const stop = sentences.find((sentence) => /\b(?:does(?:n'?t| not)|did(?:n'?t| not)) (?:function|work)\b|\bhas(?:n'?t| not) taken\b/i.test(sentence) && DAMAGE_WORDS.some((word) => new RegExp(`\\b${word}\\b`, "i").test(sentence)));
  const stoppedBy = stop ? DAMAGE_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(stop)) : [];
  const diesOnlyAtTurnStart = /\bdies (?:only )?if it starts (?:its )?turn with 0 (?:hit points|hp)\b/i.test(text);
  const own = sentences.find((sentence) => sentence.includes(amount[0])) ?? "";
  const whileBloodied = /\b(?:while|if) (?:the [a-z' -]+?|it) is bloodied\b/i.test(own);
  // What else the sentence asks: "While in a forest", "if it has at least 1
  // hp and isn't in sunlight or running water" (at least 1 hit point is the
  // server's own rule: it heals only a creature above 0).
  const before = /^(?:while|as long as|if it starts its turn) ([^,]+),/i.exec(own);
  const after = /\bturns?,? (?:if|while) (.+?)\.?$/i.exec(own.slice(own.indexOf(amount[0])));
  const asks = [
    ...(before && !/\bbloodied\b/i.test(before[1]) ? [before[1]] : []),
    ...(after ? [after[1].replace(/\bit has at least 1 (?:hit\.? points?|hp)\.?(?: and)?/i, "").trim()] : []),
  ].filter((part) => part && !/^(?:it|and)$/i.test(part) && !/\btaken\b.*\bdamage\b/i.test(part));
  return {
    amount: Number(amount[1]),
    stoppedBy,
    ...(diesOnlyAtTurnStart ? { diesOnlyAtTurnStart: true } : {}),
    ...(whileBloodied ? { whileBloodied: true } : {}),
    ...(asks.length ? { onlyIf: asks.join("; ").slice(0, 160) } : {}),
  };
}

// The block's Regeneration: parsed with the block, or read from its trait
// line for a block written by hand.
export function regenerationOf(stats: { regeneration?: Regeneration; traits?: string[] }): Regeneration | null {
  if (stats.regeneration) {
    return stats.regeneration;
  }
  for (const line of stats.traits ?? []) {
    if (REGENERATION_NAME.test(line.trim())) {
      const parsed = parseRegeneration(line);
      if (parsed) {
        return parsed;
      }
    }
  }
  return null;
}
