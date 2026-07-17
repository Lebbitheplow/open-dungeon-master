import backgroundsJson from "@/lib/srd/backgrounds.json";
import classesJson from "@/lib/srd/classes.json";
import racesJson from "@/lib/srd/races.json";
import skillsJson from "@/lib/srd/skills.json";
import spellSlotsJson from "@/lib/srd/spell-slots.json";
import type { Ability, CharacterSheet } from "@/lib/schemas/sheet";

export type SrdSkill = { id: string; name: string; ability: Ability };
export type SrdClass = {
  id: string;
  name: string;
  hitDie: 6 | 8 | 10 | 12;
  saves: Ability[];
  casterType: "none" | "full" | "half" | "pact";
  spellAbility: "int" | "wis" | "cha" | null;
  armor: string[];
  weapons: string[];
  skillChoices: { count: number; from: string[] };
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
};
export type SrdBackground = { id: string; name: string; skills: string[]; feature: string };

export const SRD_SKILLS = skillsJson.skills as SrdSkill[];
export const SRD_CLASSES = classesJson.classes as SrdClass[];
export const SRD_RACES = racesJson.races as SrdRace[];
export const SRD_BACKGROUNDS = backgroundsJson.backgrounds as SrdBackground[];

const SLOT_TABLES = spellSlotsJson as unknown as {
  full: Record<string, number[]>;
  half: Record<string, number[]>;
  pact: Record<string, { slots: number; slotLevel: number }>;
};

export function findClass(id: string) {
  return SRD_CLASSES.find((entry) => entry.id === id) ?? null;
}

export function findRace(id: string) {
  return SRD_RACES.find((entry) => entry.id === id) ?? null;
}

export function findBackground(id: string) {
  return SRD_BACKGROUNDS.find((entry) => entry.id === id) ?? null;
}

export function findSkill(id: string) {
  return SRD_SKILLS.find((entry) => entry.id === id) ?? null;
}

export function abilityMod(score: number) {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level: number) {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

export function formatModifier(value: number) {
  return value >= 0 ? `+${value}` : `${value}`;
}

// Spell slots {level: max} for a class at a character level, per SRD tables.
export function spellSlotsFor(classId: string, level: number): Record<string, number> {
  const klass = findClass(classId);
  if (!klass || klass.casterType === "none") {
    return {};
  }
  const key = String(Math.max(1, Math.min(20, level)));
  if (klass.casterType === "pact") {
    const pact = SLOT_TABLES.pact[key];
    return pact ? { [String(pact.slotLevel)]: pact.slots } : {};
  }
  const row = SLOT_TABLES[klass.casterType][key] ?? [];
  return Object.fromEntries(row.map((max, index) => [String(index + 1), max]));
}

export type SheetDerived = {
  proficiencyBonus: number;
  abilityMods: Record<Ability, number>;
  saves: Record<Ability, number>;
  skills: Record<string, number>;
  initiative: number;
  passivePerception: number;
  spellSaveDc: number | null;
  spellAttack: number | null;
};

// All derived numbers come from the sheet + SRD data; the model never
// invents a modifier.
export function computeSheetDerived(
  sheet: Pick<CharacterSheet, "abilities" | "level" | "proficiencies" | "spellcasting">,
): SheetDerived {
  const pb = proficiencyBonus(sheet.level);
  const abilities = sheet.abilities;
  const abilityMods = Object.fromEntries(
    (Object.keys(abilities) as Ability[]).map((ability) => [ability, abilityMod(abilities[ability])]),
  ) as Record<Ability, number>;

  const saves = Object.fromEntries(
    (Object.keys(abilities) as Ability[]).map((ability) => [
      ability,
      abilityMods[ability] + (sheet.proficiencies.saves.includes(ability) ? pb : 0),
    ]),
  ) as Record<Ability, number>;

  const skills = Object.fromEntries(
    SRD_SKILLS.map((skill) => [
      skill.id,
      abilityMods[skill.ability] + (sheet.proficiencies.skills.includes(skill.id) ? pb : 0),
    ]),
  );

  const spellAbility = sheet.spellcasting?.ability ?? null;
  return {
    proficiencyBonus: pb,
    abilityMods,
    saves,
    skills,
    initiative: abilityMods.dex,
    passivePerception: 10 + skills.perception,
    spellSaveDc: spellAbility ? 8 + pb + abilityMods[spellAbility] : null,
    spellAttack: spellAbility ? pb + abilityMods[spellAbility] : null,
  };
}

// Suggested starting HP: max hit die + CON mod (+1/level for hill dwarves).
export function suggestedStartingHp(classId: string, raceId: string, con: number, level: number) {
  const klass = findClass(classId);
  if (!klass) {
    return 8;
  }
  const conMod = abilityMod(con);
  const perLevelBonus = raceId === "hill_dwarf" ? 1 : 0;
  const firstLevel = klass.hitDie + conMod + perLevelBonus;
  const laterLevels =
    (level - 1) * (Math.floor(klass.hitDie / 2) + 1 + conMod + perLevelBonus);
  return Math.max(1, firstLevel + Math.max(0, laterLevels));
}
