// A spell slot a player marked spent by hand, waiting for the cast it paid.
//
// A player who ticks a slot on their sheet and then writes "I cast Cure
// Wounds" has paid once; the cast the DM then resolves must not take a second
// slot for it. The usage route records each slot a player marks spent, and
// the cast guard (src/lib/dm/cast-guard.ts) takes one back from here before
// it spends: a matching tick means the slot is already paid.
//
// Held in memory, per sheet and slot level, for a few minutes: long enough
// for the DM's turn to resolve the cast the tick was for, short enough that a
// slot ticked for a spell nobody resolved does not pay for tomorrow's. A
// restart forgets them, which costs only the old behaviour (the cast spends).

import type { SlotPlan } from "@/lib/dm/cast-rules";

const WINDOW_MS = 10 * 60 * 1000;

type Tick = { level: number; at: number };

const ticks = new Map<string, Tick[]>();

function live(sheetId: string, now: number): Tick[] {
  const kept = (ticks.get(sheetId) ?? []).filter((tick) => now - tick.at <= WINDOW_MS);
  if (kept.length) {
    ticks.set(sheetId, kept);
  } else {
    ticks.delete(sheetId);
  }
  return kept;
}

// `count` slots of `level` were marked spent by hand just now.
export function recordManualTicks(sheetId: string, level: number, count: number, now = Date.now()) {
  const kept = live(sheetId, now);
  for (let index = 0; index < count; index += 1) {
    kept.push({ level, at: now });
  }
  ticks.set(sheetId, kept);
}

// Takes one waiting tick of this level, if there is one: true means the slot
// the cast needs is already paid. A dry run only looks.
export function consumeManualTick(
  sheetId: string,
  level: number,
  { dryRun = false, now = Date.now() }: { dryRun?: boolean; now?: number } = {},
): boolean {
  const kept = live(sheetId, now);
  const at = kept.findIndex((tick) => tick.level === level);
  if (at < 0) {
    return false;
  }
  if (dryRun) {
    return true;
  }
  kept.splice(at, 1);
  if (kept.length) {
    ticks.set(sheetId, kept);
  } else {
    ticks.delete(sheetId);
  }
  return true;
}

type Caster = { id: string; spellcasting: { slots: Record<string, { max: number; used: number }> } | null };

// The cast guard's slot plan, with a slot the player already marked spent
// for this cast taken as the payment: the plan then writes the slot as it
// already stands. It also covers the last slot of a level ticked by hand,
// which the plan alone would refuse as spent. `wanted` is the level the cast
// is made at, `lowest` the spell's own level.
export function paidByManualTick(
  sheet: Caster,
  plan: SlotPlan | { error: string },
  wanted: number | undefined,
  lowest: number | undefined,
  dryRun: boolean,
): SlotPlan | { error: string } {
  const level = "error" in plan ? wanted : plan.kind === "slot" ? plan.level : undefined;
  const current = level ? sheet.spellcasting?.slots[String(level)] : undefined;
  if (!level || !current || level < (lowest ?? 1)) {
    return plan;
  }
  if ("error" in plan && current.used < current.max) {
    return plan;
  }
  if (!consumeManualTick(sheet.id, level, { dryRun })) {
    return plan;
  }
  return { kind: "slot", level, state: { max: current.max, used: current.used } };
}
