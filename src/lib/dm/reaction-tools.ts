// use_reaction: a character's reaction, resolved by the engine.
//
// Before this the reaction was spent and the rest was a note: Uncanny Dodge
// told the model to "heal the difference back", Shield to "narrate
// accordingly", Cutting Words spent no die, a reaction spell's effect was
// "narrate its effect", and anyone could use any of them. Now:
//   - only the holder of a feature uses it, and a refusal spends nothing;
//   - a reaction to a hit that already landed re-resolves that attack from
//     the engine's record of it (src/lib/dm/last-hit.ts) and gives back what
//     the rules give back (src/lib/dm/reaction-refund.ts);
//   - a reaction spell is a cast through the one guard, and Hellish Rebuke
//     resolves as cast_at_enemy does;
//   - an opportunity attack is the server's own on a battle map, and off
//     the map is resolved here as one attack with the reaction.
// Split from action-tools.ts, which re-exports the handler.

import { defensiveDuelist, lucky, mageSlayer, reservesRecovery, sentinel } from "@/lib/dm/feat-reactions";
import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, saveEncounter } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { d20Expression } from "@/lib/dice";
import { publishPersisted } from "@/lib/events";
import { acBreakdownFor, computeSheetDerived } from "@/lib/srd";
import { martialArtsDie } from "@/lib/srd/feature-effects";
import { enemyAcWithEffects } from "@/lib/dm/ac-effects";
import { kiSpend } from "@/lib/dm/bonus-actions";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import { classLevelFor } from "@/lib/srd/multiclass";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { spellFactsFor } from "@/lib/content";
import { addSheetCondition, rollCard } from "@/lib/dm/action-common";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { canAct } from "@/lib/dm/can-act";
import { removeConditions } from "@/lib/dm/condition-logic";
import { freshLastHit, rerollAttacker, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import type { RollAttacker } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { opportunity, reactionSpell } from "@/lib/dm/reaction-spells";
import { settleLastHit } from "@/lib/dm/reaction-refund";
import { authoredReaction } from "@/lib/dm/authored-reactions";
import { freeAuthoredReaction } from "@/lib/dm/authored-reactions-more";
import { srdFeatureReaction } from "@/lib/dm/srd-reactions";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { PRONE } from "@/lib/dm/vitals-logic";

const useReactionSchema = z.object({
  characterId: z.string(),
  feature: z.string().max(80),
  targetCharacterId: z.string().optional(),
  targetEnemyId: z.string().optional(),
  // Counterspell: the spell being countered.
  spell: z.string().max(80).optional(),
  // A reaction spell cast from a higher slot (Counterspell at 5th).
  level: z.coerce.number().int().min(1).max(9).optional(),
  // A reaction that moves the character (Skirmisher, Relentless Avenger):
  // the square on the battle map.
  x: z.coerce.number().int().min(0).optional(),
  y: z.coerce.number().int().min(0).optional(),
  reason: z.string().optional(),
});

type Args = z.infer<typeof useReactionSchema>;
export type Ctx = {
  campaign: Campaign;
  turn: DmTurn;
  sheet: CharacterSheet;
  args: Args;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
  encounter: ReturnType<typeof getActiveEncounter>;
};

function holds(sheet: CharacterSheet, name: string): boolean {
  return sheet.features.some((feature) => feature.name.toLowerCase().includes(name));
}

export function spendReaction(ctx: Ctx) {
  const live = ctx.encounter ? getActiveEncounter(ctx.campaign.id) : null;
  if (live && !live.reactionsUsed.includes(ctx.sheet.id)) {
    live.reactionsUsed = [...live.reactionsUsed, ctx.sheet.id];
    saveEncounter(live);
  }
}

export const SPENT = (name: string) => `${name}'s reaction is used until the start of their next turn.`;

export function allyOf(ctx: Ctx): CharacterSheet | null {
  const ref = ctx.args.targetCharacterId
    ? resolveSheetRef(ctx.args.targetCharacterId, ctx.sheets, ctx.sheetsById)
    : null;
  return ref ? (getSheetById(ref.id) ?? ref) : null;
}

// The hit swing a one-attack reaction answers: the heaviest one still
// standing (a multiattack is several attacks; the reaction takes one).
function heaviestHit(swings: SwingRecord[], which: (swing: SwingRecord) => boolean = () => true): number {
  let best = -1;
  swings.forEach((swing, index) => {
    if (swing.hit && which(swing) && (best < 0 || swing.raw > swings[best].raw)) {
      best = index;
    }
  });
  return best;
}

export function noHit(who: string, feature: string, what = "an attack that hit them"): string {
  return `${feature} answers ${what} this turn, and the server has none on record against ${who}. Nothing was spent.`;
}

export function settle(ctx: Ctx, record: LastHit, corrected: SwingRecord[], label: string) {
  return settleLastHit(ctx.campaign, ctx.turn.id, record, corrected, label, ctx.sheets, ctx.sheetsById);
}

// ---- features ----

function uncannyDodge(ctx: Ctx): Record<string, unknown> {
  const { sheet, campaign } = ctx;
  if (classLevelFor(sheet, "rogue") < 5 && !holds(sheet, "uncanny dodge")) {
    return { error: `${sheet.name} does not have Uncanny Dodge (a rogue's feature from 5th level). Nothing was spent.` };
  }
  const record = freshLastHit(campaign.id, sheet.id);
  const index = record && record.source === "attack" && !record.answered.includes("uncanny dodge") ? heaviestHit(record.swings) : -1;
  if (!record || index < 0) {
    return { error: noHit(sheet.name, "Uncanny Dodge") };
  }
  const corrected = record.swings.map((swing, at) => (at === index ? { ...swing, raw: Math.floor(swing.raw / 2) } : swing));
  spendReaction(ctx);
  const settled = settle(ctx, record, corrected, "uncanny dodge");
  return {
    ok: true,
    reaction: "Uncanny Dodge",
    spent: SPENT(sheet.name),
    applied: `The ${record.attack} hit's damage is halved: ${settled.given} hit points come back. HP ${settled.hp}.`,
    ...(settled.notes.length ? { notes: settled.notes } : {}),
  };
}

function deflectMissiles(ctx: Ctx): Record<string, unknown> {
  const { sheet, campaign } = ctx;
  const monk = classLevelFor(sheet, "monk");
  if (monk < 3 && !holds(sheet, "deflect missile")) {
    return { error: `${sheet.name} does not have Deflect Missiles (a monk's feature from 3rd level). Nothing was spent.` };
  }
  const record = freshLastHit(campaign.id, sheet.id);
  const index =
    record && record.source === "attack" && !record.answered.includes("deflect missiles")
      ? heaviestHit(record.swings, (swing) => swing.ranged ?? record.ranged)
      : -1;
  if (!record || index < 0) {
    return { error: noHit(sheet.name, "Deflect Missiles", "a ranged weapon attack that hit them") };
  }
  spendReaction(ctx);
  const dex = computeSheetDerived(sheet).abilityMods.dex;
  const die = rollCard(campaign, ctx.turn, sheet.id, "custom", `${sheet.name}: Deflect Missiles`, "1d10", null).total;
  const reduction = die + dex + (monk || sheet.level);
  const corrected = record.swings.map((swing, at) =>
    at === index ? { ...swing, raw: Math.max(0, swing.raw - reduction) } : swing,
  );
  const caught = corrected[index].raw === 0;
  const settled = settle(ctx, record, corrected, "deflect missiles");
  const thrown = caught && ctx.args.targetEnemyId ? throwBack(ctx, record, monk || sheet.level) : null;
  return {
    ok: true,
    reaction: "Deflect Missiles",
    spent: SPENT(sheet.name),
    reduction: `1d10 (${die}) + DEX ${dex} + monk level ${monk || sheet.level} = ${reduction}`,
    applied: `${settled.given} hit points come back. HP ${settled.hp}.${
      caught
        ? thrown
          ? " The missile is caught and thrown back."
          : " The missile is caught: the damage is gone. With 1 ki it can be thrown back: pass targetEnemyId with the reaction."
        : ""
    }`,
    ...(thrown ? { throwBack: thrown } : {}),
  };
}

// A caught missile thrown back for 1 ki, as part of the same reaction: a
// ranged attack with it as a monk weapon, proficient, range 20/60, DEX to
// hit and damage, the Martial Arts die.
function throwBack(ctx: Ctx, record: LastHit, monkLevel: number): Record<string, unknown> {
  const { sheet, campaign, encounter } = ctx;
  const enemy = encounter && ctx.args.targetEnemyId ? resolveEnemyRef(encounter.id, ctx.args.targetEnemyId) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    return { error: "The missile can be thrown back at a living enemy from GAME STATE; it was caught and kept." };
  }
  const apart = tilesBetween(encounter.id, sheet.id, enemy.id);
  if (apart !== null && apart > 12) {
    return { error: `${enemy.displayName} is ${apart * 5} ft away, past the missile's 60 ft; it was caught and kept.` };
  }
  const ki = kiSpend(getSheetById(sheet.id) ?? sheet, 1, "throwing the missile back");
  if ("error" in ki) {
    return { error: `${ki.error} The missile was caught and kept.` };
  }
  const paid = patchSheet(sheet.id, { resources: ki.resources });
  if (paid) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: paid });
  }
  const derived = computeSheetDerived(sheet);
  const bonus = derived.abilityMods.dex + derived.proficiencyBonus;
  const thrower: RollAttacker = { kind: "sheet", id: sheet.id, name: sheet.name };
  const hitRoll = rollCard(campaign, ctx.turn, sheet.id, "attack", rollAgainst("Caught missile", enemy.displayName), d20Expression(bonus, apart !== null && apart > 4 ? "disadvantage" : "none"), thrower);
  const ac = enemyAcWithEffects(campaign.id, enemy);
  const hit = hitRoll.crit !== "nat1" && (hitRoll.crit === "nat20" || hitRoll.total >= ac);
  if (!hit) {
    return { rolled: hitRoll.total, vsAc: ac, hit: false, ki: "1 ki spent" };
  }
  const faces = `1${martialArtsDie(monkLevel)}`;
  const damage = rollCard(campaign, ctx.turn, sheet.id, "damage", rollAgainst("Caught missile", enemy.displayName), hitRoll.crit === "nat20" ? `${faces}+${faces}+${derived.abilityMods.dex}` : `${faces}+${derived.abilityMods.dex}`, thrower);
  const applied = applyEnemyDamage(campaign, ctx.turn, encounter, enemy, Math.max(0, damage.total), ctx.sheets, ctx.sheetsById, record.type);
  publishEncounter(campaign.id);
  return { rolled: hitRoll.total, vsAc: ac, hit: true, damage: damage.total, ki: "1 ki spent", ...applied };
}

