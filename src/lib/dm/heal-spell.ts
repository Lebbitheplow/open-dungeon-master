// A healing spell through the heal tool, worked out before anything is
// spent (SRD 5.1):
//
//   - the healing is derived first: the spell's dice (Cure Wounds 1d8 a slot
//     level), a number (Heal 70, +10 a slot level above 6th), or for a spell
//     the server cannot read, the amount sent. A spell with none of these is
//     refused with its slot unspent.
//   - the target is in the spell's reach (touch beside the caster, Healing
//     Word within 60 feet) on a mapped fight.
//   - a dead creature is healed by nothing but a revival spell, inside that
//     spell's window: Revivify a minute, Raise Dead ten days, Resurrection a
//     century, True Resurrection two hundred years.
//   - Spare the Dying stabilizes, it does not heal.
//   - one casting of Mass Healing Word, Mass Cure Wounds or Prayer of
//     Healing reaches six creatures: the later calls the same turn spend
//     nothing (cast-guard.ts open casts).
//   - the modifier is the spellcasting ability of the class that carries
//     the spell; Disciple of Life adds 2 + the slot level; Supreme Healing
//     and Beacon of Hope make the dice their maximum.
//
// This module does not import mutations.ts: the cast is handed in.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { authoredHealMax } from "@/lib/srd/authored-economy";
import { authoredSpellDice } from "@/lib/srd/authored-effects-more";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived, spellSaveDcFor } from "@/lib/srd";
import { spellDamageFor, spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { handleStabilize } from "@/lib/dm/stabilize";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { wakeConditions } from "@/lib/dm/vitals-logic";
import { describeMinutes, minutesSinceDeath } from "@/lib/dm/revival";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Cast = (args: Record<string, unknown>) => Record<string, unknown>;

export type HealSpellOutcome =
  // Heal this much; the cast is paid.
  | { amount: number; note: string }
  // The spell did its own thing (a revival, a stabilize): return this.
  | { done: Record<string, unknown> }
  | { error: string };

const hasFeature = (sheet: CharacterSheet, name: string) =>
  sheet.features.some((feature) => feature.name.trim().toLowerCase().startsWith(name));

// The most a dice expression can roll: "2d8+3" is 19.
export function maximumOf(expression: string): number {
  let total = 0;
  for (const term of expression.replace(/\s+/g, "").split(/(?=[+-])/)) {
    const sign = term.startsWith("-") ? -1 : 1;
    const bare = term.replace(/^[+-]/, "");
    const dice = /^(\d*)d(\d+)$/i.exec(bare);
    total += sign * (dice ? Number(dice[1] || 1) * Number(dice[2]) : Number(bare) || 0);
  }
  return total;
}

export function castHealingSpell(
  campaign: Campaign,
  turnId: string,
  input: {
    target: CharacterSheet;
    caster: CharacterSheet;
    spell: string;
    level?: number;
    amount?: number;
    reason: string;
  },
  cast: Cast,
): HealSpellOutcome | null {
  const authors = spellAuthorsFor(campaign);
  const facts = spellFactsFor(input.spell, authors);
  if (!facts) {
    // Not a spell anybody published or the table wrote: heal by the amount.
    return null;
  }
  const { target, caster } = input;
  const resolved = spellMechanicsFor({ spell: input.spell, userIds: authors });
  const mech = resolved?.mech ?? null;
  const name = resolved?.name ?? facts.name;

  // Spare the Dying stabilizes a dying creature and heals nothing.
  if (name.toLowerCase() === "spare the dying") {
    return { done: handleStabilize(campaign, turnId, target, caster, { method: "spell", reason: input.reason }) };
  }

  // Reach first: nothing is spent on a creature the spell cannot reach.
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && target.id !== caster.id) {
    const reach = spellReachProblem({
      encounterId: encounter.id,
      casterId: caster.id,
      casterName: caster.name,
      targetId: target.id,
      targetName: target.name,
      facts,
    });
    if (reach) {
      return { error: reach };
    }
  }

  if (mech?.revive) {
    return revive(campaign, turnId, input, name, mech.revive, cast);
  }
  if (target.deathSaves?.dead) {
    return {
      error: `${target.name} is DEAD. Healing cannot help: only a spell that returns the dead (Revivify within a minute, Raise Dead within ten days) or the party lead can reverse a death.`,
    };
  }

  // The healing is known before the slot is: dice, a number, or the amount
  // for a spell whose text the server cannot read.
  const plannedSlot = Math.max(facts.level, input.level ?? facts.level);
  const dice = mech?.healing || mech?.healPool
    ? null
    : spellDamageFor({ spell: input.spell, userIds: authors, casterLevel: caster.level, slotLevel: plannedSlot });
  if (mech?.healPool && !(input.amount && input.amount > 0)) {
    return { error: `${name} divides ${mech.healPool} hit points among its targets: send heal with the amount this creature takes. Nothing was spent.` };
  }
  const readable = Boolean(mech?.healing || mech?.healPool || dice);
  if (!readable && !(input.amount && input.amount > 0)) {
    return {
      error: `${name} is not a healing spell the server can roll, so nothing was cast and no slot was spent. Cast it with its own tool, or send heal with an amount for healing that is not a spell.`,
    };
  }

  const paid = cast({
    characterId: caster.id,
    spell: input.spell,
    ...(input.level !== undefined ? { level: input.level } : {}),
    via: "heal",
    ...(mech?.healPool ? { uses: input.amount } : {}),
    reason: input.reason || `${input.spell} on ${target.name}`,
  });
  if ("error" in paid) {
    return { error: String(paid.error) };
  }
  const slotLevel = typeof paid.slotLevel === "number" ? paid.slotLevel : facts.level;
  if (mech?.healPool) {
    // What is left of the pool bounds this share (cast-guard.ts open casts).
    const amount = typeof paid.uses === "number" ? paid.uses : (input.amount ?? 0);
    return { amount, note: `${name}: ${amount} of its ${mech.healPool} hit points.` };
  }
  const shared = paid.continuing ? ` ${String(paid.continuing)}` : paid.shares ? ` ${String(paid.shares)}` : "";

  if (mech?.healing) {
    const amount = mech.healing.flat + (mech.healing.perSlotLevel ?? 0) * Math.max(0, slotLevel - facts.level);
    return { amount, note: `${name}: ${amount} hit points.${shared}` };
  }
  if (!readable) {
    return { amount: input.amount ?? 0, note: `${name}: ${input.amount} hit points as sent.${shared}` };
  }
  const scaled =
    slotLevel === plannedSlot
      ? dice
      : spellDamageFor({ spell: input.spell, userIds: authors, casterLevel: caster.level, slotLevel });
  const expression = scaled?.dice ?? dice?.dice ?? "0";
  // The modifier of the class whose list carries the spell (a cleric's
  // Wisdom, not the wizard side's Intelligence): its save DC less 8 and the
  // proficiency bonus.
  const derived = computeSheetDerived(caster);
  const dc = spellSaveDcFor(caster, input.spell);
  // Regenerate's 4d8 + 15 carries its own bonus: no modifier rides it.
  const modifier = dc !== null && !mech?.healNoModifier ? dc - 8 - derived.proficiencyBonus : 0;
  const riders: string[] = [];
  let bonus = Math.max(0, modifier);
  if (slotLevel >= 1 && hasFeature(caster, "disciple of life")) {
    bonus += 2 + slotLevel;
    riders.push(`Disciple of Life +${2 + slotLevel}`);
  }
  const maximize =
    (slotLevel >= 1 && hasFeature(caster, "supreme healing")) ||
    // Circle of Mortality: on a creature at 0 hit points (authored-effects.ts).
    authoredHealMax(caster, target) !== null ||
    target.conditions.some((entry) => entry.toLowerCase() === "beacon of hope");
  // Enhanced Bond: the wildfire spirit adds 1d8 to a healing spell
  // (src/lib/srd/authored-effects-more.ts).
  const bond = authoredSpellDice(caster, { healing: true }, derived.abilityMods);
  riders.push(...bond.notes);
  const withBond = [expression, ...bond.dice].join("+");
  const full = bonus > 0 ? `${withBond}+${bonus}` : withBond;
  let amount: number;
  if (maximize) {
    amount = maximumOf(full);
    riders.push("the dice at their maximum");
  } else {
    const outcome = rollExpression(full);
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "custom",
      detail: `${name} on ${target.name} (${full})`,
      result: outcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
    amount = outcome.total;
  }
  // Regenerate goes on healing at the start of each of the target's turns
  // (src/lib/dm/spell-aura.ts reads the mark).
  if (mech?.regainEachTurn) {
    markRegenerating(campaign, target.id, name, caster.id);
    riders.push(`${mech.regainEachTurn} more at the start of each of their turns for an hour`);
  }
  // Blessed Healer (Life 6): healing another creature with a slot heals the
  // cleric 2 + the slot's level.
  if (slotLevel >= 1 && target.id !== caster.id && hasFeature(caster, "blessed healer")) {
    const self = getSheetById(caster.id) ?? caster;
    const currentHp = Math.min(effectiveMaxHp(self), self.currentHp + 2 + slotLevel);
    if (currentHp > self.currentHp && self.currentHp > 0) {
      const healed = patchSheet(self.id, { currentHp });
      if (healed) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: healed });
      }
      riders.push(`Blessed Healer: ${caster.name} regains ${currentHp - self.currentHp}`);
    }
  }
  return {
    amount: Math.max(1, amount),
    note: `${name}: ${scaled?.note ?? expression}${riders.length ? ` (${riders.join(", ")})` : ""}, ${Math.max(1, amount)} hit points.${shared}`,
  };
}

