import { findCustomClass, spellClassFor } from "@/lib/classes";
import { suggestedSpellCount } from "@/lib/content/mechanics";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { abilityMod, spellSlotsFor } from "@/lib/srd";
import { subclassSpellsFor } from "@/lib/srd/features";
import { isCantripName, spellsAgainstLimit } from "@/lib/srd/spell-lists";

// How a caster's spell list works, and the 5e (SRD 5.1) timing for changing
// it. Pure and database-free, shared by the sheet, the builder, the server
// and scripts/test-spell-prep.mjs.
//
// - "known" (bard, sorcerer, warlock, ranger): the spells they know are
//   always ready. The list only changes on a level-up.
// - "prepared" (cleric, druid, paladin, artificer): the whole class list is
//   open to them; they choose what is prepared, and a new choice takes hold
//   when they finish a long rest.
// - "spellbook" (wizard): the same, but they prepare from the spells written
//   in their spellbook rather than the whole class list.
//
// Cantrips are none of these: known for good, never prepared. A short rest
// changes nothing. Unpreparing a spell takes effect at once (the caster simply
// stops holding it ready); preparing one waits in `pending` until the long
// rest, so it cannot be cast before then.

export type SpellStyle = "known" | "prepared" | "spellbook";

const KNOWN_CLASSES = new Set(["bard", "sorcerer", "warlock", "ranger"]);

export function spellStyleFor(classId: string): SpellStyle {
  const id = classId.trim().toLowerCase();
  const custom = findCustomClass(id);
  if (custom) {
    return custom.knownCaster ? "known" : "prepared";
  }
  if (id === "wizard") {
    return "spellbook";
  }
  return KNOWN_CLASSES.has(id) ? "known" : "prepared";
}

// Spells a wizard has written in their book by `level` without buying or
// copying any: six at 1st level and two more every level after.
export function spellbookAllowance(level: number): number {
  return 6 + 2 * (Math.max(1, Math.min(20, level)) - 1);
}

type Ability = "int" | "wis" | "cha";

export type CasterLists = {
  known: string[];
  prepared: string[];
  cantrips?: string[];
  pending?: string[];
  spellbook?: string[];
};

// One caster class's slice of a sheet: the legacy top-level lists for a
// single-class character, or one `casters` entry on a multiclass one.
export type CasterView = {
  classId: string;
  ability: Ability;
  level: number;
  subclass: string;
  style: SpellStyle;
  known: string[];
  prepared: string[];
  cantrips: string[];
  pending: string[];
  spellbook: string[];
};

type SheetLike = Pick<CharacterSheet, "class" | "level" | "subclass" | "classes" | "abilities"> & {
  spellcasting: CharacterSheet["spellcasting"];
};

const lower = (name: string) => name.trim().toLowerCase();
const has = (list: string[], name: string) => list.some((entry) => lower(entry) === lower(name));
const without = (list: string[], name: string) => list.filter((entry) => lower(entry) !== lower(name));

export function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = lower(name);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function viewOf(
  lists: CasterLists,
  classId: string,
  ability: Ability,
  level: number,
  subclass: string,
): CasterView {
  return {
    classId,
    ability,
    level,
    subclass,
    style: spellStyleFor(classId),
    known: [...(lists.known ?? [])],
    prepared: [...(lists.prepared ?? [])],
    cantrips: [...(lists.cantrips ?? [])],
    pending: [...(lists.pending ?? [])],
    spellbook: [...(lists.spellbook ?? [])],
  };
}

export function casterViewsOf(sheet: SheetLike): CasterView[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  if (casting.casters?.length) {
    return casting.casters.map((caster) => {
      const entry = (sheet.classes ?? []).find((row) => lower(row.id) === lower(caster.classId));
      return viewOf(caster, caster.classId, caster.ability, entry?.level ?? sheet.level, entry?.subclass ?? "");
    });
  }
  return [viewOf(casting, sheet.class, casting.ability, sheet.level, sheet.subclass ?? "")];
}

