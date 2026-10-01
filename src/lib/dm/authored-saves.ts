// What the authored subclass features do to a creature's saving throw and to
// the damage a character's blow deals it (src/lib/srd/authored-effects.ts):
//
//   Magical Ambush: a creature the rogue is hidden from saves at
//     disadvantage against the rogue's spell.
//   Hound of Ill Omen, Eldritch Strike: the marked creature saves at
//     disadvantage against the marker's spell (Eldritch Strike's mark is
//     spent by that save).
//   Corona of Light, Elder Champion: enemies near the holder save at
//     disadvantage against spells (Corona: anyone's; Elder Champion: the
//     paladin's own).
//   Unsettling Words: the die the registry row takes off the next save is
//     spent by it.
//   Inescapable Destruction: the Death cleric's necrotic damage ignores
//     resistance.
//
// The caster is the combatant whose turn it is: a spell a character casts at
// a creature is cast on their own turn, so the pointer names them. Called
// from rollEnemySave (forced-save.ts) and applyEnemyDamage (enemy-damage.ts);
// this module must not import either.

import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { getActiveEncounter, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets } from "@/lib/db/sheets";
import { chebyshev } from "@/lib/battlemap/types";
import type { Advantage } from "@/lib/dice";
import { activeAuthored, hasCondition } from "@/lib/srd/authored-effects";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

// The character whose turn it is, when the pointer rests on one.
export function actingSheetId(encounter: Encounter | null): string | null {
  if (!encounter?.orderReady) {
    return null;
  }
  const entry = encounter.order[encounter.turnIndex];
  return entry?.kind === "pc" ? entry.characterId : null;
}

// Whether two combatants stand within `feet` of each other on the live
// board. With no board there is nothing to measure, and the fiction decides.
export function withinFeet(encounterId: string, fromRef: string, toRef: string, feet: number): boolean {
  const map = getBattleMapForEncounter(encounterId);
  if (!map) {
    return true;
  }
  const from = getTokenByRef(map.id, fromRef);
  const to = getTokenByRef(map.id, toRef);
  if (!from || !to) {
    return false;
  }
  return chebyshev(from.x, from.y, to.x, to.y) <= Math.floor(feet / 5);
}

function sourcedMark(enemy: EncounterEnemy, name: string): { condition: string; source: string | undefined } | null {
  const condition = enemy.conditions.find((entry) => lower(entry) === name);
  if (!condition) {
    return null;
  }
  return { condition, source: (enemy.conditionMeta as ConditionMetaMap)[condition]?.source };
}

function fielded(campaignId: string): CharacterSheet[] {
  return listSheets(campaignId)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((sheet) => !sheet.deathSaves?.dead && sheet.currentHp > 0);
}

export function authoredEnemySave(
  campaignId: string,
  enemy: EncounterEnemy,
  options: { magical?: boolean } = {},
): { sources: Advantage[]; notes: string[] } {
  const sources: Advantage[] = [];
  const notes: string[] = [];
  const encounter = getActiveEncounter(campaignId);
  const actorId = actingSheetId(encounter);
  const spent: string[] = [];
  // Unsettling Words: the registry row has taken its die off this save.
  for (const condition of enemy.conditions) {
    if (/^unsettled \(d\d+\)$/i.test(condition.trim())) {
      spent.push(condition);
    }
  }
  if (encounter && options.magical) {
    for (const holder of fielded(campaignId)) {
      for (const { effect, held } of activeAuthored(holder, "enemy_save")) {
        const mine = holder.id === actorId;
        if (effect.when === "hidden") {
          if (mine && hasCondition(holder, "hidden")) {
            sources.push("disadvantage");
            notes.push(`${held.feature}: ${holder.name} is hidden from it; disadvantage on the save`);
          }
        } else if (effect.when === "marked" && effect.mark) {
          const mark = sourcedMark(enemy, effect.mark);
          if (mine && mark && mark.source === holder.id) {
            sources.push("disadvantage");
            notes.push(`${held.feature}: disadvantage on the save against ${holder.name}'s spell`);
          }
        } else if (effect.when === "near") {
          if ((effect.anyCaster || mine) && withinFeet(encounter.id, holder.id, enemy.id, effect.rangeFt ?? 10)) {
            sources.push("disadvantage");
            notes.push(`${held.feature}: disadvantage on the save within ${effect.rangeFt ?? 10} feet of ${holder.name}`);
          }
        }
      }
      // Eldritch Strike: the fighter's mark, spent by the save against their spell.
      for (const { effect, held } of activeAuthored(holder, "mark")) {
        if (effect.effect !== "save_disadv" || holder.id !== actorId) {
          continue;
        }
        const mark = sourcedMark(enemy, effect.condition);
        if (mark && mark.source === holder.id) {
          sources.push("disadvantage");
          notes.push(`${held.feature}: disadvantage on this save against ${holder.name}'s spell`);
          spent.push(mark.condition);
        }
      }
    }
  }
  if (spent.length) {
    const cleared = removeConditions(enemy.conditions, enemy.conditionMeta, spent);
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
  }
  return { sources, notes };
}

// Inescapable Destruction: the acting character's damage of this type
// ignores the creature's resistance to it.
export function authoredIgnoresResistance(campaignId: string, damageType: string | undefined): string | null {
  const type = (damageType ?? "").trim().toLowerCase();
  if (!type) {
    return null;
  }
  const actorId = actingSheetId(getActiveEncounter(campaignId));
  const actor = actorId ? getSheetById(actorId) : null;
  if (!actor) {
    return null;
  }
  const held = activeAuthored(actor, "ignore_resist").find(({ effect }) => effect.types.includes(type));
  return held ? held.held.feature : null;
}

function reach(range: number | Array<[number, number]>, level: number): number {
  if (typeof range === "number") {
    return range;
  }
  let feet = range[0]?.[1] ?? 10;
  for (const [atLevel, value] of range) {
    if (level >= atLevel) {
      feet = value;
    }
  }
  return feet;
}

// Resistances an ally's aura grants the character now: Aura of Warding
// (spell damage) and Shielding Storm (the storm's type).
export function authoredAuraResistances(campaignId: string, sheet: CharacterSheet, options: { spell?: boolean } = {}): string[] {
  const out: string[] = [];
  const encounter = getActiveEncounter(campaignId);
  for (const holder of fielded(campaignId)) {
    for (const { effect, held } of activeAuthored(holder, "aura_resist")) {
      const inRange =
        holder.id === sheet.id ||
        !encounter ||
        withinFeet(encounter.id, holder.id, sheet.id, reach(effect.rangeFt, held.level));
      if (!inRange) {
        continue;
      }
      if (effect.spells) {
        if (options.spell) {
          out.push(
            "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
            "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
          );
        }
        continue;
      }
      if (effect.typeFrom && holder.id !== sheet.id) {
        const aura = holder.conditions.find((entry) => lower(entry).startsWith(effect.typeFrom!.condition));
        const kind = aura ? /\(([^)]+)\)/.exec(aura)?.[1]?.toLowerCase() : undefined;
        const type = kind ? effect.typeFrom.map[kind] : undefined;
        if (type) {
          out.push(type);
        }
      }
    }
  }
  return [...new Set(out)];
}
