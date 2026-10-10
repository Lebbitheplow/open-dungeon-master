import { parseAbilityText } from "@/lib/dm/monster-abilities";
import { addTrait, hasTerm, toggleTerm } from "@/lib/bestiary/kit";
import type { MonsterDraft } from "@/lib/bestiary/monster-draft";

// The SRD's Half-Dragon template (Monsters, Half-Dragon Template) as a
// transformation of a block in the bestiary editor: a beast, humanoid, giant
// or monstrosity keeps its statistics and gains blindsight 10 feet,
// darkvision 60 feet, resistance by its dragon half's colour, Draconic, and
// the breath weapon of a dragon of that colour by its size (a wyrmling's
// for Large or smaller, a young dragon's for Huge, an adult's for
// Gargantuan). Each breath below is the bundled book's own, word for word,
// so the engine parses its save, DC, dice and area as it does the dragon's.
// Pure.

export const DRAGON_COLORS = ["black", "blue", "brass", "bronze", "copper", "gold", "green", "red", "silver", "white"] as const;
export type DragonColor = (typeof DRAGON_COLORS)[number];
type Age = "wyrmling" | "young" | "adult";

const RESISTANCE: Record<DragonColor, string> = {
  black: "acid",
  copper: "acid",
  blue: "lightning",
  bronze: "lightning",
  brass: "fire",
  gold: "fire",
  red: "fire",
  green: "poison",
  silver: "cold",
  white: "cold",
};

// The breath a dragon of each colour and age prints in the SRD.
const BREATH: Record<DragonColor, Record<Age, { name: string; desc: string }>> = {
  black: {
    wyrmling: { name: "Acid Breath", desc: "The dragon exhales acid in a 15-foot line that is 5 feet wide. Each creature in that line must make a DC 11 Dexterity saving throw, taking 22 (5d8) acid damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Acid Breath", desc: "The dragon exhales acid in a 30-foot line that is 5 feet wide. Each creature in that line must make a DC 14 Dexterity saving throw, taking 49 (11d8) acid damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Acid Breath", desc: "The dragon exhales acid in a 60-foot line that is 5 feet wide. Each creature in that line must make a DC 18 Dexterity saving throw, taking 54 (12d8) acid damage on a failed save, or half as much damage on a successful one." },
  },
  blue: {
    wyrmling: { name: "Lightning Breath", desc: "The dragon exhales lightning in a 30-foot line that is 5 feet wide. Each creature in that line must make a DC 12 Dexterity saving throw, taking 22 (4d10) lightning damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Lightning Breath", desc: "The dragon exhales lightning in a 60-foot line that is 5 feet wide. Each creature in that line must make a DC 16 Dexterity saving throw, taking 55 (10d10) lightning damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Lightning Breath", desc: "The dragon exhales lightning in a 90-foot line that is 5 feet wide. Each creature in that line must make a DC 19 Dexterity saving throw, taking 66 (12d10) lightning damage on a failed save, or half as much damage on a successful one." },
  },
  brass: {
    wyrmling: { name: "Fire Breath", desc: "The dragon exhales fire in a 20-foot line that is 5 feet wide. Each creature in that line must make a DC 11 Dexterity saving throw, taking 14 (4d6) fire damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Fire Breath", desc: "The dragon exhales fire in a 40-foot line that is 5 feet wide. Each creature in that line must make a DC 14 Dexterity saving throw, taking 42 (12d6) fire damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Fire Breath", desc: "The dragon exhales fire in a 60-foot line that is 5 feet wide. Each creature in that line must make a DC 18 Dexterity saving throw, taking 45 (13d6) fire damage on a failed save, or half as much damage on a successful one." },
  },
  bronze: {
    wyrmling: { name: "Lightning Breath", desc: "The dragon exhales lightning in a 40-foot line that is 5 feet wide. Each creature in that line must make a DC 12 Dexterity saving throw, taking 16 (3d10) lightning damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Lightning Breath", desc: "The dragon exhales lightning in a 60-foot line that is 5 feet wide. Each creature in that line must make a DC 15 Dexterity saving throw, taking 55 (10d10) lightning damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Lightning Breath", desc: "The dragon exhales lightning in a 90-foot line that is 5 feet wide. Each creature in that line must make a DC 19 Dexterity saving throw, taking 66 (12d10) lightning damage on a failed save, or half as much damage on a successful one." },
  },
  copper: {
    wyrmling: { name: "Acid Breath", desc: "The dragon exhales acid in a 20-foot line that is 5 feet wide. Each creature in that line must make a DC 11 Dexterity saving throw, taking 18 (4d8) acid damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Acid Breath", desc: "The dragon exhales acid in a 40-foot line that is 5 feet wide. Each creature in that line must make a DC 14 Dexterity saving throw, taking 40 (9d8) acid damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Acid Breath", desc: "The dragon exhales acid in a 60-foot line that is 5 feet wide. Each creature in that line must make a DC 18 Dexterity saving throw, taking 54 (12d8) acid damage on a failed save, or half as much damage on a successful one." },
  },
  gold: {
    wyrmling: { name: "Fire Breath", desc: "The dragon exhales fire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 22 (4d10) fire damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Fire Breath", desc: "The dragon exhales fire in a 30-foot cone. Each creature in that area must make a DC 17 Dexterity saving throw, taking 55 (10d10) fire damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Fire Breath", desc: "The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 21 Dexterity saving throw, taking 66 (12d10) fire damage on a failed save, or half as much damage on a successful one." },
  },
  green: {
    wyrmling: { name: "Poison Breath", desc: "The dragon exhales poisonous gas in a 15-foot cone. Each creature in that area must make a DC 11 Constitution saving throw, taking 21 (6d6) poison damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Poison Breath", desc: "The dragon exhales poisonous gas in a 30-foot cone. Each creature in that area must make a DC 14 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Poison Breath", desc: "The dragon exhales poisonous gas in a 60-foot cone. Each creature in that area must make a DC 18 Constitution saving throw, taking 56 (16d6) poison damage on a failed save, or half as much damage on a successful one." },
  },
  red: {
    wyrmling: { name: "Fire Breath", desc: "The dragon exhales fire in a 15-foot cone. Each creature in that area must make a DC 13 Dexterity saving throw, taking 24 (7d6) fire damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Fire Breath", desc: "The dragon exhales fire in a 30-foot cone. Each creature in that area must make a DC 17 Dexterity saving throw, taking 56 (16d6) fire damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Fire Breath", desc: "The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save, or half as much damage on a successful one." },
  },
  silver: {
    wyrmling: { name: "Cold Breath", desc: "The dragon exhales an icy blast in a 15-foot cone. Each creature in that area must make a DC 13 Constitution saving throw, taking 18 (4d8) cold damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Cold Breath", desc: "The dragon exhales an icy blast in a 30-foot cone. Each creature in that area must make a DC 17 Constitution saving throw, taking 54 (12d8) cold damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Cold Breath", desc: "The dragon exhales an icy blast in a 60-foot cone. Each creature in that area must make a DC 20 Constitution saving throw, taking 58 (13d8) cold damage on a failed save, or half as much damage on a successful one." },
  },
  white: {
    wyrmling: { name: "Cold Breath", desc: "The dragon exhales an icy blast of hail in a 15-foot cone. Each creature in that area must make a DC 12 Constitution saving throw, taking 22 (5d8) cold damage on a failed save, or half as much damage on a successful one." },
    young: { name: "Cold Breath", desc: "The dragon exhales an icy blast in a 30-foot cone. Each creature in that area must make a DC 15 Constitution saving throw, taking 45 (10d8) cold damage on a failed save, or half as much damage on a successful one." },
    adult: { name: "Cold Breath", desc: "The dragon exhales an icy blast in a 60-foot cone. Each creature in that area must make a DC 19 Constitution saving throw, taking 54 (12d8) cold damage on a failed save, or half as much damage on a successful one." },
  },};

