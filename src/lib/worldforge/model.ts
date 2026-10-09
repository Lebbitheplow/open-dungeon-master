// WorldForge in the workshop. WorldForge is Smoebo's world-building app,
// brought into Open Dungeon Master with their blessing: its model of a world
// (typed entries with their own fields, a web of links that can be hidden or
// false, calendars and a timeline, nested maps with pins and regions, secrets
// and who knows them, names still to be written) now lives inside every
// workshop.
//
// The one rule that makes it a workshop tool rather than a second database:
// every entry IS a record the table already plays with. A Character is a
// member of the Cast, a Location is a place, a Faction is a faction, and any
// other type is a lore entry. WorldForge adds only what those rows have no
// column for, in one document per workshop (src/lib/db/world-forge.ts),
// keyed by a ref: "npc:<id>", "location:<id>", "faction:<id>", "lore:<id>".
//
// Pure, no "@/" imports, so the scripts can load it and the browser can use
// it. Every reader below is a floor: whatever arrives (a request body, an
// old document, a WorldForge export) comes out the right shape and within
// its caps, never as an exception.

export const SHELVES = ["npc", "location", "faction", "lore"] as const;
export type Shelf = (typeof SHELVES)[number];

export const SHELF_LABELS: Record<Shelf, string> = {
  npc: "The Cast",
  location: "Places",
  faction: "Factions",
  lore: "Lore",
};

export const LORE_CATEGORIES = ["geography", "factions", "history", "magic", "culture", "religion", "other"] as const;
export type LoreCategory = (typeof LORE_CATEGORIES)[number];

export const FIELD_KINDS = ["text", "number", "select", "year"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];
export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: "Text",
  number: "Number",
  select: "Pick one",
  year: "Year",
};
export type FieldRole = "" | "birth" | "death";

export type FieldDef = { id: string; name: string; kind: FieldKind; options: string[]; authorOnly: boolean; role: FieldRole };
export type WorldType = { id: string; name: string; color: string; shelf: Shelf; loreCategory: LoreCategory; fields: FieldDef[] };

// A year in one of the world's calendars: the shape WorldForge gives events
// and year fields alike, so one conversion serves both.
export type YearValue = { calendarId: string; yearNum: number | null; year: string };
export type FieldValue = string | number | YearValue;

export const CANON_STATES = ["canon", "draft", "alternate", "retired"] as const;
export type Canon = (typeof CANON_STATES)[number];

// What WorldForge knows about a record that the record has no column for.
export type Entry = {
  typeId: string;
  folderId: string;
  canon: Canon;
  // The wiki article. Characters and factions keep a one-line summary in
  // their own row (trait, blurb) for the table; places and lore entries use
  // their own long text, so this stays empty for them.
  article: string;
  // In-world, true, and the DM's alone: never shown to players.
  hiddenTruth: string;
  // Out-of-world: the author's working notes.
  notes: string;
  fields: Record<string, FieldValue>;
  // Places, factions and lore entries have no alias column; NPCs do.
  aliases: string[];
  // The Cast and places have no tag column; factions and lore do.
  tags: string[];
  // A place's picture (an uploaded path); the other shelves keep theirs in
  // their own row.
  image: string;
  // The entity's id in a WorldForge export, so a second import of the same
  // world updates rather than duplicates.
  wfId: string;
};

export const VERACITIES = ["known", "hidden", "believed"] as const;
export type Veracity = (typeof VERACITIES)[number];
export const VERACITY_LABELS: Record<Veracity, string> = {
  known: "Common knowledge",
  hidden: "Hidden truth: real, but the world does not know",
  believed: "False belief: the world thinks so, but it is not true",
};

