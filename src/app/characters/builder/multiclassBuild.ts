// A character built with levels in more than one class (backlog F9): the
// classes taken after the first, how the levels split between them, which
// classes may still be added and why the others may not, and where each
// Ability Score Improvement falls. The first class keeps the builder's own
// class and subclass fields; the classes after it live in a list beside
// them, and the first class's level is whatever the others leave of the
// character's level.
//
// The rules are the ones level-up in play already uses
// (src/lib/srd/multiclass.ts), and the server holds the sheet to the same
// (src/lib/srd/sheet-legality.ts classListOf): no class twice, at most
// three, levels that add up to the character's, and each class's
// prerequisite on the final scores. The levels are read as taken in order,
// the first class's first (the plan's accepted default), which is where the
// level table puts each one.
//
// Pure, so scripts/test-builder-multiclass.mjs drives it without React.
import type { ClassMechanics } from "@/lib/content/mechanics";
import type { AbilityScores, ClassEntry } from "@/lib/schemas/sheet";
import { asiLevelsFor } from "@/lib/srd/asi";
import { subclassCastingProfileFor, subclassLevelFor, subclassSpellsFor } from "@/lib/srd/features";
import { spellbookAllowance, spellStyleFor, type SpellStyle } from "@/lib/srd/spell-prep";
import { MULTICLASS_CAP, canMulticlassInto, describeGrant, describePrereq, meetsPrereq, multiclassGrantsFor } from "@/lib/srd/multiclass";
import { thirdCasterProfileOf } from "@/lib/srd/third-caster";
import { findClass } from "@/lib/srd";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { builderCasting, builderSpellAdvice } from "./casting";
import { textKey } from "@/lib/language/text-logic";
import { classLevelWords } from "@/lib/characters/class-words";

// One class taken after the first: its id, its subclass once its level
// reaches the pick, its levels, and the skill (or skills) its multiclass
// grant lets the player choose (a rogue's one from the rogue list).
export type ExtraClass = { classId: string; subclass: string; level: number; skills: string[] };

// The class row the builder offers, as much of it as these rules read.
export type ClassRow = {
  id: string;
  name: string;
  casterType?: ClassMechanics["casterType"];
  spellAbility?: string | null;
};

const sumLevels = (entries: ReadonlyArray<{ level: number }>) => entries.reduce((sum, entry) => sum + entry.level, 0);

// The first class's levels: the character's level less the others', never
// below one.
export function primaryLevelOf(total: number, extras: ReadonlyArray<{ level: number }> = []): number {
  return Math.max(1, Math.floor(total) - sumLevels(extras));
}

// The list kept valid against the first class and the character's level: no
// class twice and none that is the first class, at most the cap, every
// class at least one level, and the first class left at least one. Levels
// past what the character has come off the last class taken first (it is
// dropped once it has none), the way a campaign entered below the
// character's level sheds them (src/lib/characters/adapt.ts). A subclass the
// class's level no longer reaches comes off, as the server drops it.
export function fitExtraClasses(
  extras: ReadonlyArray<Partial<ExtraClass>> | undefined,
  { primaryId, total }: { primaryId: string; total: number },
): ExtraClass[] {
  if (!primaryId || total < 2) {
    return [];
  }
  const seen = new Set([textKey(primaryId)]);
  const out: ExtraClass[] = [];
  for (const entry of extras ?? []) {
    const classId = (entry?.classId ?? "").trim();
    if (!classId || seen.has(textKey(classId)) || out.length >= MULTICLASS_CAP - 1) {
      continue;
    }
    seen.add(textKey(classId));
    out.push({
      classId,
      subclass: entry.subclass ?? "",
      level: Math.max(1, Math.floor(Number(entry.level) || 1)),
      skills: [...(entry.skills ?? [])],
    });
  }
  let over = sumLevels(out) - (Math.floor(total) - 1);
  while (over > 0 && out.length) {
    const last = out[out.length - 1];
    if (last.level <= over) {
      over -= last.level;
      out.pop();
    } else {
      last.level -= over;
      over = 0;
    }
  }
  return out.map((entry) => {
    const pickLevel = subclassLevelFor(entry.classId);
    return pickLevel !== null && entry.level < pickLevel ? { ...entry, subclass: "" } : entry;
  });
}

