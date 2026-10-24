// A departed companion who comes back worn (issue 503 Phase 3), the pure
// half. Solo play is where lasting companions live, and a companion at its
// one character's level is past deadly for that character by the DMG's own
// math, so whole it is past the ceiling the table's difficulty sets on
// start_encounter and the return could never be staged. It comes back worn
// instead, with no allies: its current hit points lowered and its spell
// slots spent, highest first, a step at a time, until its rating through the
// same derive-cr path fits (src/lib/dm/departure-logic.ts planReturn), and
// never below the floor below. A wear is applied to the companion's own
// sheet (src/lib/dm/companion-statblock.ts applyWear), so the stat block it
// fights as now and the real sheet Phase 6 will put on the enemy side are
// worn by the same rule.
//
// Pure, with relative imports only, so scripts/test-departure.mjs loads it
// directly.

import type { CompanionValue } from "./companion-values-logic.ts";

// Never below half its hit points. Half is the rules' own line between a
// hurt creature and a broken one (a "bloodied" foe in the DMG's fiction),
// and at half a same-level companion still needs two or three rounds of a
// solo character's damage to drop, so the return is a fight and not a
// formality. Halving hit points halves the defensive half of the rating
// (about three rows of the DMG's table at levels 3 to 10), which, with its
// slots spent, brings a same-level companion inside a solo table's ceiling
// at every difficulty for the common classes; one that still does not fit
// comes in a standoff in words.
export const WORN_HP_FLOOR = 0.5;
// Each step of lost hit points: a tenth of its maximum, so the wear stops
// close to the first fit rather than overshooting it.
const HP_STEP = 0.1;

// The key a warlock's pact slots are worn under, beside the shared slot
// levels ("1" to "9").
export const PACT = "pact";

export type SlotPool = { key: string; level: number; count: number };

export type Wear = {
  hpLost: number;
  // Slots spent, by the key the sheet files them under ("3", or "pact").
  slotsSpent: Record<string, number>;
};

export const NO_WEAR: Wear = { hpLost: 0, slotsSpent: {} };

export function isWorn(wear: Wear | null | undefined): wear is Wear {
  return Boolean(wear && (wear.hpLost > 0 || Object.values(wear.slotsSpent).some((count) => count > 0)));
}

// The most hit points a wear may take.
export function maxHpLost(maxHp: number): number {
  return Math.max(0, maxHp - Math.ceil(maxHp * WORN_HP_FLOOR));
}

// Every wear from the gentlest to the floor, each one step more than the
// last: the highest slot it has left spent, then a tenth of its hit points,
// in turn, until both are gone as far as they may go (the floor for hit
// points; every levelled slot, since cantrips stay).
export function wearSteps(maxHp: number, slots: readonly SlotPool[]): Wear[] {
  const left = slots.map((pool) => ({ ...pool })).sort((a, b) => b.level - a.level);
  const ceilingLost = maxHpLost(maxHp);
  const step = Math.max(1, Math.round(maxHp * HP_STEP));
  const steps: Wear[] = [];
  let current: Wear = NO_WEAR;
  let slotTurn = true;
  for (;;) {
    const pool = left.find((entry) => entry.count > 0);
    const canSpend = Boolean(pool);
    const canBleed = current.hpLost < ceilingLost;
    if (!canSpend && !canBleed) {
      break;
    }
    if ((slotTurn && canSpend) || !canBleed) {
      pool!.count -= 1;
      current = { ...current, slotsSpent: { ...current.slotsSpent, [pool!.key]: (current.slotsSpent[pool!.key] ?? 0) + 1 } };
    } else {
      current = { ...current, hpLost: Math.min(ceilingLost, current.hpLost + step) };
    }
    slotTurn = !slotTurn;
    steps.push(current);
  }
  return steps;
}

export function slotsSpentCount(wear: Wear): number {
  return Object.values(wear.slotsSpent).reduce((sum, count) => sum + count, 0);
}

// Why they are worn, for the DM to narrate: what they hold to says what the
// hunt cost them. Never a rule or a number the table must take on trust; the
// numbers ride beside it.
export function wornReason(values: readonly Pick<CompanionValue, "value">[], spentSlots: boolean): string {
  if (values.some((held) => held.value === "mercenary")) {
    return "they paid for allies with coin and blood, and the allies did not come";
  }
  if (values.some((held) => held.value === "ruthless")) {
    return "an old wound, taken in a fight they picked on the way, has not closed";
  }
  return spentSlots ? "a hard road on the party's trail has spent their strength and their magic" : "a hard road on the party's trail has worn them down";
}

export function wearWords(maxHp: number, wear: Wear): string {
  const spent = slotsSpentCount(wear);
  return `${maxHp - wear.hpLost} of ${maxHp} hit points${spent ? `, ${spent} spell slot${spent === 1 ? "" : "s"} spent` : ""}`;
}

export function parseWear(raw: unknown): Wear | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as { hpLost?: unknown; slotsSpent?: unknown };
  const slots: Record<string, number> = {};
  if (record.slotsSpent && typeof record.slotsSpent === "object") {
    for (const [key, count] of Object.entries(record.slotsSpent as Record<string, unknown>)) {
      const value = Math.max(0, Math.round(Number(count) || 0));
      if (value && (key === PACT || /^[1-9]$/.test(key))) {
        slots[key] = value;
      }
    }
  }
  const wear = { hpLost: Math.max(0, Math.round(Number(record.hpLost) || 0)), slotsSpent: slots };
  return isWorn(wear) ? wear : null;
}
