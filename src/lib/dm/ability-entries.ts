import { parseAbilityText, spellOfAction, type MonsterAbility } from "@/lib/dm/monster-abilities";
import { parseSaveEffect, SAVE_DC } from "@/lib/dm/save-effect";

// A section of a printed block (its actions, traits or legendary actions) as
// the abilities the engine runs, for statblock.ts. Most entries are one
// ability each; these are not:
// - an entry that prints several options ("The dragon uses one of the
//   following breath weapons" with each breath under it, a roar's three
//   roars, a d6 table): one ability per option, all sharing the entry's
//   limit, so using either breath spends the one recharge (`group`);
// - an entry that only announces its options, A5e's "Breath Weapons
//   (Recharge 5-6)", whose breaths follow as entries of their own: the
//   breaths take its limit, and the announcement itself is not an ability;
// - an entry whose one use forces a second save of another kind ("must also
//   succeed on a DC 18 Wisdom saving throw or be frightened"): the second
//   save is an ability of its own, run on the turn the first was (`partOf`);
// - A5e's spells printed as actions ("Hold Monster (5th-Level; V, S,
//   Concentration)"), which are the creature's spells (statblock.ts adds them
//   to its spellcasting), not abilities.

type RawEntry = { name?: unknown; desc?: unknown };

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

// Words that say an entry's options follow.
const OFFERS = /\b(?:one of the following|the following (?:effects|options|breath weapons)|roll a d\d+|choos(?:es|ing) (?:one|from) (?:the following|effect)|determined by (?:a )?d\d+)/i;

