// What the campaign clock keeps for life between adventures and for the
// afflictions that run on it: each character's lifestyle, their downtime
// progress, and their diseases, madness and lingering poisons. All three
// live on the clock beside the supplies counts (src/lib/dm/calendar.ts
// normalizeClock), because the clock is what moves them: a day of downtime,
// a long rest, an onset hour. Every field is optional and bounded; a clock
// written before them reads as nobody living anywhere and nobody afflicted.

export const LIFESTYLES = ["wretched", "squalid", "poor", "modest", "comfortable", "wealthy", "aristocratic"] as const;
export type Lifestyle = (typeof LIFESTYLES)[number];

export type DowntimeProgress = {
  crafting?: { item: string; valueCp: number; progressCp: number; tool: string };
  training?: { subject: string; kind: "language" | "tool"; days: number };
  recuperating?: { days: number };
  research?: { topic: string; days: number };
};

export type AfflictionKind = "disease" | "madness" | "poison";

export type Affliction = {
  kind: AfflictionKind;
  // The disease id, the madness kind (short, long, indefinite) or the
  // poison id.
  id: string;
  // The conditions it keeps on the sheet; empty while a disease incubates.
  conditions: string[];
  // A disease's symptoms show at this instant.
  onsetAt?: number;
  // A long-term madness or a timed poison ends at this instant.
  endsAt?: number;
  // The next time a repeated save is due (Pale Tincture), or the midnight a
  // poison waits for (Midnight Tears).
  nextAt?: number;
  // Cackle fever's current DC and its failed rest saves; a poison's
  // successes toward its end; sight rot's penalty and its ointment doses.
  dc?: number;
  fails?: number;
  successes?: number;
  penalty?: number;
  doses?: number;
  // An indefinite madness's flaw, for the narrator.
  flaw?: string;
};

export type BetweenState = {
  lifestyles?: Record<string, Lifestyle>;
  downtime?: Record<string, DowntimeProgress>;
  afflictions?: Record<string, Affliction[]>;
};

const id = (value: string) => value.length > 0 && value.length <= 80;
const num = (value: unknown, max: number) => Math.min(max, Math.max(0, Math.round(Number(value) || 0)));
const text = (value: unknown, max: number) => String(value ?? "").slice(0, max);
const INSTANT_MAX = 1e12;

function normalizeAffliction(raw: unknown): Affliction | null {
  const entry = raw as Record<string, unknown> | null;
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const kind = ["disease", "madness", "poison"].includes(String(entry.kind)) ? (entry.kind as AfflictionKind) : null;
  if (!kind || typeof entry.id !== "string" || !entry.id) {
    return null;
  }
  const conditions = Array.isArray(entry.conditions)
    ? entry.conditions.filter((name): name is string => typeof name === "string" && name.length <= 40).slice(0, 4)
    : [];
  const optional = (key: keyof Affliction, max: number) =>
    entry[key] === undefined || entry[key] === null ? {} : { [key]: num(entry[key], max) };
  return {
    kind,
    id: text(entry.id, 40),
    conditions,
    ...optional("onsetAt", INSTANT_MAX),
    ...optional("endsAt", INSTANT_MAX),
    ...optional("nextAt", INSTANT_MAX),
    ...optional("dc", 40),
    ...optional("fails", 10),
    ...optional("successes", 10),
    ...optional("penalty", 5),
    ...optional("doses", 10),
    ...(typeof entry.flaw === "string" ? { flaw: text(entry.flaw, 200) } : {}),
  };
}

export function normalizeBetween(record: Record<string, unknown>): BetweenState {
  const out: BetweenState = {};
  if (record.lifestyles && typeof record.lifestyles === "object") {
    const entries = Object.entries(record.lifestyles as Record<string, unknown>)
      .filter(([key, value]) => id(key) && (LIFESTYLES as readonly string[]).includes(String(value)))
      .slice(0, 50) as Array<[string, Lifestyle]>;
    if (entries.length) {
      out.lifestyles = Object.fromEntries(entries);
    }
  }
  if (record.downtime && typeof record.downtime === "object") {
    const entries = Object.entries(record.downtime as Record<string, Record<string, Record<string, unknown>>>)
      .filter(([key, value]) => id(key) && value && typeof value === "object")
      .slice(0, 50)
      .map(([key, value]): [string, DowntimeProgress] => {
        const progress: DowntimeProgress = {};
        if (value.crafting && typeof value.crafting.item === "string") {
          progress.crafting = {
            item: text(value.crafting.item, 80),
            valueCp: num(value.crafting.valueCp, 1e9),
            progressCp: num(value.crafting.progressCp, 1e9),
            tool: text(value.crafting.tool, 60),
          };
        }
        if (value.training && typeof value.training.subject === "string") {
          progress.training = {
            subject: text(value.training.subject, 60),
            kind: value.training.kind === "tool" ? "tool" : "language",
            days: num(value.training.days, 1000),
          };
        }
        if (value.recuperating) {
          progress.recuperating = { days: num(value.recuperating.days, 1000) };
        }
        if (value.research && typeof value.research.topic === "string") {
          progress.research = { topic: text(value.research.topic, 120), days: num(value.research.days, 10000) };
        }
        return [key, progress];
      })
      .filter(([, progress]) => Object.keys(progress).length);
    if (entries.length) {
      out.downtime = Object.fromEntries(entries);
    }
  }
  if (record.afflictions && typeof record.afflictions === "object") {
    const entries = Object.entries(record.afflictions as Record<string, unknown>)
      .filter(([key, value]) => id(key) && Array.isArray(value))
      .slice(0, 50)
      .map(([key, value]): [string, Affliction[]] => [
        key,
        (value as unknown[]).map(normalizeAffliction).filter((entry): entry is Affliction => Boolean(entry)).slice(0, 12),
      ])
      .filter(([, list]) => list.length);
    if (entries.length) {
      out.afflictions = Object.fromEntries(entries);
    }
  }
  return out;
}
