import { getDatabase, parseJson } from "@/lib/db/core";
import type { OriginKind } from "@/lib/db/content-origins";
import { dedupeName, type ImportKind } from "@/lib/workshop/import";

// Copying prep rows from one campaign into another, column for column.
//
// The copies in src/lib/db/content-import.ts used to name their columns,
// and every column added to a table after its copy was written stayed
// behind without a word: a prepared map arrived without its doors, labels,
// props, light zones, drawings, skin, overlay or sound; a prepared fight
// without its placements, overrides, rewards and phases, still bound to the
// workshop's map id (#153); a place without the map it stands on; an NPC
// without their voice; a region map without its roads, labels and art.
//
// So a copy now takes EVERY column the source row has. The only columns that
// do not travel verbatim are named below or passed as overrides by the
// caller, each with its reason, and scripts/test-workshop-dependencies.mjs
// fills every column of every table and checks the round trip. A column
// added tomorrow travels by default, which is the right way to be wrong: a
// play-state column copied by mistake shows on the copy, a prep column
// dropped by omission does not show anywhere.

type Row = Record<string, unknown>;

// Columns that never travel, because they are worked out again at the
// target rather than copied: a lore entry's vector is recomputed by
// embedPendingLore, and who it was written for names the source table's
// people.
const NEVER_COPIED: Record<string, readonly string[]> = {
  lore_entries: ["embedding", "audience_json"],
};

// The columns a copy sets itself, per table, for the reasons in the copy
// functions below. Exported so the round-trip test can tell a column that
// was deliberately reset from one that was dropped.
export const COPY_OVERRIDES: Record<string, readonly string[]> = {
  prepared_maps: ["id", "campaign_id", "name", "created_at", "updated_at"],
  encounter_templates: ["id", "campaign_id", "name", "map_json", "cued", "created_at", "updated_at"],
  locations: [
    "id", "campaign_id", "name", "visited", "is_current", "prepared_map_id", "created_at", "updated_at",
  ],
  npcs: [
    "id", "campaign_id", "name", "last_shift_turn", "bonds_json", "arc_cast_id", "faction_id",
    "created_at", "updated_at",
  ],
  factions: ["id", "campaign_id", "created_at", "updated_at"],
  lore_entries: ["id", "campaign_id", "title", "created_at", "updated_at", ...NEVER_COPIED.lore_entries],
  roll_tables: ["id", "campaign_id", "name", "drawn_json", "created_at", "updated_at"],
  overworld_maps: ["campaign_id", "anchors_json", "party_xy_json", "created_at", "updated_at"],
};

const columnCache = new Map<string, string[]>();

function columnsOf(table: string): string[] {
  const cached = columnCache.get(table);
  if (cached) {
    return cached;
  }
  const columns = (
    getDatabase().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((column) => column.name);
  // A table that has not got every column yet (a schema mid-migration) is
  // not cached, so the next copy sees the finished table.
  if (columns.length) {
    columnCache.set(table, columns);
  }
  return columns;
}

// One INSERT with every column of `row`, `values` winning where given.
export function insertCopy(table: string, row: Row, values: Row) {
  const skip = new Set(NEVER_COPIED[table] ?? []);
  const columns = columnsOf(table).filter((column) => !skip.has(column));
  getDatabase()
    .prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...columns.map((column) => (column in values ? values[column] : row[column] ?? null)));
}

export function sourceRows(table: string, sourceId: string, order = "created_at"): Row[] {
  return getDatabase()
    .prepare(`SELECT * FROM ${table} WHERE campaign_id = ? ORDER BY ${order}`)
    .all(sourceId) as Row[];
}

// What every copy function needs from the import that is running it.
export type CopyContext = {
  sourceId: string;
  campaignId: string;
  now: string;
  // The name a row lands under, after the planner numbered collisions.
  nameFor: (kind: ImportKind, id: string, fallback: string) => string;
  // A fresh id for a row about to be copied, recorded in the import's id map
  // and as the copy's origin.
  track: (kind: OriginKind, sourceRowId: string) => string;
  // The copy in this campaign of a source row: travelling in this import,
  // or brought by an earlier one. Null when it is in neither.
  resolve: (kind: OriginKind, sourceRowId: string) => string | null;
  // Whether an earlier import already brought this row, so this one keeps
  // that copy (and the DM's edits to it) instead of numbering a second.
  kept: (kind: OriginKind, sourceRowId: string) => boolean;
  // For a copy whose references are dependencies rather than choices: a
  // shared workshop's fight brings the shared map it is drawn on (#159).
  // Absent for the import's own source, where an unticked kind stays behind
  // and the planner said so.
  bring?: (kind: OriginKind, sourceRowId: string) => string | null;
  counts: { copied: number; kept: number; unbound: number };
};