// The headings an entry's options are printed under, the most marked first:
// SRD 5.1's "**Cold Breath.**", a list's "* Fire Breath.", a line's
// "Radiant Breath.", a table's "1. Pleasant Mist.", and Tome of Beasts 3's
// run-together "following:Sand Blast. ... dehydrates.Blinding Sand.".
const HEADINGS = [
  /\*\*([^*\n]{2,40}?)\.?\*\*\.?\s*/g,
  /(?:^|\n)[ \t]*(?:[-*•][ \t]+)([A-Z][\w'’ -]{1,38}?)\.\s+/g,
  /(?:^|\n)[ \t]*([A-Z][\w'’ -]{1,38}?)\.\s+/g,
  /(?:^|\s)\d\.\s+([A-Z][\w'’ -]{1,38}?)\.\s+/g,
  /(?<=[:.)])\s*([A-Z][\w'’-]*(?: [A-Z][\w'’-]*){0,4})\.\s+(?=[A-Z])/g,
];

export type EntryOption = { name: string; desc: string };

// The options an entry prints after saying it has some; empty for an entry
// that prints one effect.
export function entryOptions(desc: string): EntryOption[] {
  const text = desc.replace(/\r/g, "");
  const offered = OFFERS.exec(text);
  if (!offered) {
    return [];
  }
  const start = offered.index + offered[0].length;
  const rest = text.slice(start);
  for (const pattern of HEADINGS) {
    const marks = [...rest.matchAll(pattern)];
    if (marks.length < 2) {
      continue;
    }
    return marks.map((mark, index) => ({
      name: mark[1].replace(/[*_]/g, "").trim(),
      desc: rest.slice((mark.index ?? 0) + mark[0].length, index + 1 < marks.length ? marks[index + 1].index : rest.length).trim(),
    }));
  }
  return [];
}

// "The dragon uses one of the following breath weapons:" and nothing more.
function announcesOptions(desc: string): boolean {
  const offered = OFFERS.exec(desc);
  return Boolean(offered) && /^[^.:]*[:.]?\s*$/.test(desc.slice((offered?.index ?? 0) + (offered?.[0].length ?? 0)));
}

// An entry after an announcement that is one of its breaths: named for one
// ("Molten Breath"), or exhaling one ("Ocean Surge: The dragon exhales a
// torrent of seawater").
function isBreath(entry: RawEntry): boolean {
  return /\bbreath\b/i.test(asString(entry.name)) || /\b(?:exhales?|breathes?)\b/i.test(asString(entry.desc).slice(0, 120));
}

// The limit an entry's tags print, to be shared by its options.
function sharedLimit(rawName: string): Pick<MonsterAbility, "recharge" | "perDay" | "perRest" | "rechargeSpecial" | "oncePer" | "group"> | null {
  const header = parseAbilityText(rawName, "");
  if (!header || !(header.recharge || header.perDay || header.perRest || header.rechargeSpecial || header.oncePer)) {
    return null;
  }
  return {
    ...(header.recharge ? { recharge: header.recharge } : {}),
    ...(header.perDay ? { perDay: header.perDay } : {}),
    ...(header.perRest ? { perRest: true } : {}),
    ...(header.rechargeSpecial ? { rechargeSpecial: true } : {}),
    ...(header.oncePer ? { oncePer: header.oncePer } : {}),
    group: header.name,
  };
}

// An option as an ability, with the limit it shares: only one that runs (a
// save or dice), since an option the engine cannot run is the DM's to narrate.
function optionAbility(option: EntryOption, limit: ReturnType<typeof sharedLimit>, legendary: boolean): MonsterAbility | null {
  const ability = parseAbilityText(option.name, option.desc, { legendary });
  if (!ability || !(ability.save || ability.damage)) {
    return null;
  }
  return limit ? { ...ability, ...limit } : ability;
}

const ABILITY_NAMES: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// The second save one use forces, as an ability of its own: "Each creature in
// that area must also succeed on a DC 18 Wisdom saving throw or be
// frightened". Only a save of another ability or DC that lays something the
// engine runs; a repeat of the first save is not one.
function secondSave(ability: MonsterAbility, desc: string): MonsterAbility | null {
  const text = desc.replace(/[_*]/g, "");
  const first = SAVE_DC.exec(text);
  if (!first || !ability.save) {
    return null;
  }
  const after = text.slice(first.index + first[0].length);
  const second = SAVE_DC.exec(after);
  if (!second) {
    return null;
  }
  const sentenceStart = Math.max(after.lastIndexOf(".", second.index), after.lastIndexOf(";", second.index)) + 1;
  const sentence = after.slice(sentenceStart);
  if (/\b(?:repeats?|re-?rolls?) (?:the|its|this) sav|\bat the end of (?:each of )?its turns?\b|\bescape\b/i.test(sentence.slice(0, sentence.search(/[.;]/) + 1 || undefined))) {
    return null;
  }
  const effect = parseSaveEffect(sentence);
  if (!effect.save || (!effect.condition && !effect.damage) || (effect.save === ability.save && effect.dc === ability.dc)) {
    return null;
  }
  const label = effect.save === ability.save ? "second save" : `${ABILITY_NAMES[effect.save]} save`;
  return { ...effect, name: `${ability.name} (${label})`, partOf: ability.name };
}

// The abilities of a section's entries. `legendary`: the section is the
// legendary actions, whose bare "(2)" is a cost.
export function abilitiesOfEntries(entries: RawEntry[], options: { legendary?: boolean } = {}): MonsterAbility[] {
  const legendary = Boolean(options.legendary);
  const out: MonsterAbility[] = [];
  const taken = new Set<number>();
  entries.forEach((entry, index) => {
    if (taken.has(index)) {
      return;
    }
    const name = asString(entry.name);
    const desc = asString(entry.desc);
    if (spellOfAction(name)) {
      return;
    }
    if (announcesOptions(desc) && /\bbreath/i.test(name)) {
      const limit = sharedLimit(name);
      const breaths: EntryOption[] = [];
      for (let next = index + 1; next < entries.length; next += 1) {
        const following = { name: asString(entries[next].name), desc: asString(entries[next].desc) };
        // A breath's text split into an entry named by its next sentence
        // (Tome of Beasts' young void dragon: "Falling damage in the area
        // increases to 1d10 per 10 feet fallen") goes on with the breath.
        if (breaths.length && following.name.split(/\s+/).length > 6) {
          const last = breaths[breaths.length - 1];
          last.desc = `${last.desc} ${following.name}. ${following.desc}`;
        } else if (isBreath(entries[next])) {
          breaths.push(following);
        } else {
          break;
        }
        taken.add(next);
      }
      out.push(...breaths.map((breath) => optionAbility(breath, limit, legendary)).filter((ability): ability is MonsterAbility => ability !== null));
      return;
    }
    const choices = entryOptions(desc);
    if (choices.length >= 2) {
      const limit = sharedLimit(name);
      const read = choices.map((choice) => optionAbility(choice, limit, legendary)).filter((ability): ability is MonsterAbility => ability !== null);
      if (read.length) {
        out.push(...read);
        return;
      }
    }
    const ability = parseAbilityText(name, desc, { legendary });
    if (!ability) {
      return;
    }
    out.push(ability);
    const also = secondSave(ability, desc);
    if (also) {
      out.push(also);
    }
  });
  return out;
}

// ---- legendary actions ----

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };

// How many legendary actions a line says the creature takes: "can take 3
// legendary actions", "can take 1 legendary action", A5e's "The ankheg queen
// has 1 legendary action". Null for a line that does not say.
export function legendaryCountIn(line: string): number | null {
  const count = /(?:\bcan take|has) (\d+|a|an|one|two|three|four|five) legendary actions?\b(?! per)/i.exec(line);
  if (!count) {
    return null;
  }
  const word = count[1].toLowerCase();
  return Math.max(1, Math.min(9, COUNT_WORDS[word] ?? Number(word)));
}

// The number of legendary actions a pack row gives: its description's ("can
// take 1 legendary action"), else the option A5e prints the count as. Tome of
// Beasts' zmey takes "1 legendary action per head", so its count is the heads
// a trait gives it ("The zmey normally has three heads"). Null when the row
// says nothing, which is the usual three.
export function legendaryCountOf(desc: string, entries: RawEntry[], traits: RawEntry[]): number | null {
  const perHead = /\b(\d+|a|an|one) legendary actions? per head\b/i.exec(desc);
  if (perHead) {
    const each = COUNT_WORDS[perHead[1].toLowerCase()] ?? Number(perHead[1]);
    const heads = traits.map((entry) => /\bhas (\d+|two|three|four|five) heads\b/i.exec(asString(entry.desc))).find((match) => match !== null);
    const count = heads ? (COUNT_WORDS[heads[1].toLowerCase()] ?? Number(heads[1])) : null;
    return count ? Math.min(9, each * count) : null;
  }
  return legendaryCountIn(desc) ?? entries.map((entry) => legendaryCountIn(asString(entry.name))).find((count) => count !== null) ?? null;
}
