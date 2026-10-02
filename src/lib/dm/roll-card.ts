// A die the engine rolls inside the rules, stored and published as a dice
// card like any other: the table sees every roll the server makes. Its own
// module, importing only the roll store and the event stream, so the clock
// paths (a spell's tick at a turn's start or end, src/lib/dm/spell-aura.ts)
// can card their dice without the import cycles action-common.ts would bring.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { insertRoll, type RollAttacker } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";

// `turn` is the DM turn the card belongs to, when one is running; a roll at a
// turn's start or end (no DM turn) stands alone in the chronicle. `attacker`
// is who made an attack or damage roll (null: nobody, or not a combat roll).
// A flat amount (Aura of Conquest's half a level) rolls no dice and gets no
// card.
export function rollCard(
  campaign: Campaign,
  turn: DmTurn | null,
  characterId: string | null,
  kind: "attack" | "damage" | "custom" | "skill_check",
  detail: string,
  expression: string,
  attacker: RollAttacker | null,
) {
  const outcome = rollExpression(expression);
  if (!outcome.terms.some((term) => term.kind === "dice")) {
    return outcome;
  }
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId,
    requestedBy: "dm",
    kind,
    detail: detail.slice(0, 120),
    result: outcome,
    attacker,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn?.rollIds.push(roll.id);
  return outcome;
}

// Who a character is, as a roll's attacker.
export const sheetAttacker = (sheet: { id: string; name: string }): RollAttacker => ({ kind: "sheet", id: sheet.id, name: sheet.name });

// Who an enemy is, as a roll's attacker.
export const enemyAttacker = (enemy: { id: string; displayName: string }): RollAttacker => ({ kind: "enemy", id: enemy.id, name: enemy.displayName });
