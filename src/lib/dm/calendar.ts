// The in-world calendar and clock.
//
// There was no date anywhere in src/lib. `srd/travel.ts` counts hours inside
// a day and throws them away at the end of it, spell durations measured in
// days had nothing to count against, the gritty and heroic rest variants
// already in `variantRules` had no way to say a week had passed, and the
// world simulation ticked on chapters rather than on time. This is the clock
// all of that hangs on.
//
// Shaped after dnd5e's data/calendar/: a generic model plus optional
// presets, rather than a hard-coded Gregorian year. A campaign picks a preset
// or writes its own months, and everything downstream asks this module rather
// than doing arithmetic on a Date.
//
// Pure by design: no imports at all, so scripts/test-calendar.mjs can load it
// and the client can render a date without a request.

export type CalendarMonth = {
  name: string;
  days: number;
};

export type CalendarDefinition = {
  id: string;
  name: string;
  months: CalendarMonth[];
  // Names of the days in a week, in order. An empty list means the setting
  // does not name its days, and nothing will show a weekday.
  weekdays: string[];
  // What the year is called after the number: "DR", "After the Fall".
  yearSuffix: string;
  // The year the campaign starts in when nothing else says.
  epochYear: number;
};

export const HOURS_PER_DAY = 24;
export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR;

// A moment, stored as whole minutes since the start of day 1 of the epoch
// year. One integer rather than a record of fields, because every operation
// worth having (add an hour, add eight days, compare two moments, ask how
// long since) is arithmetic on it, and a record would need normalizing after
// every one of them.
export type Instant = number;

// The generic calendar: twelve thirty-day months, which is the shape most
// fantasy settings use and the one that makes "a month" mean something
// consistent. Nothing depends on the names, so a table can replace them
// without touching a line of logic.
export const GENERIC_CALENDAR: CalendarDefinition = {
  id: "generic",
  name: "Twelve months",
  months: [
    { name: "First Month", days: 30 },
    { name: "Second Month", days: 30 },
    { name: "Third Month", days: 30 },
    { name: "Fourth Month", days: 30 },
    { name: "Fifth Month", days: 30 },
    { name: "Sixth Month", days: 30 },
    { name: "Seventh Month", days: 30 },
    { name: "Eighth Month", days: 30 },
    { name: "Ninth Month", days: 30 },
    { name: "Tenth Month", days: 30 },
    { name: "Eleventh Month", days: 30 },
    { name: "Twelfth Month", days: 30 },
  ],
  weekdays: [],
  yearSuffix: "",
  epochYear: 1,
};

// A seasonal calendar for the default high-fantasy setting, and the one a
// table gets if they never open the setting at all. Named for weather rather
// than for gods, so it fits any world without importing anyone's pantheon.
export const SEASONS_CALENDAR: CalendarDefinition = {
  id: "seasons",
  name: "The turning year",
  // Ordered so the names agree with seasonOf, which divides the year into
  // quarters: months 1 to 3 are winter, 4 to 6 spring, 7 to 9 summer, 10 to
  // 12 autumn. The year begins at midwinter, which is what "Yearsend" in the
  // twelfth slot implies. 365 days, so a year is the length a player expects.
  months: [
    { name: "Deepwinter", days: 31 },
    { name: "Frostmoon", days: 30 },
    { name: "Thaw", days: 31 },
    { name: "Greening", days: 30 },
    { name: "Bloom", days: 31 },
    { name: "Seedfall", days: 30 },
    { name: "Highsun", days: 31 },
    { name: "Longlight", days: 31 },
    { name: "Firstharvest", days: 30 },
    { name: "Goldfall", days: 30 },
    { name: "Leafturn", days: 30 },
    { name: "Yearsend", days: 30 },
  ],
  weekdays: ["Firstday", "Seconday", "Midday", "Fourthday", "Fifthday", "Restday"],
  yearSuffix: "",
  epochYear: 1,
};

