// Which parts of the library's level-up sheet (LevelUpSheet.tsx, backlog
// F7) a level shows: the subclass when the class chooses one by then, the
// improvement or feat on a level that grants one, the class picks a level
// adds (a fighting style, expertise, an open option slot), and the spells
// when the level changes what the caster holds. Each is read off the class
// tables by level as well as off what is still owed, so a section stays on
// screen while its pick is made. Pure, for scripts/test-library-level-up-sheet.mjs.
import { fightingStyleSlots } from "@/lib/srd/feature-effects";
import { classFeaturesFor, expertiseSlotsFor, subclassLevelFor } from "@/lib/srd/features";
import { openOptionSlots } from "@/lib/srd/options";
import type { ProgressionRow } from "./levelProgression";
import type { OwedPick } from "./owed";
import type { BlockerTarget } from "./submit";

// The picks the sheet asks for itself. Anything else still owed (a tool
// grant, a score, a race pick) is named with the way to the whole build.
export const SHEET_TARGETS: readonly BlockerTarget[] = ["subclass", "asi", "styles", "expertise", "options", "spells"];

export type LevelUpSections = {
  subclass: boolean;
  asi: boolean;
  classPicks: boolean;
  spells: boolean;
};

// Whether a level changes what a caster holds: one more cantrip, a bigger
// count of spells known or prepared, a fuller book or a new slot.
export function castingGrows(before: ProgressionRow | undefined, after: ProgressionRow | undefined): boolean {
  if (!after) {
    return false;
  }
  const slots = (row: ProgressionRow | undefined) =>
    (row?.slots ?? []).map((slot) => `${slot.level}:${slot.count}`).join(",");
  return (
    (after.cantrips ?? 0) > (before?.cantrips ?? 0) ||
    (after.spells?.count ?? 0) > (before?.spells?.count ?? 0) ||
    (after.spells?.spellbook ?? 0) > (before?.spells?.spellbook ?? 0) ||
    slots(after) !== slots(before)
  );
}

export function levelUpSections(input: {
  classId: string;
  // The subclass as the builder holds it now, and as the stored character
  // held it before the level.
  subclass: string;
  storedSubclass: string;
  heldLevel: number;
  nextLevel: number;
  asiSlotLevels: readonly number[];
  casts: boolean;
  heldRow: ProgressionRow | undefined;
  nextRow: ProgressionRow | undefined;
  owed: ReadonlySet<BlockerTarget>;
}): LevelUpSections {
  const { classId, heldLevel, nextLevel, owed } = input;
  const pickLevel = subclassLevelFor(classId);
  const styleGain =
    fightingStyleSlots(classFeaturesFor(classId, input.subclass, nextLevel)) >
    fightingStyleSlots(classFeaturesFor(classId, input.subclass, heldLevel));
  const expertiseGain = expertiseSlotsFor(classId, nextLevel) > expertiseSlotsFor(classId, heldLevel);
  // An open option slot the level adds (a warlock's invocation at 5, a
  // sorcerer's metamagic at 10), read off the tables too: by what is owed
  // alone, the section went away as soon as the pick was made.
  const optionTotal = (level: number) =>
    openOptionSlots({ classId, subclass: input.subclass, level, features: classFeaturesFor(classId, input.subclass, level) }).reduce(
      (sum, slot) => sum + slot.total,
      0,
    );
  const optionGain = optionTotal(nextLevel) > optionTotal(heldLevel);
  return {
    subclass: owed.has("subclass") || (pickLevel !== null && nextLevel >= pickLevel && !input.storedSubclass.trim()),
    asi: input.asiSlotLevels.includes(nextLevel) || owed.has("asi"),
    classPicks:
      styleGain || expertiseGain || optionGain || owed.has("styles") || owed.has("expertise") || owed.has("options"),
    spells: input.casts && (castingGrows(input.heldRow, input.nextRow) || owed.has("spells")),
  };
}

// The owed picks the sheet asks for, and the ones it sends to the whole
// build.
export function splitOwed(owed: readonly OwedPick[]): { here: OwedPick[]; elsewhere: OwedPick[] } {
  const mine = new Set<BlockerTarget>(SHEET_TARGETS);
  return {
    here: owed.filter((pick) => mine.has(pick.target)),
    elsewhere: owed.filter((pick) => !mine.has(pick.target)),
  };
}
