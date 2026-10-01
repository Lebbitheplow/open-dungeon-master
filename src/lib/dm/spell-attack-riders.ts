// What an attack-roll spell does beyond its damage (SRD 5.1), applied by
// pc_attack once the roll is known:
//   - Guiding Bolt: the next attack roll against the target before the end
//     of the caster's next turn has advantage.
//   - Shocking Grasp: the target cannot take reactions until the start of
//     its next turn.
//   - Ray of Frost: the target's speed drops by 10 feet until the start of
//     the caster's next turn.
//   - Chill Touch: the target cannot regain hit points until the start of
//     the caster's next turn; an undead one has disadvantage on attack rolls
//     against the caster until the END of that turn ("undead dread (chill touch)").
//   - Vampiric Touch: the caster regains half the necrotic damage dealt.
//   - Acid Arrow: half the initial damage on a miss.
// The conditions are rows of src/lib/srd/condition-effects.ts, so the
// engines that read conditions (attack rolls, reactions, speed) hold them.
// A "until the start of" effect is untilTurnOf; a "before the end of" one is
// untilTurnEndOf, ended as that turn ends (src/lib/dm/turn-end.ts).

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { effectiveMaxHp, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import { layEnfeeblement } from "@/lib/dm/spell-retort";

// Chill Touch's hold on an undead's attacks against the caster.
export const CHILL_TOUCH_DREAD = "undead dread (chill touch)";

type SpellAttackRider = {
  match: RegExp;
  // A condition the hit leaves on the target, ending as the named turn
  // starts, or as it ends (`at: "end"`).
  onHit?: { condition: string; until: "caster" | "target"; at?: "end" };
  // The caster regains half the damage the hit dealt.
  healHalf?: boolean;
  // A miss still deals half the damage.
  halfOnMiss?: boolean;
  // The hit lays a condition the target shakes off with a save at the end of
  // each of its turns (Ray of Enfeeblement), against the caster's DC.
  saveEnds?: { condition: string; ability: "con" };
};

const RIDERS: SpellAttackRider[] = [
  { match: /^guiding bolt$/i, onHit: { condition: "guiding bolt", until: "caster", at: "end" } },
  { match: /^shocking grasp$/i, onHit: { condition: "shocked", until: "target" } },
  { match: /^ray of frost$/i, onHit: { condition: "ray of frost", until: "caster" } },
  { match: /^chill touch$/i, onHit: { condition: "chill touch", until: "caster" } },
  { match: /^vampiric touch$/i, healHalf: true },
  // The mark for the second burn at the end of the target's next turn
  // (src/lib/dm/spell-turn-end.ts).
  { match: /^(?:melf's )?acid arrow$/i, halfOnMiss: true, onHit: { condition: "acid arrow", until: "target", at: "end" } },
  { match: /^ray of enfeeblement$/i, saveEnds: { condition: "enfeebled", ability: "con" } },
];

export function spellAttackRider(spell: string | undefined): SpellAttackRider | null {
  const name = (spell ?? "").trim();
  return name ? (RIDERS.find((rider) => rider.match.test(name)) ?? null) : null;
}

// Whether a spell's attack is a melee spell attack: the rule lives in a pure
// module so the Hand can read it too.
export { isMeleeSpellAttack } from "@/lib/srd/melee-spell";

// The condition a hit leaves on the target. Returns a line for the result.
export function applySpellHitCondition(
  campaign: Campaign,
  rider: SpellAttackRider,
  enemyId: string,
  casterId: string,
): string | null {
  if (rider.saveEnds) {
    return layEnfeeblement(campaign, rider.saveEnds, enemyId, casterId);
  }
  if (!rider.onHit) {
    return null;
  }
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive") {
    return null;
  }
  const { condition, until, at } = rider.onHit;
  const whose = until === "caster" ? casterId : enemy.id;
  const meta: ConditionMetaMap = {
    ...(enemy.conditionMeta as ConditionMetaMap),
    [condition]: at === "end" ? untilTurnEnd(whose, { source: casterId }) : { untilTurnOf: whose, source: casterId },
  };
  let conditions = enemy.conditions.includes(condition) ? enemy.conditions : [...enemy.conditions, condition];
  // Chill Touch on an undead: its attacks on the caster are at disadvantage
  // until the END of the caster's next turn, longer than the no-healing part.
  if (condition === "chill touch" && /undead/i.test(enemy.stats.type ?? "")) {
    meta[CHILL_TOUCH_DREAD] = untilTurnEnd(casterId, { source: casterId });
    conditions = conditions.includes(CHILL_TOUCH_DREAD) ? conditions : [...conditions, CHILL_TOUCH_DREAD];
  }
  patchEnemyConditions(enemy.id, conditions, meta);
  publishEncounter(campaign.id);
  return `${enemy.displayName} is marked by the spell: ${condition}`;
}

// Vampiric Touch: the caster regains half the damage the hit dealt.
export function healCasterHalf(campaign: Campaign, casterId: string, dealt: number, spell: string): string | null {
  const sheet = getSheetById(casterId);
  const amount = Math.floor(dealt / 2);
  if (!sheet || amount <= 0 || sheet.currentHp <= 0) {
    return null;
  }
  const currentHp = Math.min(effectiveMaxHp(sheet), sheet.currentHp + amount);
  if (currentHp === sheet.currentHp) {
    return null;
  }
  const patch = { currentHp };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId: null,
    kind: "heal",
    delta: { amount: currentHp - sheet.currentHp, currentHp },
    reason: `${spell}: half the necrotic damage dealt`,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `${spell}: ${sheet.name} regains ${currentHp - sheet.currentHp} hit points`;
}
