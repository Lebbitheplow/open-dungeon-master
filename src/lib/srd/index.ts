import backgroundsJson from "@/lib/srd/backgrounds.json";
import classesJson from "@/lib/srd/classes.json";
import racesJson from "@/lib/srd/races.json";
import skillsJson from "@/lib/srd/skills.json";
import spellSlotsJson from "@/lib/srd/spell-slots.json";
import { CUSTOM_CLASSES } from "@/lib/classes";
import { computeArmorClass, unarmoredFormulaFor, type AcBreakdown } from "@/lib/srd/armor";
import { combatRiders, defenseRiders } from "@/lib/srd/feature-effects";
import { effectiveAbilities, magicItemRiders } from "@/lib/srd/magic-items";
import type {
  Ability,
  AbilityScores,
  CharacterSheet,
  Proficiencies,
} from "@/lib/schemas/sheet";

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
  // Tool/kit proficiencies the class grants (thieves' tools, instruments).
  tools: string[];
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
  // Extra languages of the player's choice (SRD: human, half-elf, high elf).
  bonusLanguages?: number;
  // Structured grants behind the trait prose, so the builder can put them on
  // the sheet instead of leaving them as flavor text.
  skills?: string[];
  skillChoice?: { count: number };
  cantripChoice?: { list: string; count: number };
  tools?: string[];
  toolChoice?: { count: number; from: string[] };
};
export type SrdBackground = {
  id: string;
  name: string;
  skills: string[];
  feature: string;
  tools?: string[];
  languages?: number;
  equipment?: string[];
};

export const SRD_SKILLS = skillsJson.skills as SrdSkill[];
export const SRD_CLASSES = classesJson.classes as SrdClass[];
export const SRD_RACES = racesJson.races as SrdRace[];
export const SRD_BACKGROUNDS = backgroundsJson.backgrounds as SrdBackground[];

const SLOT_TABLES = spellSlotsJson as unknown as {
  full: Record<string, number[]>;
  half: Record<string, number[]>;
  pact: Record<string, { slots: number; slotLevel: number }>;
};

// SRD classes first, then the setting-specific custom catalog.
export const ALL_CLASSES: SrdClass[] = [...SRD_CLASSES, ...CUSTOM_CLASSES];

