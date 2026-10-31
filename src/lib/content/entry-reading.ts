// One entry point for every reader (reading-logic.ts): the pack build
// stores what this answers, and the golden suite and the server ask it the
// same way.

import { readSpell } from "@/lib/content/spell-reading-logic";
import { readMonster } from "@/lib/content/monster-reading-logic";
import { readFeat } from "@/lib/content/feat-reading-logic";
import { readArchetype, readBackground, readClass, readRace } from "@/lib/content/option-reading-logic";
import type { EntryReading, ReadingKind, ReadingRow } from "@/lib/content/reading-logic";

const READERS: Record<ReadingKind, (row: ReadingRow) => EntryReading> = {
  spell: readSpell,
  monster: readMonster,
  feat: readFeat,
  race: readRace,
  class: readClass,
  background: readBackground,
  archetype: readArchetype,
};

export function readEntry(kind: ReadingKind, row: ReadingRow): EntryReading {
  return READERS[kind](row);
}
