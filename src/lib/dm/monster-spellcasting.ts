import type { SaveAbility } from "@/lib/bestiary/statblock";
import { splitWords, textKey } from "@/lib/language/text-logic";
import { ABILITY_WORDS } from "@/lib/dm/save-effect";

// A monster's spellcasting as the numbers it prints (SRD 5.1, Monsters:
// Spellcasting and Innate Spellcasting): its save DC, attack bonus, slots and
// the spells it knows, from whichever section the book filed it in. Pure;
// statblock.ts reads a pack row through it and enemy-casting.ts runs the
// result.

export type MonsterSpell = {
  name: string;
  // 0 for a cantrip; null for an innate spell whose level the block does not
  // print (the spell's own level applies).
  level: number | null;
  // Innate uses a day; absent for at will and for slot spells.
  perDay?: number;
};

export type MonsterSpellcasting = {
  dc?: number;
  attack?: number;
  ability?: SaveAbility;
  casterLevel?: number;
  // Slots by spell level ("1" -> 4).
  slots: Record<string, number>;
  spells: MonsterSpell[];
};

const titleCase = (name: string) =>
  splitWords(name)
    .map((part, index) => (index % 2 ? part.split("-").map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1)).join("-") : part))
    .join("")
    .replace(/\b(Of|The|And|From|To)\b/g, (word) => word.toLowerCase());

// Names the packs misprint, by the name the SRD (or the official book) gives
// the spell. The engine finds a spell by its whole name, so "Heroes Feast" on
// a block would never be cast.
const MISPRINTS: Record<string, string> = {
  "heroes feast": "Heroes' Feast",
  "detect good and evil": "Detect Evil and Good",
  "blindness deafness": "Blindness/Deafness",
  "mirage arcana": "Mirage Arcane",
  stoneshape: "Stone Shape",
  "create water": "Create or Destroy Water",
};

// One spell name from a list entry: its notes in brackets ("invisibility
// (self only)"), a damage or level note after it ("cure wounds 21 (4d8 + 3)",
// "circle of death (7th level; 10d6)") and markup dropped, the misprints read
// as the spell they mean.
function spellName(entry: string): string | null {
  const name = entry
    .replace(/\([^)]*\)?/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[_*•]/g, " ")
    .replace(/\s+\d+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // A faerie dragon's ages ("10 years old") are headings, not spells.
  if (!name || name.length > 40 || /^\d|\byears? old\b|^desc\b/i.test(name)) {
    return null;
  }
  return MISPRINTS[textKey(name)] ?? titleCase(name);
}

// A list's entries, split on the commas outside brackets: "detect thoughts
// (range 120 ft, desc: ), project image" is two spells, and "misty step (when
// in shadows, dim light, or darkness only)" one.
function spellNames(list: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of list) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if ((char === "," || char === ";") && depth === 0) {
      entries.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  entries.push(current);
  return entries.map(spellName).filter((name): name is string => name !== null);
}

// The list after a heading: its own line, and the lines after it while they
// read as more names (A5e prints one spell a line: "Cantrips (at will):
// light\n sacred flame"), not the prose a block may go on with.
function listOf(chunk: string): string {
  const [first, ...rest] = chunk.split("\n");
  const more: string[] = [];
  for (const line of rest) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 5 || /[.:]$/.test(line.trim())) {
      break;
    }
    more.push(line);
  }
  return [first, ...more].join(", ");
}

// A list's headings: "Cantrips (at will):", Tome of Beasts' "cantrips:",
// "1st level (4 slots):" and "1st level:", "At will:", "Constant:", "3/day
// each:", "1/rest each:", Tome of Beasts 3's "3/day ea:", and A5e's "3/day
// each:comprehend languages".
const HEADER =
  /(cantrips(?:\s*\(at will\))?|(\d)(?:st|nd|rd|th)[ -]level(?:\s*\((\d+)\s+slots?\))?|at will|constant|(\d+)\s*\/\s*(?:day|rest)(?:\s+(?:each|ea)\b\.?)?)\s*:/gi;

