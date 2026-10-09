// Curated character-creation examples; gender-neutral variants are independent portraits.
import { normalizeGender } from "@/lib/placeholders";

export const ILLUSTRATED_RACES = [
  "human",
  "elf",
  "drow",
  "half-elf",
  "dwarf",
  "halfling",
  "gnome",
  "half-orc",
  "dragonborn",
  "tiefling",
  "aasimar",
  "goliath",
  "firbolg",
  "tabaxi",
  "kenku",
  "tortle",
  "genasi",
  "changeling",
  "warforged",
  "goblin",
  "bugbear",
  "lizardfolk"
] as const;
export const ILLUSTRATED_CLASSES = [
  "artificer",
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
  "marshal",
  "mechanist",
  "netrunner",
  "street_samurai",
  "rigger",
  "fixer",
  "esper",
  "trauma_doc",
  "machinist",
  "aeronaut",
  "alchemist",
  "gadgeteer",
  "aether_channeler",
  "steam_knight",
  "exorcist",
  "occultist",
  "survivor",
  "slayer",
  "parapsychologist",
  "apostate",
  "detective",
  "alienist",
  "grifter",
  "enforcer",
  "muckraker",
  "spirit_medium",
  "scavenger",
  "road_warrior",
  "aberrant",
  "salvage_tech",
  "waste_preacher",
  "packmaster",
  "witch_hunter",
  "plague_doctor",
  "grave_knight",
  "penitent",
  "dirgesinger",
  "vermin_lord"
] as const;

const races = new Set<string>(ILLUSTRATED_RACES);
const classes = new Set<string>(ILLUSTRATED_CLASSES);

export function illustratedPortrait(
  kind: "race" | "class",
  rawId: string,
  gender?: string | null,
): string | null {
  const id = String(rawId ?? "").trim().toLowerCase()
    .replace(/[\s_-]+/g, kind === "race" ? "-" : "_");
  if (!(kind === "race" ? races : classes).has(id)) return null;
  return `/assets/portraits/illustrated-v1/character-${kind}/${id}-${normalizeGender(gender)}.webp`;
}
