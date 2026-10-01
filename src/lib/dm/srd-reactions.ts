// The SRD reactions the final recount found spent with nothing behind them
// (SRD 5.1), resolved from the engine's record of the last attack against the
// character (src/lib/dm/last-hit.ts):
//
//   - Retaliation (Path of the Berserker 14): when a creature within 5 feet
//     damages the barbarian, the reaction makes one melee weapon attack
//     against it.
//   - Stand Against the Tide (Hunter 15, Superior Hunter's Defense): when a
//     hostile creature misses the ranger with a melee attack, the reaction
//     makes it repeat the attack against another creature the ranger
//     chooses: its own attack bonus against that creature's AC, its own
//     damage on a hit.
//
// use_reaction reaches these after the authored reactions; a refusal spends
// nothing.

import { getEnemy } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { holdsFeature } from "@/lib/srd/trait-rules";
import { addSheetCondition, rollCard } from "@/lib/dm/action-common";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { removeConditions } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { freshLastHit, writeLastHit } from "@/lib/dm/last-hit";
import { READIED } from "@/lib/dm/object-actions";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { noHit, SPENT, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

export function srdFeatureReaction(ctx: Ctx): Record<string, unknown> | null {
  const asked = lower(ctx.args.feature);
  if (/^retaliation\b/.test(asked)) {
    return retaliation(ctx);
  }
  if (/^(superior hunter's defense:\s*)?stand against the tide\b/.test(asked)) {
    return standAgainstTheTide(ctx);
  }
  return null;
}

function retaliation(ctx: Ctx): Record<string, unknown> {
  const { campaign, sheet, encounter } = ctx;
  if (!holdsFeature(sheet, "retaliation")) {
    return { error: `${sheet.name} does not have Retaliation (a Berserker's 14th level feature). Nothing was spent.` };
  }
  const record = freshLastHit(campaign.id, sheet.id);
  const damaged = record && record.source === "attack" && record.attacker.kind === "enemy" && record.attacker.id && !record.answered.includes("retaliation")
    ? record.swings.some((swing) => swing.hit && swing.raw > 0)
    : false;
  if (!record || !damaged || !record.attacker.id || !encounter) {
    return { error: noHit(sheet.name, "Retaliation", "damage from a creature within 5 feet") };
  }
  const enemy = resolveEnemyRef(encounter.id, ctx.args.targetEnemyId ?? record.attacker.id);
  if (!enemy || enemy.id !== record.attacker.id || enemy.status !== "alive") {
    return { error: `Retaliation answers ${record.attacker.name}, the creature that just damaged ${sheet.name}. Nothing was spent.` };
  }
  if (!withinFeet(encounter.id, sheet.id, enemy.id, 5)) {
    return { error: `${enemy.displayName} is not within 5 feet of ${sheet.name}; Retaliation is a melee attack. Nothing was spent.` };
  }
  // The attack is the reaction: a readied swing, as the attack path reads it.
  addSheetCondition(campaign, sheet, READIED, { untilTurnOf: sheet.id }, "Retaliation");
  const result = handlePcAttack(campaign, ctx.turn, JSON.stringify({ characterId: sheet.id, targetEnemyId: enemy.id }), ctx.sheets, ctx.sheetsById, new Set(), null);
  const after = getSheetById(sheet.id);
  if (after?.conditions.some((entry) => lower(entry) === READIED)) {
    const cleared = removeConditions(after.conditions, after.conditionMeta, [READIED]);
    patchSheet(after.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  }
  if ("error" in result) {
    return { error: String(result.error) };
  }
  writeLastHit(campaign.id, { ...record, answered: [...record.answered, "retaliation"] });
  spendReaction(ctx);
  return { ok: true, reaction: "Retaliation", spent: SPENT(sheet.name), attack: result };
}

function standAgainstTheTide(ctx: Ctx): Record<string, unknown> {
  const { campaign, sheet, encounter } = ctx;
  if (!holdsFeature(sheet, "stand against the tide", "superior hunter's defense: stand against the tide")) {
    return { error: `${sheet.name} does not have Stand Against the Tide (a Hunter's Superior Hunter's Defense pick). Nothing was spent.` };
  }
  const record = freshLastHit(campaign.id, sheet.id);
  const missed = record && record.source === "attack" && !record.ranged && !record.answered.includes("stand against the tide")
    ? record.swings.some((swing) => !swing.hit && !(swing.ranged ?? false))
    : false;
  if (!record || !missed || record.attacker.kind !== "enemy" || !record.attacker.id || !encounter) {
    return { error: noHit(sheet.name, "Stand Against the Tide", "a melee attack that missed them") };
  }
  const target = ctx.args.targetEnemyId ? resolveEnemyRef(encounter.id, ctx.args.targetEnemyId) : null;
  if (!target || target.status !== "alive" || target.id === record.attacker.id) {
    return { error: "Stand Against the Tide turns the attack on another creature, not the attacker: pass its targetEnemyId. Nothing was spent." };
  }
  const attacker = getEnemy(record.attacker.id);
  const attack = (attacker?.stats.attacks ?? []).find((entry) => lower(entry.name) === lower(record.attack)) ?? attacker?.stats.attacks?.[0];
  if (!attacker || !attack) {
    return { error: `The server has no record of ${record.attacker.name}'s ${record.attack} to repeat. Nothing was spent.` };
  }
  const ac = enemyAcWithEffects(campaign.id, target);
  const bonus = Number(attack.toHit ?? 0);
  const roll = rollCard(campaign, ctx.turn, null, "attack", `${attacker.displayName}: ${attack.name} again, at ${target.displayName} (Stand Against the Tide)`, `1d20${bonus >= 0 ? "+" : ""}${bonus}`);
  const hit = roll.crit !== "nat1" && (roll.crit === "nat20" || roll.total >= ac);
  writeLastHit(campaign.id, { ...record, answered: [...record.answered, "stand against the tide"] });
  spendReaction(ctx);
  if (!hit || !attack.damage) {
    return { ok: true, reaction: "Stand Against the Tide", spent: SPENT(sheet.name), applied: `${attacker.displayName}'s ${attack.name} swings at ${target.displayName} instead: ${roll.total} against AC ${ac} misses.` };
  }
  const damage = rollCard(campaign, ctx.turn, null, "damage", `${attacker.displayName}: ${attack.name} damage on ${target.displayName}`, attack.damage);
  const applied = applyEnemyDamage(campaign, ctx.turn, encounter, target, Math.max(0, damage.total), ctx.sheets, ctx.sheetsById, attack.type);
  publishEncounter(campaign.id);
  return {
    ok: true,
    reaction: "Stand Against the Tide",
    spent: SPENT(sheet.name),
    applied: `${attacker.displayName}'s ${attack.name} strikes ${target.displayName} instead: ${roll.total} against AC ${ac} hits for ${damage.total}.`,
    redirected: applied,
  };
}