// Levels taken off a class list, the last class taken first (a class left
// with none goes), the way a campaign entered below the character's level
// sheds them (src/lib/characters/adapt.ts). What the list cannot give comes
// off the first class, which keeps what the level leaves it.
export function shedExtraLevels(extras: ReadonlyArray<ExtraClass>, levels: number): ExtraClass[] {
  const out = extras.map((entry) => ({ ...entry, skills: [...entry.skills] }));
  let left = Math.max(0, Math.floor(levels));
  while (left > 0 && out.length) {
    const last = out[out.length - 1];
    if (last.level <= left) {
      left -= last.level;
      out.pop();
    } else {
      last.level -= left;
      left = 0;
    }
  }
  return out;
}

// A stored character's classes after the first, as the builder opens them
// at `total` levels: a table below the character's level sheds the last
// class's levels first, as joining it does. Empty for a single class.
export function storedExtraClasses(
  initial: { classes?: ReadonlyArray<ClassEntry> } | undefined,
  total: number,
): ExtraClass[] {
  const stored = initial?.classes ?? [];
  if (stored.length < 2) {
    return [];
  }
  const extras = stored.slice(1).map((entry) => ({ classId: entry.id, subclass: entry.subclass ?? "", level: entry.level, skills: [] }));
  const storedTotal = stored.reduce((sum, entry) => sum + entry.level, 0);
  return fitExtraClasses(shedExtraLevels(extras, storedTotal - total), { primaryId: stored[0].id, total });
}

// The sheet's class list: the first class first, at the levels the others
// leave it. A single class is a list of one, as classListFor reads a sheet.
export function builderClassList(
  primary: { id: string; subclass: string },
  total: number,
  extras: ReadonlyArray<ExtraClass> = [],
): ClassEntry[] {
  return [
    { id: primary.id, subclass: primary.subclass, level: primaryLevelOf(total, extras) },
    ...extras.map((entry) => ({ id: entry.classId, subclass: entry.subclass, level: entry.level })),
  ];
}

// Whether a class casts, as the server counts casting classes
// (src/lib/srd/legality/spells.ts castingClassesOf): one with a casting
// ability, warlock pact magic included, or an Eldritch Knight or Arcane
// Trickster once it casts at 3rd level. A paladin of 1st level casts nothing
// yet and is still a casting class.
export function classCasts(row: ClassRow | undefined, subclass = "", level = 1): boolean {
  if (!row) {
    return false;
  }
  if (row.casterType && row.casterType !== "none" && row.spellAbility) {
    return true;
  }
  const profile = thirdCasterProfileOf(row.id, subclass, subclassCastingProfileFor(row.id, subclass));
  return profile !== null && level >= 3;
}

export type CasterEntry = { row: ClassRow | undefined; subclass: string; level: number };

// The place in the class list of the class whose spells the builder's own
// spell fields hold (the lead caster): the first class that has something
// to cast at its level, else the first casting class, or -1. A paladin of
// 1st level beside a wizard casts nothing yet, so the wizard leads.
export function castingIndexOf(entries: ReadonlyArray<CasterEntry>): number {
  const casting = entries.flatMap((entry, index) => (classCasts(entry.row, entry.subclass, entry.level) ? [index] : []));
  return casting.find((index) => builderCasting(entries[index].row, entries[index].subclass, entries[index].level).casts) ?? casting[0] ?? -1;
}

// Which class leads the spell lists and which other classes cast, by id
// (backlog F9, phase 2). One class leads whether it casts or not, as the
// single-class builder always has.
export function castersOf(entries: ReadonlyArray<CasterEntry>): { lead: string | null; others: string[] } {
  if (entries.length < 2) {
    return { lead: entries[0]?.row?.id ?? null, others: [] };
  }
  const at = castingIndexOf(entries);
  const lead = at >= 0 ? (entries[at].row?.id ?? null) : null;
  const others = entries.flatMap((entry, index) =>
    index !== at && entry.row && classCasts(entry.row, entry.subclass, entry.level) ? [entry.row.id] : [],
  );
  return { lead, others };
}

