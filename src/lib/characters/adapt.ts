import { spellSlotsFor, suggestedStartingHp } from "@/lib/srd";
import { slotTableFor } from "@/lib/srd/multiclass";
import { earnedAsiCount, removeAsiChoices } from "@/lib/srd/asi";
import type { CreateSheetInput } from "@/lib/schemas/sheet";

// Taking a stored sheet into a campaign that runs at a different level.
//
// This was the body of instantiateIntoCampaign in src/lib/db/characters.ts,
// which is where it has always run and where it still runs. It moved here
// unchanged because a companion out of the library needs exactly the same
// work done to it, and the plan is explicit that duplicating this logic
// would be the worst trade available: it is the piece that knows a level 9
// character joining a level 3 table has to give back its ability score
// improvements, shed multiclass levels from the right end, resize its hit
// dice, and be handed the spell slots of the level it is actually playing.
//
// Pure by design: it takes a sheet and two numbers and returns a sheet, so
// scripts/test-character-adapt.mjs can drive every branch without a
// database, which nothing could do while it lived inside a DB call.
//
// It is deliberately lossy in one place, and always was: reversing an
// ability score improvement cannot restore a score that hit the 20 cap on
// the way up. Up-scaling grants no automatic extra improvements either; the
// player edits the sheet in play instead. Both of those are the old
// behaviour, written down rather than changed.

export function adaptSheetToLevel(
  input: CreateSheetInput,
  fromLevel: number,
  toLevel: number,
): CreateSheetInput {
  const sheet = structuredClone(input);
  const level = Math.max(1, Math.min(20, toLevel));

  // Strip ASI choices earned above the target level: reverse their ability
  // bonuses (slightly lossy for scores that hit the 20 cap) and drop their
  // feats. Level-up ASIs taken mid-campaign sync back as raw abilities with
  // no recorded choice, so those cannot be reversed here either.
  const storedChoices = sheet.asiChoices ?? [];
  const keptChoiceCount = earnedAsiCount(level);
  if (storedChoices.length > keptChoiceCount) {
    const dropped = storedChoices.slice(keptChoiceCount);
    sheet.abilities = removeAsiChoices(sheet.abilities, dropped);
    const droppedFeats = new Set(
      dropped.flatMap((choice) => (choice.mode === "feat" ? [choice.feat] : [])),
    );
    sheet.feats = (sheet.feats ?? []).filter((feat) => !droppedFeats.has(feat));
    sheet.asiChoices = storedChoices.slice(0, keptChoiceCount);
  }

  // A multiclassed character adapting to a lower level sheds levels from the
  // LAST class first (acquisition order = array order); classes stripped to
  // zero drop entirely, along with their hit-die pool and caster entry.
  // Up-scaling adds levels to the primary class.
  if ((sheet.classes ?? []).length > 1) {
    let excess = (sheet.classes ?? []).reduce((sum, entry) => sum + entry.level, 0) - level;
    const classes = (sheet.classes ?? []).map((entry) => ({ ...entry }));
    for (let index = classes.length - 1; index > 0 && excess > 0; index -= 1) {
      const take = Math.min(classes[index].level, excess);
      classes[index].level -= take;
      excess -= take;
    }
    if (excess !== 0) {
      classes[0].level = Math.max(1, Math.min(20, classes[0].level - excess));
    }
    sheet.classes = classes.filter((entry) => entry.level > 0);
    const keptIds = new Set(sheet.classes.map((entry) => entry.id.toLowerCase()));
    sheet.hitDicePools =
      sheet.hitDicePools
        ?.filter((pool) => keptIds.has(pool.classId.toLowerCase()))
        .map((pool) => ({
          ...pool,
          total:
            sheet.classes!.find((entry) => entry.id.toLowerCase() === pool.classId.toLowerCase())
              ?.level ?? pool.total,
          spent: 0,
        })) ?? null;
    if (sheet.classes.length < 2) {
      sheet.hitDicePools = null;
    }
    if (sheet.spellcasting?.casters?.length) {
      sheet.spellcasting.casters = sheet.spellcasting.casters.filter((caster) =>
        keptIds.has(caster.classId.toLowerCase()),
      );
      if (!keptIds.has("warlock")) {
        delete sheet.spellcasting.pact;
      }
    }
  }

  sheet.hitDice = { ...sheet.hitDice, total: level, spent: 0 };
  if (level !== fromLevel) {
    const suggested = suggestedStartingHp(sheet.class, sheet.race, sheet.abilities.con, level);
    // Only classes the SRD tables know produce a real suggestion; otherwise
    // scale the stored HP roughly by level.
    sheet.maxHp =
      suggested !== 8 || sheet.class === "wizard"
        ? suggested
        : Math.max(1, Math.round((sheet.maxHp / Math.max(1, fromLevel)) * level));
  }
  if (sheet.spellcasting) {
    const slots =
      (sheet.classes ?? []).length > 1
        ? slotTableFor({ class: sheet.class, classes: sheet.classes })
        : spellSlotsFor(sheet.class, level);
    if (Object.keys(slots).length) {
      sheet.spellcasting.slots = Object.fromEntries(
        Object.entries(slots).map(([slotLevel, max]) => [slotLevel, { max, used: 0 }]),
      );
    }
  }

  return sheet;
}
