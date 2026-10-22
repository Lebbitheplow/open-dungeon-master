// What a check is about and what a save resists, as fixed choices: the
// circumstances class features, racial traits and feats key on (Favored
// Enemy, Stonecunning, Brave, Fey Ancestry, Dungeon Delver...). The caller
// names them, the model in request_roll's `about` and `against`, an engine
// from what it knows (a spell's condition, a poison), and the rules read the
// choice, never the words of a roll's reason, which are the table's language.
//
// No I/O, so the console's forms, the tool schemas and the test scripts read
// the same lists.

import { normalizeCreatureType, type CreatureType } from "@/lib/bestiary/creature-type";
import { CONDITION_VALUES, DAMAGE_TYPE_VALUES } from "@/lib/dm/catalog-vocab";

// The circumstances a check can be about, each read by the features named.
export const CHECK_ABOUT = [
  // Favored Enemy (with Survival), Stalker.
  "tracking",
  // Stonecunning.
  "stonework",
  // Artificer's Lore: magic items, alchemical objects, technological devices.
  "devices",
  // Stone Camouflage.
  "rocky_terrain",
  // Actor: passing as someone else.
  "disguise",
  // Forest Denizen: escaping vegetation's or a beast's hold.
  "escape_plants_or_beast",
  // Floriographer: a hidden message of a visual kind.
  "hidden_message",
  // Surgical Combatant: diagnosing or treating a wound.
  "wounds",
  // Monster Hunter: a creature's legends, lore and weaknesses.
  "creature_lore",
  // Crafting Expert: crafting, maintaining or repairing.
  "crafting",
  // Ace Driver: driving or piloting a vehicle.
  "vehicles",
  // The bear's Aspect of the Beast: pushing, pulling, lifting or breaking.
  "push_pull_lift_break",
] as const;
export type CheckAbout = (typeof CHECK_ABOUT)[number];

// Natural Explorer's favored terrains (SRD 5.1).
export const NATURAL_TERRAINS = ["arctic", "coast", "desert", "forest", "grassland", "mountain", "swamp", "underdark"] as const;
export type NaturalTerrain = (typeof NATURAL_TERRAINS)[number];

// What a call says when a check is about, or a save resists, none of the
// listed values: asked for when a trait the roller holds would answer one
// (src/lib/srd/roll-keys.ts unnamedRollKeys).
export const NONE = "none";
export function named<T extends string>(value: T | typeof NONE | undefined): Exclude<T, typeof NONE> | undefined {
  return value === NONE ? undefined : (value as Exclude<T, typeof NONE>);
}

// The senses a check can need (src/lib/srd/sense-checks.ts).
export const CHECK_SENSES = ["sight", "hearing"] as const;

// What a check is about, as a check tool's fields (request_roll,
// group_check): one wording, so the two never drift.
export const CHECK_KEY_PROPERTIES = {
  about: {
    type: "string",
    enum: [...CHECK_ABOUT, NONE],
    description:
      "A check: the circumstance it is about, or 'none': the server applies the features keyed to it (Favored Enemy and Stalker on tracking, Stonecunning, Artificer's Lore on devices, Stone Camouflage on rocky terrain, Actor on a disguise, and the feats' riders).",
  },
  creature: {
    type: "string",
    description:
      "A check about a creature: its type or humanoid race by the rules name, singular ('undead', 'orc', 'giant'), or 'none', for Favored Enemy and Giant Foe.",
  },
  terrain: {
    type: "string",
    enum: [...NATURAL_TERRAINS, NONE],
    description: "A check made in one of these terrains, for Natural Explorer, or 'none'.",
  },
  by: {
    type: "string",
    enum: [...CHECK_SENSES, NONE],
    description: "A check that needs sight or hearing, or 'none': a blinded or deafened character fails it.",
  },
};

// What a save can resist: a condition, a damage type, a disease, or being
// thrown from a mount (Born to the Saddle). Whether it is magic, and the
// type of a spell's caster, are fields of their own (SaveAgainst).
export const SAVE_AGAINST = [...CONDITION_VALUES, ...DAMAGE_TYPE_VALUES, "disease", "dismount"] as const;
export type SaveAgainstValue = (typeof SAVE_AGAINST)[number];

// What one save resists, as the save-keyed traits read it.
export type SaveAgainst = {
  against?: SaveAgainstValue;
  // A spell or another magical effect (Gnome Cunning, Spell Resistance).
  magical?: boolean;
  // The creature type of the spell's caster (Holy Nimbus).
  casterType?: CreatureType;
};

// An engine's own condition or damage type as a save's `against`, or none
// for one off the list (a story condition, a homebrew damage type).
export function listedAgainst(value: string | undefined): SaveAgainstValue | undefined {
  return SAVE_AGAINST.find((entry) => entry === value);
}

// What an engine's save resists, from what it knows: the condition or the
// damage it lays (the condition first: a poisoned spell's save is against
// being poisoned), whether it is magic, and a spell caster's stat-block type
// (Holy Nimbus: advantage against spells cast by fiends or undead).
export function saveAgainst(parts: { condition?: string; damageType?: string; magical?: boolean; spellBy?: string }): SaveAgainst {
  const casterType = parts.spellBy ? normalizeCreatureType(parts.spellBy) : null;
  return {
    against: listedAgainst(parts.condition) ?? listedAgainst(parts.damageType),
    ...(parts.magical || casterType ? { magical: true } : {}),
    ...(casterType ? { casterType } : {}),
  };
}
