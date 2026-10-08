// The reactions two feats grant (issue #125, src/lib/srd/feat-combat.ts):
//
// Defensive Duelist: wielding a finesse weapon the character is proficient
// with, the reaction adds the proficiency bonus to AC against one melee
// attack that hit. It answers the last attack the way Shield does
// (src/lib/dm/reaction-spells.ts): every swing of it the higher AC turns
// away becomes a miss, and the refund puts the character back where they
// stood (src/lib/dm/reaction-refund.ts).
//
// Mage Slayer: a creature within 5 feet of the character casts a spell, and
// the character makes one melee weapon attack against it with the reaction,
// through pc_attack's own rules (as the opportunity attack does).
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { addSheetCondition } from "@/lib/dm/action-common";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { removeConditions } from "@/lib/dm/condition-logic";
import { freshLastHit } from "@/lib/dm/last-hit";
import { READIED } from "@/lib/dm/object-actions";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { settle, spendReaction, SPENT, type Ctx } from "@/lib/dm/reaction-tools";
import { proficiencyBonus } from "@/lib/srd";
import { defensiveDuelistBonus, hasMageSlayer } from "@/lib/srd/feat-combat";

export function defensiveDuelist(ctx: Ctx): Record<string, unknown> {
  const { campaign, sheet } = ctx;
  const bonus = defensiveDuelistBonus(sheet, proficiencyBonus(sheet.level));
  if (bonus === null) {
    return {
      error: `${sheet.name} cannot use Defensive Duelist: it takes the feat and a finesse weapon in hand (equipped on the sheet). Nothing was spent.`,
    };
  }
  const record = freshLastHit(campaign.id, sheet.id);
  if (!record || record.source !== "attack" || record.attacker.kind !== "enemy") {
    return { error: `Defensive Duelist answers a melee weapon attack that just hit ${sheet.name}, and the server has no such attack on record. Nothing was spent.` };
  }
  if (record.ranged) {
    return { error: `Defensive Duelist answers a melee attack; ${record.attacker.name}'s ${record.attack} was ranged. Nothing was spent.` };
  }
  if (record.answered.includes("defensive duelist")) {
    return { error: `Defensive Duelist has already answered ${record.attacker.name}'s ${record.attack}. Nothing was spent.` };
  }
  if (!record.swings.some((swing) => swing.hit)) {
    return { error: `${record.attacker.name}'s ${record.attack} missed ${sheet.name}; there is no hit to turn away. Nothing was spent.` };
  }
  spendReaction(ctx);
  const corrected = record.swings.map((swing) =>
    swing.hit && swing.natural !== 20 && swing.total < swing.vsAc + bonus ? { ...swing, hit: false, raw: 0 } : swing,
  );
  const turned = corrected.filter((swing, at) => record.swings[at].hit && !swing.hit).length;
  const settled = settle(ctx, record, corrected, "defensive duelist");
  return {
    ok: true,
    reaction: "Defensive Duelist",
    spent: SPENT(sheet.name),
    applied: turned
      ? `Defensive Duelist: +${bonus} AC against ${record.attacker.name}'s ${record.attack}; ${turned} hit${turned === 1 ? "" : "s"} now miss${turned === 1 ? "es" : ""}: ${settled.given} hit points come back. HP ${settled.hp}.`
      : `Defensive Duelist: +${bonus} AC, but ${record.attacker.name}'s ${record.attack} still hits.`,
  };
}

export function mageSlayer(ctx: Ctx): Record<string, unknown> {
  const { campaign, encounter, sheet, args } = ctx;
  if (!hasMageSlayer(sheet)) {
    return { error: `${sheet.name} has no Mage Slayer; the reaction attack on a caster is that feat's. Nothing was spent.` };
  }
  if (!encounter) {
    return { error: "Mage Slayer's attack happens in a fight; there is no active encounter." };
  }
  if (!args.targetEnemyId) {
    return { error: "Mage Slayer answers a creature within 5 feet that just cast a spell: pass its targetEnemyId. Nothing was spent." };
  }
  if (getBattleMapForEncounter(encounter.id)) {
    const apart = tilesBetween(encounter.id, sheet.id, args.targetEnemyId);
    if (apart !== null && apart > 1) {
      return { error: `Mage Slayer reaches a caster within 5 feet, and that creature is ${apart * 5} ft from ${sheet.name}. Nothing was spent.` };
    }
  }
  // One melee weapon attack with the reaction, through pc_attack's own
  // rules; the readied mark lets the off-turn attack through and the attack
  // spends it and the reaction.
  addSheetCondition(campaign, sheet, READIED, { untilTurnOf: sheet.id }, "Mage Slayer");
  const result = handlePcAttack(
    campaign,
    ctx.turn,
    JSON.stringify({ characterId: sheet.id, targetEnemyId: args.targetEnemyId }),
    ctx.sheets,
    ctx.sheetsById,
    new Set(),
    null,
  );
  const after = getSheetById(sheet.id);
  if (after?.conditions.some((entry) => entry.toLowerCase() === READIED)) {
    const cleared = removeConditions(after.conditions, after.conditionMeta, [READIED]);
    patchSheet(after.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  }
  return "error" in result ? result : { ...result, reaction: "Mage Slayer" };
}
