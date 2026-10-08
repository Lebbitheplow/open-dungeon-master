// Class features and racial traits that change a saving throw, a check, a
// condition or a number the sheet derives, as rules the engines read.
//
// feature-effects.ts holds the attack and damage riders; this module holds
// the defensive and derived ones that the audit found only narrated: the
// racial save advantages, the condition immunities features grant, the save
// proficiencies Diamond Soul and Slippery Mind give, the hit points Draconic
// Resilience adds, Primal Champion's scores, and Evasion's damage rule shared
// by every save-for-half path. Pure and database-free, like the rest of
// src/lib/srd, so the roll resolver, set_condition, the damage path, the
// legality check and the level-up all read the same answer.

import { defenseRiders } from "@/lib/srd/feature-effects";
import {
  authoredConditionImmunities,
  authoredDamageImmunities,
  authoredInitiativeAdvantage,
  authoredSaveAdvantages,
  authoredSaveProficiencies,
} from "@/lib/srd/authored-effects";

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
type FeatureLike = { name: string; source?: string; classId?: string };

export type TraitSheet = {
  race?: string;
  class?: string;
  subclass?: string;
  level?: number;
  classes?: Array<{ id: string; level: number; subclass?: string }>;
  features?: FeatureLike[];
  feats?: string[];
  conditions?: string[];
};

const lower = (value: string | undefined) => (value ?? "").trim().toLowerCase();

// Whether the sheet holds a feature whose name starts with (or is) one of
// these names. Racial traits carry their gist in brackets ("Brave (adv. vs
// frightened)"), so the start of the name is what identifies them.
export function holdsFeature(sheet: TraitSheet, ...names: string[]): boolean {
  const wanted = names.map(lower);
  return [...(sheet.features ?? []).map((feature) => feature.name), ...(sheet.feats ?? [])].some(
    (name) => {
      const held = lower(name);
      return wanted.some((term) => held === term || held.startsWith(`${term} (`) || held.startsWith(`${term}:`));
    },
  );
}

// The level a class-scaled feature reads: the class's own level on a
// multiclass sheet, the character level otherwise.
export function classLevelOf(sheet: TraitSheet, classId: string): number {
  const entry = (sheet.classes ?? []).find((item) => lower(item.id) === classId);
  if (entry) {
    return entry.level;
  }
  return lower(sheet.class) === classId ? (sheet.level ?? 1) : 0;
}

function hasCondition(sheet: TraitSheet, ...names: string[]): boolean {
  const held = (sheet.conditions ?? []).map(lower);
  return names.some((name) => held.includes(name));
}

// ---- saving throws ----

const MAGIC_WORDS = /\b(spell|spells|magic|magical|cantrip|enchantment|ritual)\b/i;