function bardDie(sheet: CharacterSheet): string {
  const level = classLevelFor(sheet, "bard") || sheet.level;
  return level >= 15 ? "1d12" : level >= 10 ? "1d10" : level >= 5 ? "1d8" : "1d6";
}

function cuttingWords(ctx: Ctx): Record<string, unknown> {
  const { sheet, campaign, encounter } = ctx;
  const lore = /lore/i.test(sheet.subclass ?? "") && classLevelFor(sheet, "bard") >= 3;
  if (!lore && !holds(sheet, "cutting words")) {
    return { error: `${sheet.name} does not have Cutting Words (a College of Lore bard's feature from 3rd level). Nothing was spent.` };
  }
  const pool = sheet.resources?.bardic_inspiration;
  if (!pool || pool.used >= pool.max) {
    return { error: `${sheet.name} has no Bardic Inspiration left to spend on Cutting Words. Nothing was spent.` };
  }
  const target = allyOf(ctx) ?? sheet;
  const record = freshLastHit(campaign.id, target.id);
  const index =
    record && record.source === "attack" && record.attacker.kind === "enemy" && !record.answered.includes("cutting words")
      ? record.swings.map((swing) => swing.hit).lastIndexOf(true)
      : -1;
  if (!record || index < 0) {
    return { error: noHit(target.name, "Cutting Words", `an attack that hit ${target.name}`) };
  }
  // The attacker has to be within 60 feet of the bard.
  const apart = encounter && record.attacker.id ? tilesBetween(encounter.id, sheet.id, record.attacker.id) : null;
  if (apart !== null && apart > 12) {
    return {
      error: `${record.attacker.name} is ${apart * 5} ft from ${sheet.name}; Cutting Words reaches a creature within 60 ft. Nothing was spent.`,
    };
  }
  spendReaction(ctx);
  const spentPool = patchSheet(sheet.id, {
    resources: { ...sheet.resources, bardic_inspiration: { max: pool.max, used: pool.used + 1 } },
  });
  if (spentPool) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: spentPool });
  }
  const dieExpression = bardDie(sheet);
  const die = rollCard(campaign, ctx.turn, sheet.id, "custom", `${sheet.name}: Cutting Words`, dieExpression, null).total;
  const swing = record.swings[index];
  // Off the attack roll when that turns the hit into a miss (a natural 20
  // hits whatever the total), otherwise off the damage.
  const missed = swing.natural !== 20 && swing.total - die < swing.vsAc;
  const corrected = record.swings.map((entry, at) =>
    at !== index ? entry : missed ? { ...entry, hit: false, raw: 0 } : { ...entry, raw: Math.max(0, entry.raw - die) },
  );
  const settled = settle(ctx, record, corrected, "cutting words");
  return {
    ok: true,
    reaction: "Cutting Words",
    spent: `${SPENT(sheet.name)} One Bardic Inspiration die is spent.`,
    rolled: `${dieExpression}: ${die}`,
    applied: missed
      ? `${record.attacker.name}'s roll falls from ${swing.total} to ${swing.total - die} against AC ${swing.vsAc}: the hit on ${target.name} becomes a miss, and ${settled.given} hit points come back. HP ${settled.hp}.`
      : `The roll still hits, so the die comes off the damage: ${settled.given} hit points come back to ${target.name}. HP ${settled.hp}.`,
  };
}

