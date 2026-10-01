// A creature that falls (SRD 5.1, Falling): 1d6 bludgeoning for every 10
// feet, at most 20d6, rolled by the server as a dice card, and it lands
// prone unless it avoids all the damage. The characters' side is
// apply_hazard's "falling" (hazard-tools.ts); this is the enemies' side,
// reached through damage_enemy's fallFeet.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getEnemy, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { applyEnemyDamage, publishEncounter } from "@/lib/dm/enemy-damage";
import { fallingDamageDice } from "@/lib/srd/hazards";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function enemyFalls(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemy: EncounterEnemy,
  feet: number,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const dice = fallingDamageDice(feet);
  if (dice === "0") {
    return { ok: true, name: enemy.displayName, feet, note: "Too short a fall to hurt." };
  }
  const outcome = rollExpression(dice);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: null,
    requestedBy: "dm",
    kind: "damage",
    detail: `${enemy.displayName}: falls ${feet} ft (${dice} bludgeoning)`,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn.rollIds.push(roll.id);
  const applied = applyEnemyDamage(
    campaign,
    turn,
    encounter,
    enemy,
    Math.max(1, outcome.total),
    sheets,
    sheetsById,
    "bludgeoning",
  );
  const out: Record<string, unknown> = { ...applied, fall: `${feet} ft: ${dice} = ${outcome.total} bludgeoning` };
  // It lands prone when the fall hurt it and it is still up.
  const after = getEnemy(enemy.id);
  if (after && after.status === "alive" && Number(applied.damageApplied ?? outcome.total) > 0) {
    if (!after.conditions.includes("prone")) {
      patchEnemyConditions(after.id, [...after.conditions, "prone"], after.conditionMeta);
      publishEncounter(campaign.id);
    }
    out.landed = "prone";
  }
  return out;
}