// "Spellcasting", "Innate Spellcasting" and "Shared Spellcasting" entries as
// the numbers they print. `name` is the entry's own name, which carries the
// uses of the one-spell form ("Innate Spellcasting (1/Day). The mephit can
// innately cast sleep").
export function parseSpellcasting(desc: string, name = ""): MonsterSpellcasting | null {
  const text = desc
    .replace(/\r/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/[_*]/g, "")
    .replace(/\s*•\s*/g, ", ");
  // Tome of Beasts 3 prints the ability and DC first: "Cha (DC 13) no
  // material components: ...".
  const short = /\b(str|dex|con|int|wis|cha)[a-z]*\.?\s*\((?:spell save )?DC\s*(\d{1,2})/i.exec(text);
  const dc = /(?:spell )?save DC\s*(\d{1,2})/i.exec(text) ?? (short ? [short[0], short[2]] : null);
  const attack = /([+-]\d{1,2}) to hit with spell attacks/i.exec(text);
  const level = /(\d{1,2})(?:st|nd|rd|th)-level spellcaster/i.exec(text);
  const ability =
    /spellcasting (?:ability|attribute) is (strength|dexterity|constitution|intelligence|wisdom|charisma)|using (strength|dexterity|constitution|intelligence|wisdom|charisma|str|dex|con|int|wis|cha)\b/i.exec(text) ??
    (short ? [short[0], undefined, short[1]] : null);
  const heads = [...text.matchAll(HEADER)];
  const slots: Record<string, number> = {};
  const spells: MonsterSpell[] = [];
  heads.forEach((head, index) => {
    const start = (head.index ?? 0) + head[0].length;
    const end = index + 1 < heads.length ? (heads[index + 1].index ?? text.length) : text.length;
    const names = spellNames(listOf(text.slice(start, end)));
    const tag = head[1].toLowerCase();
    if (tag.startsWith("cantrips")) {
      spells.push(...names.map((spell) => ({ name: spell, level: 0 })));
    } else if (head[2]) {
      if (head[3]) {
        slots[head[2]] = Number(head[3]);
      }
      spells.push(...names.map((spell) => ({ name: spell, level: Number(head[2]) })));
    } else if (head[4]) {
      spells.push(...names.map((spell) => ({ name: spell, level: null, perDay: Number(head[4]) })));
    } else {
      spells.push(...names.map((spell) => ({ name: spell, level: null })));
    }
  });
  // The one-spell form: "The mephit can innately cast sleep, requiring no
  // material components", Tome of Beasts 2023's "(3/Day)The stryx casts the
  // comprehend languages spell", its uses in the entry's name or before it.
  const single = heads.length
    ? null
    : (/\bcan innately cast ([a-z' /-]+?)(?:,|\.| on itself| \(| requiring| at will| without)/i.exec(text) ?? /\bcasts the ([a-z' /-]+?) spell\b/i.exec(text));
  if (single && !/\bfollowing\b/i.test(single[1])) {
    const spell = spellName(single[1]);
    const uses = /(\d+)\s*\/\s*day/i.exec(name) ?? /^\s*\((\d+)\s*\/\s*day/i.exec(text);
    if (spell) {
      spells.push({ name: spell, level: null, ...(uses ? { perDay: Number(uses[1]) } : {}) });
    }
  }
  if (!spells.length && !dc) {
    return null;
  }
  const abilityWord = ability ? (ability[1] ?? ability[2]).toLowerCase() : "";
  const abilityId = ABILITY_WORDS[abilityWord] ?? (Object.values(ABILITY_WORDS).find((id) => id === abilityWord) as SaveAbility | undefined);
  return {
    ...(dc ? { dc: Number(dc[1]) } : {}),
    ...(attack ? { attack: Number(attack[1]) } : {}),
    ...(abilityId ? { ability: abilityId } : {}),
    ...(level ? { casterLevel: Number(level[1]) } : {}),
    slots,
    spells,
  };
}

// A block's spellcasting entries as one: a hag's Innate Spellcasting and her
// coven's Shared Spellcasting, a dragon's Spellcasting beside its innate
// spells. The first entry's DC, bonus and ability stand, the slots are the
// largest each level gives, and a spell listed twice keeps its first listing.
export function mergeSpellcasting(parts: MonsterSpellcasting[]): MonsterSpellcasting | null {
  if (!parts.length) {
    return null;
  }
  const [first, ...rest] = parts;
  const slots = { ...first.slots };
  const spells = [...first.spells];
  for (const part of rest) {
    for (const [slot, count] of Object.entries(part.slots)) {
      slots[slot] = Math.max(slots[slot] ?? 0, count);
    }
    for (const spell of part.spells) {
      if (!spells.some((known) => textKey(known.name) === textKey(spell.name))) {
        spells.push(spell);
      }
    }
  }
  const pick = <K extends "dc" | "attack" | "ability" | "casterLevel">(key: K) => parts.find((part) => part[key] !== undefined)?.[key];
  const dc = pick("dc");
  const attack = pick("attack");
  const ability = pick("ability");
  const casterLevel = pick("casterLevel");
  return {
    ...(dc !== undefined ? { dc } : {}),
    ...(attack !== undefined ? { attack } : {}),
    ...(ability !== undefined ? { ability } : {}),
    ...(casterLevel !== undefined ? { casterLevel } : {}),
    slots,
    spells,
  };
}

export function findMonsterSpell(casting: MonsterSpellcasting | undefined, wanted: string): MonsterSpell | null {
  const key = textKey(wanted);
  return casting?.spells.find((spell) => textKey(spell.name) === key) ?? null;
}

// A5e prints each spell a caster knows as an action of its own, its level in
// the name: "Hold Monster (5th-Level; V, S, Concentration)", "Fire Bolt
// (Cantrip; V, S)". The spell, with its level, or null for any other name.
export function spellOfAction(name: string): MonsterSpell | null {
  const tag = /^(.+?)\s*\((cantrip|(\d)(?:st|nd|rd|th)-level)\b[^)]*\)?\s*$/i.exec(name.trim());
  if (!tag) {
    return null;
  }
  const spell = spellName(tag[1]);
  return spell ? { name: spell, level: tag[3] ? Number(tag[3]) : 0 } : null;
}