function protection(ctx: Ctx): Record<string, unknown> {
  const { sheet, campaign, encounter } = ctx;
  if (!holds(sheet, "protection")) {
    return { error: `${sheet.name} does not have the Protection fighting style. Nothing was spent.` };
  }
  if (!acBreakdownFor(sheet).shieldName) {
    return { error: `The Protection style needs a shield, and ${sheet.name} is not carrying one. Nothing was spent.` };
  }
  const ally = allyOf(ctx);
  if (!ally || ally.id === sheet.id) {
    return { error: "Protection covers another creature: pass the ally's targetCharacterId. Nothing was spent." };
  }
  const apart = encounter ? tilesBetween(encounter.id, sheet.id, ally.id) : null;
  if (apart !== null && apart > 1) {
    return {
      error: `${ally.name} is ${apart * 5} ft from ${sheet.name}; Protection covers a creature within 5 ft. Nothing was spent.`,
    };
  }
  spendReaction(ctx);
  addSheetCondition(campaign, ally, "protected", { untilTurnOf: sheet.id });
  // The attack that called for it, already rolled: rolled again at
  // disadvantage. A straight roll takes the lower of its die and a new one;
  // a roll with advantage becomes a straight one (its first die); one
  // already at disadvantage is unchanged.
  const record = freshLastHit(campaign.id, ally.id);
  const first = record && record.source === "attack" && !record.answered.includes("protection") ? record.swings[0] : null;
  let reread = "";
  if (record && first?.hit && first.natural !== null && first.faces.length) {
    const kept =
      first.advantage === "disadvantage"
        ? first.natural
        : first.advantage === "advantage"
          ? first.faces[0]
          : Math.min(first.natural, rollCard(campaign, ctx.turn, null, "attack", rollAgainst(`${record.attack} again, at disadvantage (Protection)`, ally.name), "1d20", rerollAttacker(record)).total);
    const total = first.total - first.natural + kept;
    const missed = kept !== 20 && (kept === 1 || total < first.vsAc);
    if (missed) {
      const settled = settle(ctx, record, record.swings.map((swing, at) => (at === 0 ? { ...swing, hit: false, raw: 0 } : swing)), "protection");
      reread = ` The attack is rolled again at disadvantage: ${total} against AC ${first.vsAc} misses, and ${settled.given} hit points come back to ${ally.name}.`;
    } else {
      reread = ` The attack is rolled again at disadvantage: ${total} against AC ${first.vsAc} still hits.`;
    }
  }
  return {
    ok: true,
    reaction: "Protection",
    spent: SPENT(sheet.name),
    applied: `${ally.name} is protected: attacks against them roll at disadvantage until ${sheet.name}'s next turn. The server applies it.${reread}`,
  };
}

