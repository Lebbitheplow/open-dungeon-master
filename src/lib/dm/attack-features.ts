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
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { nameChoice } from "@/lib/srd/feature-names";
import { favoredEnemies } from "@/lib/srd/check-traits";
import { sameRulesKey } from "@/lib/srd/name-forms";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";

type Sheet = Pick<CharacterSheet, "name" | "class" | "level" | "classes" | "features" | "feats" | "conditions" | "resources" | "spellcasting">;

const holds = (sheet: Sheet, condition: string) => sheet.conditions.some((entry) => textKey(entry) === condition);

// ---- Inspiration ----

export function inspirationProblem(sheet: Sheet, asked: boolean | undefined): ToolError | null {
  if (!asked || heldInspiration(sheet)) {
    return null;
  }
  return { error: `${sheet.name} holds no Inspiration to spend. The DM awards it with set_condition condition "inspiration"; attack without useInspiration.`, retry: true };
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
    ? conditions.filter((entry) => !["invisible", "hidden"].includes(textKey(entry)))
    : conditions;
}

// ---- Foe Slayer ----

export const FOE_SLAYER = "foe-slayer";

// The enemy is favored (src/lib/srd/check-traits.ts favoredEnemies) by its
// creature type ("fiend (demon)" is a fiend), a subtype ("humanoid
// (goblinoid, orc)" is an orc) or its row ("goblin"), each whole, in the
// singular or the plural ("monstrosities", "elves"): no name it merely
// holds ("Forcemage" is no orc).
export function isFavoredEnemy(sheet: Sheet, enemy: Pick<EncounterEnemy, "slug" | "stats">): boolean {
  const type = String(enemy.stats.type ?? "");
  const kinds = [textKey(enemy.slug), textKey(type.replace(/\s*\([^()]*\)\s*$/, "")), ...(nameChoice(type) ?? "").split(",").map(textKey)].filter(Boolean);
  return favoredEnemies(sheet).some((favored) => kinds.some((kind) => sameRulesKey(kind, favored)));
}

// The bonus Foe Slayer can add to this attack, or 0: a ranger 20 (or the
// feature) against a favored enemy, on their own turn, not yet used this turn.
export function foeSlayerBonus(
  sheet: Sheet,
  derived: Pick<SheetDerived, "abilityMods">,
  enemy: Pick<EncounterEnemy, "slug" | "stats">,
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

export function strokeOfLuckProblem(sheet: Sheet, asked: boolean | undefined): ToolError | null {
  if (!asked) {
    return null;
  }
  if (!(classLevelOf(sheet, "rogue") >= 20 || holdsFeature(sheet, "stroke of luck"))) {
    return { error: `${sheet.name} does not have Stroke of Luck (a rogue's feature at 20th level); attack without strokeOfLuck.`, retry: true };
  }
  const state = sheet.resources?.[STROKE_OF_LUCK];
  if (!state || state.max - state.used <= 0) {
    return { error: `${sheet.name} has used Stroke of Luck; it comes back on a short or long rest. Attack without strokeOfLuck.`, retry: true };
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
// Hex Warrior (Hexblade 1): the weapon the warlock bound at the end of a
// long rest ("Hex Warrior (Longsword)") swings with Charisma when it is the
// better modifier, for its attack and damage rolls alike.
export function hexWarriorSwing(
  sheet: Sheet & { features: Array<{ name: string; classId?: string; source?: string }> },
  resolved: ResolvedWeapon,
  derived: SheetDerived,
): { derived: SheetDerived; note: string } | null {
  const srd = resolved.srd;
  if (!srd) {
    return null;
  }
  for (const { effect, held } of activeAuthored(sheet, "weapon_ability")) {
    // Battle Ready: any magic weapon. Hex Warrior: the weapon its option names.
    const fits = effect.magicOnly ? Boolean(resolved.gear) : Boolean(held.choice) && textKey(held.choice ?? "") === textKey(srd.name);
    if (!fits) {
      continue;
    }
    const mod = derived.abilityMods[effect.ability];
    if (mod <= Math.max(derived.abilityMods.str, derived.abilityMods.dex)) {
      return null;
    }
    return {
      derived: { ...derived, abilityMods: { ...derived.abilityMods, str: mod, dex: mod } },
      note: `${held.feature}: ${srd.name} swings with ${ABILITY_NAMES[effect.ability] ?? effect.ability}`,
    };
  }
  return null;
}

export function shillelaghSwing(
  sheet: Sheet,
  resolved: ResolvedWeapon,
  derived: SheetDerived,
): { resolved: ResolvedWeapon; derived: SheetDerived; note: string } | null {
  const srd = resolved.srd;
  if (!srd || !SHILLELAGH_WEAPONS.has(textKey(srd.name)) || !holds(sheet, SHILLELAGH) || !sheet.spellcasting) {
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
