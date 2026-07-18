import type { Ability } from "@/lib/schemas/sheet";

// Parses Open5e's prose-ish mechanics fields (race asi arrays, class
// proficiency strings) into the same shapes the bundled SRD data uses, so
// the character builder treats both sources uniformly. Pure functions on
// plain data: safe for client components operating on fetched entries.

export type RaceMechanics = {
  speed: number;
  asi: Partial<Record<Ability, number>>;
  languages: string[];
  // Extra languages of the player's choice granted by the race.
  bonusLanguages: number;
  traitsSummary: string;
};

// The 5e standard + exotic languages, for language pickers.
export const STANDARD_LANGUAGES = [
  "Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling",
  "Orc", "Abyssal", "Celestial", "Draconic", "Deep Speech", "Infernal",
  "Primordial", "Sylvan", "Undercommon",
];

export type ClassMechanics = {
  hitDie: 6 | 8 | 10 | 12;
  saves: Ability[];
  skillChoices: { count: number; from: string[] };
  armor: string[];
  weapons: string[];
  spellAbility: "int" | "wis" | "cha" | null;
  casterType: "none" | "full" | "half" | "pact";
};

const ABILITY_BY_NAME: Record<string, Ability> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

export const ALL_SKILLS = [
  "acrobatics",
  "animal_handling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleight_of_hand",
  "stealth",
  "survival",
] as const;

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Find 5e skill ids mentioned in prose ("Choose two from Acrobatics, ...").
// Substring matching on normalized text survives Open5e's comma glitches
// ("Animal, Handling").
export function skillsInText(text: unknown): string[] {
  const normalized = ` ${normalizeText(text)} `;
  return ALL_SKILLS.filter((skill) =>
    normalized.includes(` ${skill.replace(/_/g, " ")} `),
  );
}

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  any: 3,
};

export function raceMechanics(data: Record<string, unknown>): RaceMechanics {
  const asi: Partial<Record<Ability, number>> = {};
  if (Array.isArray(data.asi)) {
    for (const entry of data.asi as Array<{ attributes?: unknown; value?: unknown }>) {
      const value = Number(entry?.value ?? 0);
      for (const attribute of Array.isArray(entry?.attributes) ? entry.attributes : []) {
        const ability = ABILITY_BY_NAME[normalizeText(attribute)];
        if (ability && Number.isFinite(value)) {
          asi[ability] = (asi[ability] ?? 0) + value;
        }
      }
    }
  }
  const speedRaw = (data.speed as { walk?: unknown } | undefined)?.walk;
  const speed = Number.isFinite(Number(speedRaw)) && Number(speedRaw) > 0 ? Number(speedRaw) : 30;

  // Languages prose usually reads "...speak, read, and write Common and X".
  const languageText = String(data.languages ?? "");
  const languages = STANDARD_LANGUAGES.filter((language) =>
    languageText.toLowerCase().includes(language.toLowerCase()),
  );
  // "...and one extra/additional/other language of your choice."
  const bonusLanguages = /\b(one|1)\b[^.]*\blanguage/i.test(languageText.replace(/speak|read|write/gi, "")) &&
    /choice|extra|additional|other language/i.test(languageText)
    ? 1
    : 0;

  const traitsSummary = String(data.traits ?? "")
    .replace(/\*\*_?|_?\*\*/g, "")
    .split(/\n+/)
    .map((line) => line.split(".")[0])
    .filter(Boolean)
    .slice(0, 6)
    .join(" · ");

  return {
    speed,
    asi,
    languages: languages.length ? languages : ["Common"],
    bonusLanguages,
    traitsSummary,
  };
}

const FULL_CASTERS = new Set(["bard", "cleric", "druid", "sorcerer", "wizard"]);
const HALF_CASTERS = new Set(["paladin", "ranger"]);

export function classMechanics(slug: string, data: Record<string, unknown>): ClassMechanics {
  const hitDieRaw = Number.parseInt(String(data.hit_dice ?? "").replace(/^\d*d/i, ""), 10);
  const hitDie = ([6, 8, 10, 12] as const).includes(hitDieRaw as 6 | 8 | 10 | 12)
    ? (hitDieRaw as 6 | 8 | 10 | 12)
    : 8;

  const savesText = normalizeText(data.prof_saving_throws);
  const saves = (Object.keys(ABILITY_BY_NAME) as Array<keyof typeof ABILITY_BY_NAME>)
    .filter((name) => savesText.includes(name))
    .map((name) => ABILITY_BY_NAME[name]);

  const skillsText = String(data.prof_skills ?? "");
  const countMatch = /choose\s+(\w+)/i.exec(skillsText);
  const count = COUNT_WORDS[countMatch?.[1]?.toLowerCase() ?? ""] ?? 2;
  const from = skillsInText(skillsText);

  const spellAbilityName = normalizeText(data.spellcasting_ability);
  const spellAbility =
    spellAbilityName && ABILITY_BY_NAME[spellAbilityName]
      ? (ABILITY_BY_NAME[spellAbilityName] as "int" | "wis" | "cha")
      : null;

  const baseSlug = slug.toLowerCase();
  const casterType = FULL_CASTERS.has(baseSlug)
    ? ("full" as const)
    : HALF_CASTERS.has(baseSlug)
      ? ("half" as const)
      : baseSlug === "warlock"
        ? ("pact" as const)
        : ("none" as const);

  return {
    hitDie,
    saves: saves.length ? saves : ["str", "con"],
    skillChoices: { count, from: from.length ? from : [...ALL_SKILLS] },
    armor: String(data.prof_armor ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    weapons: String(data.prof_weapons ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    spellAbility: spellAbility && casterType !== "none" ? spellAbility : spellAbility,
    casterType,
  };
}

// Suggested spells-known caps for SRD known-casters; prepared casters use
// ability mod + level. Advisory in the builder, never a hard block
// (homebrew and third-party classes vary).
const KNOWN_CASTER_TABLE: Record<string, number[]> = {
  // index = level - 1
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
  ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
};

export function suggestedSpellCount(
  classSlug: string,
  level: number,
  spellAbilityMod: number,
): { label: string; count: number } | null {
  const slug = classSlug.toLowerCase();
  const clamped = Math.max(1, Math.min(20, level));
  const known = KNOWN_CASTER_TABLE[slug];
  if (known) {
    return { label: "spells known", count: known[clamped - 1] };
  }
  if (FULL_CASTERS.has(slug) || HALF_CASTERS.has(slug)) {
    const prepared = Math.max(
      1,
      spellAbilityMod + (HALF_CASTERS.has(slug) ? Math.floor(clamped / 2) : clamped),
    );
    return { label: "spells prepared", count: prepared };
  }
  return null;
}
