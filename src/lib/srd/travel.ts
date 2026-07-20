// Travel rules from the PHB: pace affects passive Perception and stealth, and
// marching more than 8 hours in a day forces a Constitution save each extra
// hour or the traveler gains a level of exhaustion. Pure so scripts/
// test-world.mjs can exercise the save math without a database.

export type TravelPace = "fast" | "normal" | "slow";

// The passive-Perception consequence and stealth allowance of each pace.
const PACE_EFFECT: Record<TravelPace, { passivePerceptionMod: number; canStealth: boolean }> = {
  fast: { passivePerceptionMod: -5, canStealth: false },
  normal: { passivePerceptionMod: 0, canStealth: false },
  slow: { passivePerceptionMod: 0, canStealth: true },
};

export function paceEffect(pace: TravelPace) {
  return PACE_EFFECT[pace];
}

// A normal day of travel is 8 hours; every hour beyond that is a forced march.
export const NORMAL_TRAVEL_HOURS = 8;

// The number of forced-march hours in a day of the given length.
export function forcedMarchHours(totalHours: number): number {
  return Math.max(0, Math.round(Number(totalHours) || 0) - NORMAL_TRAVEL_HOURS);
}

// The Constitution save DC for the nth forced-march hour: DC 10 for the first
// extra hour, +1 for each hour after that (PHB forced march).
export function forcedMarchSaveDc(extraHour: number): number {
  return 10 + Math.max(0, Math.round(Number(extraHour) || 1) - 1);
}
