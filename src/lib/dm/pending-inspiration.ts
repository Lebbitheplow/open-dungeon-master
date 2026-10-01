// A player spends their Inspiration on a roll parked for them (SRD 5.1:
// "you can spend it to give yourself advantage on an attack roll, saving
// throw, or ability check"). The parked roll's d20 term becomes the
// advantage roll, or a disadvantage roll becomes a straight one (the two
// cancel), before a die is thrown. Pure: the parked roll and the sheet in,
// the new expression or the refusal out; the pending-roll inspiration route
// writes it and spends the counter (src/lib/dm/roll-riders.ts).

import type { Advantage } from "@/lib/dice";
import { heldInspiration } from "@/lib/dm/roll-riders";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The kinds of roll Inspiration helps: every d20 test.
export const INSPIRED_KINDS = ["skill_check", "saving_throw", "ability_check", "attack", "initiative"] as const;

// The leading d20 term the roll composer writes (src/lib/dice.ts d20Expression,
// with any reroll or floor suffix after it).
const LEADING_D20 = /^(\d+)d20(k[hl]1)?/;

export function inspiredRoll(
  pending: { kind: string; expression: string; advantage: Advantage },
  sheet: Pick<CharacterSheet, "name" | "resources"> | null,
): { expression: string; advantage: Advantage } | { error: string } {
  if (!sheet) {
    return { error: "Only a character's own roll can take their Inspiration." };
  }
  if (!(INSPIRED_KINDS as readonly string[]).includes(pending.kind)) {
    return { error: "Inspiration gives advantage on an attack roll, a saving throw or an ability check; this roll is none of those." };
  }
  if (!heldInspiration(sheet)) {
    return { error: `${sheet.name} holds no Inspiration to spend. The DM awards it.` };
  }
  if (pending.advantage === "advantage") {
    return { error: "This roll already has advantage, so Inspiration would add nothing. Keep it for another roll." };
  }
  const expression = pending.expression.replace(/\s+/g, "");
  const match = LEADING_D20.exec(expression);
  if (!match) {
    return { error: "Inspiration gives advantage on a d20 roll, and this roll has no d20 to double." };
  }
  // Advantage and disadvantage cancel: one d20.
  if (pending.advantage === "disadvantage" || match[2] === "kl1") {
    return { expression: expression.replace(LEADING_D20, "1d20"), advantage: "none" };
  }
  return { expression: expression.replace(LEADING_D20, "2d20kh1"), advantage: "advantage" };
}
