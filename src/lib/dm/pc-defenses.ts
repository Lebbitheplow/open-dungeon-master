// A character's damage defenses: the immunities and resistances their
// lineage, features, spells, rage and worn gear give them, as the keyword
// strings damageAdjust matches against. Split from condition-logic.ts, which
// re-exports both, so every caller keeps its import. Database-free.

import { conditionResistances } from "@/lib/srd/condition-effects";
import { conditionDamageImmunities } from "@/lib/srd/condition-effect-queries";
import { defenseRiders } from "@/lib/srd/feature-effects";
import { chosenResistances, featureDamageImmunities } from "@/lib/srd/trait-rules";
import { authoredResistances } from "@/lib/srd/authored-effects";
import { magicItemRiders } from "@/lib/srd/magic-items";
import { DAMAGE_TYPES, PHYSICAL_TYPES, rageApplies, resistsAllDamage } from "@/lib/dm/damage-logic";

// Damage types a character's features make them immune to (Purity of Body:
// poison), as a keyword string damageAdjust can match against.
export function pcImmunities(sheet: { features: Array<{ name: string }>; conditions?: string[] }): string {
  // A spell's immunity too (Heroes' Feast: poison).
  return [...featureDamageImmunities(sheet), ...conditionDamageImmunities(sheet.conditions ?? [])].join(", ");
}

// Racial, feature, and condition-derived damage resistances a sheet
// carries, as a keyword string damageAdjust can match against.
// Conservative: only unambiguous SRD grants are recognized.
export function pcResistances(sheet: {
  race: string;
  features: Array<{ name: string }>;
  conditions?: string[];
  equipment?: Array<{ name: string; attuned?: boolean; equipped?: boolean }>;
  class?: string;
  level?: number;
}, options?: { magical?: boolean; spell?: boolean }): string {
  const out: string[] = [];
  const race = sheet.race.toLowerCase();
  // The authored subclass features' resistances (Soul of the Forge, a
  // raging bear totem, Spell Resistance against a spell's damage).
  out.push(...authoredResistances(sheet, options));
  // Typed feature effects (parsed subclass features, Heart of the Storm).
  if (sheet.class) {
    out.push(
      ...defenseRiders({
        class: sheet.class,
        level: sheet.level ?? 1,
        features: sheet.features,
      }).resistances,
    );
  }
  // Lineage traits name their resistance directly: "Fire Resistance",
  // "Celestial Resistance (necrotic and radiant)".
  const TYPES = DAMAGE_TYPES;
  for (const feature of sheet.features) {
    const name = feature.name.toLowerCase();
    if (name.includes("resistance")) {
      out.push(...TYPES.filter((type) => name.includes(type)));
    }
  }
  // Rage: resistance to the three physical damage types, for its duration,
  // and not in heavy armor.
  if (rageApplies(sheet)) {
    out.push(...PHYSICAL_TYPES);
  }
  if (resistsAllDamage(sheet.conditions)) {
    out.push(...DAMAGE_TYPES);
  }
  const featureNames = sheet.features.map((feature) => feature.name.toLowerCase());
  const hasFeature = (fragment: string) =>
    featureNames.some((name) => name.includes(fragment));
  if (race.includes("dwarf") || hasFeature("dwarven resilience")) {
    out.push("poison");
  }
  if (race.includes("stout") || hasFeature("stout resilience")) {
    out.push("poison");
  }
  if (race.includes("tiefling") || hasFeature("hellish resistance")) {
    out.push("fire");
  }
  // Fiendish Resilience: the type chosen at the last rest, in the name.
  out.push(...chosenResistances(sheet));
  // Effect conditions (blade ward, stoneskin) grant theirs for a duration.
  // A magical blow goes through the nonmagical-only ones (Stoneskin).
  out.push(...conditionResistances(sheet.conditions ?? [], options));
  // Worn magic items (Ring of Resistance, resistant armor) add their types.
  // "nonmagical damage" (Armor of Invulnerability) is every type, and only
  // for damage that is neither a spell nor magical.
  if (sheet.equipment) {
    const blocking = !options?.magical && !options?.spell;
    out.push(...magicItemRiders(sheet.equipment, sheet).resistances.flatMap((entry) =>
      entry !== "nonmagical damage" ? [entry] : blocking ? DAMAGE_TYPES : []));
  }
  return [...new Set(out)].join(", ");
}