// Advantage a trait gives on one save, with the line that says why. `against`
// is what the save resists as the caller named it: a condition ("charmed"),
// a damage type ("poison"), or a word saying the effect is magic ("spell:
// Hold Person"). A save with nothing named gets only the traits that cover
// every save of an ability (Danger Sense).
export function traitSaveAdvantages(
  sheet: TraitSheet,
  ability: Ability | undefined,
  against: string | undefined,
): string[] {
  const text = lower(against);
  const notes: string[] = [];
  if (text && /frighten|fear/.test(text) && holdsBrave(sheet)) {
    notes.push("Brave: advantage on saves against being frightened");
  }
  // Steel Will (a Hunter ranger's Defensive Tactics pick).
  if (text && /frighten|fear/.test(text) && holdsFeature(sheet, "steel will", "defensive tactics: steel will", "defensive tactics (steel will)")) {
    notes.push("Steel Will: advantage on saves against being frightened");
  }
  if (text && /charm/.test(text) && holdsFeature(sheet, "fey ancestry")) {
    notes.push("Fey Ancestry: advantage on saves against being charmed");
  }
  if (
    text &&
    /poison/.test(text) &&
    (holdsFeature(sheet, "dwarven resilience", "stout resilience", "duergar resilience") ||
      /dwarf/.test(lower(sheet.race)))
  ) {
    notes.push("advantage on saves against poison (resilience)");
  }
  if (
    text &&
    (ability === "int" || ability === "wis" || ability === "cha") &&
    MAGIC_WORDS.test(text) &&
    holdsFeature(sheet, "gnome cunning")
  ) {
    notes.push("Gnome Cunning: advantage on INT, WIS and CHA saves against magic");
  }
  // Countercharm (bard 6): allies hearing the performance have advantage on
  // saves against being frightened or charmed while the condition lasts.
  if (text && /charm|frighten|fear/.test(text) && hasCondition(sheet, "countercharm")) {
    notes.push("Countercharm: advantage on saves against being charmed or frightened");
  }
  // Holy Nimbus (Oath of Devotion 20): while it shines, advantage on saves
  // against spells cast by fiends or undead. The save's `against` names the
  // caster's type (cast-at-player.ts saveAgainst, aoe-damage.ts).
  if (text && /\bspell\b/.test(text) && /\b(fiend|undead)\b/.test(text) && hasCondition(sheet, "holy nimbus")) {
    notes.push("Holy Nimbus: advantage on saves against spells cast by fiends or undead");
  }
  if (ability === "dex" && dangerSenseWorks(sheet)) {
    notes.push("Danger Sense: advantage on DEX saves");
  }
  // The authored subclass features' own (Unyielding Spirit, Beguiling
  // Twist, Spell Resistance...): src/lib/srd/authored-effects.ts.
  notes.push(...authoredSaveAdvantages(sheet, ability, against));
  return notes;
}

// Brave, as the builder writes it or as a race-sourced trait of that name.
function holdsBrave(sheet: TraitSheet): boolean {
  return (sheet.features ?? []).some((feature) => {
    const name = lower(feature.name);
    return name.includes("brave") && (feature.source === "race" || name.includes("frighten"));
  });
}

// Danger Sense: the barbarian must be able to see and hear what is coming,
// so it does nothing while they are blinded, deafened or incapacitated.
function dangerSenseWorks(sheet: TraitSheet): boolean {
  if (!sheet.class) {
    return false;
  }
  const riders = defenseRiders({
    class: sheet.class,
    level: sheet.level ?? 1,
    features: sheet.features ?? [],
  });
  if (!riders.saveAdvantage.has("dex")) {
    return false;
  }
  return !hasCondition(
    sheet,
    "blinded",
    "deafened",
    "incapacitated",
    "paralyzed",
    "stunned",
    "unconscious",
    "petrified",
  );
}

// Saves a feature makes the character proficient in, on top of the class
// table's two: Diamond Soul (monk 14) all six, Slippery Mind (rogue 15) WIS.
export function featureSaveProficiencies(sheet: TraitSheet): Ability[] {
  if (holdsFeature(sheet, "diamond soul")) {
    return ["str", "dex", "con", "int", "wis", "cha"];
  }
  if (holdsFeature(sheet, "slippery mind")) {
    return ["wis", ...authoredSaveProficiencies(sheet).filter((ability) => ability !== "wis")];
  }
  return authoredSaveProficiencies(sheet);
}

// Initiative rolled with advantage: Feral Instinct (barbarian 7).
export function initiativeAdvantage(sheet: TraitSheet): string | null {
  return holdsFeature(sheet, "feral instinct")
    ? "Feral Instinct: advantage on initiative"
    : authoredInitiativeAdvantage(sheet);
}

// Indomitable Might (barbarian 18): a Strength check whose total is less than
// the Strength score uses the score. Returned as the lowest d20 face that
// reaches it, for the dice grammar's floor suffix.
export function strengthCheckFloor(
  sheet: TraitSheet,
  strengthScore: number,
  modifier: number,
): number | null {
  if (!holdsFeature(sheet, "indomitable might")) {
    return null;
  }
  const face = strengthScore - modifier;
  return face > 1 ? Math.min(20, face) : null;
}

