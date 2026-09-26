import { ABILITIES, type Ability } from "@/lib/schemas/sheet";

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
  // When one of those picks is from a short list rather than from every
  // language ("your choice of Common or Undercommon"), the list it is from.
  languageChoice?: LanguageChoice;
  traitsSummary: string;
  // Structured grants. Bundled SRD rows fill these in; Open5e pack rows
  // leave them undefined rather than guess from trait prose.
  skills?: string[];
  skillChoice?: { count: number };
  asiChoice?: { count: number; amount: number };
  cantripChoice?: { list: string; count: number };
  tools?: string[];
  toolChoice?: { count: number; from: string[] };
  // Race-taught combat training (mountain dwarf armor, drow weapons).
  armor?: string[];
  weapons?: string[];
};

// The 5e standard + exotic languages, for language pickers. The four
// elemental tongues are dialects of Primordial that the expanded pack's kenku
// and tortle name outright.
export const STANDARD_LANGUAGES = [
  "Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling",
  "Orc", "Abyssal", "Celestial", "Draconic", "Deep Speech", "Infernal",
  "Primordial", "Sylvan", "Undercommon", "Auran", "Aquan", "Ignan", "Terran",
];

export type LanguageChoice = { count: number; from: string[] };

export type LanguageGrant = {
  languages: string[];
  bonusLanguages: number;
  languageChoice?: LanguageChoice;
};

const LANGUAGE_COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3 };

// Canonical casing for a name the allowlist knows; anything else is kept as
// written, so Darakhul, Minotaur and Machine Speech survive instead of
// vanishing.
function canonicalLanguage(name: string): string {
  const wanted = name.trim().toLowerCase();
  return STANDARD_LANGUAGES.find((entry) => entry.toLowerCase() === wanted) ?? name.trim();
}

// A token that reads as a language name: capitalised words, nothing else.
// "Common", "Void Speech" and "Machine Speech" pass; "one of your choice",
// "you can speak" and "the languages of other peoples" do not.
function looksLikeLanguage(token: string): boolean {
  const cleaned = token.trim().replace(/[.;:]+$/, "");
  return /^[A-Z][A-Za-z'\u2019-]*(?:\s+[A-Z][A-Za-z'\u2019-]*)*$/.test(cleaned) && !/^(You|Your|The|They|It)$/.test(cleaned);
}

function languageTokens(text: string): string[] {
  return text
    .split(/,|\band\b|\bor\b|;/)
    .map((token) => token.trim().replace(/[.;:]+$/, "").trim())
    .filter((token) => token && looksLikeLanguage(token))
    .map(canonicalLanguage);
}