// A short, dateless calendar for tables that count sessions rather than
// dates: one month of a hundred days, so "day 47" is the whole answer.
export const DAYCOUNT_CALENDAR: CalendarDefinition = {
  id: "daycount",
  name: "Just count the days",
  months: [{ name: "Day", days: 100 }],
  weekdays: [],
  yearSuffix: "",
  epochYear: 1,
};

export const CALENDAR_PRESETS: CalendarDefinition[] = [
  SEASONS_CALENDAR,
  GENERIC_CALENDAR,
  DAYCOUNT_CALENDAR,
];

export function calendarPreset(id: string): CalendarDefinition {
  return CALENDAR_PRESETS.find((preset) => preset.id === id) ?? SEASONS_CALENDAR;
}

export function daysPerYear(calendar: CalendarDefinition): number {
  return calendar.months.reduce((total, month) => total + Math.max(1, month.days), 0);
}

export type CalendarDate = {
  year: number;
  // 1-based, so it reads the way a person says it.
  month: number;
  monthName: string;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
};

// Instants are never negative: a campaign cannot run before its own epoch,
// and a negative one would render as a year before year one.
export function clampInstant(value: number): Instant {
  return Math.max(0, Math.round(value));
}

export function breakDown(calendar: CalendarDefinition, instant: Instant): CalendarDate {
  const total = clampInstant(instant);
  const minuteOfDay = total % MINUTES_PER_DAY;
  let dayIndex = Math.floor(total / MINUTES_PER_DAY);

  const yearLength = daysPerYear(calendar);
  const year = calendar.epochYear + Math.floor(dayIndex / yearLength);
  dayIndex %= yearLength;

  let month = 0;
  while (month < calendar.months.length - 1 && dayIndex >= calendar.months[month].days) {
    dayIndex -= calendar.months[month].days;
    month += 1;
  }

  const weekday = calendar.weekdays.length
    ? calendar.weekdays[Math.floor(clampInstant(instant) / MINUTES_PER_DAY) % calendar.weekdays.length]
    : "";

  return {
    year,
    month: month + 1,
    monthName: calendar.months[month]?.name ?? "Day",
    day: dayIndex + 1,
    weekday,
    hour: Math.floor(minuteOfDay / MINUTES_PER_HOUR),
    minute: minuteOfDay % MINUTES_PER_HOUR,
  };
}

// The inverse, for a DM setting the date by hand. Out-of-range months and
// days are clamped rather than rejected: a person typing "day 45 of a
// 30-day month" meant the end of it.
export function toInstant(
  calendar: CalendarDefinition,
  input: { year?: number; month?: number; day?: number; hour?: number; minute?: number },
): Instant {
  const yearLength = daysPerYear(calendar);
  const year = Math.max(calendar.epochYear, Math.round(input.year ?? calendar.epochYear));
  const month = Math.min(calendar.months.length, Math.max(1, Math.round(input.month ?? 1)));
  const monthDays = calendar.months[month - 1]?.days ?? 30;
  const day = Math.min(monthDays, Math.max(1, Math.round(input.day ?? 1)));
  const hour = Math.min(HOURS_PER_DAY - 1, Math.max(0, Math.round(input.hour ?? 0)));
  const minute = Math.min(MINUTES_PER_HOUR - 1, Math.max(0, Math.round(input.minute ?? 0)));

  const daysBeforeMonth = calendar.months
    .slice(0, month - 1)
    .reduce((total, entry) => total + entry.days, 0);
  const dayIndex = (year - calendar.epochYear) * yearLength + daysBeforeMonth + (day - 1);
  return dayIndex * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR + minute;
}

// ---- reading the clock ----

// The parts of the day the world reacts to: light, who is awake, whether an
// inn will serve. Deliberately coarse, because the model narrates from this
// and "it is 14:37" is not a thing anyone says at a table.
export const DAY_PARTS = [
  "deep night",
  "before dawn",
  "morning",
  "midday",
  "afternoon",
  "evening",
  "night",
] as const;
export type DayPart = (typeof DAY_PARTS)[number];