export type WorldLink = { id: string; from: string; to: string; label: string; veracity: Veracity; oneway: boolean; rank: string };
export type Folder = { id: string; name: string; parentId: string };
export type Calendar = { id: string; name: string; abbrev: string; epochOffset: number; notes: string };
export type WorldEvent = { id: string; title: string; body: string; era: string; when: YearValue; refs: string[]; canon: Canon };
export type Secret = { id: string; title: string; subject: string; notes: string; knownBy: string[]; partyKnows: boolean };
export type Stub = { id: string; name: string; note: string; source: "scan" | "manual" | "import"; status: "open" | "dismissed" };
export type XY = { x: number; y: number };
export type Region = { id: string; name: string; points: XY[]; color: string; ref: string; notes: string };
export type AtlasMap = { id: string; name: string; image: string; parentPinId: string; regions: Region[] };
export type Pin = { id: string; mapId: string; x: number; y: number; name: string; ref: string; linkedMapId: string; notes: string };

export type WorldDoc = {
  version: 1;
  types: WorldType[];
  entries: Record<string, Entry>;
  links: WorldLink[];
  folders: Folder[];
  calendars: Calendar[];
  events: WorldEvent[];
  secrets: Secret[];
  stubs: Stub[];
  maps: AtlasMap[];
  pins: Pin[];
};

export const SLICES = ["types", "entries", "links", "folders", "calendars", "events", "secrets", "stubs", "maps", "pins"] as const;
export type Slice = (typeof SLICES)[number];

export const LIMITS = {
  types: 40,
  fieldsPerType: 30,
  options: 30,
  entries: 4_000,
  links: 8_000,
  folders: 300,
  calendars: 20,
  events: 2_000,
  secrets: 600,
  stubs: 1_000,
  maps: 100,
  pins: 3_000,
  regions: 100,
  points: 200,
  refs: 40,
  name: 120,
  article: 12_000,
  note: 4_000,
} as const;

// Link words WorldForge offers. The family four and the chain-of-command four
// build the family tree and the chart; "member of" carries a rank.
export const LINK_LABELS = [
  "allied with", "enemy of", "friend of", "rival of", "loves", "fears", "serves", "mentor of",
  "member of", "rules", "lives in", "located in", "worships", "guards", "seeks", "created", "destroyed",
  "parent of", "child of", "spouse of", "sibling of", "descended from",
  "superior of", "reports to", "liege of", "vassal of",
] as const;
export const KIN_LABELS = ["parent of", "child of", "spouse of", "sibling of"] as const;
export const CHAIN_LABELS = ["superior of", "reports to", "liege of", "vassal of"] as const;

export const TYPE_COLORS = ["#c44444", "#3d9e9e", "#c9a84c", "#a090e0", "#d08a3c", "#5d9b8a", "#b8608a", "#7a6e54", "#8a9bb8", "#7da868"];

const ALIGNMENTS = ["lawful good", "neutral good", "chaotic good", "lawful neutral", "neutral", "chaotic neutral", "lawful evil", "neutral evil", "chaotic evil"];

// The types a new world starts with: WorldForge's five, plus the two a
// fantasy table reaches for first.
export function defaultTypes(): WorldType[] {
  const field = (id: string, name: string, kind: FieldKind, extra: Partial<FieldDef> = {}): FieldDef => ({
    id, name, kind, options: [], authorOnly: false, role: "", ...extra,
  });
  return [
    { id: "t_character", name: "Character", color: "#c44444", shelf: "npc", loreCategory: "other", fields: [field("f_born", "Born", "year", { role: "birth" }), field("f_died", "Died", "year", { role: "death" }), field("f_species", "Species", "text")] },
    { id: "t_location", name: "Location", color: "#3d9e9e", shelf: "location", loreCategory: "geography", fields: [field("f_population", "Population", "number"), field("f_ruler", "Ruled by", "text")] },
    { id: "t_faction", name: "Faction", color: "#c9a84c", shelf: "faction", loreCategory: "factions", fields: [field("f_founded", "Founded", "year"), field("f_seat", "Seat of power", "text")] },
    { id: "t_artifact", name: "Artifact", color: "#a090e0", shelf: "lore", loreCategory: "magic", fields: [field("f_maker", "Made by", "text")] },
    { id: "t_deity", name: "Deity", color: "#d08a3c", shelf: "lore", loreCategory: "religion", fields: [field("f_domains", "Domains", "text"), field("f_alignment", "Alignment", "select", { options: ALIGNMENTS })] },
    { id: "t_culture", name: "Culture", color: "#5d9b8a", shelf: "lore", loreCategory: "culture", fields: [] },
    { id: "t_other", name: "Other", color: "#7a6e54", shelf: "lore", loreCategory: "other", fields: [] },
  ];
}

