// The in-world calendar and clock: what a moment is, how it reads, and what
// moves it.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  advance,
  breakDown,
  CALENDAR_PRESETS,
  DAYCOUNT_CALENDAR,
  calendarPreset,
  dayPart,
  daysBetween,
  daysPerYear,
  defaultClock,
  describeDuration,
  describeInstant,
  formatClock,
  GENERIC_CALENDAR,
  HOURS_PER_DAY,
  isDark,
  MAX_ADVANCE_DAYS,
  MINUTES_PER_DAY,
  normalizeClock,
  restMinutes,
  SEASONS_CALENDAR,
  seasonOf,
  toInstant,
} = await import("../src/lib/dm/calendar.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a generic year is twelve thirty-day months", () => {
  assert.equal(daysPerYear(GENERIC_CALENDAR), 360);
  assert.equal(GENERIC_CALENDAR.months.length, 12);
});

test("every preset is reachable by id, and an unknown one falls back", () => {
  for (const preset of CALENDAR_PRESETS) {
    assert.equal(calendarPreset(preset.id).id, preset.id);
  }
  assert.equal(calendarPreset("nonsense").id, SEASONS_CALENDAR.id);
});

test("an instant and a date are inverses", () => {
  const instant = toInstant(GENERIC_CALENDAR, { year: 1, month: 3, day: 12, hour: 14, minute: 30 });
  const date = breakDown(GENERIC_CALENDAR, instant);
  assert.equal(date.year, 1);
  assert.equal(date.month, 3);
  assert.equal(date.day, 12);
  assert.equal(date.hour, 14);
  assert.equal(date.minute, 30);
});

test("a year rolls over into the next", () => {
  const lastDay = toInstant(GENERIC_CALENDAR, { year: 1, month: 12, day: 30, hour: 23 });
  const nextDay = lastDay + MINUTES_PER_DAY;
  const date = breakDown(GENERIC_CALENDAR, nextDay);
  assert.equal(date.year, 2);
  assert.equal(date.month, 1);
  assert.equal(date.day, 1);
});

test("out-of-range dates clamp rather than being refused", () => {
  // A person typing day 45 of a 30-day month meant the end of it.
  const date = breakDown(GENERIC_CALENDAR, toInstant(GENERIC_CALENDAR, { month: 1, day: 45 }));
  assert.equal(date.day, 30);
});

test("a one-month calendar still works", () => {
  assert.equal(daysPerYear(DAYCOUNT_CALENDAR), 100);
  const date = breakDown(DAYCOUNT_CALENDAR, toInstant(DAYCOUNT_CALENDAR, { day: 47 }));
  assert.equal(date.day, 47);
  assert.match(describeInstant(DAYCOUNT_CALENDAR, toInstant(DAYCOUNT_CALENDAR, { day: 47 })), /Day 47/);
});

test("the time of day is named the way a table would say it", () => {
  assert.equal(dayPart(2), "deep night");
  assert.equal(dayPart(9), "morning");
  assert.equal(dayPart(12), "midday");
  assert.equal(dayPart(19), "evening");
  assert.equal(dayPart(23), "night");
  // Wraps rather than throwing on an out-of-range hour.
  assert.equal(dayPart(HOURS_PER_DAY + 9), "morning");
});

test("darkness is what darkvision and stealth ask about", () => {
  assert.equal(isDark(2), true);
  assert.equal(isDark(12), false);
  assert.equal(isDark(22), true);
});

test("seasons divide the year, whatever its month count", () => {
  assert.equal(seasonOf(GENERIC_CALENDAR, 1), "winter");
  assert.equal(seasonOf(GENERIC_CALENDAR, 12), "autumn");
  // A calendar with too few months to have seasons says so honestly.
  assert.equal(seasonOf(DAYCOUNT_CALENDAR, 1), "summer");
});

