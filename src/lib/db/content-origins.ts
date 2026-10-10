import { getDatabase, nowIso } from "@/lib/db/core";

// Where a row of prep came from.
//
// An import copies rows under fresh ids, and before this table nothing
// remembered which copy was which original. That is why a second import of
// the same workshop numbered a duplicate of everything the first one brought,
// and why a chapter's storyboard had no way to find the shared cast a
// campaign already held (#157, #159). Now every copy writes one row here:
// the campaign it landed in, the copy's id, and the campaign (or workshop)
// and row it was copied from. A bundle import writes the portable key the
// row arrived under instead, with origin_id 'bundle'
// (src/lib/db/workshop-bundle.ts), so two bundles from the same author can
// find each other's rows without anybody matching names.
//
// A copy the DM has since deleted does not count: its origin row stays
// behind and simply never matches again, so the next import brings the row
// back rather than pointing at nothing.

export const BUNDLE_ORIGIN = "bundle";

// The kinds an origin can describe, and the table each one's copies live in.
// "board-*" are rows a storyboard card COMPILED into rather than rows copied
// (src/lib/db/workshop-storyboard.ts); their origin row is the card.
export const ORIGIN_TABLES = {
  npcs: "npcs",
  factions: "factions",
  locations: "locations",
  maps: "prepared_maps",
  encounters: "encounter_templates",
  lore: "lore_entries",
  tables: "roll_tables",
  shops: "shops",
  "board-lore": "lore_entries",
  "board-fight": "encounter_templates",
  "board-note": "campaign_notes",
} as const;

export type OriginKind = keyof typeof ORIGIN_TABLES;

export function recordOrigin(
  campaignId: string,
  kind: OriginKind,
  rowId: string,
  originId: string,
  originRowId: string,
) {
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO content_origins
         (campaign_id, kind, row_id, origin_id, origin_row_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(campaignId, kind, rowId, originId, originRowId, nowIso());
}

// Every live copy in `campaignId` of a row from `originId`, keyed
// `kind:originRowId`. One query per kind, because the liveness check is a
// join against the kind's own table.
export function copiesFrom(campaignId: string, originId: string): Map<string, string> {
  const db = getDatabase();
  const copies = new Map<string, string>();
  for (const [kind, table] of Object.entries(ORIGIN_TABLES)) {
    const rows = db
      .prepare(
        `SELECT o.origin_row_id AS origin, o.row_id AS id
           FROM content_origins o
           JOIN ${table} t ON t.id = o.row_id AND t.campaign_id = o.campaign_id
          WHERE o.campaign_id = ? AND o.kind = ? AND o.origin_id = ?`,
      )
      .all(campaignId, kind, originId) as Array<{ origin: string; id: string }>;
    for (const row of rows) {
      copies.set(`${kind}:${row.origin}`, row.id);
    }
  }
  return copies;
}

// The portable key a row arrived under, or null for one written here.
export function bundleRefOf(campaignId: string, kind: OriginKind, rowId: string): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT origin_row_id AS ref FROM content_origins
        WHERE campaign_id = ? AND kind = ? AND row_id = ? AND origin_id = ?`,
    )
    .get(campaignId, kind, rowId, BUNDLE_ORIGIN) as { ref: string } | undefined;
  return row?.ref ?? null;
}

// Rows anywhere in `campaignIds` that arrived under one of `refs`, as
// `kind:ref` -> {campaignId, rowId}. Live rows only, as above.
export function rowsByBundleRef(
  campaignIds: string[],
  kind: OriginKind,
  refs: string[],
): Map<string, { campaignId: string; rowId: string }> {
  const found = new Map<string, { campaignId: string; rowId: string }>();
  if (!campaignIds.length || !refs.length) {
    return found;
  }
  const table = ORIGIN_TABLES[kind];
  const wanted = new Set(refs);
  const statement = getDatabase().prepare(
    `SELECT o.campaign_id AS campaignId, o.row_id AS rowId, o.origin_row_id AS ref
       FROM content_origins o
       JOIN ${table} t ON t.id = o.row_id AND t.campaign_id = o.campaign_id
      WHERE o.campaign_id = ? AND o.kind = ? AND o.origin_id = ?`,
  );
  for (const campaignId of campaignIds) {
    for (const row of statement.all(campaignId, kind, BUNDLE_ORIGIN) as Array<{
      campaignId: string;
      rowId: string;
      ref: string;
    }>) {
      if (wanted.has(row.ref) && !found.has(`${kind}:${row.ref}`)) {
        found.set(`${kind}:${row.ref}`, { campaignId: row.campaignId, rowId: row.rowId });
      }
    }
  }
  return found;
}
