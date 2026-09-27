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
  // Every trait the race's text names, and those among them whose text asks
  // the player to choose (gearforged's "Race Chassis", a subrace heading):
  // a subrace row is that choice already made.
  traitNames: string[];
  choiceTraitNames: string[];
  // Structured grants. Bundled SRD rows fill these in; Open5e pack rows
  // leave them undefined rather than guess from trait prose, except
  // asiChoice, which they state outright as "Any" ability entries or as an
  // either-or sentence ("Your Strength or Dexterity score increases by 1"),
  // a pick `from` those two.
  skills?: string[];
  skillChoice?: { count: number };
  asiChoice?: { count: number; amount: number; from?: Ability[] };
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

const LANGUAGE_COUNT_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};

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
  // A bare count: a5e's dungeon robber knows "Any six".
  sentence = sentence.replace(/\bany\s+(one|two|three|four|five|six)\b/gi, (_match, count: string) => {
    bonusLanguages += LANGUAGE_COUNT_WORDS[count.toLowerCase()];
    return "";
  });
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

// A heading paragraph that asks the player to pick one of several options
// the text goes on to list, or to name another race.
const CHOICE_HEADING = /\bchoose (?:one of (?:these|the following)\b|another race\b|[^.]*\bbelow\b)/i;
// "***Name.***" and "**_Name._**", the two ways the pack marks a trait. A
// bulleted "* **Option.**" under one is an option of that trait, not a trait.
const TRAIT_HEADING = /^(?:\*\*\*|\*\*_)(.+?)(?:\*\*\*|_\*\*)\s*(.*)$/;

function proseTraitNames(text: string): { names: string[]; choices: string[] } {
  const lines = text.split(/\n+/).map((line) => line.trim());
  if (lines.some((line) => TRAIT_HEADING.test(line))) {
    const names: string[] = [];
    const choices: string[] = [];
    for (const line of lines) {
      const heading = TRAIT_HEADING.exec(line);
      if (!heading) {
        continue;
      }
      const name = heading[1].replace(/\.$/, "").trim();
      names.push(name);
      if (CHOICE_HEADING.test(heading[2])) {
        choices.push(name);
      }
    }
    return { names, choices };
  }
  // No headings: the expanded pack writes one trait per line.
  const names = text
    .replace(/\*\*\*|\*\*_?|_?\*\*|\*/g, "")
    .split(/\n+/)
    // The name ends at the first full stop that closes a sentence; the one
    // inside "(adv. vs poison)" is an abbreviation, not an ending.
    .map((line) => line.split(/\.(?=\s+[A-Z]|$)/)[0].trim());
  return { names, choices: [] };
}

