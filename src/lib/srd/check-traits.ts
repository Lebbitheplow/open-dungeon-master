// The class features and racial traits that ride an ability check because of
// what the check is about (SRD 5.1), read by the roll resolver
// (src/lib/dm/rolls.ts resolveRollExpression) from the roll's fixed choices
// (src/lib/dm/roll-about.ts: about, creature, terrain):
//
//   Favored Enemy (ranger 1): advantage on Wisdom (Survival) checks to track
//     the favored enemies and on Intelligence checks to recall information
//     about them. The enemies are the ones the feature names ("Favored Enemy:
//     undead, fiends"; a Favored Enemy Improvement names more, and a
//     Natural Explorer Improvement more terrain).
//   Natural Explorer (ranger 1): in the favored terrain ("Natural Explorer:
//     forest"), an Intelligence or Wisdom check the ranger is proficient in
//     adds double the proficiency bonus.
//   Stonecunning (dwarf): a History check on the origin of stonework counts
//     as proficient and adds double the proficiency bonus.
//   Artificer's Lore (rock gnome): a History check on magic items, alchemical
//     objects or technological devices adds twice the proficiency bonus.
//   Stone Camouflage (deep gnome): advantage on Stealth checks to hide in
//     rocky terrain.
//   Supreme Sneak (Thief 9): advantage on Stealth checks when the rogue moved
//     no more than half their speed on the same turn (the caller says so).
//
// Pure: the sheet and what the check is come in as values.

import { holdsFeature, type TraitSheet } from "@/lib/srd/trait-rules";
import { keyFits, type RollKey } from "@/lib/srd/roll-keys";
import { NATURAL_TERRAINS, type CheckAbout, type NaturalTerrain } from "@/lib/dm/roll-about";
import { sameRulesKey } from "@/lib/srd/name-forms";
import { textKey } from "@/lib/language/text-logic";
import { isDwarf, speciesHoldsTrait, speciesRulesFor, srdRaceId } from "@/lib/srd/race-id";

export type CheckInput = {
  ability?: string;
  skill?: string;
  about?: CheckAbout;
  // The creature the check is about, by its rules name: a type ("undead") or
  // a humanoid race ("orc").
  creature?: string;
  terrain?: NaturalTerrain;
  proficiencyBonus: number;
  // The check already carries proficiency (a proficient skill).
  proficient: boolean;
  // How much of the proficiency bonus the check already carries: none,
  // half (Jack of All Trades), once, or twice (expertise). A feature that
  // doubles the bonus brings the check to twice and no further; it never
  // adds a third (SRD 5.1: a bonus is multiplied only once).
  applied?: number;
  // Supreme Sneak's condition, measured by the caller from the board.
  movedLittle?: boolean;
};

export type CheckTraits = { advantage: string[]; bonus: number; notes: string[] };

// The picks a feature records after a colon or in brackets ("Favored Enemy:
// undead, fiends", "Natural Explorer (forest and swamp)"): keys of ODM's
// English rules vocabulary, like the feature's own name, listed with commas
// or "and", each in the singular or the plural (sameRulesKey).
function namedPicks(sheet: TraitSheet, feature: RegExp): string[] {
  const out: string[] = [];
  for (const entry of sheet.features ?? []) {
    const match = feature.exec(entry.name.trim());
    if (match?.[1]) {
      out.push(...match[1].split(/,|\band\b/).map(textKey).filter(Boolean));
    }
  }
  return out;
}

// The creature types and races a ranger's Favored Enemy (and its
// Improvement) names. None recorded, none favored.
export function favoredEnemies(sheet: TraitSheet): string[] {
  return namedPicks(sheet, /^favored enemy(?: improvement)?\s*[:(]\s*([^)]*)\)?$/i);
}

// The check traits the sheet holds, each as the roll it rides and the values
// it reads (src/lib/srd/roll-keys.ts), with what it gives: advantage, or the
// proficiency bonus brought to twice. The roll applies the ones its fields
// fit (traitCheckRiders), and a model's call that leaves one of those fields
// unnamed is asked for it from the same list.
export type CheckTrait = RollKey & { gives: "advantage" | "double"; note: (input: CheckInput) => string };
export function heldCheckTraits(sheet: TraitSheet & { race?: string }): CheckTrait[] {
  // A bundled species by its id, whichever list spelled it, else a trait the
  // sheet or the species carries (src/lib/srd/race-id.ts).
  const race = srdRaceId(sheet.race ?? "");
  const species = speciesRulesFor(sheet.race ?? "");
  const holds = (name: string) => holdsFeature(sheet, name) || speciesHoldsTrait(species, name);
  const out: CheckTrait[] = [];
  const favored = favoredEnemies(sheet);
  if (favored.length) {
    const note = (input: CheckInput) => `Favored Enemy: advantage on this check about ${input.creature}`;
    out.push({ roll: "check", skills: ["survival"], about: "tracking", creatures: favored, gives: "advantage", note });
    out.push({ roll: "check", abilities: ["int"], creatures: favored, gives: "advantage", note });
  }
  const explored = namedPicks(sheet, /^natural explorer(?: improvement)?\s*[:(]\s*([^)]*)\)?$/i);
  const terrains = NATURAL_TERRAINS.filter((terrain) => explored.some((pick) => sameRulesKey(terrain, pick)));
  if (terrains.length) {
    out.push({ roll: "check", abilities: ["int", "wis"], proficient: true, terrains, gives: "double", note: (input) => `Natural Explorer: double proficiency in the ${input.terrain}` });
  }
  if (holds("stonecunning") || isDwarf(race)) {
    out.push({ roll: "check", skills: ["history"], about: "stonework", gives: "double", note: () => "Stonecunning: double proficiency on History about stonework" });
  }
  if (holds("artificer's lore") || race === "rock_gnome") {
    out.push({ roll: "check", skills: ["history"], about: "devices", gives: "double", note: () => "Artificer's Lore: twice the proficiency bonus on History about magic items and devices" });
  }
  if (holds("stone camouflage") || race === "deep_gnome" || race === "svirfneblin") {
    out.push({ roll: "check", skills: ["stealth"], about: "rocky_terrain", gives: "advantage", note: () => "Stone Camouflage: advantage on Stealth in rocky terrain" });
  }
  return out;
}

export function traitCheckRiders(sheet: TraitSheet & { race?: string }, input: CheckInput): CheckTraits {
  const out: CheckTraits = { advantage: [], bonus: 0, notes: [] };
  const skill = textKey(input.skill ?? "");
  const roll = { roll: "check" as const, skill, ability: textKey(input.ability ?? ""), proficient: input.proficient, about: input.about, creature: input.creature, terrain: input.terrain };
  // What brings the check to twice the bonus from what it carries.
  const doubled = Math.max(0, 2 * input.proficiencyBonus - (input.applied ?? (input.proficient ? input.proficiencyBonus : 0)));
  for (const trait of heldCheckTraits(sheet)) {
    if (!keyFits(trait, roll)) {
      continue;
    }
    if (trait.gives === "advantage") {
      out.advantage.push(trait.note(input));
    } else if (doubled > 0 && out.bonus === 0) {
      out.bonus += doubled;
      out.notes.push(trait.note(input));
    }
  }
  if (skill === "stealth" && input.movedLittle && holdsFeature(sheet, "supreme sneak")) {
    out.advantage.push("Supreme Sneak: advantage on Stealth after moving no more than half their speed");
  }
  return out;
}