// Writes views back: onto `casters` (with the top-level lists kept as their
// union, the mirror every other reader uses) or onto the top level itself.
export function withCasterViews(
  casting: NonNullable<CharacterSheet["spellcasting"]>,
  views: CasterView[],
): NonNullable<CharacterSheet["spellcasting"]> {
  if (casting.casters?.length) {
    const casters = casting.casters.map((caster) => {
      const view = views.find((entry) => lower(entry.classId) === lower(caster.classId));
      return view ? writeLists(caster, view) : caster;
    });
    const union = (pick: (view: CasterView) => string[]) => dedupeNames(views.flatMap(pick));
    const mirror: CasterView = {
      ...views[0],
      // A spellbook anywhere keeps the mirror's.
      style: views.some((view) => view.style === "spellbook") ? "spellbook" : "prepared",
      known: union((view) => view.known).slice(0, 80),
      prepared: union((view) => view.prepared).slice(0, 60),
      cantrips: union((view) => view.cantrips).slice(0, 40),
      pending: union((view) => view.pending).slice(0, 60),
      spellbook: union((view) => view.spellbook).slice(0, 120),
    };
    return { ...writeLists(casting, mirror), casters };
  }
  const [view] = views;
  return view ? writeLists(casting, view) : casting;
}

// The optional lists are dropped when empty, so a sheet that never used them
// serializes exactly as before.
function writeLists<T extends CasterLists>(target: T, view: CasterView): T {
  const next: T = {
    ...target,
    known: view.known,
    prepared: view.prepared,
    cantrips: view.cantrips,
    pending: view.pending,
    spellbook: view.spellbook,
  };
  if (!view.pending.length) {
    delete next.pending;
  }
  if (view.style !== "spellbook" && !view.spellbook.length) {
    delete next.spellbook;
  }
  return next;
}

// The list that holds a caster's levelled spells: `known` for a known
// caster, `prepared` otherwise (older sheets sometimes filed a known caster's
// spells under prepared; the non-empty one wins, as everywhere else).
export function heldSpells(view: CasterView): string[] {
  if (view.style === "known") {
    return view.known.length ? view.known : view.prepared;
  }
  return view.prepared;
}

// Every spell in a wizard's book. What they have prepared is always in it,
// whether or not an older sheet wrote it down twice.
export function spellbookOf(view: Pick<CasterView, "spellbook" | "prepared" | "pending">): string[] {
  return dedupeNames([...view.spellbook, ...view.prepared, ...view.pending]).filter(
    (name) => !isCantripName(name),
  );
}

export function grantedSpellsOf(view: CasterView): string[] {
  return subclassSpellsFor(view.classId, view.subclass, view.level);
}

// The highest spell level this class can prepare or learn at its own level.
export function maxSpellLevelOf(view: Pick<CasterView, "classId" | "level">): number {
  return Object.keys(spellSlotsFor(view.classId, view.level)).reduce(
    (top, slotLevel) => Math.max(top, Number(slotLevel)),
    0,
  );
}

// How many spells the class may hold (known or prepared), not counting
// cantrips or the subclass's always-prepared spells. Null for a class with no
// table (custom counts are advice, never enforced).
export function spellCapOf(
  view: CasterView,
  abilities: CharacterSheet["abilities"],
): { label: string; count: number } | null {
  return suggestedSpellCount(spellClassFor(view.classId), view.level, abilityMod(abilities[view.ability]));
}

// Prepared now plus waiting for the rest, as the cap counts them.
export function preparedCount(view: CasterView): number {
  return spellsAgainstLimit(dedupeNames([...view.prepared, ...view.pending]), grantedSpellsOf(view));
}

export type PrepAction = "prepare" | "unprepare" | "cancel";

export type PrepResult = { view: CasterView; note: string } | { error: string };

