// The shapes of the SRD data tables (skills, classes, races, backgrounds) the
// srd module loads from its JSON. Split from src/lib/srd/index.ts, which
// re-exports them; type-only, so any module may import them.

import type { Ability } from "@/lib/schemas/sheet";

export type SrdSkill = { id: string; name: string; ability: Ability };
export type SrdClass = {
  id: string;
  name: string;
  hitDie: 6 | 8 | 10 | 12;
  saves: Ability[];
  // "artificer" is a half caster that rounds up, so it needs its own table.
  casterType: "none" | "full" | "half" | "pact" | "artificer";
  spellAbility: "int" | "wis" | "cha" | null;
  armor: string[];
  weapons: string[];
  // Tool/kit proficiencies the class grants (thieves' tools, instruments).
  tools: string[];
  // Languages the class itself teaches: a druid learns Druidic, a rogue
  // Thieves' Cant. These are granted on top of the race's languages.
  languages?: string[];
  skillChoices: { count: number; from: string[] };
  // One line for the class picker, so a new player can tell a warlock from
  // a wizard before opening the full write-up.
  blurb?: string;
};
export type SrdRace = {
  id: string;
  name: string;
  speed: number;
  size: string;
  asi: Partial<Record<Ability, number>>;
  asiChoice?: { count: number; amount: number };
  traits: string[];
  languages: string[];
  // Extra languages of the player's choice (SRD: human, half-elf, high elf).
  bonusLanguages?: number;
  // Structured grants behind the trait prose, so the builder can put them on
  // the sheet instead of leaving them as flavor text.
  skills?: string[];
  skillChoice?: { count: number };
  cantripChoice?: { list: string; count: number };
  tools?: string[];
  toolChoice?: { count: number; from: string[] };
  // Race-taught combat training on top of the class lists (mountain dwarf
  // armor, drow and wood elf weapons).
  armor?: string[];
  weapons?: string[];
};
export type SrdBackground = {
  id: string;
  name: string;
  skills: string[];
  feature: string;
  tools?: string[];
  languages?: number;
  equipment?: string[];
  // One line for the picker, and what the named feature does.
  blurb?: string;
  featureDesc?: string;
};
