import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { owedChoices } from "@/lib/srd/owed-choices";
import { textKey } from "@/lib/language/text-logic";
import type { OwedPicks } from "@/lib/characters/seat-picks";

// What taking a seat does to a hero, in words, for the confirm sheet a
// player reads before joining (backlog F6, JoinConfirmDialog.tsx). It
// compares the sheet as stored with the sheet the table's door admitted
// (src/lib/characters/seat-preview.ts), so it describes the real join and
// invents nothing: the adapting is src/lib/characters/adapt.ts, the rules
// check is src/lib/characters/admit.ts.
//
// Pure, for scripts/test-seat-confirm.mjs.

export type JoinChanges = {
  // One line per change, in the order a player cares about.
  changes: string[];
  // Choices the level earned and the hero has not made: taken by the first
  // level-up, as the character sheet says (owedChoices).
  owed: string[];
};

// What the confirm sheet reads (POST /sheet/preview).
export type JoinPreview = JoinChanges & {
  name: string;
  fromLevel: number;
  toLevel: number;
  // Whether the table's rules let the hero in, and what stops it if not.
  ok: boolean;
  problems: string[];
  // A table that rolls hit points rolls them when the seat is taken, so the
  // number shown here is one throw, not the one the hero keeps.
  rollsHp: boolean;
  // What the confirm sheet may pick of the owed choices before the hero
  // seats (src/lib/characters/seat-picks.ts): read off the hero as it seats
  // with nothing picked, so the pickers stay put while picks are made.
  picks?: OwedPicks;
};

type Sheet = Pick<
  CreateSheetInput,
  "class" | "subclass" | "classes" | "maxHp" | "asiChoices" | "feats" | "features" | "proficiencies" | "spellcasting"
>;

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function spellsOf(sheet: Sheet): string[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  const lists = [
    casting.cantrips,
    casting.known,
    casting.prepared,
    casting.spellbook ?? [],
    ...(casting.casters ?? []).flatMap((caster) => [caster.cantrips, caster.known, caster.prepared, caster.spellbook ?? []]),
  ];
  const seen = new Map<string, string>();
  for (const name of lists.flat()) {
    const key = textKey(name);
    if (key && !seen.has(key)) {
      seen.set(key, name.trim());
    }
  }
  return [...seen.values()];
}

function slotLine(sheet: Sheet): string {
  const slots = Object.entries(sheet.spellcasting?.slots ?? {})
    .filter(([, slot]) => slot.max > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([level, slot]) => `${slot.max} × ${ORDINAL[Number(level)] ?? level}`);
  return slots.join(", ");
}

function classLine(sheet: Sheet, level: number): string {
  const classes = sheet.classes ?? [];
  if (classes.length > 1) {
    return classes.map((entry) => `${entry.id} ${entry.level}`).join(" / ");
  }
  return `${sheet.class} ${level}`;
}

export function joinChanges(
  stored: Sheet,
  storedLevel: number,
  seated: Sheet,
  tableLevel: number,
): JoinChanges {
  const changes: string[] = [];
  if (storedLevel === tableLevel) {
    changes.push(`Plays at its own level, ${tableLevel}.`);
  } else if (storedLevel < tableLevel) {
    changes.push(`Goes up from level ${storedLevel} to ${tableLevel} for this table.`);
  } else {
    changes.push(`Plays at level ${tableLevel} here, down from ${storedLevel}.`);
  }

  const storedClasses = classLine(stored, storedLevel);
  const seatedClasses = classLine(seated, tableLevel);
  if ((stored.classes ?? []).length > 1 && storedClasses !== seatedClasses) {
    changes.push(`Classes: ${storedClasses} becomes ${seatedClasses}.`);
  }

  if (stored.maxHp !== seated.maxHp) {
    changes.push(`Hit points: ${stored.maxHp} becomes ${seated.maxHp}.`);
  }

  const givenBack = (stored.asiChoices ?? []).length - (seated.asiChoices ?? []).length;
  if (givenBack > 0) {
    const seatedFeats = new Set((seated.feats ?? []).map(textKey));
    const feats = (stored.feats ?? []).filter((feat) => !seatedFeats.has(textKey(feat)));
    changes.push(
      `Gives back ${plural(givenBack, "Ability Score Improvement")} this level has not earned${feats.length ? `, with ${feats.join(", ")}` : ""}.`,
    );
  }

  const seatedSpells = new Set(spellsOf(seated).map(textKey));
  const lostSpells = spellsOf(stored).filter((name) => !seatedSpells.has(textKey(name)));
  if (stored.spellcasting && !seated.spellcasting) {
    changes.push("Loses its spellcasting with the class levels it gives back.");
  } else if (lostSpells.length) {
    changes.push(`Gives back ${plural(lostSpells.length, "spell")} this level cannot hold: ${lostSpells.join(", ")}.`);
  }

  const storedSlots = slotLine(stored);
  const seatedSlots = slotLine(seated);
  if (seated.spellcasting && storedSlots !== seatedSlots) {
    changes.push(seatedSlots ? `Spell slots: ${seatedSlots}.` : "No spell slots at this level.");
  }

  // Owed choices read the sheet at the level it plays; the seated sheet's
  // own level field is the table's once stored, so it is given here.
  const owed = owedChoices({
    class: seated.class,
    subclass: seated.subclass ?? "",
    level: tableLevel,
    classes: seated.classes,
    features: seated.features ?? [],
    proficiencies: seated.proficiencies,
  } as Parameters<typeof owedChoices>[0]);

  return { changes, owed };
}