// One casting class's own lists, the shape the builder's spell fields keep:
// for a wizard `spells` is the book and `bookPrepared` what is prepared.
export type SpellLists = { spells: string[]; bookPrepared: string[]; cantrips: string[] };

export const NO_SPELL_LISTS: SpellLists = { spells: [], bookPrepared: [], cantrips: [] };

// The lists keyed again when the class that leads changes: each class keeps
// its own, whichever field holds them, and a class that no longer casts
// takes its lists with it.
export function rekeySpellLists(
  lead: SpellLists,
  others: Readonly<Record<string, SpellLists>>,
  before: string | null,
  after: { lead: string | null; others: string[] },
): { lead: SpellLists; others: Record<string, SpellLists> } {
  const byClass: Record<string, SpellLists> = { ...others };
  if (before) {
    byClass[before] = lead;
  }
  const nextLead = before === after.lead ? lead : after.lead ? (byClass[after.lead] ?? NO_SPELL_LISTS) : NO_SPELL_LISTS;
  return {
    lead: nextLead,
    others: Object.fromEntries(after.others.map((id) => [id, byClass[id] ?? NO_SPELL_LISTS])),
  };
}

// How a class holds its spells (useBuilderDerived reads the same): known,
// prepared from the class list, or a wizard's book and what is prepared
// from it. A content-pack class says whether it is a known caster.
export function spellStyleOfRow(
  row: ClassRow & { knownCaster?: boolean },
  casting: { casts: boolean; third: boolean },
): SpellStyle | null {
  if (!casting.casts) {
    return null;
  }
  if (casting.third || row.knownCaster === true) {
    return "known";
  }
  return row.knownCaster === false && spellStyleFor(row.id) === "known" ? "prepared" : spellStyleFor(row.id);
}

export type CountDrop = { kind: "cantrip" | "spell" | "prepared"; value: string };

// A casting class's lists trimmed to its counts at its level, after a level
// moves (backlog F9): cantrips to its cantrip count, a known or prepared
// list to its count, a wizard's book to its allowance and what is prepared
// to its count from what the book still holds. The picks made last go
// first: the lists keep the order the picks were made in. What its
// subclass grants, and the race's and the feats' cantrips (`free`), count
// for nothing. A prepared count waits on the scores (`abilities` null): a
// list is never trimmed by a count the builder cannot yet work out.
export function trimSpellCounts(
  lists: SpellLists,
  entry: CasterEntry & { row: (ClassRow & { knownCaster?: boolean }) | undefined },
  abilities: AbilityScores | null,
  free: { cantrips: string[] } = { cantrips: [] },
): { lists: SpellLists; drops: CountDrop[] } {
  const row = entry.row;
  const drops: CountDrop[] = [];
  if (!row) {
    return { lists, drops };
  }
  const casting = builderCasting(row, entry.subclass, entry.level);
  if (!casting.casts) {
    return { lists, drops };
  }
  // Keep the first `count` of the counted names, and every free one.
  const keepFirst = (names: string[], count: number, isFree: (name: string) => boolean, kind: CountDrop["kind"]) => {
    let left = Math.max(0, count);
    return names.filter((name) => {
      if (isFree(name)) {
        return true;
      }
      if (left > 0) {
        left -= 1;
        return true;
      }
      drops.push({ kind, value: name });
      return false;
    });
  };
  const freeCantrips = new Set(free.cantrips.map(textKey));
  const cantrips =
    casting.cantripCap === null ? lists.cantrips : keepFirst(lists.cantrips, casting.cantripCap, (name) => freeCantrips.has(textKey(name)), "cantrip");
  const granted = new Set(subclassSpellsFor(row.id, entry.subclass, entry.level).map(textKey));
  const isGranted = (name: string) => granted.has(textKey(name));
  const style = spellStyleOfRow(row, casting);
  // A known caster's count is its table's; a prepared one's needs the score.
  const advice =
    style === "known" || abilities
      ? builderSpellAdvice(casting, row, entry.subclass, entry.level, abilities ?? { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 })
      : null;
  let spells = lists.spells;
  let bookPrepared = lists.bookPrepared;
  if (style === "spellbook") {
    spells = keepFirst(lists.spells, spellbookAllowance(entry.level), isGranted, "spell");
    const book = new Set(spells.map(textKey));
    const inBook = lists.bookPrepared.filter((name) => book.has(textKey(name)));
    bookPrepared = advice ? keepFirst(inBook, advice.count, () => false, "prepared") : inBook;
  } else if (advice) {
    spells = keepFirst(lists.spells, advice.count, isGranted, "spell");
  }
  return { lists: { spells, bookPrepared, cantrips }, drops };
}