export function emptyDoc(): WorldDoc {
  return { version: 1, types: defaultTypes(), entries: {}, links: [], folders: [], calendars: [], events: [], secrets: [], stubs: [], maps: [], pins: [] };
}

// ---- refs ----

export function refOf(shelf: Shelf, id: string): string {
  return `${shelf}:${id}`;
}

export function parseRef(ref: unknown): { shelf: Shelf; id: string } | null {
  if (typeof ref !== "string") return null;
  const at = ref.indexOf(":");
  const shelf = ref.slice(0, at) as Shelf;
  const id = ref.slice(at + 1);
  return at > 0 && SHELVES.includes(shelf) && id && id.length <= 80 ? { shelf, id } : null;
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// ---- floors ----

type Raw = Record<string, unknown>;
const rec = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value).slice(0, max) : "");
const num = (value: unknown, fallback = 0) => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const unit = (value: unknown) => Math.min(1, Math.max(0, num(value, 0.5)));
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);
const idOf = (value: unknown) => str(value, 80).replace(/[^\w:.-]/g, "");
const ref = (value: unknown) => (parseRef(value) ? (value as string) : "");
const color = (value: unknown, fallback = "#7a6e54") => (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback);
const uniqueById = <T extends { id: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  return rows.filter((row) => row.id && !seen.has(row.id) && seen.add(row.id));
};
// An uploaded picture by path; anything else (a data URL, a remote address,
// a path that climbs) is not kept.
const uploadedPath = (value: unknown) => {
  const path = str(value, 300);
  return /^\/uploads\/[\w./-]+$/.test(path) && !path.includes("..") ? path : "";
};
const strings = (value: unknown, max: number, each: number) =>
  [...new Set(list(value, max).map((item) => str(item, each)).filter(Boolean))];

export function readYear(value: unknown): YearValue {
  const raw = rec(value);
  const yearNum = raw.yearNum === "" || raw.yearNum === undefined || raw.yearNum === null ? null : num(raw.yearNum, NaN);
  return { calendarId: idOf(raw.calendarId), yearNum: yearNum === null || Number.isNaN(yearNum) ? null : Math.round(yearNum), year: str(raw.year, 40) };
}

function readField(value: unknown): FieldDef | null {
  const raw = rec(value);
  const id = idOf(raw.id);
  const name = str(raw.name, 60);
  if (!id || !name) return null;
  const kind = oneOf(raw.kind, FIELD_KINDS, "text");
  return {
    id,
    name,
    kind,
    options: kind === "select" ? strings(raw.options, LIMITS.options, 60) : [],
    authorOnly: raw.authorOnly === true,
    role: kind === "year" ? oneOf(raw.role, ["", "birth", "death"] as const, "") : "",
  };
}

function readType(value: unknown): WorldType | null {
  const raw = rec(value);
  const id = idOf(raw.id);
  const name = str(raw.name, 40);
  if (!id || !name) return null;
  return {
    id,
    name,
    color: color(raw.color),
    shelf: oneOf(raw.shelf, SHELVES, "lore"),
    loreCategory: oneOf(raw.loreCategory, LORE_CATEGORIES, "other"),
    fields: uniqueById(list(raw.fields, LIMITS.fieldsPerType).map(readField).filter((f): f is FieldDef => f !== null)),
  };
}

function readFieldValue(value: unknown): FieldValue | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.trim() ? value.trim().slice(0, 400) : null;
  const raw = rec(value);
  return "calendarId" in raw || "yearNum" in raw || "year" in raw ? readYear(raw) : null;
}

