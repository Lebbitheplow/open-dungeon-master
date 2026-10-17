import { LIMITS, newId, type Entry, type Origin, type WorldDoc, type YearValue } from "./model";
import { textKey } from "../language/text-logic";

// A world brought in again: a WorldForge file imported a second time, or a
// workshop copied into a campaign again. Audit findings WF-03 and WF-04.
//
// Every row and entry an import brings remembers where it came from and how
// each of its values read, in the document's `origins` (model.ts). The next
// import of the same source compares three readings of each value: the one
// it brought last time, the one here now, and the one it brings now.
//
//   - nobody changed it here: the source's new reading is taken;
//   - the source did not change it: the local edit stands;
//   - both changed it: the local edit stands, and the clash is reported;
//   - a value here that was never imported: a blank one is filled, a
//     written one stands and the difference is reported.
//
// Identity is the source's, not the id's: two worlds that both call a
// calendar "cal_1" keep two calendars, and every reference to one (an
// event's date, a year field, a pin's map, a folder's parent) is moved to
// the id it was given here. Pure: the callers read and write the document.

export const IMPORT_SLICES = ["folders", "calendars", "events", "secrets", "stubs", "maps", "pins"] as const;
export type ImportSlice = (typeof IMPORT_SLICES)[number];
type Row = { id: string } & Record<string, unknown>;

const PREFIX: Record<ImportSlice, string> = { folders: "fo", calendars: "cal", events: "ev", secrets: "sec", stubs: "stub", maps: "map", pins: "pin" };
const SLICE_WORDS: Record<ImportSlice, string> = { folders: "Folder", calendars: "Calendar", events: "Event", secrets: "Secret", stubs: "Name to write", maps: "Map", pins: "Pin" };
const VALUE_WORDS: Record<string, string> = {
  name: "name",
  title: "title",
  body: "text",
  text: "text",
  tagline: "line",
  notes: "notes",
  note: "note",
  article: "article",
  hiddenTruth: "hidden truth",
  canon: "canon setting",
  typeId: "type",
  folderId: "folder",
  parentId: "parent folder",
  aliases: "other names",
  tags: "tags",
  portrait: "picture",
  image: "picture",
  knownBy: "list of who knows it",
  partyKnows: "setting for whether the party knows it",
  subject: "subject",
  when: "date",
  refs: "list of who and what it involves",
  era: "era",
  regions: "regions",
  x: "position",
  y: "position",
  mapId: "map",
  linkedMapId: "linked map",
  ref: "marked entry",
  status: "status",
  abbrev: "abbreviation",
  epochOffset: "start year",
  color: "colour",
  source: "origin",
  dmOnly: "setting for whether only the DM sees it",
};
// What a value is called in a report. A type field by its name when known.
export const valueWords = (key: string, fieldName?: (id: string) => string | undefined) =>
  key.startsWith("fields.") ? `“${fieldName?.(key.slice("fields.".length)) ?? key.slice("fields.".length)}” field` : VALUE_WORDS[key] ?? key;

// ---- values ----

function stable(value: unknown): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "";
}

