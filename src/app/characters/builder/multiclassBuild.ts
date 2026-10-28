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
import { subclassCastingProfileFor, subclassLevelFor } from "@/lib/srd/features";
import { MULTICLASS_CAP, canMulticlassInto, describeGrant, describePrereq, meetsPrereq, multiclassGrantsFor } from "@/lib/srd/multiclass";
import { thirdCasterProfileOf } from "@/lib/srd/third-caster";
import { findClass } from "@/lib/srd";
import { textKey } from "@/lib/language/text-logic";

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

// The place in the class list of the class whose spells the builder's one
// spell list holds: the first that casts, or -1. Phase 1 of F9 builds one
// casting class; a stored character with two keeps the second's lists as
// they were (submit.ts keptSpellcasting).
export function castingIndexOf(entries: ReadonlyArray<{ row: ClassRow | undefined; subclass: string; level: number }>): number {
  return entries.findIndex((entry) => classCasts(entry.row, entry.subclass, entry.level));
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

// "Fighter 3 / Wizard 2", for the summary and the header.
export function classSplitWords(classList: ReadonlyArray<{ id: string; level: number }>, nameOf: (id: string) => string): string {
  return classList.map((entry) => `${nameOf(entry.id)} ${entry.level}`).join(" / ");
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
// step holds the build until the scores meet it. Phase 1 holds one casting
// class: a second beside a class that already casts is offered as not yet
// available.
export function multiclassChoices(input: {
  rows: ReadonlyArray<ClassRow>;
  classList: ReadonlyArray<ClassEntry>;
  abilities: AbilityScores | null;
  rowOf: (id: string) => ClassRow | undefined;
}): MulticlassChoice[] {
  const held = new Set(input.classList.map((entry) => textKey(entry.id)));
  const caster = input.classList.find((entry) => classCasts(input.rowOf(entry.id), entry.subclass ?? "", entry.level));
  const casterName = caster ? (input.rowOf(caster.id)?.name ?? caster.id) : "";
  const [first] = input.classList;
  const choices = input.rows
    .filter((row) => !held.has(textKey(row.id)))
    .map((row): MulticlassChoice => {
      const needs = describePrereq(row.id);
      const grants = describeGrant(multiclassGrantsFor(row.id));
      let reason: string | null = null;
      if (input.classList.length >= MULTICLASS_CAP) {
        reason = `A character holds at most ${MULTICLASS_CAP} classes here.`;
      } else if (casterName && classCasts(row)) {
        reason = `Not available yet: the builder holds one spellcasting class for now, and your ${casterName} already casts.`;
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
  return { chosen: [...chosen, ...left], extraSkills };
}
