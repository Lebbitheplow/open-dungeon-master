import type { Calendar, Entry, FieldDef, FieldValue, WorldEvent, WorldType, YearValue } from "./model.ts";
import { compareNames } from "../language/text-logic.ts";

// Years across a world's calendars, after WorldForge's years and fields
// modules (by Smoebo). A calendar is a reckoning, "Tide Reckoning, TR", with
// an offset that places its year 0 on one shared line: absolute year =
// calendar year + offset. So an event dated in one reckoning reads in every
// other one for free, and a character's birth year gives their age at any
// event. Pure.

// A year written as free text ("342 AE", "-1200") still sorts by its number.
export function parseYear(text: string): number {
  const match = text.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : Infinity;
}

// Where a year falls on the shared line, or Infinity when it says nothing.
export function absoluteYear(when: YearValue, calendars: Calendar[]): number {
  if (when.yearNum !== null) {
    const calendar = calendars.find((entry) => entry.id === when.calendarId);
    return when.yearNum + (calendar?.epochOffset ?? 0);
  }
  return when.year ? parseYear(when.year) : Infinity;
}

export function yearSet(when: YearValue | undefined): when is YearValue {
  return Boolean(when) && (when!.yearNum !== null || Boolean(when!.year));
}

// "61 TR", with the same moment in every other calendar: "= 1301 AF".
export function formatYear(when: YearValue, calendars: Calendar[]): { primary: string; conversions: string } {
  const calendar = calendars.find((entry) => entry.id === when.calendarId);
  const primary =
    when.yearNum === null ? when.year : calendar?.abbrev ? `${when.yearNum} ${calendar.abbrev}` : String(when.yearNum);
  const absolute = absoluteYear(when, calendars);
  if (!Number.isFinite(absolute)) {
    return { primary, conversions: "" };
  }
  const others = calendars
    .filter((entry) => entry.id !== when.calendarId)
    .map((entry) => (entry.abbrev ? `${absolute - entry.epochOffset} ${entry.abbrev}` : String(absolute - entry.epochOffset)));
  return { primary, conversions: others.length ? `= ${others.join(" · ")}` : "" };
}

export function sortEvents(events: WorldEvent[], calendars: Calendar[]): WorldEvent[] {
  return [...events].sort((a, b) => {
    const ya = absoluteYear(a.when, calendars);
    const yb = absoluteYear(b.when, calendars);
    if (ya !== yb) return ya === Infinity ? 1 : yb === Infinity ? -1 : ya - yb;
    return compareNames(a.title, b.title) || a.id.localeCompare(b.id);
  });
}

// ---- fields ----

export function hasFieldValue(def: FieldDef, value: FieldValue | undefined): boolean {
  if (value === undefined || value === "") return false;
  if (def.kind === "year") return typeof value === "object" && yearSet(value);
  return typeof value === "string" || typeof value === "number";
}

export function formatField(def: FieldDef, value: FieldValue | undefined, calendars: Calendar[]): string {
  if (!hasFieldValue(def, value)) return "";
  if (def.kind === "year") {
    const shown = formatYear(value as YearValue, calendars);
    return shown.conversions ? `${shown.primary} ${shown.conversions}` : shown.primary;
  }
  return String(value);
}

// The fields of an entry's type that print, in the type's order; the
// author-only ones left out unless asked for.
export function fieldLines(type: WorldType, entry: Entry, calendars: Calendar[], withAuthorOnly: boolean) {
  return type.fields
    .filter((def) => withAuthorOnly || !def.authorOnly)
    .map((def) => ({ def, text: formatField(def, entry.fields[def.id], calendars) }))
    .filter((line) => line.text);
}

// Birth and death from the year fields marked with those roles.
export function lifespan(type: WorldType, entry: Entry, calendars: Calendar[]): { birth: number | null; death: number | null } {
  const at = (role: "birth" | "death") => {
    const def = type.fields.find((field) => field.kind === "year" && field.role === role);
    const value = def ? entry.fields[def.id] : undefined;
    if (!def || !hasFieldValue(def, value)) return null;
    const year = absoluteYear(value as YearValue, calendars);
    return Number.isFinite(year) ? year : null;
  };
  return { birth: at("birth"), death: at("death") };
}

// "12 years before their birth": an event that names someone outside their
// own life, which is either a mistake or a ghost story.
export function lifespanIssue(span: { birth: number | null; death: number | null }, year: number): string {
  if (!Number.isFinite(year)) return "";
  const years = (count: number) => `${count} year${count === 1 ? "" : "s"}`;
  if (span.birth !== null && year < span.birth) return `${years(span.birth - year)} before their birth`;
  if (span.death !== null && year > span.death) return `${years(year - span.death)} after their death`;
  return "";
}

export function ageAt(span: { birth: number | null; death: number | null }, year: number): number | null {
  return span.birth === null || !Number.isFinite(year) || lifespanIssue(span, year) ? null : year - span.birth;
}

// "61 TR to 118 TR (57 years)", "born 61 TR", "died 118 TR".
export function formatLifespan(type: WorldType, entry: Entry, calendars: Calendar[]): string {
  const span = lifespan(type, entry, calendars);
  const shown = (role: "birth" | "death") => {
    const def = type.fields.find((field) => field.kind === "year" && field.role === role);
    return def ? formatYear(entry.fields[def.id] as YearValue, calendars).primary : "";
  };
  if (span.birth !== null && span.death !== null) {
    const length = span.death - span.birth;
    return `${shown("birth")} to ${shown("death")} (${length < 0 ? "dies before being born" : `${length} year${length === 1 ? "" : "s"}`})`;
  }
  if (span.birth !== null) return `born ${shown("birth")}`;
  if (span.death !== null) return `died ${shown("death")}`;
  return "";
}