const TEMPLATE_TYPES = ["beast", "humanoid", "giant", "monstrosity"];
// The challenge rating at which the template leaves the rating as it was.
const PREREQUISITE: Record<Age, number> = { wyrmling: 2, young: 7, adult: 8 };

function ageFor(size: string | undefined): Age {
  const word = (size ?? "Medium").toLowerCase();
  return word === "gargantuan" ? "adult" : word === "huge" ? "young" : "wyrmling";
}

export type HalfDragonResult = { draft: MonsterDraft; note: string } | { error: string };

export function applyHalfDragon(draft: MonsterDraft, color: DragonColor): HalfDragonResult {
  const type = (draft.stats.type ?? "monstrosity").toLowerCase();
  if (!TEMPLATE_TYPES.includes(type)) {
    return { error: `Only a beast, humanoid, giant or monstrosity can become a half-dragon; this is a ${type}.` };
  }
  const age = ageFor(draft.stats.size);
  const breath = BREATH[color][age];
  const recharge = `${breath.name} (Recharge 5-6)`;
  const senses = { ...(draft.stats.senses ?? {}) };
  senses.blindsight = Math.max(senses.blindsight ?? 0, 10);
  senses.darkvision = Math.max(senses.darkvision ?? 0, 60);
  const damage = RESISTANCE[color];
  const resist = hasTerm(draft.stats.resist, damage) ? draft.stats.resist : toggleTerm(draft.stats.resist, damage);
  const languages = /\bdraconic\b/i.test(draft.stats.languages ?? "") ? draft.stats.languages : [draft.stats.languages, "Draconic"].filter(Boolean).join(", ");
  const special = parseAbilityText(recharge, breath.desc);
  const specials = (draft.stats.specials ?? []).filter((entry) => !/breath/i.test(entry.name));
  const next = addTrait(
    {
      ...draft,
      stats: {
        ...draft.stats,
        senses,
        resist,
        ...(languages ? { languages } : {}),
        ...(special ? { specials: [...specials, special] } : {}),
      },
    },
    `${recharge}: ${breath.desc}`,
  );
  const prerequisite = PREREQUISITE[age];
  return {
    draft: next,
    note:
      draft.stats.cr >= prerequisite
        ? `Half-${color} dragon: CR ${draft.stats.cr} meets the template's challenge ${prerequisite}, so the rating stands.`
        : `Half-${color} dragon: below challenge ${prerequisite} the SRD asks for the rating to be worked out again; the rating panel shows what the numbers now support.`,
  };
}