test("the clock reads as a clock", () => {
  assert.equal(formatClock({ hour: 9, minute: 5 }), "09:05");
  assert.equal(formatClock({ hour: 14, minute: 30 }), "14:30");
});

test("time moves forward only", () => {
  const moved = advance(0, 3, "hours");
  assert.equal(moved.minutes, 180);
  assert.ok("error" in advance(0, 0, "hours"));
  assert.ok("error" in advance(0, -5, "days"));
});

test("a single advance is capped at a year", () => {
  assert.ok("error" in advance(0, MAX_ADVANCE_DAYS + 1, "days"));
  assert.ok(!("error" in advance(0, MAX_ADVANCE_DAYS, "days")));
});

test("rest length follows the variant, which is what the setting was for", () => {
  assert.equal(restMinutes("short", "standard"), 60);
  assert.equal(restMinutes("long", "standard"), 480);
  assert.equal(restMinutes("short", "gritty"), MINUTES_PER_DAY);
  assert.equal(restMinutes("long", "gritty"), MINUTES_PER_DAY * 7);
  assert.equal(restMinutes("short", "heroic"), 5);
  assert.equal(restMinutes("long", "heroic"), 60);
});

test("whole days between two moments, floored", () => {
  assert.equal(daysBetween(0, MINUTES_PER_DAY * 3), 3);
  assert.equal(daysBetween(0, MINUTES_PER_DAY * 3 - 1), 2);
});

test("a duration reads in the largest honest unit", () => {
  assert.equal(describeDuration(MINUTES_PER_DAY * 7), "1 week");
  assert.equal(describeDuration(MINUTES_PER_DAY * 3), "3 days");
  assert.equal(describeDuration(120), "2 hours");
  assert.equal(describeDuration(5), "5 minutes");
  assert.equal(describeDuration(90), "90 minutes");
});

test("an unreadable stored clock falls back rather than throwing", () => {
  assert.deepEqual(normalizeClock(null).calendar.id, defaultClock().calendar.id);
  assert.deepEqual(normalizeClock("nonsense").calendar.id, defaultClock().calendar.id);
  assert.equal(normalizeClock({ instant: -50 }).instant, 0);
});

test("a custom calendar survives a round trip", () => {
  const clock = normalizeClock({
    calendar: {
      id: "mine",
      name: "Mine",
      months: [{ name: "Ash", days: 40 }, { name: "Ember", days: 40 }],
      weekdays: ["One", "Two"],
      yearSuffix: "AF",
      epochYear: 700,
    },
    instant: 5000,
  });
  assert.equal(clock.calendar.months.length, 2);
  assert.equal(daysPerYear(clock.calendar), 80);
  assert.match(describeInstant(clock.calendar, clock.instant), /AF/);
});

test("the seasonal calendar's month names agree with its seasons", () => {
  // The names are the whole point of the preset, so a month called Greening
  // landing in winter is a bug a player would notice before any of us.
  const expected = {
    Deepwinter: "winter", Frostmoon: "winter", Thaw: "winter",
    Greening: "spring", Bloom: "spring", Seedfall: "spring",
    Highsun: "summer", Longlight: "summer", Firstharvest: "summer",
    Goldfall: "autumn", Leafturn: "autumn", Yearsend: "autumn",
  };
  SEASONS_CALENDAR.months.forEach((month, index) => {
    assert.equal(
      seasonOf(SEASONS_CALENDAR, index + 1),
      expected[month.name],
      `${month.name} should be ${expected[month.name]}`,
    );
  });
});

test("the seasonal year is 365 days", () => {
  assert.equal(daysPerYear(SEASONS_CALENDAR), 365);
});

test("a fresh campaign starts on a spring morning", () => {
  const clock = defaultClock();
  const date = breakDown(clock.calendar, clock.instant);
  assert.equal(date.monthName, "Greening");
  assert.equal(seasonOf(clock.calendar, date.month), "spring");
  assert.equal(dayPart(date.hour), "morning");
});

console.log(`calendar: ${passed} tests passed`);
