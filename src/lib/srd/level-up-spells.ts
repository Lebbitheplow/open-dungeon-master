// What a caster's spell lists may become when the class gains a level.
//
// SRD 5.1, each class's Spellcasting feature: a new spell is on the class's
// own list and of a level the class has slots for; a bard, sorcerer, warlock
// or ranger learns what the Spells Known column adds and may replace ONE
// spell they know; cantrips are never replaced; a wizard writes two spells in
// the book for the level (six for a first wizard level) and prepares only
// from the book; a caster who knows spells prepares none.
//
// Pure. The player's picks arrive either as the names picked
// (`levelUpSpells`, with `levelUpForget` for the one a known caster gives
// up) or, from a client built before that, as the lists whole; both are read
// as "the lists the player wants" and judged against the lists held.
import {
  cantripCapOf,
  dedupeNames,
  grantedSpellsOf,
  maxSpellLevelOf,
  preparedCount,
  spellCapOf,
  spellbookAllowance,
  spellbookOf,
  type CasterView,
} from "@/lib/srd/spell-prep";
import type { AbilityScores } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/legality/types";

const lower = (name: string) => name.trim().toLowerCase();
const has = (list: string[], name: string) => list.some((entry) => lower(entry) === lower(name));
const added = (after: string[], before: string[]) =>
  dedupeNames(after).filter((name) => !has(before, name));

export type SpellPicks =
  | { kind: "picks"; spells: string[]; forget?: string }
  | {
      kind: "lists";
      lists: {
        known: string[];
        prepared: string[];
        cantrips: string[];
        pending?: string[];
        spellbook?: string[];
      };
    };

export type SpellLevelUp = {
  // The caster's lists before the level, at the class's OLD level; empty
  // lists for a class that starts casting with this level.
  before: CasterView;
  // The class's level and subclass after it.
  level: number;
  subclass: string;
  // The spell list the class draws from ("wizard" for an Eldritch Knight).
  list: string;
  // True when this is the first level in the class (a first wizard level
  // writes a whole starting book).
  firstLevel: boolean;
  abilities: AbilityScores;
  // Cantrips the race gave, known on top of the class's own.
  freeCantrips: number;
  spellOf: (name: string) => SpellFacts | null;
  picks: SpellPicks | null;
};

export type SpellLevelUpResult = { view: CasterView } | { error: string };

// A warlock's Mystic Arcanum reaches past pact slots.
function arcanumTop(classList: string, level: number): number {
  if (classList !== "warlock") {
    return 0;
  }
  return level >= 17 ? 9 : level >= 15 ? 8 : level >= 13 ? 7 : level >= 11 ? 6 : 0;
}

