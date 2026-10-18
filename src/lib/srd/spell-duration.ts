// How long a spell lasts from the slot it was cast from. Some spells buy a
// longer lifetime with a higher slot (SRD 5.1): Hunter's Mark held 8 hours
// from a 3rd-level slot and 24 from a 5th, Dominate Person 10 minutes from a
// 6th, Geas a year from a 7th and until dispelled from a 9th. The rows say so
// where the SRD is bundled (`durationBySlot`); any other spell's own
// "At Higher Levels" text is read for it. One answer for the concentration
// clock, a buff's condition and a failed save's condition.

import { ROUND_CEILING } from "@/lib/schemas/condition-meta";

// [the slot level it starts at, its rounds or null for "until dispelled"],
// in ascending order.
export type SlotDurations = Array<[number, number | null]>;

const ROUNDS: Record<string, number> = { round: 1, minute: 10, hour: 600, day: 14400, week: 100800, month: 432000, year: 5256000 };
const UNIT = "(round|minute|hour|day|week|month|year)s?";
// "3rd", "5th-level", "9th level", with whatever dash the text was typed with.
const LEVEL = /\b([1-9])(?:st|nd|rd|th)(?=\b|level)/i;
// A sentence about how long the spell lasts, not its damage or its reach.
const SPEAKS_OF_DURATION = /duration|\blasts?\b|concentration|for up to|until (?:it is )?dispelled|permanent|extended/i;

const roundsOf = (count: string | undefined, unit: string) =>
  Math.min(ROUND_CEILING, Number(count ?? 1) * (ROUNDS[unit.toLowerCase()] ?? 1));

// What an "At Higher Levels" text says about the duration: lifetimes from a
// slot level up, and a lifetime added for each slot level above one. A
// cantrip's growth with its caster ("when you reach 5th level") is no slot's.
export function slotDurationsFromText(text: string): { at: SlotDurations; each: { above: number; rounds: number } | null } {
  const at: SlotDurations = [];
  let each: { above: number; rounds: number } | null = null;
  const first = text.split(/\n\s*\n|\*\*\*/)[0] ?? "";
  for (const sentence of first.split(/(?<=[.;])\s+/)) {
    if (/you reach|character level/i.test(sentence) || !SPEAKS_OF_DURATION.test(sentence)) {
      continue;
    }
    const added =
      new RegExp(`(?:by|an additional|additional)\\s+(\\d+\\s+)?${UNIT}[^.]*?for each slot level above ([1-9])`, "i").exec(sentence) ??
      new RegExp(`(\\d+)\\s+${UNIT}\\s+longer[^.]*?for each slot level above ([1-9])`, "i").exec(sentence);
    if (added) {
      each = { above: Number(added[3]), rounds: roundsOf(added[1]?.trim(), added[2]) };
      continue;
    }
    for (const clause of sentence.split(/,\s*(?:or|and)\s+|,\s*(?=[1-9](?:st|nd|rd|th))/i)) {
      const level = LEVEL.exec(clause);
      if (!level) {
        continue;
      }
      if (/until (?:it is )?dispelled|permanent/i.test(clause)) {
        at.push([Number(level[1]), null]);
        continue;
      }
      const lasts = new RegExp(`(\\d+)\\s+${UNIT}`, "i").exec(clause);
      if (lasts) {
        at.push([Number(level[1]), roundsOf(lasts[1], lasts[2])]);
      }
    }
  }
  return { at: at.sort((a, b) => a[0] - b[0]), each };
}

// The rounds a spell lasts from `slotLevel`, given what it lasts at its own
// level: the last lifetime the slot reaches, then anything added per level.
// Null is "until dispelled"; `base` when the slot changes nothing.
export function roundsAtSlot(
  base: number | null,
  slotLevel: number,
  scaling: { at: SlotDurations; each?: { above: number; rounds: number } | null },
): number | null {
  let rounds = base;
  for (const [level, lasts] of scaling.at) {
    if (slotLevel >= level) {
      rounds = lasts;
    }
  }
  const each = scaling.each;
  if (each && rounds !== null && slotLevel > each.above) {
    rounds = Math.min(ROUND_CEILING, rounds + each.rounds * (slotLevel - each.above));
  }
  return rounds;
}
