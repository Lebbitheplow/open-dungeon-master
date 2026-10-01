// The class features and effects that change a character's attack after the
// first two repair waves left them narrated (SRD 5.1):
//   - Feral Senses (ranger 18): attacking a creature the ranger cannot see
//     has no disadvantage for it.
//   - Foe Slayer (ranger 20): once on each of the ranger's turns, the WIS
//     modifier added to the attack roll or the damage of an attack against a
//     favored enemy. The server adds it where it counts: to a roll that
//     misses by no more than the modifier, else to a hit's damage.
//   - Stroke of Luck (rogue 20): a missed attack hits instead; once a short
//     rest. Declared on the call (strokeOfLuck), spent only on a miss.
//   - Shillelagh: a club or quarterstaff attacks and deals damage with the
//     spellcasting ability, rolls a d8, and is magical.
//   - Inspiration: spent for advantage on the attack roll.
// Pure functions of the sheet and the numbers; pc-attack*.ts calls them and
// writes what they decide.

import type { EncounterEnemy } from "@/lib/db/encounters";
import type { ResolvedWeapon } from "@/lib/dm/attack-logic";
import { heldInspiration } from "@/lib/dm/roll-riders";
import type { SheetDerived } from "@/lib/srd";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Sheet = Pick<CharacterSheet, "name" | "class" | "level" | "classes" | "features" | "feats" | "conditions" | "resources" | "spellcasting">;

const lower = (value: string) => value.trim().toLowerCase();
const holds = (sheet: Sheet, condition: string) => sheet.conditions.some((entry) => lower(entry) === condition);

// ---- Inspiration ----

export function inspirationProblem(sheet: Sheet, asked: boolean | undefined): string | null {
  if (!asked || heldInspiration(sheet)) {
    return null;
  }
  return `${sheet.name} holds no Inspiration to spend. The DM awards it with set_condition condition "inspiration"; attack without useInspiration.`;
}

// ---- Feral Senses ----

export function hasFeralSenses(sheet: Sheet): boolean {
  return classLevelOf(sheet, "ranger") >= 18 || holdsFeature(sheet, "feral senses");
}

// The target's conditions as a Feral Senses ranger's attack meets them: an
// invisible or hidden creature is still unseen, but that no longer costs the
// roll anything.
export function seenTargetConditions(sheet: Sheet, conditions: string[]): string[] {
  return hasFeralSenses(sheet)
    ? conditions.filter((entry) => !["invisible", "hidden"].includes(lower(entry)))
    : conditions;
}

// ---- Foe Slayer ----

export const FOE_SLAYER = "foe-slayer";

// The creature types (and, for humanoids, the races) a ranger's Favored
// Enemy names: a feature written "Favored Enemy: undead, fiends" or
// "Favored Enemy (orcs)". None recorded, none favored.
export function favoredEnemyTypes(sheet: Sheet): string[] {
  const out: string[] = [];
  for (const feature of sheet.features) {
    const match = /^favored enemy(?: improvement)?\s*[:(]\s*([^)]*)\)?$/i.exec(feature.name.trim());
    if (match) {
      out.push(
        ...match[1]
          .split(/,|\band\b/)
          .map((entry) => lower(entry).replace(/s$/, ""))
          .filter(Boolean),
      );
    }
  }
  return out;
}

export function isFavoredEnemy(sheet: Sheet, enemy: Pick<EncounterEnemy, "displayName" | "stats">): boolean {
  const type = lower(String(enemy.stats.type ?? ""));
  const name = lower(enemy.displayName);
  return favoredEnemyTypes(sheet).some((favored) => type.includes(favored) || name.includes(favored));
}

// The bonus Foe Slayer can add to this attack, or 0: a ranger 20 (or the
// feature) against a favored enemy, on their own turn, not yet used this turn.
export function foeSlayerBonus(
  sheet: Sheet,
  derived: Pick<SheetDerived, "abilityMods">,
  enemy: Pick<EncounterEnemy, "displayName" | "stats">,
  oncePerTurn: string[] | null,
): number {
  if (!oncePerTurn || oncePerTurn.includes(FOE_SLAYER)) {
    return 0;
  }
  if (!(classLevelOf(sheet, "ranger") >= 20 || holdsFeature(sheet, "foe slayer")) || !isFavoredEnemy(sheet, enemy)) {
    return 0;
  }
  return Math.max(0, derived.abilityMods.wis);
}

// ---- Stroke of Luck ----

export const STROKE_OF_LUCK = "stroke_of_luck";

export function strokeOfLuckProblem(sheet: Sheet, asked: boolean | undefined): string | null {
  if (!asked) {
    return null;
  }
  if (!(classLevelOf(sheet, "rogue") >= 20 || holdsFeature(sheet, "stroke of luck"))) {
    return `${sheet.name} does not have Stroke of Luck (a rogue's feature at 20th level); attack without strokeOfLuck.`;
  }
  const state = sheet.resources?.[STROKE_OF_LUCK];
  if (!state || state.max - state.used <= 0) {
    return `${sheet.name} has used Stroke of Luck; it comes back on a short or long rest. Attack without strokeOfLuck.`;
  }
  return null;
}

// What becomes of a missed attack roll: Foe Slayer's bonus turns a miss by
// no more than itself into a hit (never a natural 1), and a declared Stroke
// of Luck turns any miss into a hit. Foe Slayer is tried first: it costs
// nothing a rest has to give back.
export function rescueMiss(input: {
  total: number;
  ac: number;
  natural1: boolean;
  foeSlayer: number;
  strokeOfLuck: boolean;
}): "foe slayer" | "stroke of luck" | null {
  if (input.foeSlayer > 0 && !input.natural1 && input.total + input.foeSlayer >= input.ac) {
    return "foe slayer";
  }
  return input.strokeOfLuck ? "stroke of luck" : null;
}

// ---- Shillelagh ----

const SHILLELAGH = "shillelagh";
const SHILLELAGH_WEAPONS = new Set(["club", "quarterstaff"]);

// The weapon and the numbers a Shillelagh swing is made with, or null when
// the spell does not touch this attack: the base weapon's die becomes a d8
// (a quarterstaff's two-handed d8 stays one), and the spellcasting ability
// stands in for Strength when it is better.
export function shillelaghSwing(
  sheet: Sheet,
  resolved: ResolvedWeapon,
  derived: SheetDerived,
): { resolved: ResolvedWeapon; derived: SheetDerived; note: string } | null {
  const srd = resolved.srd;
  if (!srd || !SHILLELAGH_WEAPONS.has(lower(srd.name)) || !holds(sheet, SHILLELAGH) || !sheet.spellcasting) {
    return null;
  }
  const casting = derived.abilityMods[sheet.spellcasting.ability];
  const type = srd.damage.trim().split(/\s+/).slice(1).join(" ") || "bludgeoning";
  return {
    resolved: {
      ...resolved,
      srd: {
        ...srd,
        damage: `1d8 ${type}`,
        properties: (srd.properties ?? []).filter((property) => property !== "versatile"),
      },
    },
    derived: {
      ...derived,
      abilityMods: { ...derived.abilityMods, str: Math.max(derived.abilityMods.str, casting) },
    },
    note: `Shillelagh: ${srd.name} deals 1d8 with the spellcasting ability, and is magical`,
  };
}

export function underShillelagh(sheet: Sheet, weaponName: string | undefined): boolean {
  return holds(sheet, SHILLELAGH) && SHILLELAGH_WEAPONS.has(lower(weaponName ?? ""));
}
