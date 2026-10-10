import { clamp, text, type Raw } from "@/lib/homebrew/coerce";
import { raceSizeOf } from "@/lib/content/mechanics";

// A workshop species in the fields the builder and the creation check read
// a race by (src/lib/content/mechanics.ts raceMechanics): its scores, speed,
// size, languages and traits, and the structured grants the SRD's races
// carry, its skills, tools, weapon and armor training, a cantrip from a
// class list, and the picks it leaves the player, and its size and the
// dwarf's heavy-armor clause, which the engines read off it at the table. A homebrew species kept
// only the first five, so a workshop copy of the High Elf lost the Elf's
// own traits, its Perception, its longbows and its wizard cantrip, and a
// copy of the Hill Dwarf walked at 30 feet.

const ABILITY_WORDS = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;
const SHORT: Record<string, (typeof ABILITY_WORDS)[number]> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
const SHORT_IDS = ["str", "dex", "con", "int", "wis", "cha"] as const;
const CLASS_LISTS = ["bard", "cleric", "druid", "sorcerer", "warlock", "wizard"];

function words(value: unknown, count: number, max = 40): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = [...new Set(value.map((entry) => text(entry, max)).filter(Boolean))].slice(0, count);
  return list.length ? list : undefined;
}

// The ability increases, as the pack writes them: [{ attributes, value }].
// A map ({ con: 2, wis: 1 }) is taken too, as the expanded pack writes it.
function asiRows(raw: unknown): Array<{ attributes: string[]; value: number }> {
  const out: Array<{ attributes: string[]; value: number }> = [];
  if (Array.isArray(raw)) {
    for (const entry of raw.slice(0, 6)) {
      const row = (entry ?? {}) as Raw;
      const attributes = Array.isArray(row.attributes) ? row.attributes.map((a) => String(a).trim()).filter(Boolean).slice(0, 6) : [];
      const value = clamp(row.value, -2, 3, 1);
      if (attributes.length && value !== 0) {
        out.push({ attributes, value });
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Raw)) {
      const name = SHORT[key.toLowerCase()] ?? ABILITY_WORDS.find((word) => word.toLowerCase() === key.toLowerCase());
      const amount = clamp(value, -2, 3, 0);
      if (name && amount) {
        out.push({ attributes: [name], value: amount });
      }
    }
  }
  return out;
}

export function normalizeRaceData(source: Raw, data: Raw & { desc: string }): Raw & { desc: string } {
  data.traits = text(source.traits, 6_000);
  data.size = raceSizeOf(source.size) ?? "Medium";
  if (source.heavyArmorSpeed === true) data.heavyArmorSpeed = true;
  data.speed = { walk: clamp((source.speed as Raw | undefined)?.walk ?? source.speed, 5, 120, 30) };
  // A list is the structured form (["Common", "Elvish"]); text is parsed.
  const languageList = words(source.languages, 12, 30);
  data.languages = languageList ?? text(source.languages, 300);
  const bonus = clamp(source.bonusLanguages, 0, 4, 0);
  if (bonus) data.bonusLanguages = bonus;
  const languageChoice = (source.languageChoice ?? null) as Raw | null;
  const languageFrom = words(languageChoice?.from, 12, 30);
  if (languageChoice && languageFrom) data.languageChoice = { count: clamp(languageChoice.count, 1, 3, 1), from: languageFrom };
  data.vision = text(source.vision, 120);
  data.asi = asiRows(source.asi);
  const asiChoice = (source.asiChoice ?? null) as Raw | null;
  if (asiChoice && clamp(asiChoice.count, 0, 3, 0)) {
    const from = Array.isArray(asiChoice.from) ? asiChoice.from.filter((a) => SHORT_IDS.includes(a as (typeof SHORT_IDS)[number])) : [];
    data.asiChoice = { count: clamp(asiChoice.count, 1, 3, 1), amount: clamp(asiChoice.amount, 1, 2, 1), ...(from.length ? { from } : {}) };
  }
  const skills = words(source.skills, 6, 30)?.map((skill) => skill.toLowerCase().replace(/\s+/g, "_"));
  if (skills) data.skills = skills;
  const skillChoice = clamp((source.skillChoice as Raw | undefined)?.count, 0, 4, 0);
  if (skillChoice) data.skillChoice = { count: skillChoice };
  const tools = words(source.tools, 6);
  if (tools) data.tools = tools;
  const toolChoice = (source.toolChoice ?? null) as Raw | null;
  const toolFrom = words(toolChoice?.from, 12);
  if (toolChoice && toolFrom) data.toolChoice = { count: clamp(toolChoice.count, 1, 3, 1), from: toolFrom };
  const armor = words(source.armor, 6);
  if (armor) data.armor = armor;
  const weapons = words(source.weapons, 12);
  if (weapons) data.weapons = weapons;
  const cantrip = (source.cantripChoice ?? null) as Raw | null;
  if (cantrip && CLASS_LISTS.includes(String(cantrip.list))) {
    data.cantripChoice = { list: String(cantrip.list), count: clamp(cantrip.count, 1, 3, 1) };
  }
  return data;
}
