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
  // Draws without replacement: the results handed out so far, and whether
  // the table remembers them at all (src/lib/dm/roll-table-logic.ts).
  drawn: number[];
  noReplacement: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

type TableRow = {
  id: string;
  campaign_id: string;
  name: string;
  entries_json: string;
  drawn_json: string | null;
  no_replacement: number | null;
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
    drawn: parseJson<number[]>(row.drawn_json ?? "[]", []).filter((value) => Number.isInteger(value)),
    noReplacement: row.no_replacement === 1,
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
  noReplacement?: boolean;
  createdByUserId: string;
}): RollTable {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `
        INSERT INTO roll_tables (
          id, campaign_id, name, entries_json, drawn_json, no_replacement, created_by_user_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)
      `,
    )
    .run(
      id,
      input.campaignId,
      input.name,
      JSON.stringify(input.entries),
      input.noReplacement ? 1 : 0,
      input.createdByUserId,
      now,
      now,
    );
  return getRollTable(id)!;
}

// Rewriting the rows forgets what was drawn: the numbers no longer mean
// the same results.
export function updateRollTable(
  tableId: string,
  patch: { name?: string; entries?: RollTableEntry[]; noReplacement?: boolean; resetDrawn?: boolean },
): RollTable | null {
  const table = getRollTable(tableId);
  if (!table) {
    return null;
  }
  const drawn = patch.entries || patch.resetDrawn ? [] : table.drawn;
  getDatabase()
    .prepare(
      `UPDATE roll_tables SET name = ?, entries_json = ?, drawn_json = ?, no_replacement = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.name ?? table.name,
      JSON.stringify(patch.entries ?? table.entries),
      JSON.stringify(drawn),
      (patch.noReplacement ?? table.noReplacement) ? 1 : 0,
      nowIso(),
      tableId,
    );
  return getRollTable(tableId);
}

export function markDrawn(tableId: string, result: number): RollTable | null {
  const table = getRollTable(tableId);
  if (!table) {
    return null;
  }
  const drawn = table.drawn.includes(result) ? table.drawn : [...table.drawn, result];
  getDatabase()
    .prepare(`UPDATE roll_tables SET drawn_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(drawn), nowIso(), tableId);
  return getRollTable(tableId);
}

export function deleteRollTable(tableId: string): void {
  getDatabase().prepare(`DELETE FROM roll_tables WHERE id = ?`).run(tableId);
}