// The mark Regenerate leaves: an hour of it, the spell and caster recorded.
function markRegenerating(campaign: Campaign, targetId: string, spell: string, casterId: string) {
  const sheet = getSheetById(targetId);
  if (!sheet) {
    return;
  }
  const name = "regenerating";
  const conditions = sheet.conditions.includes(name) ? sheet.conditions : [...sheet.conditions, name];
  const updated = patchSheet(sheet.id, {
    conditions,
    conditionMeta: { ...sheet.conditionMeta, [name]: { rounds: 600, spell, source: casterId } },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function revive(
  campaign: Campaign,
  turnId: string,
  input: { target: CharacterSheet; caster: CharacterSheet; spell: string; level?: number; reason: string },
  name: string,
  rule: { hp: "one" | "all"; withinMinutes: number; ordeal?: boolean },
  cast: Cast,
): HealSpellOutcome {
  const { target } = input;
  if (!target.deathSaves?.dead) {
    return {
      error: `${target.name} is not dead; ${name} returns the dead to life. Heal them with a healing spell instead. Nothing was spent.`,
    };
  }
  const since = minutesSinceDeath(campaign.id, target.id);
  if (since !== null && since > rule.withinMinutes) {
    return {
      error: `${target.name} died ${describeMinutes(since)} ago, longer than ${name} reaches back (${describeMinutes(rule.withinMinutes)}). The spell would fail, so nothing was cast and nothing was spent.`,
    };
  }
  const paid = cast({
    characterId: input.caster.id,
    spell: input.spell,
    ...(input.level !== undefined ? { level: input.level } : {}),
    via: "heal",
    reason: input.reason || `${name} on ${target.name}`,
  });
  if ("error" in paid) {
    return { error: String(paid.error) };
  }
  const fresh = getSheetById(target.id) ?? target;
  const woke = wakeConditions(fresh);
  const hp = rule.hp === "all" ? effectiveMaxHp(fresh) : 1;
  // Coming back is an ordeal (Raise Dead, Resurrection): -4 to attack rolls
  // and saving throws, one less after each long rest.
  const ordeal = rule.ordeal ? "returned from death (-4)" : null;
  const conditions = ordeal && !woke.conditions.includes(ordeal) ? [...woke.conditions, ordeal] : woke.conditions;
  const patch = { deathSaves: null, currentHp: hp, conditions, conditionMeta: woke.conditionMeta };
  const updated = patchSheet(fresh.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: fresh.id,
    turnId,
    kind: "death_state",
    delta: { revived: name, currentHp: hp },
    reason: `${name} cast by ${input.caster.name}`,
    seq: allocateSeq(campaign.id),
    before: fresh,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: fresh.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return {
    done: {
      ok: true,
      revived: target.name,
      spell: name,
      hp: `${hp}/${effectiveMaxHp(fresh)}`,
      ...(paid.slot ? { slot: paid.slot } : {}),
      ...(paid.material ? { material: paid.material } : {}),
      ...(ordeal ? { ordeal: "-4 to attack rolls and saving throws, one less after each long rest" } : {}),
      note: `${target.name} returns to life with ${hp} hit point${hp === 1 ? "" : "s"}; narrate it.`,
    },
  };
}