export function dayPart(hour: number): DayPart {
  const value = ((Math.round(hour) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY;
  if (value < 4) return "deep night";
  if (value < 6) return "before dawn";
  if (value < 11) return "morning";
  if (value < 14) return "midday";
  if (value < 17) return "afternoon";
  if (value < 21) return "evening";
  return "night";
}

// True when the sun is down, which is what darkvision, stealth and half the
// wandering-monster tables actually want to know.
export function isDark(hour: number): boolean {
  const part = dayPart(hour);
  return part === "deep night" || part === "before dawn" || part === "night";
}

export const SEASONS = ["winter", "spring", "summer", "autumn"] as const;
export type Season = (typeof SEASONS)[number];

// Which quarter of the year the month falls in. Works for any calendar
// because it divides by the month count rather than assuming twelve, and a
// one-month calendar is always "summer", which is the honest answer for a
// setting that has declined to have seasons.
export function seasonOf(calendar: CalendarDefinition, month: number): Season {
  const count = Math.max(1, calendar.months.length);
  if (count < 4) {
    return "summer";
  }
  const index = Math.floor(((month - 1) / count) * 4);
  return SEASONS[Math.min(3, Math.max(0, index))];
}

export function formatClock(date: CalendarDate): string {
  return `${String(date.hour).padStart(2, "0")}:${String(date.minute).padStart(2, "0")}`;
}

// "Bloom 12, year 1 (14:30)". The weekday leads when the setting names its
// days, because that is how a person at that table would say it.
export function formatDate(calendar: CalendarDefinition, instant: Instant): string {
  const date = breakDown(calendar, instant);
  const weekday = date.weekday ? `${date.weekday}, ` : "";
  const suffix = calendar.yearSuffix ? ` ${calendar.yearSuffix}` : "";
  if (calendar.months.length === 1) {
    return `${weekday}Day ${date.day}, year ${date.year}${suffix} (${formatClock(date)})`;
  }
  return `${weekday}${date.monthName} ${date.day}, year ${date.year}${suffix} (${formatClock(date)})`;
}

// One line for the DM prompt and the party's status bar. Says the time of
// day in words as well as numbers, because the model narrates from the words.
export function describeInstant(calendar: CalendarDefinition, instant: Instant): string {
  const date = breakDown(calendar, instant);
  return `${formatDate(calendar, instant)}, ${dayPart(date.hour)}, ${seasonOf(calendar, date.month)}`;
}

// ---- moving the clock ----

export const ADVANCE_UNITS = ["minutes", "hours", "days", "weeks"] as const;
export type AdvanceUnit = (typeof ADVANCE_UNITS)[number];

const UNIT_MINUTES: Record<AdvanceUnit, number> = {
  minutes: 1,
  hours: MINUTES_PER_HOUR,
  days: MINUTES_PER_DAY,
  weeks: MINUTES_PER_DAY * 7,
};

// A single advance is capped at a year. Time moves forward only: an in-world
// clock that could run backwards would let a spell duration or a rest cadence
// be undone by arithmetic rather than by the audit trail, which is where
// undoing belongs.
export const MAX_ADVANCE_DAYS = 365;

export function advance(
  instant: Instant,
  amount: number,
  unit: AdvanceUnit,
): { instant: Instant; minutes: number } | { error: string } {
  const value = Math.round(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return { error: "Time moves forward; say how much." };
  }
  const minutes = value * UNIT_MINUTES[unit];
  if (minutes > MAX_ADVANCE_DAYS * MINUTES_PER_DAY) {
    return { error: `That is more than ${MAX_ADVANCE_DAYS} days; advance it in stages.` };
  }
  return { instant: clampInstant(instant) + minutes, minutes };
}

// How long a rest takes under each variant (DMG p.267). The clock is the
// reason these settings can now mean anything: before it, "gritty realism"
// was a line in the prompt and nothing counted the week.
export function restMinutes(
  kind: "short" | "long",
  variant: "standard" | "gritty" | "heroic",
): number {
  if (variant === "gritty") {
    return kind === "short" ? MINUTES_PER_DAY * 1 : MINUTES_PER_DAY * 7;
  }
  if (variant === "heroic") {
    // Heroic: a short rest is five minutes and a long rest is an hour.
    return kind === "short" ? 5 : MINUTES_PER_HOUR;
  }
  return kind === "short" ? MINUTES_PER_HOUR : MINUTES_PER_HOUR * 8;
}

// Whole days between two moments, which is the unit spell durations, disease
// and downtime are written in. Floors, so "a day later" means the clock has
// actually gone round.
export function daysBetween(from: Instant, to: Instant): number {
  return Math.floor((clampInstant(to) - clampInstant(from)) / MINUTES_PER_DAY);
}

// "3 days", "4 hours", "20 minutes". Chooses the largest unit that is not a
// lie, so a rest of exactly a week reads as a week.
export function describeDuration(minutes: number): string {
  const value = Math.max(0, Math.round(minutes));
  if (value >= MINUTES_PER_DAY * 7 && value % (MINUTES_PER_DAY * 7) === 0) {
    const weeks = value / (MINUTES_PER_DAY * 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  if (value >= MINUTES_PER_DAY && value % MINUTES_PER_DAY === 0) {
    const days = value / MINUTES_PER_DAY;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (value >= MINUTES_PER_HOUR && value % MINUTES_PER_HOUR === 0) {
    const hours = value / MINUTES_PER_HOUR;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${value} ${value === 1 ? "minute" : "minutes"}`;
}

// What a campaign stores. The definition rides alongside the instant so a
// table that writes its own months keeps them, and a preset that is later
// renamed does not silently move every date the campaign ever recorded.
export type CampaignClock = {
  calendar: CalendarDefinition;
  instant: Instant;
};

export function defaultClock(): CampaignClock {
  // Greening, the first month of spring, at eight in the morning: a campaign
  // that never sets its own date starts on a bright day at the turn of the
  // year rather than in the dark.
  return { calendar: SEASONS_CALENDAR, instant: toInstant(SEASONS_CALENDAR, { month: 4, day: 1, hour: 8 }) };
}

// Anything unreadable falls back to the default clock rather than throwing:
// a broken date should cost a campaign its calendar, not its session.
export function normalizeClock(raw: unknown): CampaignClock {
  if (!raw || typeof raw !== "object") {
    return defaultClock();
  }
  const record = raw as Record<string, unknown>;
  const calendarRaw = record.calendar as Record<string, unknown> | undefined;
  const months = Array.isArray(calendarRaw?.months)
    ? (calendarRaw.months as Array<Record<string, unknown>>)
        .map((month) => ({
          name: String(month?.name ?? "Month").slice(0, 40),
          days: Math.min(400, Math.max(1, Math.round(Number(month?.days) || 30))),
        }))
        .slice(0, 24)
    : [];
  const calendar: CalendarDefinition = months.length
    ? {
        id: String(calendarRaw?.id ?? "custom").slice(0, 40),
        name: String(calendarRaw?.name ?? "Custom").slice(0, 60),
        months,
        weekdays: Array.isArray(calendarRaw?.weekdays)
          ? (calendarRaw.weekdays as unknown[]).slice(0, 12).map((day) => String(day).slice(0, 30))
          : [],
        yearSuffix: String(calendarRaw?.yearSuffix ?? "").slice(0, 20),
        epochYear: Math.round(Number(calendarRaw?.epochYear) || 1),
      }
    : defaultClock().calendar;
  return { calendar, instant: clampInstant(Number(record.instant) || 0) };
}
