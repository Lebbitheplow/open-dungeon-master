// The level progression table (backlog F8): one row per level from 1 to the
// character's level, saying what each level grants (proficiency bonus,
// class and subclass features, the subclass pick, an Ability Score
// Improvement or feat, spell slots and the spells known or prepared), with
// the pick the character made there, inline, where the builder records one.
//
// Read from the engine's own tables, the ones the server holds a sheet to:
// classFeaturesFor for the features, asiLevelsFor (through the builder's
// slot levels) for the improvements, spellSlotsFor for the slots and the
// level-up dialog's casterPreview for the counts. Pure, no JSX, so
// scripts/test-builder-level-table.mjs drives it.
import { casterPreview } from "@/app/campaigns/[campaignId]/level-up-preview";
import type { AbilityScores, AsiChoice } from "@/lib/schemas/sheet";
import { proficiencyBonus, spellSlotsFor } from "@/lib/srd";
import { pactSlotsFor, slotTableFor } from "@/lib/srd/multiclass";
import { classAtLevel } from "./multiclassBuild";
import { applyChoices } from "@/lib/srd/level-up";
import { fightingStyleSlots } from "@/lib/srd/feature-effects";
import { classFeaturesFor, subclassLevelFor } from "@/lib/srd/features";
import { ABILITY_NAMES } from "@/lib/srd/legality/types";
import { spellbookAllowance, spellStyleFor } from "@/lib/srd/spell-prep";
import type { ThirdCasterSetting } from "@/lib/srd/third-caster";

export type ProgressionInput = {
  classId: string;
  // The subclass held or picked, "" while there is none.
  subclass: string;
  progression?: ThirdCasterSetting;
  // The last row: the character's level (or the table's, in the builder).
  level: number;
  // The scores before any improvement, so a prepared caster's count at each
  // level reads the casting score as it stood then. Null until all six are
  // set; the counts then read a 10.
  baseAbilities: AbilityScores | null;
  // The builder's improvement slots: the level of each, its pick, and
  // whether it was taken in play (already in the scores, no pick recorded).
  asiSlotLevels: readonly number[];
  asiChoices: ReadonlyArray<AsiChoice | null>;
  asiTakenInPlay?: readonly boolean[];
  // The fighting styles picked, by name ("Defense"), in the order their
  // slots come.
  styles?: readonly string[];
  // The rows marked: the level held now and the one being taken.
  current?: number;
  next?: number;
  // A character with levels in more than one class (backlog F9): each
  // class with its name, subclass and levels, the first class first. Its
  // levels are read as taken in that order, so each row says which class
  // the level went to. Absent, or one class, for a single class.
  classes?: ReadonlyArray<ProgressionClass>;
};

export type ProgressionClass = {
  classId: string;
  name: string;
  subclass: string;
  level: number;
  progression?: ThirdCasterSetting;
  // A warlock's pact magic, apart from the shared slots.
  pact?: boolean;
};

export type ProgressionSpells = {
  // "spells known", "prepared spells"...
  label: string;
  count: number;
  // A wizard's book at this level, when it is one.
  spellbook?: number;
};

export type ProgressionRow = {
  level: number;
  proficiency: number;
  // The features the level grants, a fighting style slot with its pick.
  features: string[];
  // The level the class chooses its subclass at, with the pick (null while
  // it is still to choose); null on every other level.
  subclass: { pick: string | null } | null;
  // An improvement this level grants, with the pick in words (null while
  // it is still to choose).
  improvement: { pick: string | null; takenInPlay: boolean } | null;
  slots: Array<{ level: number; count: number }>;
  // A warlock's pact slots on a class list, which sit apart (backlog F9).
  pact?: { level: number; count: number } | null;
  // Which class the level went to and that class's level there ("Wizard
  // 2"), on a class list only.
  classLabel?: string;
  // With more than one casting class so far, each one's own counts at its
  // own level (backlog F9, phase 2); `cantrips` and `spells` are then the
  // first's.
  casters?: Array<{ name: string; cantrips: number | null; spells: ProgressionSpells | null }>;
  cantrips: number | null;
  spells: ProgressionSpells | null;
  mark: "current" | "next" | null;
};

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

export function ordinal(level: number): string {
  return ORDINALS[level] ?? `${level}th`;
}