export function levelUpSpells(input: SpellLevelUp): SpellLevelUpResult {
  const { before, picks } = input;
  const label = `${before.classId.replace(/[_-]+/g, " ")} of level ${input.level}`;
  const after: CasterView = {
    ...before,
    level: input.level,
    subclass: input.subclass,
    known: [...before.known],
    prepared: [...before.prepared],
    cantrips: [...before.cantrips],
    pending: [...before.pending],
    spellbook: [...before.spellbook],
  };
  const granted = grantedSpellsOf(after);
  const isGranted = (name: string) => has(granted, name);
  const top = Math.max(maxSpellLevelOf(after), arcanumTop(input.list, input.level));

  // ---- what the player asked for, as lists ----
  let removed: string[] = [];
  if (picks?.kind === "picks") {
    const held = [...after.cantrips, ...after.known, ...after.prepared, ...after.pending, ...after.spellbook];
    for (const name of dedupeNames(picks.spells)) {
      if (has(held, name) || isGranted(name)) {
        continue;
      }
      const spell = input.spellOf(name);
      if (!spell) {
        return { error: `${name} is not a spell this server knows; pick one from the ${input.list} spell list.` };
      }
      if (spell.level === 0) {
        after.cantrips.push(spell.name);
      } else if (after.style === "known") {
        after.known.push(spell.name);
      } else if (after.style === "spellbook") {
        // The book holds what was prepared before it was kept as a list.
        after.spellbook = dedupeNames([...spellbookOf(after), spell.name]);
      } else {
        after.prepared.push(spell.name);
      }
    }
    const forget = (picks.forget ?? "").trim();
    if (forget) {
      if (after.style !== "known" || !has(before.known, forget)) {
        return { error: `${forget} is not a spell this character knows, so it cannot be given up for another.` };
      }
      after.known = after.known.filter((name) => lower(name) !== lower(forget));
      removed = [forget];
    }
  } else if (picks?.kind === "lists") {
    const wanted = picks.lists;
    const legacyKnown = after.style === "known" && !before.known.length && before.prepared.length > 0;
    after.cantrips = dedupeNames(wanted.cantrips ?? []);
    after.known = dedupeNames(wanted.known ?? []);
    after.prepared = dedupeNames(wanted.prepared ?? []);
    after.pending = dedupeNames(wanted.pending ?? before.pending);
    after.spellbook = dedupeNames(wanted.spellbook ?? before.spellbook);
    if (after.style === "known" && !legacyKnown) {
      const apart = after.prepared.filter((name) => !has(after.known, name) && !isGranted(name));
      if (apart.length) {
        return {
          error: `A ${label} knows its spells and prepares none; ${apart.join(", ")} would be held beside the spells known. Learn them as spells known, within the number the class knows.`,
        };
      }
    }
    const lostCantrips = before.cantrips.filter((name) => !has(after.cantrips, name));
    if (lostCantrips.length) {
      return {
        error: `A cantrip, once known, is known for good; ${lostCantrips.join(", ")} cannot be replaced at a level-up.`,
      };
    }
    const heldBefore = after.style === "known" ? (before.known.length ? before.known : before.prepared) : [];
    const heldAfter = after.known.length ? after.known : after.prepared;
    removed = heldBefore.filter((name) => !has(heldAfter, name) && !isGranted(name));
    if (after.style === "spellbook") {
      const torn = spellbookOf(before).filter(
        (name) => !has(spellbookOf(after), name),
      );
      if (torn.length) {
        return { error: `${torn.join(", ")} is written in the spellbook and stays there; a level-up adds to the book.` };
      }
    }
  }
  if (removed.length > 1) {
    return {
      error: `On gaining a level a ${label} may replace one spell they know with another, not ${removed.length} (${removed.join(", ")}).`,
    };
  }

  // The subclass's always-prepared spells arrive on their own, free.
  for (const name of granted) {
    const home = after.style === "known" ? after.known : after.prepared;
    if (!has([...after.known, ...after.prepared, ...after.pending], name)) {
      home.push(name);
    }
  }

  // ---- every new name: a real spell, on the list, within reach ----
  const newCantrips = added(after.cantrips, before.cantrips);
  const beforeSpells = [...before.known, ...before.prepared, ...before.pending, ...before.spellbook];
  const newSpells = added(
    [...after.known, ...after.prepared, ...after.pending, ...after.spellbook],
    beforeSpells,
  ).filter((name) => !isGranted(name));
  for (const name of newCantrips) {
    const spell = input.spellOf(name);
    if (!spell) {
      return { error: `${name} is not a spell this server knows; pick one from the ${input.list} spell list.` };
    }
    if (spell.level !== 0) {
      return { error: `${spell.name} is a level ${spell.level} spell, not a cantrip; it cannot sit on the cantrip list.` };
    }
    if (!spell.classes.map(lower).includes(input.list)) {
      return { error: `${spell.name} is not a ${input.list} cantrip, so a ${label} cannot learn it.` };
    }
  }
  for (const name of newSpells) {
    const spell = input.spellOf(name);
    if (!spell) {
      return { error: `${name} is not a spell this server knows; pick one from the ${input.list} spell list.` };
    }
    if (spell.level === 0) {
      return { error: `${spell.name} is a cantrip; it belongs on the cantrip list, not among the spells.` };
    }
    if (!spell.classes.map(lower).includes(input.list)) {
      return { error: `${spell.name} is not on the ${input.list} spell list, so a ${label} cannot learn or prepare it.` };
    }
    if (spell.level > top) {
      return {
        error:
          top === 0
            ? `A ${label} has no spell slots yet, so ${spell.name} cannot be learned.`
            : `${spell.name} is a level ${spell.level} spell; a ${label} casts up to level ${top}.`,
      };
    }
  }

  // ---- the counts ----
  const cantripCap = cantripCapOf(after);
  const cantrips = dedupeNames(after.cantrips);
  if (newCantrips.length && cantripCap === null) {
    return { error: `A ${label} knows no cantrips.` };
  }
  if (cantripCap !== null && newCantrips.length && cantrips.length - input.freeCantrips > cantripCap) {
    return {
      error: `A ${label} knows ${cantripCap} ${cantripCap === 1 ? "cantrip" : "cantrips"}; that list would have ${cantrips.length - input.freeCantrips}.`,
    };
  }
  const cap = spellCapOf(after, input.abilities);
  if (after.style === "spellbook") {
    const written = added(spellbookOf(after), spellbookOf(before)).filter((name) => !isGranted(name));
    const allowance = input.firstLevel ? spellbookAllowance(input.level) : 2;
    if (written.length > allowance) {
      return {
        error: `A wizard writes ${allowance} new spells in the spellbook at this level, not ${written.length}.`,
      };
    }
    const book = [...after.spellbook, ...spellbookOf(before)];
    const unwritten = [...after.prepared, ...after.pending].filter(
      (name) => !has(book, name) && !isGranted(name),
    );
    if (unwritten.length) {
      return {
        error: `A wizard prepares only spells written in the spellbook; ${unwritten.join(", ")} ${unwritten.length === 1 ? "is" : "are"} not in it. Write them in the book first, two a level.`,
      };
    }
    if (picks?.kind === "picks") {
      // Written in the book, and prepared as far as the limit has room.
      let room = cap ? Math.max(0, cap.count - preparedCount(after)) : written.length;
      for (const name of written) {
        if (room <= 0) {
          break;
        }
        after.prepared.push(name);
        room -= 1;
      }
    }
    if (cap && preparedCount(after) > cap.count && added(after.prepared, before.prepared).length) {
      return {
        error: `A ${label} may hold ${cap.count} ${cap.label}; that list would have ${preparedCount(after)}.`,
      };
    }
  } else if (cap) {
    const held =
      after.style === "known"
        ? dedupeNames(after.known.length ? after.known : after.prepared).filter((name) => !isGranted(name)).length
        : preparedCount(after);
    const grew =
      newSpells.length > 0 ||
      held >
        (after.style === "known"
          ? dedupeNames(before.known.length ? before.known : before.prepared).filter((name) => !isGranted(name)).length
          : preparedCount(before));
    if (grew && held > cap.count) {
      return {
        error: `A ${label} may hold ${cap.count} ${cap.label}; that list would have ${held}.`,
      };
    }
  } else if (newSpells.length) {
    return { error: `A ${label} has no spells to learn yet.` };
  }

  return { view: after };
}
