import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { RollTableEntry } from "@/lib/dm/roll-table-logic";

// DM-authored random tables. Owned by the campaign, written by whoever holds
// the DM seat, and never shown to players (the ROLL is public if the DM says
// so; the table behind it is theirs).

export type RollTable = {
  id: string;
  campaignId: string;
  name: string;
  entries: RollTableEntry[];
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

type TableRow = {
  id: string;
  campaign_id: string;
  name: string;
  entries_json: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

function mapTable(row: TableRow): RollTable {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    entries: parseJson<RollTableEntry[]>(row.entries_json, []),
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listRollTables(campaignId: string): RollTable[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM roll_tables WHERE campaign_id = ? ORDER BY name COLLATE NOCASE ASC`)
    .all(campaignId) as TableRow[];
  return rows.map(mapTable);
}

export function getRollTable(tableId: string): RollTable | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM roll_tables WHERE id = ?`)
    .get(tableId) as TableRow | undefined;
  return row ? mapTable(row) : null;
}

export function insertRollTable(input: {
  campaignId: string;
  name: string;
  entries: RollTableEntry[];
  createdByUserId: string;
}): RollTable {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO roll_tables (
          id, campaign_id, name, entries_json, created_by_user_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.name,
      JSON.stringify(input.entries),
      input.createdByUserId,
      now,
      now,
    );
  return getRollTable(id)!;
}

export function updateRollTable(
  tableId: string,
  patch: { name?: string; entries?: RollTableEntry[] },
): RollTable | null {
  const table = getRollTable(tableId);
  if (!table) {
    return null;
  }
  getDatabase()
    .prepare(`UPDATE roll_tables SET name = ?, entries_json = ?, updated_at = ? WHERE id = ?`)
    .run(
      patch.name ?? table.name,
      JSON.stringify(patch.entries ?? table.entries),
      nowIso(),
      tableId,
    );
  return getRollTable(tableId);
}

export function deleteRollTable(tableId: string): void {
  getDatabase().prepare(`DELETE FROM roll_tables WHERE id = ?`).run(tableId);
}