// ---- conditions ----

// The conditions a character's own features keep off them. Rage-gated ones
// (Mindless Rage) count only while raging. `sleep` is Fey Ancestry's
// immunity to being put to sleep by magic, which set_condition reads off the
// reason an unconscious condition is given.
export function featureConditionImmunities(sheet: TraitSheet): {
  conditions: Array<{ condition: string; because: string }>;
  magicalSleep: string | null;
} {
  const out: Array<{ condition: string; because: string }> = [];
  const add = (condition: string, because: string) => out.push({ condition, because });
  if (holdsFeature(sheet, "aura of courage")) {
    add("frightened", "Aura of Courage");
  }
  if (holdsFeature(sheet, "aura of devotion")) {
    add("charmed", "Aura of Devotion");
  }
  if (holdsFeature(sheet, "mindless rage") && hasCondition(sheet, "raging")) {
    add("charmed", "Mindless Rage");
    add("frightened", "Mindless Rage");
  }
  if (holdsFeature(sheet, "purity of body")) {
    add("poisoned", "Purity of Body");
    add("diseased", "Purity of Body");
  }
  if (holdsFeature(sheet, "nature's ward")) {
    add("poisoned", "Nature's Ward");
    add("diseased", "Nature's Ward");
  }
  if (holdsFeature(sheet, "divine health")) {
    add("diseased", "Divine Health");
  }
  if (holdsFeature(sheet, "constructed resilience")) {
    add("poisoned", "Constructed Resilience");
    add("diseased", "Constructed Resilience");
  }
  const magicalSleep = holdsFeature(sheet, "fey ancestry")
    ? "Fey Ancestry"
    : holdsFeature(sheet, "constructed resilience")
      ? "Constructed Resilience"
      : null;
  out.push(...authoredConditionImmunities(sheet));
  return { conditions: out, magicalSleep };
}

// Immunities that depend on who is causing the condition: Purity of Spirit
// (Devotion 15, always under Protection from Evil and Good) against the
// charm, fear and possession of aberrations, celestials, elementals, fey,
// fiends and undead; Nature's Ward (Land 10) against elementals' and fey's
// charm and fear. `creatureType` is the source's stat block type.
export function sourcedConditionImmunity(
  sheet: TraitSheet,
  condition: string,
  creatureType: string | undefined,
): string | null {
  const type = lower(creatureType);
  if (!type || (condition !== "charmed" && condition !== "frightened")) {
    return null;
  }
  if (holdsFeature(sheet, "purity of spirit") && /aberration|celestial|elemental|fey|fiend|undead/.test(type)) {
    return "Purity of Spirit";
  }
  if (holdsFeature(sheet, "nature's ward") && /elemental|fey/.test(type)) {
    return "Nature's Ward";
  }
  return null;
}

// The conditions a paladin's aura keeps off everyone near them (Aura of
// Courage, Aura of Devotion), while the paladin is conscious.
export function auraConditionImmunities(sheet: TraitSheet): Array<{ condition: string; because: string }> {
  const out: Array<{ condition: string; because: string }> = [];
  if (holdsFeature(sheet, "aura of courage")) {
    out.push({ condition: "frightened", because: "Aura of Courage" });
  }
  if (holdsFeature(sheet, "aura of devotion")) {
    out.push({ condition: "charmed", because: "Aura of Devotion" });
  }
  return out;
}

// Damage types a feature makes the character immune to (Purity of Body,
// Nature's Ward: poison).
export function featureDamageImmunities(sheet: TraitSheet): string[] {
  const own = holdsFeature(sheet, "purity of body", "nature's ward", "constructed resilience") ? ["poison"] : [];
  return [...own, ...authoredDamageImmunities(sheet)];
}

// Fiendish Resilience (warlock 10): resistance to the damage type chosen at
// the last rest, written into the feature's name ("Fiendish Resilience
// (fire)").
export function chosenResistances(sheet: TraitSheet): string[] {
  const out: string[] = [];
  for (const feature of sheet.features ?? []) {
    const match = /^fiendish resilience \(([a-z]+)\)/i.exec(feature.name.trim());
    if (match) {
      out.push(match[1].toLowerCase());
    }
  }
  return out;
}