// One change a player makes to what is prepared. `inClassList` is the
// caller's answer to "is this spell on the class list at a level they can
// cast" (the server checks it against the content pack; a prepared caster may
// pick anything on it, a wizard only what is in their book).
export function changePreparation(
  view: CasterView,
  action: PrepAction,
  spell: string,
  context: { abilities: CharacterSheet["abilities"]; inClassList: boolean },
): PrepResult {
  const name = spell.trim();
  if (!name) {
    return { error: "Name a spell." };
  }
  if (view.style === "known") {
    return {
      error:
        "A caster who knows their spells always has them ready. They swap one for another when they gain a level, not at a rest.",
    };
  }
  if (isCantripName(name) || has(view.cantrips, name)) {
    return { error: `${name} is a cantrip: always ready, never prepared.` };
  }
  const granted = grantedSpellsOf(view);
  if (action === "cancel") {
    if (!has(view.pending, name)) {
      return { error: `${name} is not waiting to be prepared.` };
    }
    return { view: { ...view, pending: without(view.pending, name) }, note: `${name} will not be prepared.` };
  }
  if (action === "unprepare") {
    if (has(granted, name)) {
      return { error: `${name} comes with the subclass and is always prepared.` };
    }
    if (has(view.pending, name)) {
      return { view: { ...view, pending: without(view.pending, name) }, note: `${name} will not be prepared.` };
    }
    if (!has(view.prepared, name)) {
      return { error: `${name} is not prepared.` };
    }
    return {
      view: {
        ...view,
        prepared: without(view.prepared, name),
        // A wizard's spell stays written in the book.
        spellbook: view.style === "spellbook" ? spellbookOf(view) : view.spellbook,
      },
      note: `${name} is no longer prepared. Preparing it again takes a long rest.`,
    };
  }
  // prepare
  if (has(view.prepared, name) || has(granted, name)) {
    return { error: `${name} is already prepared.` };
  }
  if (has(view.pending, name)) {
    return { error: `${name} is already waiting for the next long rest.` };
  }
  if (view.style === "spellbook" && !has(spellbookOf(view), name)) {
    return { error: `${name} is not in the spellbook. A wizard prepares only spells written in it.` };
  }
  if (view.style === "prepared" && !context.inClassList) {
    return { error: `${name} is not on the list this class can prepare at its level.` };
  }
  const cap = spellCapOf(view, context.abilities);
  if (cap && preparedCount(view) >= cap.count) {
    return {
      error: `Already ${cap.count} ${cap.label}, counting the ones waiting for the long rest. Unprepare one first.`,
    };
  }
  return {
    view: { ...view, pending: [...view.pending, name] },
    note: `${name} will be prepared after the next long rest.`,
  };
}

// Long rest: everything waiting is now prepared.
export function settlePreparation(
  casting: NonNullable<CharacterSheet["spellcasting"]>,
): NonNullable<CharacterSheet["spellcasting"]> {
  const settle = <T extends CasterLists>(lists: T): T => {
    const pending = lists.pending ?? [];
    if (!pending.length) {
      return lists;
    }
    const next = { ...lists, prepared: dedupeNames([...lists.prepared, ...pending]) };
    delete next.pending;
    return next;
  };
  const top = settle(casting);
  return casting.casters?.length ? { ...top, casters: casting.casters.map(settle) } : top;
}

// Why a spell the caster owns cannot be cast right now, or null when it is
// not one of theirs at all: waiting for the long rest, or only written in a
// wizard's spellbook. Lets a refusal say so instead of "not on the list".
export function notReadyReason(
  casting: CharacterSheet["spellcasting"],
  spell: string,
): string | null {
  if (!casting) {
    return null;
  }
  const lists = [casting, ...(casting.casters ?? [])];
  const inList = (pick: (lists: CasterLists) => string[] | undefined) =>
    lists.some((entry) => has(pick(entry) ?? [], spell));
  // A prepared spell is in a wizard's book too: ready beats written down.
  if (inList((entry) => [...(entry.cantrips ?? []), ...entry.known, ...entry.prepared])) {
    return null;
  }
  if (inList((entry) => entry.pending)) {
    return `${spell} is chosen but not prepared yet: it becomes ready after the next long rest.`;
  }
  if (inList((entry) => entry.spellbook)) {
    return `${spell} is in the spellbook but not prepared, so it cannot be cast. Prepare it from the sheet; it is ready after the next long rest.`;
  }
  return null;
}