// Rewrites an id-valued reference through the copy. A reference whose
// target did not travel and was never brought is dropped and counted, never
// kept pointing at the source's row: an id from another campaign resolves
// to nothing at best and to that campaign's prep at worst.
function remap(context: CopyContext, kind: OriginKind, id: unknown): string | null {
  if (typeof id !== "string" || !id) {
    return null;
  }
  const copy = context.resolve(kind, id) ?? context.bring?.(kind, id) ?? null;
  if (!copy) {
    context.counts.unbound += 1;
  }
  return copy;
}

// Prepared maps carry no tokens and no fog, so a copy is the row and nothing
// else. The backdrop and overlay paths travel as-is: they point at files in
// public/uploads both campaigns can read, and duplicating the art would cost
// megabytes to show the same picture.
function copyMapRow(context: CopyContext, row: Row, name: string): string {
  const id = context.track("maps", String(row.id));
  insertCopy("prepared_maps", row, {
    id,
    campaign_id: context.campaignId,
    name,
    created_at: context.now,
    updated_at: context.now,
  });
  return id;
}

function copyLocationRow(context: CopyContext, row: Row, name: string): string {
  const id = context.track("locations", String(row.id));
  insertCopy("locations", row, {
    id,
    campaign_id: context.campaignId,
    name,
    // A prepared place has not been visited and is nobody's current
    // location: the party has not been there yet. Copying either would
    // tell the campaign it has already travelled, and two current
    // locations is a state the engine has no meaning for.
    visited: 0,
    is_current: 0,
    // The map this place stands on, so arriving offers a one-tap deploy.
    prepared_map_id: remap(context, "maps", row.prepared_map_id),
    created_at: context.now,
    updated_at: context.now,
  });
  return id;
}

// The picture and an attached PDF are files both campaigns can read, the
// same way a prepared map's backdrop travels.
function copyLoreRow(context: CopyContext, row: Row, name: string): string {
  const id = context.track("lore", String(row.id));
  insertCopy("lore_entries", row, {
    id,
    campaign_id: context.campaignId,
    title: name,
    created_at: context.now,
    updated_at: context.now,
  });
  return id;
}

function copyTableRow(context: CopyContext, row: Row, name: string): string {
  const id = context.track("tables", String(row.id));
  insertCopy("roll_tables", row, {
    id,
    campaign_id: context.campaignId,
    name,
    // What has already been drawn from a no-replacement table is the
    // source table's play, not the table: the copy starts with a full deck.
    drawn_json: "[]",
    created_at: context.now,
    updated_at: context.now,
  });
  return id;
}

// One prepared fight. The roster, battlefield, notes and extras (placements,
// entry, hidden enemies, overrides, rewards, phases) all travel verbatim;
// the map it is drawn on is bound to the map's copy when the map travelled
// or is already here, and unbound otherwise. An unbound fight deploys on the
// generator's map from its own dials, and the planner said so before the
// button (#153).
function copyEncounterRow(context: CopyContext, row: Row, name: string): string {
  const map = parseJson<Record<string, unknown>>(String(row.map_json ?? "{}"), {});
  if (map.mapId !== undefined && map.mapId !== null) {
    map.mapId = remap(context, "maps", map.mapId);
  }
  const id = context.track("encounters", String(row.id));
  insertCopy("encounter_templates", row, {
    id,
    campaign_id: context.campaignId,
    name,
    map_json: JSON.stringify(map),
    // A cue is the source table's play: the copy starts uncued.
    cued: 0,
    created_at: context.now,
    updated_at: context.now,
  });
  return id;
}

// A faction rides with its members (docs/vtt-parity-implementation-plan.md
// section 6): copied the first time one of them needs it, once.
function factionFor(context: CopyContext, factionId: unknown): string {
  if (typeof factionId !== "string" || !factionId) {
    return "";
  }
  const existing = context.resolve("factions", factionId);
  if (existing) {
    return existing;
  }
  const row = getDatabase()
    .prepare(`SELECT * FROM factions WHERE id = ? AND campaign_id = ?`)
    .get(factionId, context.sourceId) as Row | undefined;
  if (!row) {
    return "";
  }
  const id = context.track("factions", factionId);
  insertCopy("factions", row, {
    id,
    campaign_id: context.campaignId,
    created_at: context.now,
    updated_at: context.now,
  });
  return id;
}

