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

// How far a pace covers, from the PHB "Travel Pace" table. Miles per day is
// the miles-per-hour rate over a normal 8-hour day, so a longer day is
// hours * milesPerHour rather than a second number that could disagree.
const PACE_SPEED: Record<TravelPace, { feetPerMinute: number; milesPerHour: number }> = {
  fast: { feetPerMinute: 400, milesPerHour: 4 },
  normal: { feetPerMinute: 300, milesPerHour: 3 },
  slow: { feetPerMinute: 200, milesPerHour: 2 },
};

export function paceSpeed(pace: TravelPace) {
  return PACE_SPEED[pace];
}

// A normal day of travel is 8 hours; every hour beyond that is a forced march.
export const NORMAL_TRAVEL_HOURS = 8;

// The number of forced-march hours in a day of the given length.
export function forcedMarchHours(totalHours: number): number {
  return Math.max(0, Math.round(Number(totalHours) || 0) - NORMAL_TRAVEL_HOURS);
}

// The Constitution save DC for the nth forced-march hour. SRD 5.1, Forced
// March: "The DC is 10 + 1 for each hour past 8 hours", so the ninth hour is
// DC 11 and the twelfth DC 14.
export function forcedMarchSaveDc(extraHour: number): number {
  return 10 + Math.max(1, Math.round(Number(extraHour) || 1));
}

// The miles a leg covers: the pace's miles an hour, halved in difficult
// terrain (SRD 5.1, Difficult Terrain: "you can cover only half the normal
// distance in a minute, an hour, or a day"), times what the weather leaves
// of it. Rounded to the half mile.
export function milesCovered(input: {
  pace: TravelPace;
  terrain?: "normal" | "difficult";
  hours: number;
  weatherFactor?: number;
}): number {
  const perHour = PACE_SPEED[input.pace].milesPerHour * (input.terrain === "difficult" ? 0.5 : 1) * (input.weatherFactor ?? 1);
  return Math.round(perHour * Math.max(0, input.hours) * 2) / 2;
}

// One leg of travel from what the DM gave: hours (the miles follow) or miles
// (the hours follow, in whole minutes). A leg is one day's travel, 24 hours
// at most; a longer journey is travelled a day at a time.
export function travelLeg(input: {
  pace: TravelPace;
  terrain?: "normal" | "difficult";
  hours?: number;
  miles?: number;
  weatherFactor?: number;
}): { hours: number; minutes: number; miles: number } | { error: string } {
  if (input.miles !== undefined && input.miles > 0) {
    const perHour = PACE_SPEED[input.pace].milesPerHour * (input.terrain === "difficult" ? 0.5 : 1) * (input.weatherFactor ?? 1);
    const minutes = Math.ceil((input.miles / perHour) * 60);
    if (minutes > 24 * 60) {
      return {
        error: `${input.miles} miles at a ${input.pace} pace takes ${Math.ceil(minutes / 60)} hours, more than one day's leg. Travel it a day at a time: call travel once per day (8 hours is a normal day; more is a forced march).`,
      };
    }
    return { hours: Math.ceil(minutes / 60), minutes, miles: input.miles };
  }
  if (input.hours === undefined) {
    return { error: "travel needs the hours travelled or the miles to cover." };
  }
  return { hours: input.hours, minutes: input.hours * 60, miles: milesCovered({ ...input, hours: input.hours }) };
}