export function findClass(id: string) {
  return ALL_CLASSES.find((entry) => entry.id === id) ?? null;
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

// Everything the armor engine needs off a sheet, loose enough that the
// character builder can pass a half-built character before one exists.
export type AcSource = {
  class: string;
  abilities: AbilityScores;
  proficiencies: Pick<Proficiencies, "armor">;
  equipment: Array<{ name: string; equipped?: boolean; attuned?: boolean }>;
  features: Array<{ name: string }>;
  level?: number;
  // Extra flat adds on top of whatever the feature table already grants.
  bonus?: number;
};

// The character's armor class and how it was arrived at. The single place
// AC is computed: db/sheets.ts writes it on every patch, the builder shows
// it live, and the sheet dialog renders `parts` as the breakdown.
export function acBreakdownFor(source: AcSource): AcBreakdown {
  const riders = combatRiders({
    class: source.class,
    level: source.level ?? 1,
    features: source.features,
  });
  // Ability-setting magic items (a Belt of Giant Strength) change the DEX
  // and CON that feed the AC, so the effective scores are used throughout.
  const abilities = effectiveAbilities(source.abilities, source.equipment);
  const magic = magicItemRiders(source.equipment);
  const input = {
    equipment: source.equipment,
    armorProfs: source.proficiencies.armor,
    dexMod: abilityMod(abilities.dex),
    abilityMods: {
      con: abilityMod(abilities.con),
      wis: abilityMod(abilities.wis),
    },
    strength: abilities.str,
    unarmored: unarmoredFormulaFor(source.class, source.features),
  };
  // The Defense fighting style only counts while actually wearing armor, so
  // whether it applies is only knowable after the armor is resolved.
  const resolved = computeArmorClass(input);
  const armored = resolved.armorName !== null;
  const featureBonus = riders.acBonus && (!riders.acBonusRequiresArmor || armored)
    ? riders.acBonus
    : 0;
  // Bracers of Defense: only while wearing no armor and no shield.
  const unarmoredBonus =
    !armored && !resolved.shieldName ? magic.acUnarmoredBonus : 0;
  const bonus = featureBonus + magic.acBonus + unarmoredBonus + (source.bonus ?? 0);
  return bonus ? computeArmorClass({ ...input, bonus }) : resolved;
}

export function deriveAc(source: AcSource): number {
  return acBreakdownFor(source).ac;
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
  sheet: Pick<
    CharacterSheet,
    "abilities" | "level" | "proficiencies" | "spellcasting"
  > & {
    class?: string;
    features?: Array<{ name: string }>;
    feats?: string[];
    equipment?: Array<{ name: string; equipped?: boolean; attuned?: boolean }>;
  },
): SheetDerived {
  const pb = proficiencyBonus(sheet.level);
  // Ability-setting magic items raise the scores every other number reads.
  const abilities = sheet.equipment
    ? effectiveAbilities(sheet.abilities, sheet.equipment)
    : sheet.abilities;
  const magicSaveBonus = sheet.equipment ? magicItemRiders(sheet.equipment).saveBonus : 0;
  const abilityMods = Object.fromEntries(
    (Object.keys(abilities) as Ability[]).map((ability) => [ability, abilityMod(abilities[ability])]),
  ) as Record<Ability, number>;

  // Feature- and feat-driven riders (Aura of Protection, Alert, Observant).
  // The full sheet carries class, features, and feats; the lighter callers
  // (the builder's preview) do not, and simply see none of them.
  const riderFeatures = [
    ...(sheet.features ?? []),
    ...((sheet.feats ?? []).map((name) => ({ name }))),
  ];
  const defense =
    sheet.class && (sheet.features || sheet.feats)
      ? defenseRiders({ class: sheet.class, level: sheet.level, features: riderFeatures }, abilityMods)
      : { saveBonus: 0, initiativeBonus: 0, passiveBonus: 0 };

  const saves = Object.fromEntries(
    (Object.keys(abilities) as Ability[]).map((ability) => [
      ability,
      abilityMods[ability] +
        (sheet.proficiencies.saves.includes(ability) ? pb : 0) +
        defense.saveBonus +
        magicSaveBonus,
    ]),
  ) as Record<Ability, number>;

  const expertise = sheet.proficiencies.expertise ?? [];
  const skills = Object.fromEntries(
    SRD_SKILLS.map((skill) => [
      skill.id,
      abilityMods[skill.ability] +
        (expertise.includes(skill.id)
          ? pb * 2
          : sheet.proficiencies.skills.includes(skill.id)
            ? pb
            : 0),
    ]),
  );

  const spellAbility = sheet.spellcasting?.ability ?? null;
  return {
    proficiencyBonus: pb,
    abilityMods,
    saves,
    skills,
    initiative: abilityMods.dex + defense.initiativeBonus,
    passivePerception: 10 + skills.perception + defense.passiveBonus,
    spellSaveDc: spellAbility ? 8 + pb + abilityMods[spellAbility] : null,
    spellAttack: spellAbility ? pb + abilityMods[spellAbility] : null,
  };
}

// Total XP needed to reach each level (index = level - 1), per the 5e table.
export const XP_THRESHOLDS = [
  0, 300, 900, 2_700, 6_500, 14_000, 23_000, 34_000, 48_000, 64_000,
  85_000, 100_000, 120_000, 140_000, 165_000, 195_000, 225_000, 265_000,
  305_000, 355_000,
];

export function levelForXp(xp: number): number {
  let level = 1;
  for (let index = 0; index < XP_THRESHOLDS.length; index += 1) {
    if (xp >= XP_THRESHOLDS[index]) {
      level = index + 1;
    }
  }
  return level;
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