// A casting class's own lists held to what it casts at its level, as
// reconcile.ts holds the lead's: no cantrips where it has none, no spell
// above the level its slots reach, nothing prepared that is not in the book.
export function fitSpellLists(lists: SpellLists, entry: CasterEntry): { lists: SpellLists; dropped: string[] } {
  const { casts, cantripCap, maxSpellLevel } = builderCasting(entry.row, entry.subclass, entry.level);
  const unique = (names: string[]) => [...new Map(names.filter(Boolean).map((name) => [textKey(name), name])).values()];
  const cantrips = casts && cantripCap !== null ? unique(lists.cantrips) : [];
  const spells = casts
    ? unique(lists.spells).filter((name) => {
        const level = spellLevelOf(name);
        return level === null || (level > 0 && level <= maxSpellLevel);
      })
    : [];
  const book = new Set(spells.map(textKey));
  const bookPrepared = unique(lists.bookPrepared).filter((name) => book.has(textKey(name)));
  const kept = new Set([...cantrips, ...spells].map(textKey));
  const dropped = unique([...lists.cantrips, ...lists.spells]).filter((name) => !kept.has(textKey(name)));
  return { lists: { spells, bookPrepared, cantrips }, dropped };
}

// Every Ability Score Improvement the class list has earned, by the
// character level it falls at: each class's own improvement levels (a
// fighter's seven, a rogue's six), the first class's levels first. The
// count is the server's (src/lib/srd/asi.ts earnedAsiCountFor).
export function builderAsiSlotLevels(classList: ReadonlyArray<{ id: string; level: number }>): number[] {
  const slots: number[] = [];
  let before = 0;
  for (const entry of classList) {
    for (const threshold of asiLevelsFor(entry.id)) {
      if (threshold <= entry.level) {
        slots.push(before + threshold);
      }
    }
    before += entry.level;
  }
  return slots;
}

// Which class a character level went to, and that class's own level there:
// the first class's levels first, then the second's, then the third's.
export function classAtLevel<T extends { id: string; level: number }>(
  classList: ReadonlyArray<T>,
  characterLevel: number,
): { index: number; entry: T; classLevel: number } | null {
  let before = 0;
  for (let index = 0; index < classList.length; index += 1) {
    const entry = classList[index];
    if (characterLevel <= before + entry.level) {
      return { index, entry, classLevel: characterLevel - before };
    }
    before += entry.level;
  }
  return null;
}

// "Fighter 3 / Wizard 2", for the summary and the header: the words every
// card and row uses for a split (src/lib/characters/class-words.ts).
export function classSplitWords(classList: ReadonlyArray<{ id: string; level: number }>, nameOf: (id: string) => string): string {
  const [first] = classList;
  return first ? classLevelWords({ class: first.id, level: first.level, classes: classList }, nameOf) : "";
}

export type MulticlassChoice = {
  row: ClassRow;
  ok: boolean;
  // Why it may not be added, in plain words; null when it may.
  reason: string | null;
  // Its prerequisite ("Intelligence 13") and what it adds as a second class.
  needs: string;
  grants: string;
};