// The reading of a value, short. Blank values (nothing, "", an empty list)
// all read as EMPTY, so filling a blank is never mistaken for an edit.
export const EMPTY = "0";
export function hashOf(value: unknown): string {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return EMPTY;
  const text = stable(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(36)}${text.length.toString(36)}`;
}

export type Decision = "same" | "take" | "keep" | "clash";

// `baseline` is "<source reading>.<local reading>" as of the last import
// that settled this value, or undefined when it never came from this one.
export function decide(baseline: string | undefined, local: string, theirs: string): Decision {
  if (local === theirs) return "same";
  if (baseline === undefined) return local === EMPTY ? "take" : "clash";
  const [source, was] = baseline.split(".");
  if (theirs === source) return "keep";
  if (local === was) return "take";
  return "clash";
}

// One record's values merged. `take` holds the source values to write;
// `clashes` the keys both sides changed. Each taken key is left `pending`:
// its local reading is known only once the caller has written it.
export function mergeValues(
  prior: Origin | undefined,
  local: Record<string, unknown>,
  theirs: Record<string, unknown>,
): { take: Record<string, unknown>; clashes: string[]; at: Record<string, string>; pending: Array<{ key: string; source: string }> } {
  const take: Record<string, unknown> = {};
  const clashes: string[] = [];
  const at: Record<string, string> = { ...(prior?.at ?? {}) };
  const pending: Array<{ key: string; source: string }> = [];
  for (const key of new Set([...Object.keys(local), ...Object.keys(theirs)])) {
    const l = hashOf(local[key]);
    const t = hashOf(theirs[key]);
    const verdict = decide(prior?.at[key], l, t);
    if (verdict === "same") at[key] = `${t}.${l}`;
    else if (verdict === "take") {
      take[key] = theirs[key];
      pending.push({ key, source: t });
    } else if (verdict === "clash") {
      clashes.push(key);
      // Reported once per change at the source: the local reading it was
      // last settled at stays, so the edit here still counts as an edit.
      at[key] = `${t}.${prior?.at[key]?.split(".")[1] ?? ""}`;
    }
  }
  return { take, clashes, at, pending };
}

// What an import brought as first readings: source and local alike.
export function firstReadings(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, `${hashOf(value)}.${hashOf(value)}`]));
}

// ---- identity ----

export const originKey = (slice: string, id: string) => `${slice}/${id}`;
export const originFrom = (source: string, slice: string, id: string) => `${source}|${slice}|${id}`;

// Which origin key an import's row already lives under, by where it came from.
export function ownedBy(doc: Pick<WorldDoc, "origins">): Map<string, string> {
  const owned = new Map<string, string>();
  for (const [key, origin] of Object.entries(doc.origins ?? {})) owned.set(origin.from, key);
  return owned;
}

export type IdPlan = Record<ImportSlice, Map<string, string>>;

// The id each incoming row takes here: the one an earlier import of the
// same source gave it; for a row imported before rows remembered their
// source, its own id; a stub of the same name; else its own id when free
// and a new one when another world already uses it.
export function planIds(doc: WorldDoc, incoming: Pick<WorldDoc, ImportSlice>, source: string): IdPlan {
  const owned = ownedBy(doc);
  const plan = {} as IdPlan;
  for (const slice of IMPORT_SLICES) {
    const own = doc[slice] as unknown as Row[];
    const ids = new Set(own.map((row) => row.id));
    const claimed = new Set<string>();
    const map = new Map<string, string>();
    for (const row of incoming[slice] as unknown as Row[]) {
      const key = owned.get(originFrom(source, slice, row.id));
      let target = key && ids.has(key.slice(slice.length + 1)) ? key.slice(slice.length + 1) : "";
      if (!target && slice === "stubs") {
        target = own.find((stub) => textKey(String(stub.name)) === textKey(String(row.name)))?.id ?? "";
      }
      if (!target && ids.has(row.id) && !doc.origins?.[originKey(slice, row.id)]) target = row.id;
      if (!target || claimed.has(target)) target = ids.has(row.id) || claimed.has(row.id) ? newId(PREFIX[slice]) : row.id;
      claimed.add(target);
      map.set(row.id, target);
    }
    plan[slice] = map;
  }
  return plan;
}

const moved = (map: Map<string, string>, id: string) => (id ? map.get(id) ?? "" : "");
const movedYear = (plan: IdPlan, when: YearValue): YearValue => ({ ...when, calendarId: moved(plan.calendars, when.calendarId) });

// The incoming rows with their own ids and every id they point at moved to
// the plan's. A reference to a row the import did not bring is dropped.
export function remapIds(incoming: Pick<WorldDoc, ImportSlice>, plan: IdPlan): Pick<WorldDoc, ImportSlice> {
  return {
    folders: incoming.folders.map((row) => ({ ...row, id: moved(plan.folders, row.id), parentId: moved(plan.folders, row.parentId) })),
    calendars: incoming.calendars.map((row) => ({ ...row, id: moved(plan.calendars, row.id) })),
    events: incoming.events.map((row) => ({ ...row, id: moved(plan.events, row.id), when: movedYear(plan, row.when) })),
    secrets: incoming.secrets.map((row) => ({ ...row, id: moved(plan.secrets, row.id) })),
    stubs: incoming.stubs.map((row) => ({ ...row, id: moved(plan.stubs, row.id) })),
    maps: incoming.maps.map((row) => ({ ...row, id: moved(plan.maps, row.id), parentPinId: moved(plan.pins, row.parentPinId) })),
    pins: incoming.pins.map((row) => ({ ...row, id: moved(plan.pins, row.id), mapId: moved(plan.maps, row.mapId), linkedMapId: moved(plan.maps, row.linkedMapId) })),
  };
}

// An entry's folder and the calendars its year fields count in, moved.
export function remapEntryIds(entry: Entry, plan: IdPlan): Entry {
  const fields = Object.fromEntries(
    Object.entries(entry.fields).map(([id, value]) => [id, value && typeof value === "object" ? movedYear(plan, value) : value]),
  );
  return { ...entry, folderId: moved(plan.folders, entry.folderId), fields };
}

// ---- rows ----

const withoutId = (row: Row): Record<string, unknown> => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id"));

export type RowMerge = { added: number; updated: number; conflicts: string[]; pending: Array<{ origin: string; key: string; source: string }> };

// Incoming rows (already remapped; `sourceIds` are their ids at the source,
// in the same order) merged into the document's slice, value by value.
export function mergeSliceRows(doc: WorldDoc, slice: ImportSlice, rows: Row[], sourceIds: string[], source: string): RowMerge {
  const result: RowMerge = { added: 0, updated: 0, conflicts: [], pending: [] };
  const own = [...(doc[slice] as unknown as Row[])];
  const origins = (doc.origins ??= {});
  rows.forEach((theirs, index) => {
    const key = originKey(slice, theirs.id);
    const from = originFrom(source, slice, sourceIds[index]);
    const values = withoutId(theirs);
    const at = own.findIndex((row) => row.id === theirs.id);
    if (at === -1) {
      if (own.length >= LIMITS[slice]) return;
      own.push(theirs);
      origins[key] = { from, at: firstReadings(values) };
      result.added += 1;
      return;
    }
    const mine = withoutId(own[at]);
    const prior = origins[key]?.from === from ? origins[key] : undefined;
    const merged = mergeValues(prior, mine, values);
    if (Object.keys(merged.take).length) {
      own[at] = { ...own[at], ...merged.take };
      result.updated += 1;
    }
    const label = String(own[at].name ?? own[at].title ?? own[at].id);
    for (const clash of [...new Set(merged.clashes.map((key) => valueWords(key)))]) {
      result.conflicts.push(`${SLICE_WORDS[slice]} “${label}”: kept your ${clash} over the import's.`);
    }
    origins[key] = { from, at: merged.at };
    for (const { key: value, source: read } of merged.pending) result.pending.push({ origin: key, key: value, source: read });
  });
  (doc as Record<ImportSlice, unknown>)[slice] = own;
  return result;
}

// Records the local reading of every value an import wrote, once written.
export function settle(doc: WorldDoc, pending: Array<{ origin: string; key: string; source: string }>, valueOf: (origin: string, key: string) => unknown) {
  for (const { origin, key, source } of pending) {
    const entry = doc.origins?.[origin];
    if (entry) entry.at[key] = `${source}.${hashOf(valueOf(origin, key))}`;
  }
}

// A row's value for `settle`, by its origin key.
export function rowValue(doc: WorldDoc, origin: string, key: string): unknown {
  const slash = origin.indexOf("/");
  const slice = origin.slice(0, slash) as ImportSlice;
  const row = (doc[slice] as unknown as Row[] | undefined)?.find((entry) => entry.id === origin.slice(slash + 1));
  return row?.[key];
}