export function raceMechanics(data: Record<string, unknown>): RaceMechanics {
  const asi: Partial<Record<Ability, number>> = {};
  let asiChoice: RaceMechanics["asiChoice"];
  if (Array.isArray(data.asi)) {
    for (const entry of data.asi as Array<{ attributes?: unknown; value?: unknown }>) {
      const value = Number(entry?.value ?? 0);
      for (const attribute of Array.isArray(entry?.attributes) ? entry.attributes : []) {
        const name = normalizeText(attribute);
        const ability = ABILITY_BY_NAME[name];
        if (ability && Number.isFinite(value)) {
          asi[ability] = (asi[ability] ?? 0) + value;
        } else if (name === "any" || name === "other") {
          // Each "Any" entry is one ability of the player's choice
          // (gearforged's "Two different ability scores of your choice").
          asiChoice = { count: (asiChoice?.count ?? 0) + 1, amount: value };
        }
      }
    }
    // Shade writes the pick in prose only: "Your Charisma score increases by
    // 1, and one other ability score of your choice increases by 1."
    const other = /\b(one|two) other ability scores? of your choice increases? by (\d)/i.exec(String(data.asi_desc));
    if (!asiChoice && other) {
      asiChoice = { count: COUNT_WORDS[other[1].toLowerCase()], amount: Number(other[2]) };
    }
    // An either-or increase ("Your Strength or Dexterity score increases by
    // 1", erina's "either your Wisdom or Charisma score by 1") is one pick
    // from the two named abilities. Delver's row also lists both as fixed
    // +1s; those come off, or the choice would be counted twice.
    const either = /\b(?:your|either your)\s+(\w+) or (\w+) scores?(?: increases?)? by (\d)/i.exec(String(data.asi_desc));
    const eitherFrom = either
      ? [ABILITY_BY_NAME[normalizeText(either[1])], ABILITY_BY_NAME[normalizeText(either[2])]].filter(Boolean)
      : [];
    if (!asiChoice && eitherFrom.length === 2) {
      const amount = Number(either![3]);
      for (const ability of eitherFrom) {
        if (asi[ability] === amount) {
          delete asi[ability];
        }
      }
      asiChoice = { count: 1, amount, from: eitherFrom };
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

  const prose = traitObjects
    ? {
        names: traitObjects
          .filter((trait) => !["SIZE", "SPEED"].includes(String(trait.type ?? "").toUpperCase()))
          .map((trait) => String(trait.name ?? "")),
        choices: [],
      }
    : proseTraitNames(String(data.traits ?? ""));
  // A markdown table row is not a trait.
  const traitNames = prose.names.filter((line) => line && !line.startsWith("|"));
  const traitsSummary = traitNames.slice(0, 6).join(" · ");

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
    traitNames,
    choiceTraitNames: prose.choices,
    ...(asiChoice ? { asiChoice } : {}),
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

// A proficiency string split into entries. The SRD writes "None" where a
// class has no armor or tools; that is not a proficiency.
function proficiencyList(value: unknown): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== "none");
}

const V2_PROFICIENCY_FIELDS: Record<string, string> = {
  Armor: "prof_armor",
  Weapons: "prof_weapons",
  Tools: "prof_tools",
  "Saving Throws": "prof_saving_throws",
  Skills: "prof_skills",
};

// Open5e's v2 class rows (a5e-ag's marshal, bfrd's mechanist) have no prof_*
// fields: the same texts sit in a "Proficiencies" feature, one
// "**Armor:** ..." line each, and are read back into the v1 fields.
function v2ProficiencyFields(data: Record<string, unknown>): Record<string, string> {
  const features = Array.isArray(data.features)
    ? (data.features as Array<{ name?: unknown; desc?: unknown }>)
    : [];
  const text = String(features.find((feature) => feature.name === "Proficiencies")?.desc ?? "");
  const fields: Record<string, string> = {};
  for (const [, label, value] of text.matchAll(/\*\*([A-Za-z ]+):\*\*\s*([^\n]*)/g)) {
    const field = V2_PROFICIENCY_FIELDS[label];
    if (field) {
      fields[field] = value.trim();
    }
  }
  return fields;
}

const FULL_CASTERS = new Set(["bard", "cleric", "druid", "sorcerer", "wizard"]);
const HALF_CASTERS = new Set(["paladin", "ranger"]);

export function classMechanics(slug: string, row: Record<string, unknown>): ClassMechanics {
  const data = row.prof_armor === undefined ? { ...row, ...v2ProficiencyFields(row) } : row;
  const hitDieRaw = Number.parseInt(String(data.hit_dice ?? "").replace(/^\d*d/i, ""), 10);
  const hitDie = ([6, 8, 10, 12] as const).includes(hitDieRaw as 6 | 8 | 10 | 12)
    ? (hitDieRaw as 6 | 8 | 10 | 12)
    : 8;

  const savesText = normalizeText(data.prof_saving_throws);
  // A v2 row's structured saves win over its prose, which can disagree (the
  // marshal's text says Wisdom and Charisma, its saving_throws Con and Wis).
  const saves = Array.isArray(data.saving_throws)
    ? (data.saving_throws as Array<{ name?: unknown }>).flatMap((save) => {
        const ability = ABILITY_BY_NAME[normalizeText(save.name)];
        return ability ? [ability] : [];
      })
    : (Object.keys(ABILITY_BY_NAME) as Array<keyof typeof ABILITY_BY_NAME>)
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
    armor: proficiencyList(data.prof_armor),
    weapons: proficiencyList(data.prof_weapons),
    tools: proficiencyList(data.prof_tools),
    spellAbility: spellAbility && casterType !== "none" ? spellAbility : spellAbility,
    casterType,
  };
}

export type BackgroundMechanics = {
  skills: string[];
  // "Persuasion, and either Insight or History": the part the player picks.
  skillChoice?: { count: number; from: string[] };
  tools: string[];
  // Extra languages of the player's choice, and the ones named outright.
  languages: number;
  knownLanguages: string[];
  equipment: string[];
};

