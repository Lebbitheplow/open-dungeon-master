import type { ClassRole } from "@/lib/srd/class-roles";
import { textKey } from "@/lib/language/text-logic";

// "How do you want to play?", for someone who does not yet know a class by
// its name: each answer is a job at the table in plain words, the class
// roles it means (src/lib/srd/class-roles.ts), and the classes a first
// character of that kind usually starts with. Suggestions only: the whole
// catalog stays below, and nothing is picked until the player picks it.
// Pure, for scripts/test-builder-playstyles.mjs.

export type PlaystyleId = "front" | "hit" | "magic" | "help" | "sneak";

// `backgrounds` are the SRD backgrounds whose skills suit the playstyle,
// offered on the first step before the class is: a soldier's Athletics for
// the front line, a sage's Arcana for a caster, a criminal's Stealth for a
// scout.
export const PLAYSTYLES: ReadonlyArray<{ id: PlaystyleId; label: string; blurb: string; roles: ClassRole[]; first: string[]; backgrounds: string[] }> = [
  { id: "front", label: "Stand in front", blurb: "Take the hits and keep the others safe.", roles: ["Tank"], first: ["fighter", "barbarian", "paladin"], backgrounds: ["soldier", "folk_hero"] },
  { id: "hit", label: "Hit hard", blurb: "End fights fast, up close or from afar.", roles: ["DPS"], first: ["fighter", "ranger", "warlock", "rogue"], backgrounds: ["soldier", "outlander"] },
  { id: "magic", label: "Cast spells", blurb: "Bend the battle with magic.", roles: ["Control"], first: ["wizard", "sorcerer", "warlock"], backgrounds: ["sage", "hermit"] },
  { id: "help", label: "Help my friends", blurb: "Heal, protect and lift the party.", roles: ["Healer", "Support"], first: ["cleric", "bard", "druid"], backgrounds: ["acolyte", "folk_hero"] },
  { id: "sneak", label: "Sneak and solve", blurb: "Scout ahead, pick locks, talk your way through.", roles: ["Utility"], first: ["rogue", "ranger", "bard"], backgrounds: ["criminal", "urchin", "charlatan"] },
];

// Classes with the fewest choices to manage in play: a good first
// character, which is not the same as one that fits this world (the
// setting's own star says that).
export const EASY_CLASSES: ReadonlySet<string> = new Set(["fighter", "barbarian", "rogue", "cleric"]);

// Up to three classes this table offers for a playstyle: the usual starts
// first, then any other offered class whose role matches (a world pack's or
// a workshop's own classes), in the order given.
export function playstyleSuggestions(
  playstyle: PlaystyleId,
  offered: ReadonlyArray<{ id: string; roles: readonly string[] }>,
  limit = 3,
): string[] {
  const style = PLAYSTYLES.find((entry) => entry.id === playstyle);
  if (!style) return [];
  const ids = new Set(offered.map((entry) => entry.id));
  const usual = style.first.filter((id) => ids.has(id));
  const more = offered
    .filter((entry) => !usual.includes(entry.id) && entry.roles.some((role) => (style.roles as readonly string[]).includes(role)))
    .map((entry) => entry.id);
  return [...usual, ...more].slice(0, limit);
}

// The backgrounds this table offers that suit a playstyle, matched by id or
// by name (a content pack writes "folk-hero" where the SRD writes
// "folk_hero"), in the playstyle's order.
export function playstyleBackgrounds(
  playstyle: PlaystyleId,
  offered: ReadonlyArray<{ id: string; name: string }>,
): Array<{ id: string; name: string }> {
  const style = PLAYSTYLES.find((entry) => entry.id === playstyle);
  if (!style) return [];
  const key = (value: string) => textKey(value).replace(/[^\p{L}\p{M}]/gu, "");
  return style.backgrounds.flatMap((wanted) => {
    const found = offered.find((entry) => key(entry.id) === key(wanted) || key(entry.name) === key(wanted));
    return found ? [found] : [];
  });
}

// The skills each core class leans on, most used first: what "Suggest the
// rest" on the class skills fills empty picks with. A world's or a
// workshop's own class takes its list's order.
const CLASS_SKILLS: Record<string, string[]> = {
  barbarian: ["athletics", "perception", "survival", "intimidation"],
  bard: ["persuasion", "deception", "performance", "insight", "perception"],
  cleric: ["insight", "medicine", "religion", "persuasion"],
  druid: ["perception", "nature", "survival", "medicine"],
  fighter: ["athletics", "perception", "intimidation", "survival"],
  monk: ["acrobatics", "stealth", "athletics", "insight"],
  paladin: ["athletics", "persuasion", "insight", "intimidation"],
  ranger: ["perception", "stealth", "survival", "nature", "athletics"],
  rogue: ["stealth", "perception", "sleight_of_hand", "acrobatics", "deception", "investigation"],
  sorcerer: ["arcana", "persuasion", "deception", "insight"],
  warlock: ["arcana", "deception", "intimidation", "investigation"],
  wizard: ["arcana", "investigation", "history", "insight"],
};

// The class skills with the empty picks filled: the player's own picks are
// kept as they are, a skill already granted is never offered, and the rest
// come from the class's usual skills, then its list.
export function fillClassSkills({
  classId,
  from,
  count,
  chosen,
  granted,
}: {
  classId: string;
  from: readonly string[];
  count: number;
  chosen: readonly string[];
  granted: ReadonlySet<string>;
}): string[] {
  const open = (id: string) => from.includes(id) && !chosen.includes(id) && !granted.has(id.toLowerCase());
  const order = [...(CLASS_SKILLS[classId] ?? []), ...from];
  const out = [...chosen];
  for (const id of order) {
    if (out.length >= count) break;
    if (open(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
