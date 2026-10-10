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
import { addConditionInstance, removeConditions, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { findSpellByName, spellMechanicsFor } from "@/lib/content";
import { bakedSpellDuration } from "@/lib/content/baked-spells";
import { durationRounds } from "@/lib/srd/spell-mechanics";
import type { SpellCondition } from "@/lib/srd/spell-mech-types";
import { conditionEffectsFor, type SaveAbilityId } from "@/lib/srd/condition-effects";
import { MECH_OVERRIDES } from "@/lib/srd/spell-mechanics";
import { getDmTurn } from "@/lib/db/dm-turns";
import { rollEnemySave } from "@/lib/dm/forced-save";

// The SRD's own conditions. One of these with no spell recorded on it may
// have come from anywhere (a ghoul's claw, a net), so a spell ending does not
// take it; an effect condition only a spell lays down (blessed, hasted) is
// the spell's even when written before sources were kept.
const SRD_CONDITIONS = new Set([
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained",
  "stunned", "unconscious",
]);

export const spellKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type SpellSource = {
  spell: string;
  casterId: string;
  slotLevel?: number | null;
};

// The rounds a spell lasts at most: its printed duration ("Concentration,
// up to 1 minute" is 10), or the structured row's own count when the pack is
// not there to say. Null for "Instantaneous", "Until dispelled" and the rest
// that carry no count.
export function spellDurationRounds(spell: string, authors?: string | string[]): number | null {
  const row = findSpellByName(spell, authors);
  const fromRow = row ? durationRounds(String(row.data.duration ?? "")) : null;
  if (fromRow) {
    return fromRow;
  }
  // No content pack: the SRD durations baked at build time
  // (scripts/annotate-spell-manifest.mjs).
  const baked = row ? null : bakedSpellDuration(spell);
  if (baked) {
    return baked;
  }
  const mech = spellMechanicsFor({ spell, ...(typeof authors === "string" ? { userId: authors } : {}) })?.mech;
  return mech?.buff?.rounds ?? mech?.condition?.rounds ?? null;
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
  const printed = bySlot ? (bySlot[1] ?? undefined) : condition.rounds;
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
    return spellNames.has(spellKey(meta.spell)) && (!casterId || !meta.source || meta.source === casterId);
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
  const wanted = spellKey(spell);
  for (const row of rows) {
    const delta = parseJson<Record<string, unknown>>(row.delta_json, {});
    if (typeof delta.spell === "string" && spellKey(delta.spell) === wanted) {
      return typeof delta.level === "number" ? delta.level : null;
    }
  }
  return null;
}

// After damage lands on a living enemy: a spell condition that ends on
// damage ends, and one that grants a save on damage rolls it. Returns lines
// for the tool result.
export function spellEffectsOnEnemyDamage(enemyId: string): string[] {
  const enemy = getEnemy(enemyId);
  if (!enemy || enemy.status !== "alive" || !enemy.conditions.length) {
    return [];
  }
  const meta = enemy.conditionMeta as ConditionMetaMap;
  const lines: string[] = [];
  const ending = new Set<string>();
  // A condition that ends on damage ends with every condition its spell laid
  // down with it (Hypnotic Pattern's charm and incapacitation together).
  const endingSpells = new Set<string>();
  for (const name of enemy.conditions) {
    if (meta[name]?.endsOnDamage) {
      ending.add(name);
      if (meta[name]?.spell) {
        endingSpells.add(`${spellKey(meta[name].spell ?? "")}|${meta[name].source ?? ""}`);
      }
    }
  }
  const saved = new Set<string>();
  for (const name of enemy.conditions) {
    const entry = meta[name];
    if (!entry?.saveOnDamage || ending.has(name)) {
      continue;
    }
    const tag = `${spellKey(entry.spell ?? "")}|${entry.source ?? ""}`;
    if (saved.has(tag)) {
      continue;
    }
    saved.add(tag);
    const { ability, dc, advantage } = entry.saveOnDamage;
    // Rolled as every enemy save is (src/lib/dm/forced-save.ts): its
    // conditions count, and the DM sees the roll.
    const outcome = rollEnemySave(enemy.campaignId, enemy, ability, dc, {
      magical: true,
      resist: true,
      advantage,
      record: { detail: `${enemy.displayName}: ${ability.toUpperCase()} save against ${entry.spell ?? name} (hurt)` },
    });
    if (outcome.success) {
      endingSpells.add(tag);
      lines.push(
        `${enemy.displayName} is hurt and shakes off ${entry.spell ?? name} (${ability.toUpperCase()} save ${outcome.total ?? "failed"} vs DC ${dc}${advantage ? ", with advantage" : ""}).`,
      );
    } else {
      lines.push(
        `${enemy.displayName} is hurt but stays ${name} (${ability.toUpperCase()} save ${outcome.total ?? "failed"} vs DC ${dc}).`,
      );
    }
  }
  for (const name of enemy.conditions) {
    const entry = meta[name];
    if (entry?.spell && endingSpells.has(`${spellKey(entry.spell)}|${entry.source ?? ""}`)) {
      ending.add(name);
    }
  }
  if (!ending.size) {
    return lines;
  }
  const cleared = removeConditions(enemy.conditions, enemy.conditionMeta, [...ending]);
  patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
  if (![...ending].every((name) => meta[name]?.saveOnDamage)) {
    lines.push(`${enemy.displayName} is no longer ${[...ending].join(" or ")}: the damage ends it.`);
  }
  return lines;
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
export function spellEffectRefusal(condition: string, turnId: string): string | null {
  const row = conditionEffectsFor(condition);
  const names = [condition.toLowerCase(), ...(row?.match ?? []), ...(row ? [row.id.replace(/_/g, " ")] : [])];
  const spellEffect = names.some((name) => SPELL_EFFECT_NAMES.has(name) || SPELL_EFFECT_NAMES.has(name.replace(/ \(.*$/, "")));
  if (!spellEffect) {
    return null;
  }
  if (getDmTurn(turnId)?.actor === "human_dm") {
    return null;
  }
  return `${condition} is a spell's effect: cast the spell with cast_buff (or cast_at_enemy), which spends the slot and the action and tracks concentration. set_condition does not hand it out.`;
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