const V2_BENEFIT_TYPES: Record<string, string> = {
  skill_proficiencies: "skill_proficiency",
  tool_proficiencies: "tool_proficiency",
  languages: "language",
  equipment: "equipment",
};

// A v1 background row carries each grant as a prose field; a v2 row (a5e-ag,
// a5e-ddg, a5e-gpg) as a `benefits` entry of the matching type.
function backgroundField(data: Record<string, unknown>, field: string): string {
  if (Array.isArray(data.benefits)) {
    const benefits = data.benefits as Array<{ type?: unknown; desc?: unknown }>;
    return String(benefits.find((benefit) => benefit.type === V2_BENEFIT_TYPES[field])?.desc ?? "");
  }
  return String(data[field] ?? "");
}

function backgroundSkills(text: string): Pick<BackgroundMechanics, "skills" | "skillChoice"> {
  // Where the fixed skills end and the pick begins: "and either Insight or
  // History", "plus one of your choice from among ...", "Your choice of two
  // from among ...", "any one skill of your choice", "Two of your choice".
  const choice = /\b(?:(?:one|two|three|four)\s+of your choice|either|your choice|any)\b/i.exec(text);
  if (!choice) {
    return { skills: skillsInText(text) };
  }
  const skills = skillsInText(text.slice(0, choice.index));
  const rest = text.slice(choice.index);
  const named = skillsInText(rest).filter((skill) => !skills.includes(skill));
  const count = COUNT_WORDS[/\b(one|two|three|four)\b/i.exec(rest)?.[1].toLowerCase() ?? ""] ?? 1;
  return { skills, skillChoice: { count, from: named.length ? named : [...ALL_SKILLS] } };
}

// A choice stays one entry, the way the bundled backgrounds write "one
// gaming set": "Your choice of one from Thieves' Tools, Forgery Kit, or
// Disguise Kit." is one proficiency, not three.
function backgroundTools(text: string): string[] {
  const plain = text.trim().replace(/\.$/, "");
  if (/^no additional\b/i.test(plain)) {
    return [];
  }
  // "Two of your choice" names no noun; the field it sits in does.
  const bare = /^(one|two|three|four) of your choice$/i.exec(plain);
  if (bare) {
    return [`${bare[1]} ${bare[1].toLowerCase() === "one" ? "tool" : "tools"} of your choice`];
  }
  return /\bchoice\b|\bor\b/i.test(plain) ? [plain] : proficiencyList(plain);
}

// Items split at the commas outside parentheses and numbers ("a bag of 1,000
// ball bearings"). "A dagger, quarterstaff, or spear" is one item to pick, so
// an "or ..." piece rejoins the pieces before it back to the one opening with
// an article, or to the first.
function backgroundEquipment(text: string): string[] {
  const pieces: string[] = [];
  let current = "";
  let depth = 0;
  for (const [index, char] of [...text].entries()) {
    depth += char === "(" ? 1 : char === ")" ? -1 : 0;
    const inNumber = /\d/.test(text[index - 1] ?? "") && /\d/.test(text[index + 1] ?? "");
    if ((char === "," || char === ";") && depth === 0 && !inNumber) {
      pieces.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  pieces.push(current);
  const article = /^(?:a|an|one)\s/i;
  const items: string[] = [];
  for (const raw of pieces) {
    const piece = raw.trim().replace(/^and\s+/i, "").replace(/\.$/, "").trim();
    if (!piece) {
      continue;
    }
    if (/^or\s/i.test(piece) && items.length) {
      let start = items.length - 1;
      while (start > 0 && !article.test(items[start])) {
        start -= 1;
      }
      items.splice(start, items.length - start, [...items.slice(start), piece].join(", "));
    } else {
      items.push(piece);
    }
  }
  return items;
}

// What a content-pack background grants, read from its text: the builder
// offers it the way it offers a bundled background's.
export function backgroundMechanics(data: Record<string, unknown>): BackgroundMechanics {
  // "No additional languages" names none and counts none, as it should.
  const grant = parseRaceLanguages(backgroundField(data, "languages"));
  return {
    ...backgroundSkills(backgroundField(data, "skill_proficiencies")),
    tools: backgroundTools(backgroundField(data, "tool_proficiencies")),
    languages: grant.bonusLanguages,
    knownLanguages: grant.languages,
    equipment: backgroundEquipment(backgroundField(data, "equipment")),
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