// A fall answered after it landed: Slow Fall takes off five times the
// monk's level, Feather Fall all of it. Taking none of it means landing on
// their feet.
export function softenFall(ctx: Ctx, target: CharacterSheet, label: string, reduction: number | "all") {
  const record = freshLastHit(ctx.campaign.id, target.id);
  if (!record || record.source !== "fall" || record.answered.includes(label)) {
    return null;
  }
  const corrected = record.swings.map((swing) => ({
    ...swing,
    raw: reduction === "all" ? 0 : Math.max(0, swing.raw - reduction),
  }));
  const settled = settle(ctx, record, corrected, label);
  if (corrected.every((swing) => swing.raw === 0) && !record.before.conditions.some((c) => c.toLowerCase() === PRONE)) {
    const now = getSheetById(target.id);
    if (now?.conditions.some((c) => c.toLowerCase() === PRONE)) {
      const cleared = removeConditions(now.conditions, now.conditionMeta, [PRONE]);
      const updated = patchSheet(now.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
      if (updated) {
        publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
  return settled;
}

function slowFall(ctx: Ctx): Record<string, unknown> {
  const { sheet } = ctx;
  const monk = classLevelFor(sheet, "monk");
  if (monk < 4 && !holds(sheet, "slow fall")) {
    return { error: `${sheet.name} does not have Slow Fall (a monk's feature from 4th level). Nothing was spent.` };
  }
  const record = freshLastHit(ctx.campaign.id, sheet.id);
  if (!record || record.source !== "fall") {
    return { error: noHit(sheet.name, "Slow Fall", "a fall (apply_hazard falling)") };
  }
  spendReaction(ctx);
  const settled = softenFall(ctx, sheet, "slow fall", 5 * (monk || sheet.level))!;
  return {
    ok: true,
    reaction: "Slow Fall",
    ...(ctx.encounter ? { spent: SPENT(sheet.name) } : {}),
    applied: `The fall's damage drops by ${5 * (monk || sheet.level)}: ${settled.given} hit points come back. HP ${settled.hp}.`,
  };
}

export function handleUseReaction(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  let args: Args;
  try {
    args = useReactionSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: use_reaction needs characterId and feature." };
  }
  const staleSheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  const sheet = staleSheet ? (getSheetById(staleSheet.id) ?? staleSheet) : null;
  if (!sheet) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  const encounter = getActiveEncounter(campaign.id);
  // The dead, the dying, the incapacitated and the surprised have no
  // reaction; whose turn it is does not matter to one. A reaction to the
  // hit that dropped them is taken as the hit lands, so it is asked of them
  // as they stood before it.
  const answering = freshLastHit(campaign.id, sheet.id);
  const before = answering && answering.before.currentHp > 0 && sheet.currentHp <= 0 ? answering.before : null;
  const standing = before
    ? { ...sheet, currentHp: before.currentHp, conditions: before.conditions, deathSaves: before.deathSaves }
    : sheet;
  const allowed = canAct({ sheet: standing, encounter, kind: "reaction" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  const feature = args.feature.trim();
  const lowered = feature.toLowerCase();
  const falling = /slow fall|feather fall/.test(lowered);
  if (!encounter && !falling) {
    return { error: "Reactions only exist in combat; there is no active encounter." };
  }
  // Slow and its kin switch reactions off entirely.
  const blocked = conditionBlocksReactions(standing.conditions);
  if (blocked) {
    return {
      error: `${sheet.name} is ${blocked} and cannot take reactions; ${feature} does not happen.`,
    };
  }
  // Part of a reaction already taken (Relentless Avenger's move after the
  // opportunity attack): src/lib/dm/authored-reactions-more.ts.
  const free = freeAuthoredReaction({ campaign, turn, sheet, args, sheets, sheetsById, encounter });
  if (free) {
    return free;
  }
  // A reaction is spent on someone ELSE's turn, so it cannot live in the
  // acting combatant's turn budget. Both sides of the table share
  // encounter.reactionsUsed; a combatant's entry leaves it as their own turn
  // starts (advancePointer).
  if (encounter?.reactionsUsed.includes(sheet.id)) {
    return {
      error: `${sheet.name} has already used their reaction; it comes back at the start of their next turn. ${feature} does not happen.`,
    };
  }
  const ctx: Ctx = { campaign, turn, sheet, args, sheets, sheetsById, encounter };

  if (/opportunity|attack of opportunity/.test(lowered)) {
    return opportunity(ctx);
  }
  // The authored subclass reactions (Spirit Shield, Spectral Defense, Storm's
  // Fury, Divine Allegiance...): src/lib/dm/authored-reactions.ts.
  const authored = authoredReaction(ctx);
  if (authored) {
    return authored;
  }
  // Retaliation, Stand Against the Tide (src/lib/dm/srd-reactions.ts).
  const srd = srdFeatureReaction(ctx);
  if (srd) {
    return srd;
  }
  // A reaction that is a spell is a cast: the caster must hold it and pay
  // its slot through the one guard (src/lib/dm/cast-guard.ts), which
  // refuses before the reaction is spent.
  const spell = spellFactsFor(feature, spellAuthorsFor(campaign));
  if (spell?.castingTime === "reaction") {
    return reactionSpell(ctx, spell.name);
  }
  if (/uncanny dodge/.test(lowered)) {
    return uncannyDodge(ctx);
  }
  if (/deflect missile/.test(lowered)) {
    return deflectMissiles(ctx);
  }
  if (/cutting words/.test(lowered)) {
    return cuttingWords(ctx);
  }
  if (/protection/.test(lowered)) {
    return protection(ctx);
  }
  if (/slow fall/.test(lowered)) {
    return slowFall(ctx);
  }
  // The feats with a reaction (src/lib/dm/feat-reactions.ts).
  if (/defensive duelist/.test(lowered)) {
    return defensiveDuelist(ctx);
  }
  if (/mage slayer/.test(lowered)) {
    return mageSlayer(ctx);
  }
  if (/sentinel|guarded warrior/.test(lowered)) {
    return sentinel(ctx);
  }
  if (/^(?:lucky|fortunate|luck point)$/.test(lowered)) {
    return lucky(ctx);
  }
  if (/boundless reserves/.test(lowered)) {
    return reservesRecovery(ctx, "ki");
  }
  if (/sorcerous vigor/.test(lowered)) {
    return reservesRecovery(ctx, "sorcery_points");
  }
  // Any other reaction must be one the sheet holds; the reaction is spent
  // and the effect is the feature's own text.
  const held = sheet.features.find((entry) => {
    const name = entry.name.toLowerCase();
    return name.includes(lowered) || lowered.includes(name);
  });
  if (!held) {
    return {
      error: `${sheet.name} has no reaction called "${feature}" on their sheet: no feature by that name, and no reaction spell they can cast. Nothing was spent.`,
    };
  }
  spendReaction(ctx);
  return {
    ok: true,
    reaction: held.name,
    spent: SPENT(sheet.name),
    note: `${held.name} is resolved from its own text; anything it rolls or changes goes through its own tool.`,
  };
}
