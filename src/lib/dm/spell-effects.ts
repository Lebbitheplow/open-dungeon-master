// What a spell leaves behind on a creature, and what ends it.
//
// A condition a spell lays down carries the spell's name and its caster in
// the condition's metadata (`spell`, `source`), and the slot it was cast
// from (`slotLevel`). That is what lets a broken concentration end THAT
// spell's paralysis and not every paralysis on the board (SRD 5.1,
// Concentration), lets an aura roll the slot's dice, and lets a later turn
// of a concentration spell find the slot it was cast from.
//
// Some spell conditions end when the creature is hurt (Sleep, Hypnotic
// Pattern), and some give it a new save when it is (Hideous Laughter,
// Dominate Person); spellEffectsOnEnemyDamage runs those after damage lands.
//
// This module must not import mutations.ts, cast-tools.ts or
// enemy-damage.ts (they import it).

import { getDatabase, parseJson } from "@/lib/db/core";
import { getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { addConditionInstance, instancesOf, isIncapacitated, removeConditionInstances, removeConditions, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { settleEnemyIncapacitation } from "@/lib/dm/enemy-incapacitation";
import { findSpellByName, spellMechanicsFor } from "@/lib/content";
import { bakedSpellDuration } from "@/lib/content/baked-spells";
import { authoredSpellRow, durationRounds } from "@/lib/srd/spell-mechanics";
import { roundsAtSlot, slotDurationsFromText } from "@/lib/srd/spell-duration";
import type { SpellCondition } from "@/lib/srd/spell-mech-types";
import { conditionEffectsFor, type SaveAbilityId } from "@/lib/srd/condition-effects";
import { MECH_OVERRIDES } from "@/lib/srd/spell-mechanics";
import { getDmTurn } from "@/lib/db/dm-turns";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

// The SRD's own conditions. One of these with no spell recorded on it may
// have come from anywhere (a ghoul's claw, a net), so a spell ending does not
// take it; an effect condition only a spell lays down (blessed, hasted) is
// the spell's even when written before sources were kept.
const SRD_CONDITIONS = new Set([
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained",
  "stunned", "unconscious",
]);

export type SpellSource = {
  spell: string;
  casterId: string;
  slotLevel?: number | null;
};

// The rounds a spell lasts at most: its printed duration ("Concentration,
// up to 1 minute" is 10), or the structured row's own count when the pack is
// not there to say. Null for "Instantaneous", "Until dispelled" and the rest
// that carry no count. With the slot it was cast from, what that slot buys
// (Hex from a 3rd-level slot: eight hours; src/lib/srd/spell-duration.ts).
export function spellDurationRounds(spell: string, authors?: string | string[], slotLevel?: number | null): number | null {
  const row = findSpellByName(spell, authors);
  const mech = spellMechanicsFor({ spell, ...(typeof authors === "string" ? { userId: authors } : Array.isArray(authors) ? { userIds: authors } : {}) })?.mech;
  // No content pack: the SRD durations baked at build time
  // (scripts/annotate-spell-manifest.mjs).
  const base =
    (row ? durationRounds(String(row.data.duration ?? "")) : null) ||
    (row ? null : bakedSpellDuration(spell)) ||
    (mech?.buff?.rounds ?? mech?.condition?.rounds ?? null);
  return lifetimeAtSlot(spell, base, slotLevel, authors);
}

// What the slot a spell was cast from makes of a lifetime of `base` rounds:
// the row's `durationBySlot`, or the spell's own higher-level text. Null is
// "until dispelled".
export function lifetimeAtSlot(spell: string, base: number | null, slotLevel?: number | null, authors?: string | string[]): number | null {
  if (!slotLevel) {
    return base;
  }
  const row = findSpellByName(spell, authors);
  const mech = spellMechanicsFor({ spell, ...(typeof authors === "string" ? { userId: authors } : Array.isArray(authors) ? { userIds: authors } : {}) })?.mech;
  const text = String(row?.data.higher_level ?? authoredSpellRow(spell)?.higher_level ?? "");
  return roundsAtSlot(base, slotLevel, mech?.durationBySlot ? { at: mech.durationBySlot } : slotDurationsFromText(text));
}

// The metadata one condition of a spell is stored with: its duration (the
// spell's rounds), a repeat save where the spell grants one, who cast it, and
// what ends it early. A repeat save never outlives the spell (SRD 5.1, Hold
// Person: "The spell ends... after 1 minute"), so a save-ends condition keeps
// the spell's duration as its count too.
export function spellConditionMeta(
  condition: Pick<SpellCondition, "rounds" | "roundsBySlot" | "saveEnds" | "endsOnDamage" | "saveOnDamage">,
  source: SpellSource,
  save: { ability: SaveAbilityId; dc: number } | null,
  roundsOverride?: number,
): ConditionMeta {
  // A higher slot can buy a longer lifetime, or none at all (Geas at 9th).
  const bySlot = (condition.roundsBySlot ?? []).filter(([level]) => (source.slotLevel ?? 0) >= level).pop();
  // A condition that lasts as long as the spell lasts as long as the slot
  // makes the spell last (Dominate Person from a 7th-level slot: an hour).
  const spellLong = !bySlot && condition.rounds !== undefined && source.slotLevel && condition.rounds === spellDurationRounds(source.spell);
  const printed = bySlot ? (bySlot[1] ?? undefined) : spellLong ? (lifetimeAtSlot(source.spell, condition.rounds ?? null, source.slotLevel) ?? undefined) : condition.rounds;
  const rounds = roundsOverride ?? printed ?? (condition.saveEnds && !bySlot ? spellDurationRounds(source.spell) ?? undefined : undefined);
  return {
    ...(condition.saveEnds && save ? { saveEnds: { ability: save.ability, dc: save.dc } } : {}),
    ...(rounds ? { rounds } : {}),
    spell: source.spell.slice(0, 80),
    source: source.casterId.slice(0, 80),
    ...(source.slotLevel ? { slotLevel: source.slotLevel } : {}),
    ...(condition.endsOnDamage ? { endsOnDamage: true } : {}),
    ...(condition.saveOnDamage && save
      ? { saveOnDamage: { ability: save.ability, dc: save.dc, ...(condition.saveOnDamage === "advantage" ? { advantage: true } : {}) } }
      : {}),
  };
}

// Lays a spell's conditions on a living enemy, each one it is not immune to.
// A condition it already holds from another source holds from this one too,
// each with its own lifetime (two casters' Hold Person: ending one leaves
// the other). Returns what landed.
export function laySpellConditionsOnEnemy(enemyId: string, names: string[], meta: ConditionMeta): string[] {
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive") {
    return [];
  }
  const immune = (enemy.stats.conditionImmune ?? "").toLowerCase();
  const landing = names.filter((name) => !immune.includes(name));
  if (!landing.length) {
    return [];
  }
  let conditions = enemy.conditions;
  let nextMeta: ConditionMetaMap = { ...(enemy.conditionMeta as ConditionMetaMap) };
  for (const name of landing) {
    const laid = addConditionInstance(conditions, nextMeta, name, meta);
    conditions = laid.conditions;
    nextMeta = laid.meta;
  }
  patchEnemyConditions(enemy.id, conditions, nextMeta);
  // Taken out of action: its concentration and its grapples end.
  settleEnemyIncapacitation(enemy.id, isIncapacitated(enemy.conditions));
  return landing;
}

// Whether one condition instance belongs to a spell's casting. With the
// spell recorded on it: the spell's name and, when a caster is named, that
// caster. With nothing recorded (written before sources were kept): only an
// effect condition no other source lays down.
export function heldBySpell(
  name: string,
  meta: ConditionMeta | undefined,
  spellNames: Set<string>,
  conditionNames: Set<string>,
  casterId?: string,
): boolean {
  const lowered = name.toLowerCase();
  if (meta?.spell) {
    return spellNames.has(textKey(meta.spell)) && (!casterId || !meta.source || meta.source === casterId);
  }
  return conditionNames.has(lowered) && !SRD_CONDITIONS.has(lowered);
}

// The slot level the caster last cast a spell from, read from the audit
// trail every cast writes (cast-guard.ts records the spell and the level).
// Null when the trail holds no such cast, or the spell was a cantrip.
export function lastCastSlot(characterId: string, spell: string): number | null {
  const rows = getDatabase()
    .prepare(
      `SELECT delta_json FROM sheet_audit WHERE character_id = ? AND kind = 'use_spell_slot' ORDER BY seq DESC LIMIT 60`,
    )
    .all(characterId) as Array<{ delta_json: string }>;
  const wanted = textKey(spell);
  for (const row of rows) {
    const delta = parseJson<Record<string, unknown>>(row.delta_json, {});
    if (typeof delta.spell === "string" && textKey(delta.spell) === wanted) {
      return typeof delta.level === "number" ? delta.level : null;
    }
  }
  return null;
}

// After damage lands on a living enemy: a spell condition that ends on
// damage ends, and one that grants a save on damage rolls it. Each source of
// a condition is settled on its own (condition-logic.ts instances): Hypnotic
// Pattern's incapacitation ends while Hideous Laughter's, on the same
// creature, saves. Returns lines for the tool result.
export function spellEffectsOnEnemyDamage(enemyId: string): string[] {
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive" || !enemy.conditions.length) {
    return [];
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  const lines: string[] = [];
  const settled = settleOnDamage(enemy.conditions, meta, (entry, name) => {
    const { ability, dc, advantage } = entry.saveOnDamage ?? { ability: "wis" as const, dc: 10 };
    // Rolled as every enemy save is (src/lib/dm/forced-save.ts): its
    // conditions count, and the DM sees the roll.
    const outcome = rollEnemySave(enemy.campaignId, enemy, ability, dc, {
      magical: true,
      resist: true,
      advantage,
      against: name,
      record: { detail: `${enemy.displayName}: ${ability.toUpperCase()} save against ${entry.spell ?? name} (hurt)` },
    });
    lines.push(
      outcome.success
        ? `${enemy.displayName} is hurt and shakes off ${entry.spell ?? name} (${ability.toUpperCase()} save ${outcome.total ?? "failed"} vs DC ${dc}${advantage ? ", with advantage" : ""}).`
        : `${enemy.displayName} is hurt but stays ${name} (${ability.toUpperCase()} save ${outcome.total ?? "failed"} vs DC ${dc}).`,
    );
    return outcome.success;
  });
  if (!settled.changed) {
    return lines;
  }
  patchEnemyConditions(enemy.id, settled.conditions, settled.meta);
  if (settled.endedByDamage.length) {
    lines.push(`${enemy.displayName} is no longer ${settled.endedByDamage.join(" or ")}: the damage ends it.`);
  }
  return lines;
}

// The one settlement of damage-triggered endings, for a character or a
// creature: every instance that ends on damage goes, with the conditions its
// spell laid beside it (Hypnotic Pattern's charm and incapacitation); every
// spell that grants a save on damage saves once (`save` rolls it) and goes on
// a success. Other sources of the same condition keep holding.
export function settleOnDamage(
  conditions: string[],
  meta: ConditionMetaMap,
  save: (entry: ConditionMeta, name: string) => boolean,
): { conditions: string[]; meta: ConditionMetaMap; changed: boolean; endedByDamage: string[] } {
  const tagOf = (entry: ConditionMeta) => (entry.spell || entry.source ? `${textKey(entry.spell ?? "")}|${entry.source ?? ""}` : null);
  const ending = new Set<string>();
  const byDamage = new Set<string>();
  for (const name of conditions) {
    for (const entry of instancesOf(meta[name])) {
      const tag = entry.endsOnDamage ? tagOf(entry) : null;
      if (tag) {
        ending.add(tag);
        byDamage.add(tag);
      }
    }
  }
  const saved = new Set<string>();
  for (const name of conditions) {
    for (const entry of instancesOf(meta[name])) {
      const tag = tagOf(entry);
      if (!entry.saveOnDamage || entry.endsOnDamage || !tag || ending.has(tag) || saved.has(tag)) {
        continue;
      }
      saved.add(tag);
      if (save(entry, name)) {
        ending.add(tag);
      }
    }
  }
  let next = { conditions, meta };
  let changed = false;
  const endedByDamage: string[] = [];
  for (const name of conditions) {
    const result = removeConditionInstances(next.conditions, next.meta, name, (entry) => {
      const tag = tagOf(entry);
      return entry.endsOnDamage === true || (tag !== null && ending.has(tag));
    });
    if (result.removed) {
      changed = true;
      next = { conditions: result.conditions, meta: result.meta };
      const tags = instancesOf(meta[name]).map(tagOf);
      if (result.ended && tags.some((tag) => tag === null || byDamage.has(tag))) {
        endedByDamage.push(name);
      }
    }
  }
  return { ...next, changed, endedByDamage };
}

// The effect conditions only a spell lays down (blessed, hasted, aided,
// spirit guardians), from the spell rows. An SRD condition (invisible,
// prone) is never among them: a potion or a fall lays those too.
const SPELL_EFFECT_NAMES = new Set(
  Object.values(MECH_OVERRIDES)
    .flatMap((mech) => [
      mech.buff?.condition,
      ...(mech.buff?.variants ?? []),
      ...(mech.buff?.bySlot ?? []).map(([, name]) => name),
      mech.condition?.name,
    ])
    .filter((name): name is string => Boolean(name))
    .map((name) => name.toLowerCase())
    .filter((name) => !SRD_CONDITIONS.has(name)),
);

// Why set_condition refuses a spell's effect condition, or null. The AI DM
// casts a spell with cast_buff, which spends the slot, the action and the
// concentration; a free set_condition "blessed" skipped all three (N:B2).
// A person at the DM console may still set one, as a correction.
export function spellEffectRefusal(condition: string, turnId: string): ToolError | null {
  const row = conditionEffectsFor(condition);
  const names = [condition.toLowerCase(), ...(row?.match ?? []), ...(row ? [row.id.replace(/_/g, " ")] : [])];
  const spellEffect = names.some((name) => SPELL_EFFECT_NAMES.has(name) || SPELL_EFFECT_NAMES.has(name.replace(/ \(.*$/, "")));
  if (!spellEffect) {
    return null;
  }
  if (getDmTurn(turnId)?.actor === "human_dm") {
    return null;
  }
  return { error: `${condition} is a spell's effect: cast the spell with cast_buff (or cast_at_enemy), which spends the slot and the action and tracks concentration. set_condition does not hand it out.`, retry: true };
}

// Death Ward: the first time damage would drop the holder to 0 hit points
// they drop to 1 instead, and the spell ends (SRD 5.1). The patch that does
// it, or null when they hold no ward.
export function deathWardPatch(sheet: {
  conditions: string[];
  conditionMeta: ConditionMetaMap | Record<string, ConditionMeta>;
}): { currentHp: number; conditions: string[]; conditionMeta: ConditionMetaMap } | null {
  const ward = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "death ward");
  if (!ward) {
    return null;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, [ward]);
  return { currentHp: 1, conditions: cleared.conditions, conditionMeta: cleared.meta };
}
