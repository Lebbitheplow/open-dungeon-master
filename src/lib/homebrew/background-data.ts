import { clamp, text, type Raw } from "@/lib/homebrew/coerce";

// A workshop background in the fields the builder and the creation check
// read a background by (src/lib/content/mechanics.ts backgroundMechanics):
// the prose fields the content pack writes, and `grants`, the same grants
// as structured picks: fixed skills and a pick of more, tools, languages
// named and of choice, the kit as catalog items and the starting coin.
// A homebrew background kept only the prose, which the builder parses; a
// copy of the SRD's Criminal lost its Deception and Stealth to "Deception,
// Stealth" read as one skill, and its 15 gp to a kit line.
//
// With grants present the prose is written from them, so every reader of
// either says the same.

const SKILL_IDS = [
  "acrobatics", "animal_handling", "arcana", "athletics", "deception", "history", "insight", "intimidation",
  "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion",
  "sleight_of_hand", "stealth", "survival",
];

export type BackgroundGrants = {
  skills: string[];
  skillChoice?: { count: number; from: string[] };
  tools: string[];
  languages: number;
  knownLanguages: string[];
  equipment: string[];
  purse: number;
};

function words(value: unknown, count: number, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry, max)).filter(Boolean))].slice(0, count);
}

// A kit line per item: ten torches are ten lines, as the class kits write them.
function kitLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => text(entry, 200)).filter(Boolean).slice(0, 80);
}

const skillIds = (value: unknown, count: number) =>
  words(value, count, 40)
    .map((skill) => skill.toLowerCase().replace(/[\s-]+/g, "_"))
    .filter((skill) => SKILL_IDS.includes(skill));

const skillName = (id: string) => id.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).replace(" Of ", " of ");

export function backgroundGrantsOf(raw: unknown): BackgroundGrants | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Raw;
  const choice = (source.skillChoice ?? null) as Raw | null;
  const choiceFrom = skillIds(choice?.from, 18);
  const choiceCount = clamp(choice?.count, 0, 4, 0);
  return {
    skills: skillIds(source.skills, 6),
    ...(choiceCount ? { skillChoice: { count: choiceCount, from: choiceFrom } } : {}),
    tools: words(source.tools, 8, 120),
    languages: clamp(source.languages, 0, 8, 0),
    knownLanguages: words(source.knownLanguages, 6, 30),
    equipment: kitLines(source.equipment),
    purse: clamp(source.purse, 0, 10_000, 0),
  };
}

// The prose the grants say, in the content pack's wording.
function proseOf(grants: BackgroundGrants) {
  const skills = grants.skills.map(skillName);
  const pick = grants.skillChoice
    ? `${grants.skillChoice.count === 1 ? "one" : grants.skillChoice.count} of your choice${grants.skillChoice.from.length ? ` from among ${grants.skillChoice.from.map(skillName).join(", ")}` : ""}`
    : "";
  const languages = [
    ...grants.knownLanguages,
    ...(grants.languages ? [`${grants.languages === 1 ? "One" : grants.languages} of your choice`] : []),
  ];
  return {
    skill_proficiencies: [skills.join(", "), pick].filter(Boolean).join(", plus "),
    tool_proficiencies: grants.tools.join(", "),
    languages: languages.join(", "),
    equipment: [...grants.equipment, ...(grants.purse ? [`${grants.purse} gp`] : [])].join(", "),
  };
}

export function normalizeBackgroundData(source: Raw, data: Raw & { desc: string }): Raw & { desc: string } {
  // The Open5e field names, because that is what the builder reads
  // (skillsInText over skill_proficiencies).
  data.skill_proficiencies = text(source.skill_proficiencies, 200);
  data.tool_proficiencies = text(source.tool_proficiencies, 200);
  data.languages = text(source.languages, 200);
  data.equipment = text(source.equipment, 500);
  data.feature = text(source.feature, 80);
  data.feature_desc = text(source.feature_desc, 4_000);
  const grants = backgroundGrantsOf(source.grants);
  if (grants) {
    data.grants = grants;
    const prose = proseOf(grants);
    data.skill_proficiencies = prose.skill_proficiencies.slice(0, 400);
    data.tool_proficiencies = prose.tool_proficiencies.slice(0, 400);
    data.languages = prose.languages.slice(0, 400);
    data.equipment = prose.equipment.slice(0, 4_000);
  }
  return data;
}