export function readEntry(value: unknown): Entry {
  const raw = rec(value);
  const fields: Record<string, FieldValue> = {};
  for (const [key, field] of Object.entries(rec(raw.fields)).slice(0, 60)) {
    const id = idOf(key);
    const read = readFieldValue(field);
    if (id && read !== null) fields[id] = read;
  }
  return {
    typeId: idOf(raw.typeId),
    folderId: idOf(raw.folderId),
    canon: oneOf(raw.canon, CANON_STATES, "canon"),
    article: str(raw.article, LIMITS.article),
    hiddenTruth: str(raw.hiddenTruth, LIMITS.note),
    notes: str(raw.notes, LIMITS.note),
    fields,
    aliases: strings(raw.aliases, 12, 80),
    tags: strings(raw.tags, 8, 40),
    image: uploadedPath(raw.image),
    wfId: str(raw.wfId, 80),
  };
}

export function readLink(value: unknown): WorldLink | null {
  const raw = rec(value);
  const from = ref(raw.from);
  const to = ref(raw.to);
  if (!from || !to || from === to) return null;
  const label = str(raw.label, 60) || "linked to";
  return {
    id: idOf(raw.id) || newId("l"),
    from,
    to,
    label,
    veracity: oneOf(raw.veracity, VERACITIES, "known"),
    oneway: raw.oneway === true,
    rank: label === "member of" ? str(raw.rank, 60) : "",
  };
}

const readers: { [K in Exclude<Slice, "entries" | "types">]: (value: unknown) => WorldDoc[K][number] | null } = {
  links: readLink,
  folders: (value) => {
    const raw = rec(value);
    const id = idOf(raw.id);
    const name = str(raw.name, 60);
    return id && name ? { id, name, parentId: idOf(raw.parentId) } : null;
  },
  calendars: (value) => {
    const raw = rec(value);
    const id = idOf(raw.id);
    const name = str(raw.name, 80);
    return id && name ? { id, name, abbrev: str(raw.abbrev, 12), epochOffset: Math.round(num(raw.epochOffset)), notes: str(raw.notes, 400) } : null;
  },
  events: (value) => {
    const raw = rec(value);
    const title = str(raw.title, LIMITS.name);
    return title
      ? { id: idOf(raw.id) || newId("ev"), title, body: str(raw.body, LIMITS.note), era: str(raw.era, 60), when: readYear(raw.when), refs: [...new Set(list(raw.refs, LIMITS.refs).map(ref).filter(Boolean))], canon: oneOf(raw.canon, CANON_STATES, "canon") }
      : null;
  },
  secrets: (value) => {
    const raw = rec(value);
    const title = str(raw.title, LIMITS.name);
    return title
      ? { id: idOf(raw.id) || newId("sec"), title, subject: ref(raw.subject), notes: str(raw.notes, LIMITS.note), knownBy: [...new Set(list(raw.knownBy, LIMITS.refs).map(ref).filter(Boolean))], partyKnows: raw.partyKnows === true }
      : null;
  },
  stubs: (value) => {
    const raw = rec(value);
    const name = str(raw.name, LIMITS.name);
    return name
      ? { id: idOf(raw.id) || newId("stub"), name, note: str(raw.note, 400), source: oneOf(raw.source, ["scan", "manual", "import"] as const, "manual"), status: oneOf(raw.status, ["open", "dismissed"] as const, "open") }
      : null;
  },
  maps: (value) => {
    const raw = rec(value);
    const id = idOf(raw.id);
    const name = str(raw.name, 80);
    if (!id || !name) return null;
    return {
      id,
      name,
      image: uploadedPath(raw.image),
      parentPinId: idOf(raw.parentPinId),
      regions: uniqueById(
        list(raw.regions, LIMITS.regions).flatMap((item) => {
          const region = rec(item);
          const points = list(region.points, LIMITS.points).map((point) => ({ x: unit(rec(point).x), y: unit(rec(point).y) }));
          const regionName = str(region.name, 80);
          return regionName && points.length >= 3
            ? [{ id: idOf(region.id) || newId("rg"), name: regionName, points, color: color(region.color, "#c9a84c"), ref: ref(region.ref), notes: str(region.notes, 400) }]
            : [];
        }),
      ),
    };
  },
  pins: (value) => {
    const raw = rec(value);
    const id = idOf(raw.id);
    const mapId = idOf(raw.mapId);
    return id && mapId
      ? { id, mapId, x: unit(raw.x), y: unit(raw.y), name: str(raw.name, 80), ref: ref(raw.ref), linkedMapId: idOf(raw.linkedMapId), notes: str(raw.notes, 400) }
      : null;
  },
};