// ---- Evasion ----

// What a save for half deals to a character, with Evasion (rogue 7, monk 7):
// on a Dexterity save against an effect that halves on a success, a made
// save takes nothing and a failed one takes half. Every save-for-half path
// (aoe_damage, cast_at_player, apply_hazard through it) reads this one rule.
export function saveDamageTaken(input: {
  total: number;
  saved: boolean;
  halfOnSave: boolean;
  ability: string;
  sheet: TraitSheet;
}): { damage: number; evasion: "no damage" | "half damage" | null } {
  const half = Math.floor(input.total / 2);
  const evasion =
    input.ability === "dex" && input.halfOnSave && hasEvasion(input.sheet);
  if (evasion) {
    return { damage: input.saved ? 0 : half, evasion: input.saved ? "no damage" : "half damage" };
  }
  if (input.saved) {
    return { damage: input.halfOnSave ? half : 0, evasion: null };
  }
  return { damage: input.total, evasion: null };
}

export function hasEvasion(sheet: TraitSheet): boolean {
  if (!sheet.class) {
    return false;
  }
  return defenseRiders({
    class: sheet.class,
    level: sheet.level ?? 1,
    features: sheet.features ?? [],
  }).evasion;
}

// ---- derived numbers ----

// Hit points a feature adds per level of its class: Draconic Resilience
// (Draconic Bloodline sorcerer) gives one per sorcerer level. Read off the
// feature, or off the subclass for a sheet whose features are not yet
// granted (the builder, a level-up in progress).
export function featureHitPoints(sheet: TraitSheet): number {
  const sorcerer = (sheet.classes ?? []).find((entry) => lower(entry.id) === "sorcerer");
  const subclass = sorcerer ? sorcerer.subclass : lower(sheet.class) === "sorcerer" ? sheet.subclass : "";
  const draconic = holdsFeature(sheet, "draconic resilience") || /draconic/i.test(subclass ?? "");
  return draconic ? Math.max(0, classLevelOf(sheet, "sorcerer")) : 0;
}

// Points a feature adds to ability scores and the cap it lifts them to:
// Primal Champion (barbarian 20) is +4 Strength and Constitution, to 24.
export function featureAbilityGrants(sheet: TraitSheet): Partial<Record<Ability, number>> {
  return holdsFeature(sheet, "primal champion") || classLevelOf(sheet, "barbarian") >= 20
    ? { str: 4, con: 4 }
    : {};
}

export const PRIMAL_CHAMPION_CAP = 24;

// Primal Champion's points added to scores that do not hold them yet.
export function withPrimalChampion<T extends Record<Ability, number>>(abilities: T): T {
  return {
    ...abilities,
    str: Math.min(PRIMAL_CHAMPION_CAP, abilities.str + 4),
    con: Math.min(PRIMAL_CHAMPION_CAP, abilities.con + 4),
  };
}

// Primal Champion's points taken back off scores stored with them, so that
// improvements and half-feats are counted beneath them (an edit of a
// barbarian at 20) and the 20 cap does not eat them.
export function withoutPrimalChampion<T extends Record<Ability, number>>(abilities: T): T {
  return {
    ...abilities,
    str: Math.max(1, abilities.str - 4),
    con: Math.max(1, abilities.con - 4),
  };
}

// Whether a sheet at this level has Primal Champion: a barbarian at 20.
export function reachesPrimalChampion(sheet: TraitSheet): boolean {
  return classLevelOf(sheet, "barbarian") >= 20;
}

// Sunlight Sensitivity (drow): disadvantage on attack rolls and on sight
// Perception checks in direct sunlight.
export function hasSunlightSensitivity(sheet: TraitSheet): boolean {
  return holdsFeature(sheet, "sunlight sensitivity");
}