// The classes that could be added, the ones that may first, each with the
// reason it may not where it may not (the level-up dialog's list,
// LevelUpDialog.tsx). Before the scores are set the prerequisites cannot be
// judged: every class is offered with what it needs, and the Abilities
// step holds the build until the scores meet it. `rows` are the classes the
// class grid offers this table, in its order.
export function multiclassChoices(input: {
  rows: ReadonlyArray<ClassRow>;
  classList: ReadonlyArray<ClassEntry>;
  abilities: AbilityScores | null;
  rowOf: (id: string) => ClassRow | undefined;
}): MulticlassChoice[] {
  const held = new Set(input.classList.map((entry) => textKey(entry.id)));
  const [first] = input.classList;
  const choices = input.rows
    .filter((row) => !held.has(textKey(row.id)))
    .map((row): MulticlassChoice => {
      const needs = describePrereq(row.id);
      const grants = describeGrant(multiclassGrantsFor(row.id));
      let reason: string | null = null;
      if (input.classList.length >= MULTICLASS_CAP) {
        reason = `A character holds at most ${MULTICLASS_CAP} classes here.`;
      } else if (input.abilities) {
        const check = canMulticlassInto({ class: first?.id ?? "", classes: [...input.classList], abilities: input.abilities }, row.id);
        if (!check.ok) {
          reason = refusalWords(row, input.classList, input.abilities, input.rowOf) ?? check.error ?? "Not available.";
        }
      }
      return { row, ok: reason === null, reason, needs, grants };
    });
  return [...choices.filter((choice) => choice.ok), ...choices.filter((choice) => !choice.ok)];
}

// Why canMulticlassInto refused, in the builder's words: a class the rules
// have no row for, a score the new class needs, or one a class already held
// needs (the rules check both directions). Null for any other refusal,
// which is then said in the rules' own words.
function refusalWords(
  row: ClassRow,
  classList: ReadonlyArray<ClassEntry>,
  abilities: AbilityScores,
  rowOf: (id: string) => ClassRow | undefined,
): string | null {
  if (!findClass(row.id)) {
    return `${row.name} can only be a first class here: the multiclass rules have no entry for it.`;
  }
  if (!meetsPrereq(abilities, row.id)) {
    return `Needs ${describePrereq(row.id)}; your scores fall short.`;
  }
  const short = classList.find((entry) => !meetsPrereq(abilities, entry.id));
  if (short) {
    return `Taking a second class means your ${rowOf(short.id)?.name ?? short.id} needs ${describePrereq(short.id)} too, and your scores fall short.`;
  }
  return null;
}

// Each class's prerequisite the final scores miss, in words for the
// Abilities step's gate: decision 1 of the plan reads the final scores, as
// the server does.
export function unmetPrereqs(
  classList: ReadonlyArray<ClassEntry>,
  abilities: AbilityScores | null,
  nameOf: (id: string) => string,
): string[] {
  if (!abilities || classList.length < 2) {
    return [];
  }
  return classList.flatMap((entry) =>
    meetsPrereq(abilities, entry.id) ? [] : [`${nameOf(entry.id)} beside another class needs ${describePrereq(entry.id)}.`],
  );
}

// A stored character's skill picks split between its classes: the first
// class's own picks first, from its list and up to its count, then each
// class after it, as many as its multiclass grant offers. What is left is
// read as the first class's, as before (reconcile.ts then says what no
// longer fits).
export function splitStoredSkills(
  skills: string[],
  primary: { skillChoices: { count: number; from: string[] } } | undefined,
  extras: ReadonlyArray<{ classId: string }>,
): { chosen: string[]; extraSkills: string[][] } {
  const left = [...skills];
  const take = (count: number, from: string[]) => {
    const pool = from.length ? new Set(from.map(textKey)) : null;
    const taken: string[] = [];
    for (let index = 0; index < left.length && taken.length < count; ) {
      if (!pool || pool.has(textKey(left[index]))) {
        taken.push(left[index]);
        left.splice(index, 1);
      } else {
        index += 1;
      }
    }
    return taken;
  };
  const chosen = primary ? take(primary.skillChoices.count, primary.skillChoices.from) : [];
  const extraSkills = extras.map((entry) => {
    const grant = multiclassGrantsFor(entry.classId).skillChoice;
    return grant ? take(grant.count, grant.from) : [];
  });
  // What is left is added as a statement of its own: the production build
  // folded a `[...chosen, ...left]` in the return into one object literal
  // that read `left` before the classes after the first took from it.
  chosen.push(...left);
  return { chosen, extraSkills };
}