// One slice, read to its shape and caps.
export function readSlice<K extends Slice>(slice: K, value: unknown): WorldDoc[K] {
  if (slice === "types") {
    const types = uniqueById(list(value, LIMITS.types).map(readType).filter((t): t is WorldType => t !== null));
    return (types.length ? types : defaultTypes()) as WorldDoc[K];
  }
  if (slice === "entries") {
    const entries: Record<string, Entry> = {};
    for (const [key, entry] of Object.entries(rec(value)).slice(0, LIMITS.entries)) {
      if (parseRef(key)) entries[key] = readEntry(entry);
    }
    return entries as WorldDoc[K];
  }
  const read = readers[slice as Exclude<Slice, "entries" | "types">] as (value: unknown) => { id: string } | null;
  const rows = list(value, LIMITS[slice as Exclude<Slice, "entries" | "types">]).map((item) => read(item)).filter((row): row is { id: string } => row !== null);
  return uniqueById(rows) as unknown as WorldDoc[K];
}

export function readDoc(value: unknown): WorldDoc {
  const raw = rec(value);
  const doc = emptyDoc();
  for (const slice of SLICES) {
    if (raw[slice] !== undefined) {
      (doc as Record<Slice, unknown>)[slice] = readSlice(slice, raw[slice]);
    }
  }
  return doc;
}

// The type an entry reads as: its own, else the first type on its shelf.
export function typeFor(doc: Pick<WorldDoc, "types">, shelf: Shelf, typeId: string): WorldType {
  return (
    doc.types.find((type) => type.id === typeId && type.shelf === shelf) ??
    doc.types.find((type) => type.shelf === shelf) ??
    defaultTypes().find((type) => type.shelf === shelf)!
  );
}

// Every ref in the document rewritten through `map`; a ref that maps to
// nothing is dropped along with whatever only it held up (a link, a pin's
// binding, a knower). For copies into a campaign and bundles out of one.
export function remapDoc(doc: WorldDoc, map: (ref: string) => string | null): WorldDoc {
  const one = (value: string) => (value ? map(value) ?? "" : "");
  const many = (values: string[]) => [...new Set(values.map(one).filter(Boolean))];
  const entries: Record<string, Entry> = {};
  for (const [key, entry] of Object.entries(doc.entries)) {
    const moved = map(key);
    if (moved) entries[moved] = entry;
  }
  return {
    ...doc,
    entries,
    links: doc.links.flatMap((link) => {
      const from = one(link.from);
      const to = one(link.to);
      return from && to ? [{ ...link, from, to }] : [];
    }),
    events: doc.events.map((event) => ({ ...event, refs: many(event.refs) })),
    secrets: doc.secrets.map((secret) => ({ ...secret, subject: one(secret.subject), knownBy: many(secret.knownBy) })),
    maps: doc.maps.map((atlas) => ({ ...atlas, regions: atlas.regions.map((region) => ({ ...region, ref: one(region.ref) })) })),
    pins: doc.pins.map((pin) => ({ ...pin, ref: one(pin.ref) })),
  };
}

// Drops whatever points at a record that is gone: an entry's overlay, the
// links on either side, a pin's binding. Records deleted in the Cast or the
// Lore panel leave their WorldForge half behind until the next save.
export function pruneDoc(doc: WorldDoc, live: Set<string>): WorldDoc {
  return remapDoc(doc, (value) => (live.has(value) ? value : null));
}
