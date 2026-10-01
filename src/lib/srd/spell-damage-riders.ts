// What a caster's own features add to a spell's damage (SRD 5.1):
//
//   Empowered Evocation (wizard, School of Evocation 10): the Intelligence
//     modifier is added to one damage roll of a wizard evocation spell.
//   Elemental Affinity (sorcerer, Draconic Bloodline 6): the Charisma
//     modifier is added to one damage roll of a spell dealing the damage type
//     of the sorcerer's dragon ancestor.
//   Potent Cantrip (wizard, School of Evocation 6): a creature that succeeds
//     on its save against the wizard's cantrip still takes half its damage.
//
// Pure: the sheet and what the spell is come in as values, so the cast tools
// (cast_at_enemy, aoe_damage) and pc_attack share one answer.

import { authoredSpellDice } from "@/lib/srd/authored-effects-more";

type Caster = {
  class: string;
  level: number;
  classes?: Array<{ id: string; level: number }>;
  features: Array<{ name: string; classId?: string }>;
  abilities: Record<"str" | "dex" | "con" | "int" | "wis" | "cha", number>;
  // For the subclass features that read them (Enhanced Bond's spirit, Arcane
  // Firearm's wand): src/lib/srd/authored-effects-more.ts.
  conditions?: string[];
  equipment?: Array<{ name: string; equipped?: boolean }>;
};

const mod = (score: number) => Math.floor((score - 10) / 2);

const hasFeature = (sheet: Caster, name: string) =>
  sheet.features.some((feature) => feature.name.trim().toLowerCase().startsWith(name));

// The damage type of each dragon a Draconic Bloodline sorcerer can descend
// from (SRD 5.1, Dragon Ancestor table).
const DRAGON_TYPES: Record<string, string> = {
  black: "acid",
  blue: "lightning",
  brass: "fire",
  bronze: "lightning",
  copper: "acid",
  gold: "fire",
  green: "poison",
  red: "fire",
  silver: "cold",
  white: "cold",
};

// The damage type of the sorcerer's dragon ancestor, read from the feature
// that records the choice ("Dragon Ancestor: Red", "Dragon Ancestor (gold)").
export function dragonAncestorType(sheet: Pick<Caster, "features">): string | null {
  for (const feature of sheet.features) {
    const name = feature.name.toLowerCase();
    if (!name.includes("dragon ancestor") && !name.includes("draconic bloodline")) {
      continue;
    }
    const color = Object.keys(DRAGON_TYPES).find((entry) => new RegExp(`\\b${entry}\\b`).test(name));
    if (color) {
      return DRAGON_TYPES[color];
    }
  }
  return null;
}

export type SpellDamageRiders = {
  // Added once to the spell's damage total.
  flat: number;
  // Dice added to the spell's damage roll (Enhanced Bond, Arcane Firearm).
  dice: string[];
  // A successful save against this cantrip still takes half.
  potentCantrip: boolean;
  notes: string[];
};

export function spellDamageRiders(
  sheet: Caster,
  spell: {
    school?: string | null;
    damageType?: string | null;
    level: number;
    // The classes whose lists carry the spell, lowercased.
    classes?: string[];
  },
): SpellDamageRiders {
  const riders: SpellDamageRiders = { flat: 0, dice: [], potentCantrip: false, notes: [] };
  const school = (spell.school ?? "").toLowerCase();
  const wizardSpell = !spell.classes?.length || spell.classes.includes("wizard");
  if (school === "evocation" && wizardSpell && hasFeature(sheet, "empowered evocation")) {
    const bonus = mod(sheet.abilities.int);
    if (bonus > 0) {
      riders.flat += bonus;
      riders.notes.push(`Empowered Evocation: +${bonus} (Intelligence)`);
    }
  }
  const ancestor = dragonAncestorType(sheet);
  if (
    ancestor &&
    spell.damageType &&
    spell.damageType.toLowerCase() === ancestor &&
    hasFeature(sheet, "elemental affinity")
  ) {
    const bonus = mod(sheet.abilities.cha);
    if (bonus > 0) {
      riders.flat += bonus;
      riders.notes.push(`Elemental Affinity: +${bonus} ${ancestor} (Charisma)`);
    }
  }
  if (spell.level === 0 && hasFeature(sheet, "potent cantrip")) {
    riders.potentCantrip = true;
  }
  // The subclass features that add a die to the spell's damage.
  const mods = Object.fromEntries(Object.entries(sheet.abilities).map(([key, score]) => [key, mod(score)]));
  const authored = authoredSpellDice(sheet, { damageType: spell.damageType }, mods);
  riders.dice.push(...authored.dice);
  riders.notes.push(...authored.notes);
  return riders;
}
