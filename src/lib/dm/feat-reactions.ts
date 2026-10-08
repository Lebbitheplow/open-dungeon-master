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
import { luckPointsLeft, spendLuckCounter } from "@/lib/srd/class-resources";
import { rollExpression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { defensiveDuelistBonus, hasMageSlayer, hasSentinel } from "@/lib/srd/feat-combat";
import { listSheets } from "@/lib/db/sheets";

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


// Sentinel (and Level Up's Guarded Warrior): a creature within 5 feet that
// attacks someone other than the character draws one melee weapon attack
// with the reaction. The server checks the feat, the distance and that the
// creature's last attack on record went at an ally, then swings through
// pc_attack's own rules as Mage Slayer does.
export function sentinel(ctx: Ctx): Record<string, unknown> {
  const { campaign, encounter, sheet, args } = ctx;
  if (!hasSentinel(sheet)) {
    return { error: `${sheet.name} has no Sentinel; the reaction attack on a creature that strikes an ally is that feat's. Nothing was spent.` };
  }
  if (!encounter) {
    return { error: "Sentinel's attack happens in a fight; there is no active encounter." };
  }
  if (!args.targetEnemyId) {
    return { error: "Sentinel answers a creature within 5 feet that just attacked someone else: pass its targetEnemyId. Nothing was spent." };
  }
  if (getBattleMapForEncounter(encounter.id)) {
    const apart = tilesBetween(encounter.id, sheet.id, args.targetEnemyId);
    if (apart !== null && apart > 1) {
      return { error: `Sentinel reaches a creature within 5 feet, and that creature is ${apart * 5} ft from ${sheet.name}. Nothing was spent.` };
    }
  }
  const struckAlly = listSheets(campaign.id).some((ally) => {
    if (ally.id === sheet.id) {
      return false;
    }
    const record = freshLastHit(campaign.id, ally.id);
    return record?.source === "attack" && record.attacker.kind === "enemy" && record.attacker.id === args.targetEnemyId;
  });
  if (!struckAlly) {
    return { error: `Sentinel answers an attack on someone other than ${sheet.name}, and the server has no such attack by that creature on record. Nothing was spent.` };
  }
  addSheetCondition(campaign, sheet, READIED, { untilTurnOf: sheet.id }, "Sentinel");
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
  return "error" in result ? result : { ...result, reaction: "Sentinel" };
}


// Lucky, against an attack: a luck point has the attacker's d20 rolled
// again and the lower face used (the feat lets the character choose which
// die the attacker uses). No reaction is spent. Answers the last attack on
// record the way Defensive Duelist does.
export function lucky(ctx: Ctx): Record<string, unknown> {
  const { campaign, sheet } = ctx;
  const fresh = getSheetById(sheet.id) ?? sheet;
  if (luckPointsLeft(fresh.resources) === 0) {
    return { error: `${sheet.name} has no luck point to spend${sheet.feats.some((feat) => /lucky|fortunate/i.test(feat)) ? " (they come back with a long rest)" : ": Lucky is not among their feats"}. Nothing was spent.` };
  }
  const record = freshLastHit(campaign.id, sheet.id);
  if (!record || record.source !== "attack" || record.attacker.kind !== "enemy") {
    return { error: `Lucky answers an attack that just hit ${sheet.name}, and the server has no such attack on record. Nothing was spent.` };
  }
  if (record.answered.includes("lucky")) {
    return { error: `A luck point has already answered ${record.attacker.name}'s ${record.attack}. Nothing was spent.` };
  }
  const index = record.swings.findIndex((swing) => swing.hit);
  if (index === -1) {
    return { error: `${record.attacker.name}'s ${record.attack} missed ${sheet.name}; there is no hit to turn away. Nothing was spent.` };
  }
  const spent = spendLuckCounter(fresh.resources);
  const patched = spent ? patchSheet(sheet.id, { resources: spent }) : null;
  if (patched) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: patched });
  }
  const swing = record.swings[index];
  if (swing.natural === null || swing.natural === undefined) {
    return { error: `${record.attacker.name}'s ${record.attack} has no d20 on record to roll again. Nothing was spent.` };
  }
  const again = rollExpression("1d20").total;
  const natural = Math.min(swing.natural, again);
  const total = swing.total - swing.natural + natural;
  const stillHits = natural === 20 || (natural !== 1 && total >= swing.vsAc);
  const corrected = record.swings.map((entry, at) => (at === index && !stillHits ? { ...entry, hit: false, natural, total, raw: 0 } : at === index ? { ...entry, natural, total } : entry));
  const settled = settle(ctx, record, corrected, "lucky");
  return {
    ok: true,
    reaction: "Lucky",
    luckPointsLeft: luckPointsLeft(spent ?? fresh.resources),
    applied: stillHits
      ? `Lucky: ${record.attacker.name}'s d20 rolled again (${swing.natural} and ${again}); the ${natural} still hits.`
      : `Lucky: ${record.attacker.name}'s d20 rolled again (${swing.natural} and ${again}); with the ${natural} the ${record.attack} misses: ${settled.given} hit points come back. HP ${settled.hp}.`,
  };
}


// Boundless Reserves and Sorcerous Vigor (Tome of Heroes): at the start of
// their turn with no ki (or sorcery points) left, the reaction spends one
// Hit Die; the die plus the Constitution modifier, halved (at least 1),
// comes back as points, never past the maximum. The die is gone until a
// long rest, and heals nothing.
export function reservesRecovery(ctx: Ctx, which: "ki" | "sorcery_points"): Record<string, unknown> {
  const { campaign, sheet } = ctx;
  const feat = which === "ki" ? "Boundless Reserves" : "Sorcerous Vigor";
  if (!sheet.feats.some((entry) => entry.trim().toLowerCase() === feat.toLowerCase())) {
    return { error: `${sheet.name} has no ${feat}; that recovery is the feat's. Nothing was spent.` };
  }
  const fresh = getSheetById(sheet.id) ?? sheet;
  const state = fresh.resources?.[which];
  if (!state) {
    return { error: `${sheet.name} has no ${which === "ki" ? "ki points" : "sorcery points"} to recover. Nothing was spent.` };
  }
  if (state.used < state.max) {
    return { error: `${feat} works only with no ${which === "ki" ? "ki points" : "sorcery points"} left, and ${sheet.name} still has ${state.max - state.used}. Nothing was spent.` };
  }
  if (fresh.hitDice.total - fresh.hitDice.spent < 1) {
    return { error: `${sheet.name} has no Hit Die left to spend on ${feat}. Nothing was spent.` };
  }
  spendReaction(ctx);
  const conMod = Math.floor((fresh.abilities.con - 10) / 2);
  const outcome = rollExpression(`1${fresh.hitDice.die}${conMod >= 0 ? `+${conMod}` : conMod}`);
  const regained = Math.min(state.max, Math.max(1, Math.floor(outcome.total / 2)));
  const patched = patchSheet(sheet.id, {
    hitDice: { ...fresh.hitDice, spent: fresh.hitDice.spent + 1 },
    resources: { ...(fresh.resources ?? {}), [which]: { ...state, used: Math.max(0, state.max - regained) } },
  });
  if (patched) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: patched });
  }
  return {
    ok: true,
    reaction: feat,
    spent: SPENT(sheet.name),
    applied: `${feat}: a Hit Die (${outcome.total} with Constitution) brings back ${regained} ${which === "ki" ? "ki point" : "sorcery point"}${regained === 1 ? "" : "s"}; the die is spent and heals nothing.`,
  };
}
