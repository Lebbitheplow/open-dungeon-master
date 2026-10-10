// Casting a spell that makes creatures (cast_buff with the creature in
// `variant`): the rule for what and how many is asked first
// (src/lib/srd/summon-spells.ts), the slot is spent through the one cast
// guard, and then the creatures arrive with their SRD stat blocks as allies
// (src/lib/dm/summon-store.ts). Nothing is spent on a refusal.
//
// Imported by cast-buff.ts only; it reaches mutations.ts through the cast
// callback, so it must not be imported by mutations.ts.

import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { computeSheetDerived, spellAttackFor } from "@/lib/srd";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { summonPlan, type SummonSpell } from "@/lib/srd/summon-spells";
import type { SummonForm } from "@/lib/srd/summon-forms";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { removeSummon, spawnSummons, summonsOf } from "@/lib/dm/summon-store";
import { SUMMONED, summonRecord } from "@/lib/dm/summon-rules";

export type SummonCastArgs = {
  caster: CharacterSheet;
  spell: SummonSpell;
  // The name it is cast under: a table's workshop copy's own ("Call the
  // Wild" running as Conjure Animals), the spell's otherwise. What the slot
  // is spent on, concentration holds, and the creatures answer to.
  castAs?: string;
  level?: number;
  variant?: string;
  count?: number;
  reason?: string;
};

// The Arcane Hand's numbers are its caster's: hit points equal to their hit
// point maximum, the fist at their spell attack bonus, 2d8 more per slot
// level above 5th.
function handForm(form: SummonForm, caster: CharacterSheet, slotLevel: number): SummonForm {
  const bonus = spellAttackFor(caster, "Arcane Hand") ?? computeSheetDerived(caster).spellAttack ?? 0;
  const dice = 4 + 2 * Math.max(0, slotLevel - 5);
  return {
    ...form,
    hp: Math.max(1, caster.maxHp),
    attacks: [{ name: "Clenched Fist", toHit: bonus, damage: `${dice}d8`, type: "force" }],
  };
}

// Faithful Hound's bite is its caster's: their spell attack bonus
// (spellcasting modifier + proficiency bonus) for 4d8 piercing.
function houndForm(form: SummonForm, caster: CharacterSheet): SummonForm {
  const bonus = spellAttackFor(caster, "Faithful Hound") ?? computeSheetDerived(caster).spellAttack ?? 0;
  return { ...form, attacks: form.attacks.map((attack) => ({ ...attack, toHit: bonus })) };
}

// The form a spell makes of the block: the caster's numbers where the spell
// gives them.
function formFor(spell: SummonSpell, form: SummonForm, caster: CharacterSheet, slotLevel: number): SummonForm {
  if (spell.name === "Arcane Hand") {
    return handForm(form, caster, slotLevel);
  }
  if (spell.name === "Faithful Hound") {
    return houndForm(form, caster);
  }
  return form;
}

// The temporary hit points a subclass gives what its holder summons with a
// spell of this school (Durable Summons: 30 for conjuration), or 0.
export function authoredSummonTempHp(sheet: CharacterSheet, school: string): number {
  return activeAuthored(sheet, "summon_temp_hp")
    .filter((found) => found.effect.school === school)
    .reduce((most, found) => Math.max(most, found.effect.amount), 0);
}