// An improvement as the player picked it: "+2 Strength", "+1 Strength, +1
// Constitution", "Feat: Alert".
export function improvementWords(choice: AsiChoice): string {
  if (choice.mode === "plus2") {
    return `+2 ${ABILITY_NAMES[choice.ability] ?? choice.ability}`;
  }
  if (choice.mode === "plus1x2") {
    const [first, second] = choice.abilities;
    return first === second
      ? `+2 ${ABILITY_NAMES[first] ?? first}`
      : `+1 ${ABILITY_NAMES[first] ?? first}, +1 ${ABILITY_NAMES[second] ?? second}`;
  }
  return `Feat: ${choice.feat}${choice.ability ? ` (+1 ${ABILITY_NAMES[choice.ability] ?? choice.ability})` : ""}`;
}

const TEN: AbilityScores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };

export function levelProgressionRows(input: ProgressionInput): ProgressionRow[] {
  if ((input.classes?.length ?? 0) > 1) {
    return classListRows(input, input.classes ?? []);
  }
  const last = Math.max(1, Math.min(20, Math.floor(input.level)));
  const pickLevel = subclassLevelFor(input.classId);
  const styles = [...(input.styles ?? [])];
  const wizard = spellStyleFor(input.classId) === "spellbook";
  const rows: ProgressionRow[] = [];
  for (let level = 1; level <= last; level += 1) {
    // The features first granted at this level. A fighting style slot shows
    // the style chosen for it, in the order the slots come.
    const features = classFeaturesFor(input.classId, input.subclass, level)
      .filter((feature) => feature.level === level)
      .map((feature) => {
        if (fightingStyleSlots([feature]) === 0) {
          return feature.name;
        }
        const style = styles.shift();
        return style ? `${feature.name} (${style})` : feature.name;
      });
    const slotIndex = input.asiSlotLevels.indexOf(level);
    const choice = slotIndex >= 0 ? (input.asiChoices[slotIndex] ?? null) : null;
    const takenInPlay = slotIndex >= 0 ? Boolean(input.asiTakenInPlay?.[slotIndex]) : false;
    // The casting score as it stood at this level: the improvements up to
    // here, a half-feat's point aside.
    const before = input.asiSlotLevels
      .map((slotLevel, index) => (slotLevel <= level ? input.asiChoices[index] : null))
      .filter((entry): entry is AsiChoice => entry !== null && entry !== undefined);
    const scores = applyChoices(input.baseAbilities ?? TEN, before);
    const caster = casterPreview({
      classId: input.classId,
      subclass: input.subclass,
      progression: input.progression,
      level,
      abilitiesAfter: scores,
    });
    const slots = Object.entries(spellSlotsFor(input.classId, level, input.subclass, input.progression))
      .map(([slotLevel, count]) => ({ level: Number(slotLevel), count }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => a.level - b.level);
    // A level that holds no spells yet (a ranger's 1st) reads as none, not
    // as "0 spells known".
    const spells: ProgressionSpells | null =
      caster.casts && caster.spellCap && caster.spellCap.count > 0
        ? { ...caster.spellCap, ...(wizard ? { spellbook: spellbookAllowance(level) } : {}) }
        : null;
    rows.push({
      level,
      proficiency: proficiencyBonus(level),
      features,
      subclass: pickLevel === level ? { pick: input.subclass.trim() || null } : null,
      improvement:
        slotIndex >= 0 ? { pick: choice ? improvementWords(choice) : null, takenInPlay: takenInPlay && !choice } : null,
      slots,
      cantrips: caster.casts ? caster.cantripCap : null,
      spells,
      mark: level === input.next ? "next" : level === input.current ? "current" : null,
    });
  }
  return rows;
}

// The rows of a class list: each level goes to the class the order gives
// it (the first class's levels first), with that class's features and
// subclass pick at its own level, the improvement wherever the slot falls,
// and the casting of the levels taken so far: the shared slots as the
// server works them, a warlock's pact slots apart, and the casting class's
// counts at its own level.
function classListRows(input: ProgressionInput, classes: ReadonlyArray<ProgressionClass>): ProgressionRow[] {
  const last = Math.max(1, Math.min(20, Math.floor(input.level)));
  const styles = [...(input.styles ?? [])];
  const list = classes.map((entry) => ({ ...entry, id: entry.classId }));
  const rows: ProgressionRow[] = [];
  for (let level = 1; level <= last; level += 1) {
    const at = classAtLevel(list, level);
    if (!at) {
      break;
    }
    const { entry, classLevel } = at;
    const features = classFeaturesFor(entry.classId, entry.subclass, classLevel)
      .filter((feature) => feature.level === classLevel)
      .map((feature) => {
        if (fightingStyleSlots([feature]) === 0) {
          return feature.name;
        }
        const style = styles.shift();
        return style ? `${feature.name} (${style})` : feature.name;
      });
    const slotIndex = input.asiSlotLevels.indexOf(level);
    const choice = slotIndex >= 0 ? (input.asiChoices[slotIndex] ?? null) : null;
    const takenInPlay = slotIndex >= 0 ? Boolean(input.asiTakenInPlay?.[slotIndex]) : false;
    const before = input.asiSlotLevels
      .map((slotLevel, index) => (slotLevel <= level ? input.asiChoices[index] : null))
      .filter((pick): pick is AsiChoice => pick !== null && pick !== undefined);
    const scores = applyChoices(input.baseAbilities ?? TEN, before);
    // The classes as they stand at this level: every level so far.
    const soFar = list.flatMap((held, index) => {
      const taken = index < at.index ? held.level : index === at.index ? classLevel : 0;
      return taken > 0 ? [{ ...held, level: taken }] : [];
    });
    // The classes that cast among them, each at its own level so far, a
    // warlock's pact magic included.
    const castingAll = soFar
      .map((held) => ({
        held,
        preview: casterPreview({ classId: held.classId, subclass: held.subclass, progression: held.progression, level: held.level, abilitiesAfter: scores }),
      }))
      .filter((pair) => pair.preview.casts);
    const casting = castingAll[0] ?? null;
    const spellsOf = (pair: (typeof castingAll)[number]): ProgressionSpells | null => {
      const own = pair.preview.spellCap;
      return own && own.count > 0
        ? { ...own, ...(spellStyleFor(pair.held.classId) === "spellbook" ? { spellbook: spellbookAllowance(pair.held.level) } : {}) }
        : null;
    };
    const slots = Object.entries(
      slotTableFor(
        { class: soFar[0].classId, classes: soFar.map((held) => ({ id: held.classId, subclass: held.subclass, level: held.level })) },
        (held) => soFar.find((row) => row.classId === held.id)?.progression,
      ),
    )
      .map(([slotLevel, count]) => ({ level: Number(slotLevel), count }))
      .filter((slot) => slot.count > 0)
      .sort((a, b) => a.level - b.level);
    const warlock = soFar.find((held) => held.pact);
    const pactRow = warlock ? pactSlotsFor(warlock.level) : null;
    const wizard = casting ? spellStyleFor(casting.held.classId) === "spellbook" : false;
    const cap = casting?.preview.spellCap ?? null;
    const spells: ProgressionSpells | null =
      cap && cap.count > 0 ? { ...cap, ...(wizard && casting ? { spellbook: spellbookAllowance(casting.held.level) } : {}) } : null;
    rows.push({
      level,
      proficiency: proficiencyBonus(level),
      features,
      subclass: subclassLevelFor(entry.classId) === classLevel ? { pick: entry.subclass.trim() || null } : null,
      improvement:
        slotIndex >= 0 ? { pick: choice ? improvementWords(choice) : null, takenInPlay: takenInPlay && !choice } : null,
      slots,
      pact: pactRow ? { level: pactRow.level, count: pactRow.max } : null,
      classLabel: `${entry.name} ${classLevel}`,
      cantrips: casting ? casting.preview.cantripCap : null,
      spells,
      ...(castingAll.length > 1
        ? { casters: castingAll.map((pair) => ({ name: pair.held.name, cantrips: pair.preview.cantripCap, spells: spellsOf(pair) })) }
        : {}),
      mark: level === input.next ? "next" : level === input.current ? "current" : null,
    });
  }
  return rows;
}

// Which columns the table needs: a class with no subclass level has no
// Subclass column, and one that never casts by this level no spell columns.
export function progressionColumns(rows: readonly ProgressionRow[]): { subclass: boolean; casting: boolean; classes: boolean } {
  return {
    subclass: rows.some((row) => row.subclass !== null),
    casting: rows.some((row) => row.slots.length > 0 || Boolean(row.pact) || row.cantrips !== null || row.spells !== null),
    // A class list says which class each level went to.
    classes: rows.some((row) => Boolean(row.classLabel)),
  };
}

// A row's slots in words: "1st 4, 2nd 3", or a dash.
export function slotWords(slots: ProgressionRow["slots"]): string {
  return slots.length ? slots.map((slot) => `${ordinal(slot.level)} ${slot.count}`).join(", ") : "-";
}
