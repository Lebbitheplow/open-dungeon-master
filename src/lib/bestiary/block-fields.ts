// The fields of an Open5e row a stored block keeps beside its attacks and
// traits, read as the books print them: the speed, the size, the type's
// tags, the habitats, the lair's printed options, and the scores, skills,
// senses, languages and alignment. Pure; read by statblock.ts parseMonster.

import type { EnemySenses, EnemyStats, SaveAbility } from "@/lib/bestiary/statblock";

type RawEntry = { name?: unknown; desc?: unknown };

// A row's field as the number or the text it should be, else none.
export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// "30, fly 60": the walking speed first, since every reader takes the first
// number as the walk (src/lib/battlemap/movement.ts speedToTiles). Tome of
// Beasts 3 spells burrow "bur.", and the SRD werecreatures keep their animal
// form's speed in a note ("40 ft. in wolf form"), carried in brackets.
const SPEED_MODES: Record<string, string> = { "bur.": "burrow", bur: "burrow" };

export function formatSpeed(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object") {
    const entries = Object.entries(raw as Record<string, unknown>);
    const walk = entries.find(([mode, value]) => mode === "walk" && typeof value === "number");
    const modes = entries
      .filter(([mode, value]) => mode !== "walk" && typeof value === "number")
      .map(([mode, value]) => `${SPEED_MODES[mode] ?? mode} ${value}`);
    const note = entries.find(([mode, value]) => mode === "notes" && typeof value === "string" && value.trim());
    // With no walking speed printed, the first mode is the one it moves by,
    // as before (the board knows no flying or swimming of its own).
    const line = [...(walk ? [String(walk[1])] : []), ...modes].join(", ");
    return note ? `${line} (${String(note[1]).trim()})` : line;
  }
  return "30";
}

// A5e's Titanic is bigger than Gargantuan; the board and the grapple rules
// stop at Gargantuan, so it reads as that.
export function sizeOf(raw: unknown): string {
  const size = asString(raw).trim();
  return /^titanic$/i.test(size) ? "Gargantuan" : size;
}

// The options a lair offers, from the list after "takes a lair action ...
// one of the following" in a lair trait, else under the lore's "Lair
// Actions" heading. Each item one option, its spacing made plain.
const LAIR_OPTIONS = 8;

export function lairOptionsOf(data: Record<string, unknown>, specials: RawEntry[]): string[] {
  const listed = (text: string) =>
    text
      .split(/\n\s*[-*\u2022]\s+/)
      .slice(1)
      .map((item) => item.split(/\n\s*\n|\n#+\s/)[0].replace(/\s+/g, " ").trim())
      .filter((item) => item.length > 10)
      .slice(0, LAIR_OPTIONS);
  const trait = specials.find((entry) => /lair/i.test(asString(entry.name)) && /takes? a lair action/i.test(asString(entry.desc)));
  if (trait) {
    const options = listed(asString(trait.desc));
    if (options.length) {
      return options;
    }
  }
  const lore = asString(data.desc);
  const heading = /#+\s*Lair Actions\s*\n/i.exec(lore);
  if (!heading) {
    return [];
  }
  const section = lore.slice(heading.index + heading[0].length).split(/\n#+\s/)[0];
  return /lair action/i.test(section) ? listed(section) : [];
}

// "Humanoid (human, shapechanger)" or a subtype field: the bracket's tags.
export function subtypeOf(data: Record<string, unknown>): string {
  const field = asString(data.subtype).trim();
  const bracket = /\(([^)]+)\)/.exec(asString(data.type))?.[1] ?? "";
  return [field, bracket].filter(Boolean).join(", ").toLowerCase().slice(0, 80);
}

// The SRD's habitats (its environments field) as the workshop's eleven
// (src/lib/bestiary/block-sections.ts ENVIRONMENTS); a plane, a tomb or a
// laboratory is none of them.
const HABITATS: Array<[RegExp, string]> = [
  [/arctic|tundra|\bice\b|polar/i, "arctic"],
  [/coast/i, "coastal"],
  [/desert/i, "desert"],
  [/forest|jungle/i, "forest"],
  [/grassland|plain/i, "grassland"],
  [/\bhills?\b/i, "hill"],
  [/mountain|volcano/i, "mountain"],
  [/swamp|marsh/i, "swamp"],
  [/underdark|\bcaves?\b/i, "underdark"],
  [/underwater|ocean|\blake\b|\bsea\b/i, "underwater"],
  [/urban|city|settlement/i, "urban"],
];

function habitatsOf(raw: unknown): string[] {
  const places = (Array.isArray(raw) ? raw : []).map((entry) => asString(entry));
  return [...new Set(places.flatMap((place) => HABITATS.filter(([pattern]) => pattern.test(place)).map(([, habitat]) => habitat)))];
}

// The rest of an Open5e block: scores, skills, senses, languages and
// alignment, so a monster started from the pack arrives with the whole
// printed block rather than the half the engine runs.
export function parseBlockExtras(
  data: Record<string, unknown>,
  abilityFields: Record<SaveAbility, [score: string, save: string]>,
): Pick<EnemyStats, "abilities" | "skills" | "senses" | "languages" | "alignment" | "environment"> {
  const abilities: Partial<Record<SaveAbility, number>> = {};
  for (const [ability, [scoreField]] of Object.entries(abilityFields) as Array<[SaveAbility, [string, string]]>) {
    const score = asNumber(data[scoreField]);
    if (score !== null) {
      abilities[ability] = score;
    }
  }
  const skills: Record<string, number> = {};
  const rawSkills = data.skills;
  if (rawSkills && typeof rawSkills === "object" && !Array.isArray(rawSkills)) {
    for (const [name, bonus] of Object.entries(rawSkills as Record<string, unknown>)) {
      const value = asNumber(bonus);
      if (value !== null) {
        skills[name.trim().toLowerCase().replace(/_/g, " ")] = value;
      }
    }
  }
  const sensesText = asString(data.senses);
  const senses: EnemySenses = {};
  for (const sense of ["darkvision", "blindsight", "tremorsense", "truesight"] as const) {
    const match = new RegExp(`${sense}\\s*(\\d+)`, "i").exec(sensesText);
    if (match) {
      senses[sense] = Number(match[1]);
    }
  }
  const passive = /passive perception\s*(\d+)/i.exec(sensesText);
  if (passive) {
    senses.passivePerception = Number(passive[1]);
  } else if (String(data.document__slug ?? "") === "blackflag" && asNumber(data.perception) !== null) {
    // Black Flag prints its passive Perception in a field of its own (an
    // aboleth's 20), never in its senses; the other books' perception field
    // is the skill's bonus, which skills already carry.
    senses.passivePerception = asNumber(data.perception) as number;
  }
  return {
    ...(Object.keys(abilities).length ? { abilities } : {}),
    ...(Object.keys(skills).length ? { skills } : {}),
    ...(Object.keys(senses).length ? { senses } : {}),
    ...(asString(data.languages) ? { languages: asString(data.languages).slice(0, 200) } : {}),
    ...(asString(data.alignment) ? { alignment: asString(data.alignment).slice(0, 40) } : {}),
    ...(habitatsOf(data.environments).length ? { environment: habitatsOf(data.environments) } : {}),
  };
}