export function castSummon(
  campaign: Campaign,
  args: SummonCastArgs,
  cast: (input: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const { caster, spell } = args;
  const castAs = args.castAs?.trim() || spell.name;
  const slotLevel = Math.max(spell.level, args.level ?? spell.level);
  // Animate Dead, Create Undead: a casting may reassert control over the
  // undead it already made, rather than making new ones.
  if (spell.reassert && /\b(?:reassert|renew|control)\b/i.test(args.variant ?? "")) {
    return reassertControl(campaign, args, slotLevel, cast);
  }
  const plan = summonPlan(spell, slotLevel, args.variant ?? "", args.count);
  if ("error" in plan) {
    return plan;
  }
  const form = formFor(spell, plan.form, caster, slotLevel);

  // Cast again while it still holds, the spell's first casting ends, and
  // the creatures it made with it.
  const recast = spell.concentration && (caster.concentratingOn ?? "").trim().toLowerCase() === castAs.toLowerCase();

  // The spend, through the one cast guard: the list, the slot, the turn, the
  // material, concentration (a second concentration spell ends the first,
  // and the creatures that spell made with it).
  const spent = cast({
    characterId: caster.id,
    spell: castAs,
    level: slotLevel,
    via: "buff",
    reason: (args.reason ?? "").slice(0, 200),
  });
  if ("error" in spent) {
    return spent;
  }
  const spentLevel = typeof spent.slotLevel === "number" ? spent.slotLevel : slotLevel;

  // Find Steed: one steed at a time; the new casting's steed replaces it.
  const replaced: string[] = [];
  if (spell.single || recast) {
    for (const old of summonsOf(campaign.id, caster.id, castAs)) {
      removeSummon(campaign, old);
      replaced.push(old.name);
    }
  }
  const fresh = getSheetById(caster.id) ?? caster;
  // Durable Summons (School of Conjuration 14): what a conjuration spell
  // makes arrives with 30 temporary hit points.
  const durableHp = authoredSummonTempHp(fresh, spell.school);
  const durable = durableHp > 0;
  const record = summonRecord(form, {
    spell: castAs,
    casterId: caster.id,
    casterName: caster.name,
    concentration: spell.concentration,
    hostileOnBreak: spell.hostileOnBreak,
    controlExpires: spell.controlExpires,
    castId: randomUUID().slice(0, 8),
  });
  const created = spawnSummons(campaign, fresh, {
    form,
    count: plan.count,
    record,
    rounds: spell.rounds,
    slotLevel: spentLevel,
    initiative: spell.beforeCaster ? "before" : spell.initiative,
    ...(spell.conditions?.length ? { conditions: spell.conditions } : {}),
    ...(durable ? { tempHp: durableHp } : {}),
    overrides: {
      ...(spell.minInt ? { int: spell.minInt } : {}),
      ...(spell.speed ? { speed: spell.speed } : {}),
    },
  });
  const attacks = form.attacks.length
    ? form.attacks.map((attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type}${(attack.riders ?? []).map((rider) => ` + ${rider.dice} ${rider.type}`).join("")})`).join(", ")
    : "none: it cannot attack";
  return {
    ok: true,
    spell: castAs,
    ...(castAs !== spell.name ? { runsAs: spell.name } : {}),
    summoned: created.map((sheet) => ({ characterId: sheet.id, name: sheet.name, hp: `${sheet.currentHp}/${sheet.maxHp}`, ac: sheet.ac })),
    creature: `${form.name} (${form.type}, CR ${form.cr}): ${form.hp} HP, AC ${form.ac}, speed ${spell.speed ?? form.speed} ft. Attacks: ${attacks}${(form.attacksPerTurn ?? 1) > 1 ? ` (${form.attacksPerTurn} per Attack action)` : ""}.`,
    ...(form.traits ? { traits: form.traits } : {}),
    ...(durable ? { durableSummons: `Durable Summons: each arrives with ${durableHp} temporary hit points.` } : {}),
    ...(replaced.length ? { replaced: `${replaced.join(", ")} ${replaced.length === 1 ? "is" : "are"} gone: ${spell.single ? "one at a time" : "the first casting ended"}.` } : {}),
    ...(spent.slot ? { slot: spent.slot } : {}),
    ...(spent.cost ? { cost: spent.cost } : {}),
    ...(spent.droppedConcentration ? { droppedConcentration: spent.droppedConcentration } : {}),
    ...(spell.concentration ? { concentration: `${caster.name} is concentrating on ${castAs}; the creatures vanish when it ends${spell.hostileOnBreak ? " (if it breaks, the creature turns hostile instead)" : ""}.` } : {}),
    spellNote: spell.note,
    note: `They are allies on the board and in the initiative order${spell.beforeCaster ? ", acting right before " + caster.name : spell.initiative === "caster" ? ", acting right after " + caster.name : ""}. Each attacks with pc_attack (its own characterId) on its turn; the server rolls its stat block's numbers. At 0 hit points one disappears. Narrate exactly this.`,
  };
}

// Reasserting control: the slot is spent and up to so many of the caster's
// undead from this spell are held another full duration.
function reassertControl(
  campaign: Campaign,
  args: SummonCastArgs,
  slotLevel: number,
  cast: (input: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const { caster, spell } = args;
  const held = summonsOf(campaign.id, caster.id, spell.name);
  if (!held.length) {
    return { error: `${caster.name} has no creatures of ${spell.name} to reassert control over. Nothing was spent.` };
  }
  const most = (spell.reassert ?? 0) + (spell.reassertPerSlot ?? 0) * Math.max(0, slotLevel - spell.level);
  const spent = cast({ characterId: caster.id, spell: spell.name, level: slotLevel, via: "buff", reason: (args.reason ?? "reasserting control").slice(0, 200) });
  if ("error" in spent) {
    return spent;
  }
  const renewed = held.slice(0, most).map((sheet) => {
    const meta = { ...(sheet.conditionMeta ?? {}) } as Record<string, Record<string, unknown>>;
    const key = Object.keys(meta).find((name) => name.toLowerCase() === SUMMONED) ?? SUMMONED;
    meta[key] = { ...(meta[key] ?? {}), rounds: spell.rounds ?? undefined };
    patchSheet(sheet.id, { conditionMeta: meta as typeof sheet.conditionMeta });
    return sheet.name;
  });
  return {
    ok: true,
    spell: spell.name,
    reasserted: renewed,
    note: `${caster.name} reasserts control over ${renewed.join(", ")} for another ${spell.rounds === DAY_ROUNDS ? "24 hours" : "full duration"}${held.length > most ? `; ${held.length - most} more are beyond this casting's hold` : ""}.`,
  };
}

const DAY_ROUNDS = 14400;
