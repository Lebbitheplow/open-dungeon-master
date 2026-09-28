// What spending an area feature reports: the dice, the save, its DC and, when
// the feature has one, the damage type. Pure, so use_resource and the hand's
// feature cards read the same numbers.
//
// Most area features (the "aoe" effect in class-resources.ts) are the same
// for every holder. The dragonborn's Breath Weapon is not: the draconic
// ancestry sets the damage type and whether the save is Dexterity or
// Constitution (SRD 5.1, Dragonborn). A dragonborn stored before the ancestry
// was chosen has none, and keeps the counter's own dice and Dexterity save.

import type { ResourceDef, SaveAbilityId } from "@/lib/srd/class-resources";
import { ancestryOf, breathWeaponFor, findDraconicAncestry } from "@/lib/srd/racial-grants";

export type AoeSpend = {
  dice: string;
  saveAbility: SaveAbilityId;
  dc: number;
  damageType?: string;
  area?: string;
};

type AoeHolder = {
  features?: Array<{ name: string }>;
  racialChoices?: { ancestry?: string } | null;
};

// The ancestry a sheet holds: the race feature the creation check writes,
// else the choice stored beside the race.
function heldAncestry(sheet: AoeHolder) {
  return ancestryOf(sheet.features ?? []) ?? findDraconicAncestry(sheet.racialChoices?.ancestry);
}

// `level` is the level the counter scales by (resourceLevel: the character
// level for a race feature); the DC is 8 + proficiency + Constitution for
// every area feature ODM counts today.
export function aoeSpendFor(
  def: ResourceDef,
  sheet: AoeHolder,
  level: number,
  derived: { proficiencyBonus: number; abilityMods: Record<string, number> },
): AoeSpend | null {
  if (def.effect.kind !== "aoe") {
    return null;
  }
  const conMod = derived.abilityMods.con ?? 0;
  const ancestry = def.id === "breath_weapon" ? heldAncestry(sheet) : null;
  if (ancestry) {
    const breath = breathWeaponFor(ancestry, level, conMod, derived.proficiencyBonus);
    return {
      dice: breath.dice,
      saveAbility: breath.save,
      dc: breath.dc,
      damageType: breath.damageType,
      area: breath.area,
    };
  }
  return {
    dice: def.effect.dice(level),
    saveAbility: def.effect.save,
    dc: 8 + derived.proficiencyBonus + conMod,
  };
}
