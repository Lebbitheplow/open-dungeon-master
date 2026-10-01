// The class features and racial traits that ride an ability check because of
// what the check is about (SRD 5.1), read by the roll resolver
// (src/lib/dm/rolls.ts resolveRollExpression) from the roll's reason:
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

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

export type CheckInput = {
  ability?: string;
  skill?: string;
  reason?: string;
  proficiencyBonus: number;
  // The check already carries proficiency (a proficient skill).
  proficient: boolean;
  // Supreme Sneak's condition, measured by the caller from the board.
  movedLittle?: boolean;
};

export type CheckTraits = { advantage: string[]; bonus: number; notes: string[] };

// The names a feature records after a colon or in brackets ("Favored Enemy:
// undead, fiends", "Natural Explorer (forest)").
function namedPicks(sheet: TraitSheet, feature: RegExp): string[] {
  const out: string[] = [];
  for (const entry of sheet.features ?? []) {
    const match = feature.exec(entry.name.trim());
    if (match?.[1]) {
      out.push(...match[1].split(/,|\band\b/).map((word) => lower(word).replace(/s$/, "")).filter(Boolean));
    }
  }
  return out;
}

const mentions = (reason: string, word: string) => new RegExp(`\\b${word}s?\\b`, "i").test(reason);

export function traitCheckRiders(sheet: TraitSheet & { race?: string }, input: CheckInput): CheckTraits {
  const out: CheckTraits = { advantage: [], bonus: 0, notes: [] };
  const reason = lower(input.reason);
  const skill = lower(input.skill);
  const ability = lower(input.ability);
  const race = lower(sheet.race);

  const favored = namedPicks(sheet, /^favored enemy(?: improvement)?\s*[:(]\s*([^)]*)\)?$/i);
  const aboutFavored = favored.find((type) => mentions(reason, type));
  if (aboutFavored && (skill === "survival" && /track|trail|follow|hunt/.test(reason) || ability === "int")) {
    out.advantage.push(`Favored Enemy: advantage on this check about ${aboutFavored}`);
  }

  const terrains = namedPicks(sheet, /^natural explorer(?: improvement)?\s*[:(]\s*([^)]*)\)?$/i);
  const inTerrain = terrains.find((terrain) => mentions(reason, terrain));
  if (inTerrain && input.proficient && (ability === "int" || ability === "wis")) {
    out.bonus += input.proficiencyBonus;
    out.notes.push(`Natural Explorer: double proficiency in the ${inTerrain}`);
  }

  if (skill === "history") {
    const stonework = /\b(stone|stonework|masonry|rock|carved|tunnel|dwarven)\b/.test(reason);
    if (stonework && (holdsFeature(sheet, "stonecunning") || /dwarf/.test(race))) {
      out.bonus += input.proficient ? input.proficiencyBonus : 2 * input.proficiencyBonus;
      out.notes.push("Stonecunning: double proficiency on History about stonework");
    }
    const device = /\b(magic|magical|wand|staff|rod|potion|alchemical|alchemy|device|devices|mechanism|clockwork|artifact|ring|amulet)\b/.test(reason);
    if (device && (holdsFeature(sheet, "artificer's lore") || race === "rock gnome" || race === "rock_gnome")) {
      out.bonus += input.proficient ? input.proficiencyBonus : 2 * input.proficiencyBonus;
      out.notes.push("Artificer's Lore: twice the proficiency bonus on History about magic items and devices");
    }
  }

  if (skill === "stealth") {
    const rocky = /\b(rock|rocks|rocky|stone|stones|cave|caves|cavern|underground|mountain|boulder|boulders|rubble)\b/.test(reason);
    if (rocky && (holdsFeature(sheet, "stone camouflage") || /deep gnome|deep_gnome|svirfneblin/.test(race))) {
      out.advantage.push("Stone Camouflage: advantage on Stealth in rocky terrain");
    }
    if (input.movedLittle && holdsFeature(sheet, "supreme sneak")) {
      out.advantage.push("Supreme Sneak: advantage on Stealth after moving no more than half their speed");
    }
  }
  return out;
}