// Every faction of the source, members or not, kept where an earlier import
// brought it.
export function copyFactions(context: CopyContext) {
  for (const row of sourceRows("factions", context.sourceId)) {
    factionFor(context, row.id);
  }
}

function copyNpcRow(context: CopyContext, row: Row, name: string): string {
  const id = context.track("npcs", String(row.id));
  insertCopy("npcs", row, {
    id,
    campaign_id: context.campaignId,
    name,
    // When they last shifted is the source table's clock.
    last_shift_turn: "",
    // Bonds are keyed by character id, and those characters do not exist
    // at the target; the arc cast link goes for the same reason. Relations
    // are keyed by NAME (src/lib/dm/npc-logic.ts), so a cast imported
    // together arrives with its feuds intact.
    bonds_json: "[]",
    arc_cast_id: "",
    faction_id: factionFor(context, row.faction_id),
    created_at: context.now,
    updated_at: context.now,
  });
  return id;
}

// The import kinds that copy row by row, the table each reads, the column
// its name is in, and how one row is copied.
const ROW_KINDS = {
  maps: { table: "prepared_maps", label: "name", copy: copyMapRow },
  locations: { table: "locations", label: "name", copy: copyLocationRow },
  lore: { table: "lore_entries", label: "title", copy: copyLoreRow },
  tables: { table: "roll_tables", label: "name", copy: copyTableRow },
  encounters: { table: "encounter_templates", label: "name", copy: copyEncounterRow },
  npcs: { table: "npcs", label: "name", copy: copyNpcRow },
} as const;

export type RowKind = keyof typeof ROW_KINDS;

// Every row of one kind, in the order the source wrote them. A row an
// earlier import brought is kept as the campaign has it (#157, #159).
export function copyKind(context: CopyContext, kind: RowKind) {
  const { table, label, copy } = ROW_KINDS[kind];
  for (const row of sourceRows(table, context.sourceId)) {
    if (context.kept(kind, String(row.id))) {
      context.counts.kept += 1;
      continue;
    }
    copy(context, row, context.nameFor(kind, String(row.id), String(row[label] ?? "")));
    context.counts.copied += 1;
  }
}

// One row by id, for a storyboard link that has to bring its target along:
// a fight the encounters did not include (#156), or a record from the
// source's shared workshop (#159). Scoped to the context's source, so an id
// that names somebody else's row copies nothing.
export function copyOneRow(context: CopyContext, kind: RowKind, rowId: string, taken: Set<string>): string | null {
  const { table, label, copy } = ROW_KINDS[kind];
  const row = getDatabase()
    .prepare(`SELECT * FROM ${table} WHERE id = ? AND campaign_id = ?`)
    .get(rowId, context.sourceId) as Row | undefined;
  if (!row) {
    return null;
  }
  const id = copy(context, row, dedupeName(String(row[label] ?? ""), taken));
  context.counts.copied += 1;
  return id;
}

// The region map replaces the target's, which the planner warned about.
// Anchors are {locationId: {x, y}}; an anchor whose place did not travel is
// dropped, and src/lib/db/overworld.ts re-places it lazily.
export function copyOverworld(context: CopyContext, keepAnchors: boolean): boolean {
  const [map] = sourceRows("overworld_maps", context.sourceId, "campaign_id");
  if (!map) {
    return false;
  }
  const anchors: Record<string, unknown> = {};
  if (keepAnchors) {
    for (const [oldId, xy] of Object.entries(
      parseJson<Record<string, unknown>>(String(map.anchors_json ?? "{}"), {}),
    )) {
      const newId = context.resolve("locations", oldId);
      if (newId) {
        anchors[newId] = xy;
      }
    }
  }
  const db = getDatabase();
  db.prepare(`DELETE FROM overworld_maps WHERE campaign_id = ?`).run(context.campaignId);
  insertCopy("overworld_maps", map, {
    campaign_id: context.campaignId,
    anchors_json: JSON.stringify(anchors),
    // The party marker is where the DM stood them at the source, which says
    // nothing about a campaign that has not started.
    party_xy_json: "",
    created_at: context.now,
    updated_at: context.now,
  });
  context.counts.copied += 1;
  return true;
}