// The grant sentence of a race's Languages trait, or the whole text when it
// is a bare list ("Common, Auran"). Everything after the sentence that says
// what the character can speak is flavor: which script a tongue is written
// in, whose curses humans borrow. Reading names out of that flavor is how a
// Human came to speak Common, Dwarvish, Elvish and Orc.
function grantSentence(text: string): string {
  const plain = text
    .replace(/[*_]/g, "")
    .replace(/^\s*Languages\.?\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = plain.split(/(?<=\.)\s+(?=[A-Z])/);
  return sentences.find((sentence) => /\b(speak|read|write|know|understand)\b/i.test(sentence)) ?? sentences[0] ?? "";
}

// What a race's Languages trait grants: the tongues it names outright, the
// free picks it offers, and a pick from a short list when it offers one.
// Written for the Open5e prose ("You can speak, read, and write Common and
// one extra language of your choice.") and for the plain lists the expanded
// pack writes.
export function parseRaceLanguages(text: string): LanguageGrant {
  let sentence = grantSentence(String(text ?? ""));
  if (!sentence) {
    return { languages: [], bonusLanguages: 0 };
  }
  let bonusLanguages = 0;
  let languageChoice: LanguageChoice | undefined;

  // "one of the following: Abyssal, Infernal, or Void Speech"
  sentence = sentence.replace(/\b(a|an|one|two)\s+of the following:?\s*([^.]+)/i, (_match, count: string, list: string) => {
    const from = languageTokens(list);
    if (from.length) {
      languageChoice = { count: LANGUAGE_COUNT_WORDS[count.toLowerCase()] ?? 1, from };
    }
    return "";
  });
  // "your choice of Common or Undercommon", "either Common or Sylvan"
  sentence = sentence.replace(
    /\b(?:your choice of|either)\s+([A-Z][A-Za-z'\u2019 -]*?)\s+or\s+([A-Z][A-Za-z'\u2019-]*(?:\s+[A-Z][A-Za-z'\u2019-]*)*)/,
    (_match, first: string, second: string) => {
      const from = languageTokens(`${first}, ${second}`);
      if (from.length) {
        languageChoice = { count: 1, from };
      }
      return "";
    },
  );
  // "one extra language of your choice", "two languages of your choice", "a
  // language associated with your Heritage Subrace", "one other language
  // spoken by your Living Origin", and the expanded pack's "one of your choice".
  sentence = sentence.replace(
    /\b(a|an|one|two|three)\s+(?:(?:extra|additional|other)\s+)?(?:languages?\b(?:\s+(?:of your choice|associated with[^,.]*|spoken by[^,.]*))?|of your choice)/gi,
    (_match, count: string) => {
      bonusLanguages += LANGUAGE_COUNT_WORDS[count.toLowerCase()] ?? 1;
      return "";
    },
  );
  sentence = sentence.replace(/^\s*You (?:can|also)?\s*(?:speak|read|write|know|understand|,|and|\s)+/i, "");
  const languages = [...new Set(languageTokens(sentence))];
  if (languageChoice) {
    bonusLanguages += languageChoice.count;
  }
  return { languages, bonusLanguages, ...(languageChoice ? { languageChoice } : {}) };
}

export type ClassMechanics = {
  hitDie: 6 | 8 | 10 | 12;
  saves: Ability[];
  skillChoices: { count: number; from: string[] };
  armor: string[];
  weapons: string[];
  tools: string[];
  spellAbility: "int" | "wis" | "cha" | null;
  casterType: "none" | "full" | "half" | "pact" | "artificer";
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
  } else if (data.asi && typeof data.asi === "object") {
    // The expanded pack writes the bumps as a plain map, {"con":2,"wis":1},
    // keyed by the short or the long ability name.
    for (const [name, raw] of Object.entries(data.asi as Record<string, unknown>)) {
      const key = normalizeText(name);
      const ability = ABILITY_BY_NAME[key] ?? ((ABILITIES as readonly string[]).includes(key) ? (key as Ability) : undefined);
      const value = Number(raw);
      if (ability && Number.isFinite(value) && value !== 0) {
        asi[ability] = (asi[ability] ?? 0) + value;
      }
    }
  }
  const speedRaw =
    typeof data.speed === "number" ? data.speed : (data.speed as { walk?: unknown } | undefined)?.walk;
  const parsedSpeed = Number.isFinite(Number(speedRaw)) && Number(speedRaw) > 0 ? Number(speedRaw) : 30;

  // A 2024-rules species (the srd-2024 rows) carries its traits as objects
  // with a type, its speed among them, and no languages of its own: under
  // those rules every character knows Common and two more of their choice.
  const traitObjects = Array.isArray(data.traits)
    ? (data.traits as Array<{ name?: unknown; desc?: unknown; type?: unknown }>)
    : null;
  const v2Speed = traitObjects
    ?.filter((trait) => String(trait.type ?? "").toUpperCase() === "SPEED")
    .map((trait) => Number.parseInt(String(trait.desc ?? ""), 10))
    .find((value) => Number.isFinite(value) && value > 0);
  const speed = v2Speed ?? parsedSpeed;

  // Languages: the expanded pack (and a re-imported pack) writes them
  // structurally, the same shape as src/lib/srd/races.json; the Open5e rows
  // carry the trait's prose and are parsed.
  const grant: LanguageGrant = Array.isArray(data.languages)
    ? {
        languages: (data.languages as unknown[]).map((entry) => canonicalLanguage(String(entry))).filter((entry) => looksLikeLanguage(entry)),
        bonusLanguages: Number(data.bonusLanguages ?? 0) || 0,
      }
    : traitObjects && data.languages === undefined
      ? { languages: ["Common"], bonusLanguages: 2 }
      : parseRaceLanguages(String(data.languages ?? ""));
  if (Array.isArray(data.languages) && !grant.bonusLanguages) {
    // The importer used to write "one of your choice" into the list itself.
    grant.bonusLanguages = (data.languages as unknown[]).filter((entry) => /of your choice/i.test(String(entry))).length;
  }
  const languages = grant.languages;
  const bonusLanguages = grant.bonusLanguages;

  const traitsSummary = (
    traitObjects
      ? traitObjects
          .filter((trait) => !["SIZE", "SPEED"].includes(String(trait.type ?? "").toUpperCase()))
          .map((trait) => String(trait.name ?? ""))
      : String(data.traits ?? "")
          .replace(/\*\*\*|\*\*_?|_?\*\*|\*/g, "")
          .split(/\n+/)
          // The name ends at the first full stop that closes a sentence; the one
          // inside "(adv. vs poison)" is an abbreviation, not an ending.
          .map((line) => line.split(/\.(?=\s+[A-Z]|$)/)[0].trim())
  )
    // A markdown table row is not a trait.
    .filter((line) => line && !line.startsWith("|"))
    .slice(0, 6)
    .join(" · ");

  // Structured grants ride along when the row carries them (the expanded
  // pack is generated from races.json and writes the same keys).
  const structured = structuredGrants(data);

  return {
    speed,
    asi,
    // A row that names no language at all (a subrace, which inherits its
    // parent's) is filled in by the caller; Common is the last resort.
    languages: languages.length ? languages : data.languages === undefined ? [] : ["Common"],
    bonusLanguages,
    ...(grant.languageChoice ? { languageChoice: grant.languageChoice } : {}),
    traitsSummary,
    ...structured,
  };
}

type StructuredGrants = Pick<
  RaceMechanics,
  "skills" | "skillChoice" | "asiChoice" | "cantripChoice" | "tools" | "toolChoice" | "armor" | "weapons"
>;

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map((entry) => String(entry)).filter(Boolean) : undefined;
}

function structuredGrants(data: Record<string, unknown>): StructuredGrants {
  const out: StructuredGrants = {};
  const skills = stringList(data.skills);
  if (skills?.length) {
    out.skills = skills;
  }
  const skillChoice = data.skillChoice as { count?: unknown } | undefined;
  if (skillChoice && Number(skillChoice.count) > 0) {
    out.skillChoice = { count: Number(skillChoice.count) };
  }
  const asiChoice = data.asiChoice as { count?: unknown; amount?: unknown } | undefined;
  if (asiChoice && Number(asiChoice.count) > 0) {
    out.asiChoice = { count: Number(asiChoice.count), amount: Number(asiChoice.amount) || 1 };
  }
  const cantripChoice = data.cantripChoice as { list?: unknown; count?: unknown } | undefined;
  if (cantripChoice && typeof cantripChoice.list === "string") {
    out.cantripChoice = { list: cantripChoice.list, count: Number(cantripChoice.count) || 1 };
  }
  const tools = stringList(data.tools);
  if (tools?.length) {
    out.tools = tools;
  }
  const toolChoice = data.toolChoice as { count?: unknown; from?: unknown } | undefined;
  const toolFrom = stringList(toolChoice?.from);
  if (toolChoice && toolFrom?.length) {
    out.toolChoice = { count: Number(toolChoice.count) || 1, from: toolFrom };
  }
  const armor = stringList(data.armor);
  if (armor?.length) {
    out.armor = armor;
  }
  const weapons = stringList(data.weapons);
  if (weapons?.length) {
    out.weapons = weapons;
  }
  return out;
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
  const casterType = baseSlug === "artificer"
    ? ("artificer" as const)
    : FULL_CASTERS.has(baseSlug)
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
    tools: String(data.prof_tools ?? "")
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

// Cantrips known by level for the SRD cantrip-casting classes. Same
// advisory role as the spells-known table: shown as guidance, never
// enforced. Paladins and rangers get no cantrips, so they are absent.
const CANTRIP_TABLE: Record<string, number[]> = {
  // index = level - 1
  bard: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  cleric: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  druid: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  sorcerer: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
  warlock: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
  wizard: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  artificer: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4],
};

// Cantrips a class of this kind knows at the given level, or null when the
// class has no cantrips. Custom classes fall back to their caster type.
export function suggestedCantripCount(
  classSlug: string,
  level: number,
  casterType: ClassMechanics["casterType"] = "none",
): number | null {
  const clamped = Math.max(1, Math.min(20, level));
  const table = CANTRIP_TABLE[classSlug.toLowerCase()];
  if (table) {
    return table[clamped - 1];
  }
  // Custom full and pact casters follow the common 2/3/4 progression.
  if (casterType === "full" || casterType === "pact") {
    return clamped >= 10 ? 4 : clamped >= 4 ? 3 : 2;
  }
  return null;
}

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
  // An artificer prepares from level 1: Intelligence modifier plus half the
  // artificer level, rounded down, at least one.
  if (slug === "artificer") {
    return { label: "spells prepared", count: Math.max(1, spellAbilityMod + Math.floor(clamped / 2)) };
  }
  // A half caster has no spells at all until level 2 (paladins and rangers
  // pray and track for a level first), so there is nothing to prepare yet.
  if (HALF_CASTERS.has(slug) && clamped < 2) {
    return null;
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
