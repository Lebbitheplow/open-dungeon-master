// What follows from a level or a class changing, by whatever path: the
// player's level-up, a companion's, the DM's update_sheet, the lead's
// correction, an undo. A character of a level holds that level's class
// features, one hit die per level of the class it was taken in, the slot
// row of its casting classes and at least the experience the level takes.
// Spent dice and spent slots stay spent.
//
// Pure, so src/lib/db/sheets.ts patchSheet only has to call it.
import type {
  CharacterSheet,
  ClassEntry,
  HitDicePool,
  SheetFeature,
  Spellcasting,
} from "@/lib/schemas/sheet";
import { XP_THRESHOLDS, findClass, spellSlotsFor } from "@/lib/srd";
import { populateFeaturesForClasses } from "@/lib/srd/features";
import type { SubclassExtras } from "@/lib/srd/subclass-tables";
import { pactSlotsFor, slotTableFor } from "@/lib/srd/multiclass";
import { isThirdCaster } from "@/lib/srd/third-caster";

type Die = CharacterSheet["hitDice"]["die"];

const dieOf = (classId: string, fallback: Die): Die => {
  const sides = findClass(classId)?.hitDie;
  return sides ? (`d${sides}` as Die) : fallback;
};

export type LevelState = {
  class: string;
  subclass: string;
  race: string;
  level: number;
  xp: number;
  classes: ClassEntry[];
  features: SheetFeature[];
  hitDice: CharacterSheet["hitDice"];
  hitDicePools: HitDicePool[] | null;
  spellcasting: Spellcasting;
  // The class the sheet held while it was single-classed, when this change
  // is what gives it a second one; null otherwise.
  loneClassBefore?: string | null;
};

// The class list with no class named twice. A rename that would repeat a
// class the sheet already holds is not applied: the list stays as it was.
export function withoutDuplicateClasses(next: ClassEntry[], before: ClassEntry[]): ClassEntry[] {
  const ids = next.map((entry) => entry.id.toLowerCase());
  return new Set(ids).size === ids.length ? next : before;
}

function classListOf(state: LevelState): ClassEntry[] {
  return state.classes.length
    ? state.classes
    : [{ id: state.class, subclass: state.subclass, level: state.level }];
}

// One pool per class, sized by the class's level; dice already spent stay
// spent as far as the pool still holds them.
function settlePools(state: LevelState): HitDicePool[] | null {
  if (state.classes.length < 2) {
    return null;
  }
  const held = state.hitDicePools ?? [];
  // A sheet taking its first second class starts its pools from the dice it
  // already has: all of them belong to the first class.
  const spentBefore = held.length ? 0 : state.hitDice.spent;
  return state.classes.map((entry, index) => {
    const pool = held.find((candidate) => candidate.classId.toLowerCase() === entry.id.toLowerCase());
    const spent = pool ? pool.spent : index === 0 ? spentBefore : 0;
    return {
      classId: entry.id,
      die: dieOf(entry.id, pool?.die ?? state.hitDice.die),
      total: entry.level,
      spent: Math.max(0, Math.min(spent, entry.level)),
    };
  });
}

// The slot row (and pact slots) a class list has, with what was spent kept
// spent. Exported for the level-up, which writes the spell lists itself.
export function settleSlots(state: LevelState, classes: ClassEntry[]): Spellcasting {
  const casting = state.spellcasting;
  const casters = classes.filter((entry) => {
    const klass = findClass(entry.id);
    return klass
      ? (klass.casterType !== "none" && Boolean(klass.spellAbility)) ||
          (isThirdCaster(entry.id, entry.subclass) && entry.level >= 3)
      : false;
  });
  if (!casters.length) {
    // Nothing to size. Spells a sheet holds without a casting class were
    // given to it by hand, and a level does not take them away.
    return casting;
  }
  const multiclass = classes.length > 1;
  const table = multiclass
    ? slotTableFor({ class: state.class, classes })
    : spellSlotsFor(classes[0].id, classes[0].level, classes[0].subclass);
  const warlock = classes.find((entry) => findClass(entry.id)?.casterType === "pact");
  // A lone warlock's pact slots live in `slots`; beside another class they
  // move to `pact`, and what was spent of them moves too.
  const lonePactUsed = Object.values(casting?.slots ?? {}).reduce(
    (most, slot) => Math.max(most, slot.used),
    0,
  );
  const hadPact = Boolean(casting?.pact);
  const movesPact =
    multiclass &&
    Boolean(warlock) &&
    !hadPact &&
    findClass(state.loneClassBefore ?? "")?.casterType === "pact";
  const used = (slotLevel: string) => (movesPact ? 0 : (casting?.slots?.[slotLevel]?.used ?? 0));
  const slots = Object.fromEntries(
    Object.entries(table).map(([slotLevel, max]) => [
      slotLevel,
      { max, used: Math.min(max, used(slotLevel)) },
    ]),
  );
  const pactTable = multiclass && warlock ? pactSlotsFor(warlock.level) : null;
  const first = findClass(casters[0].id);
  const base: NonNullable<Spellcasting> = casting ?? {
    ability: first?.spellAbility ?? "int",
    slots: {},
    prepared: [],
    known: [],
    cantrips: [],
  };
  const next: NonNullable<Spellcasting> = { ...base, slots };
  delete next.pact;
  if (pactTable) {
    next.pact = {
      level: pactTable.level,
      max: pactTable.max,
      used: Math.min(pactTable.max, hadPact ? (casting?.pact?.used ?? 0) : movesPact ? lonePactUsed : 0),
    };
  }
  return next;
}

export type Settled = Pick<
  LevelState,
  "features" | "hitDice" | "hitDicePools" | "spellcasting" | "xp"
>;

// `pinned` names what the patch itself wrote: an explicit spell block or
// experience total is the caller's, and is kept.
export function settleLevelChange(
  state: LevelState,
  pinned: { spellcasting?: boolean; xp?: boolean } = {},
  // The table's workshop and pack subclasses (src/lib/srd/subclass-tables.ts).
  extras?: SubclassExtras,
): Settled {
  const classes = classListOf(state);
  const features = populateFeaturesForClasses(state.features, classes, state.race, undefined, extras);
  const hitDicePools = settlePools(state);
  const total = Math.max(1, Math.min(20, state.level));
  const hitDice = hitDicePools
    ? {
        die: hitDicePools[0].die,
        total: Math.min(20, hitDicePools.reduce((sum, pool) => sum + pool.total, 0)),
        spent: hitDicePools.reduce((sum, pool) => sum + pool.spent, 0),
      }
    : {
        die: dieOf(state.class, state.hitDice.die),
        total,
        spent: Math.max(0, Math.min(state.hitDice.spent, total)),
      };
  return {
    features,
    hitDice,
    hitDicePools,
    spellcasting: pinned.spellcasting ? state.spellcasting : settleSlots(state, classes),
    xp: pinned.xp ? state.xp : Math.max(state.xp, XP_THRESHOLDS[total - 1] ?? 0),
  };
}
