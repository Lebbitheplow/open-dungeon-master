import type { EnemyStats, SaveAbility } from "@/lib/bestiary/statblock";

// A stat block's sections, and the lines the block prints that the attack
// list does not carry.
//
// docs/workshop-plan.md phase 6 chose to keep legendary and lair actions as
// TEXT LINES in `traits`, because nothing in the engine runs one and a
// structured field would have been a column only its own editor reads.
// That decision stands. What this module adds is a way for a line to say
// which section it belongs to, with a prefix a person can read and the
// engine prints verbatim: "Legendary action: Wing Attack. The dragon beats
// its wings...". The DM's prompt gets the same text either way; the block
// on screen gets sections.
//
// Pure by design: no DB and no I/O, so scripts/test-block-sections.mjs
// drives it directly.

export const TRAIT_SECTIONS = ["trait", "action", "bonus", "reaction", "legendary", "lair"] as const;
export type TraitSection = (typeof TRAIT_SECTIONS)[number];

export const SECTION_LABELS: Record<TraitSection, string> = {
  trait: "Trait",
  action: "Action",
  bonus: "Bonus action",
  reaction: "Reaction",
  legendary: "Legendary action",
  lair: "Lair action",
};

// The prefix a line wears, lowercased, with the punctuation a person is
// likely to type after it.
const PREFIXES: Array<[TraitSection, RegExp]> = [
  ["legendary", /^legendary(?: action)?\s*[:.-]\s*/i],
  ["lair", /^lair(?: action)?\s*[:.-]\s*/i],
  ["bonus", /^bonus(?: action)?\s*[:.-]\s*/i],
  ["reaction", /^reaction\s*[:.-]\s*/i],
  ["action", /^action\s*[:.-]\s*/i],
];

export function sectionOfLine(line: string): { section: TraitSection; text: string } {
  const trimmed = line.trim();
  for (const [section, pattern] of PREFIXES) {
    if (pattern.test(trimmed)) {
      return { section, text: trimmed.replace(pattern, "") };
    }
  }
  return { section: "trait", text: trimmed };
}

// The same line, wearing a different section. A trait wears no prefix,
// because most lines are traits and a prefix on every one is noise.
export function withSection(line: string, section: TraitSection): string {
  const { text } = sectionOfLine(line);
  return section === "trait" ? text : `${SECTION_LABELS[section]}: ${text}`;
}

// Lines grouped by section, in the order a printed block lists them.
export function groupTraits(traits: string[]): Array<{ section: TraitSection; lines: string[] }> {
  const groups = new Map<TraitSection, string[]>();
  for (const line of traits) {
    const { section, text } = sectionOfLine(line);
    if (!text) {
      continue;
    }
    (groups.get(section) ?? groups.set(section, []).get(section))!.push(text);
  }
  return TRAIT_SECTIONS.filter((section) => groups.has(section)).map((section) => ({
    section,
    lines: groups.get(section) as string[],
  }));
}

// ---- the lines the block carries beyond its attacks ----

export const ABILITY_ORDER: readonly SaveAbility[] = ["str", "dex", "con", "int", "wis", "cha"];

export const SKILL_NAMES = [
  "acrobatics",
  "animal handling",
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
  "sleight of hand",
  "stealth",
  "survival",
] as const;

export const SENSE_NAMES = ["darkvision", "blindsight", "tremorsense", "truesight"] as const;

export const ENVIRONMENTS = [
  "arctic",
  "coastal",
  "desert",
  "forest",
  "grassland",
  "hill",
  "mountain",
  "swamp",
  "underdark",
  "underwater",
  "urban",
] as const;

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

// "STR 18 (+4), DEX 12 (+1), ..." for a block with scores.
export function abilityLine(stats: Pick<EnemyStats, "abilities">): string {
  const scores = stats.abilities;
  if (!scores) {
    return "";
  }
  return ABILITY_ORDER.filter((ability) => typeof scores[ability] === "number")
    .map((ability) => `${ability.toUpperCase()} ${scores[ability]} (${signed(abilityMod(scores[ability] as number))})`)
    .join(", ");
}

// What the DM's prompt gets to see beyond the attack list: the lines the
// attack list cannot carry, each only when the block says something.
export function extraBlockLines(
  stats: Pick<EnemyStats, "abilities" | "skills" | "senses" | "languages" | "alignment" | "spells">,
): string[] {
  const lines: string[] = [];
  const abilities = abilityLine(stats);
  if (abilities) {
    lines.push(abilities);
  }
  const skills = Object.entries(stats.skills ?? {}).filter(([, bonus]) => typeof bonus === "number");
  if (skills.length) {
    lines.push(`Skills: ${skills.map(([name, bonus]) => `${name} ${signed(bonus)}`).join(", ")}`);
  }
  const senses = stats.senses;
  if (senses) {
    const parts = SENSE_NAMES.filter((sense) => senses[sense]).map((sense) => `${sense} ${senses[sense]} ft`);
    if (typeof senses.passivePerception === "number") {
      parts.push(`passive Perception ${senses.passivePerception}`);
    }
    if (parts.length) {
      lines.push(`Senses: ${parts.join(", ")}`);
    }
  }
  if (stats.languages) {
    lines.push(`Languages: ${stats.languages}`);
  }
  if (stats.alignment) {
    lines.push(`Alignment: ${stats.alignment}`);
  }
  if (stats.spells?.length) {
    lines.push(`Spells known: ${stats.spells.join(", ")}`);
  }
  return lines;
}

// Which sense sees how far, in tiles, for the vision model, should an
// enemy ever be given one: the longest of the four.
export function senseTiles(stats: Pick<EnemyStats, "senses">, tileFeet = 5): number {
  const senses = stats.senses;
  if (!senses) {
    return 0;
  }
  return Math.floor(Math.max(0, ...SENSE_NAMES.map((sense) => senses[sense] ?? 0)) / tileFeet);
}
