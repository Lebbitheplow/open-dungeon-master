import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { byName, textKey } from "@/lib/language/text-logic";
import type { RollTableEntry } from "@/lib/dm/roll-table-logic";
import { dedupeName } from "@/lib/workshop/import";

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
    .prepare(`SELECT * FROM roll_tables WHERE campaign_id = ?`)
    .all(campaignId) as TableRow[];
  return rows.map(mapTable).sort(byName);
}

export function getRollTable(tableId: string): RollTable | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM roll_tables WHERE id = ?`)
    .get(tableId) as TableRow | undefined;
  return row ? mapTable(row) : null;
}

// A row that says "@table: Gems", and the DM rolling "Gems", find the table
// by name, the first of that name. So every table in a campaign keeps a name
// of its own: a new one whose name is taken is numbered, "Gems (2)", the way
// an import numbers what it brings, and a rename onto a taken name is refused
// (the roll-tables route).
function tableNames(campaignId: string, exceptId = ""): Set<string> {
  const rows = getDatabase()
    .prepare(`SELECT name FROM roll_tables WHERE campaign_id = ? AND id <> ?`)
    .all(campaignId, exceptId) as Array<{ name: string }>;
  return new Set(rows.map((row) => textKey(row.name)));
}

export function tableNameTaken(campaignId: string, name: string, exceptId = ""): boolean {
  return tableNames(campaignId, exceptId).has(textKey(name));
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
      dedupeName(input.name, tableNames(input.campaignId)),
      JSON.stringify(input.entries),
      input.noReplacement ? 1 : 0,
      input.createdByUserId,
      now,
      now,
    );
  return getRollTable(id)!;
}

// Rewriting the rows forgets what was drawn: the numbers no longer mean
// the same results. Rows sent back unchanged are not a rewrite: the editor
// always resends its text, and a rename must not put drawn results back in.
export function updateRollTable(
  tableId: string,
  patch: { name?: string; entries?: RollTableEntry[]; noReplacement?: boolean; resetDrawn?: boolean },
): RollTable | null {
  const table = getRollTable(tableId);
  if (!table) {
    return null;
  }
  const rewritten =
    patch.entries !== undefined && JSON.stringify(patch.entries) !== JSON.stringify(table.entries);
  const drawn = rewritten || patch.resetDrawn ? [] : table.drawn;
  const db = getDatabase();
  db.transaction(() => {
    db.prepare(
      `UPDATE roll_tables SET name = ?, entries_json = ?, drawn_json = ?, no_replacement = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      patch.name ?? table.name,
      JSON.stringify(patch.entries ?? table.entries),
      JSON.stringify(drawn),
      (patch.noReplacement ?? table.noReplacement) ? 1 : 0,
      nowIso(),
      tableId,
    );
    // The rows that rolled on this table by its old name roll on it by the
    // new one, unless another table still answers to the old name.
    if (patch.name !== undefined && patch.name !== table.name && !tableNameTaken(table.campaignId, table.name, tableId)) {
      carryTableRefs(table.campaignId, table.name, patch.name);
    }
  })();
  return getRollTable(tableId);
}

function carryTableRefs(campaignId: string, from: string, to: string) {
  const db = getDatabase();
  const wanted = textKey(from);
  const rows = db.prepare(`SELECT id, entries_json FROM roll_tables WHERE campaign_id = ?`).all(campaignId) as Array<{
    id: string;
    entries_json: string;
  }>;
  for (const row of rows) {
    let changed = false;
    const entries = parseJson<RollTableEntry[]>(row.entries_json, []).map((entry) => {
      if (entry.ref?.kind !== "table" || textKey(entry.ref.name) !== wanted) {
        return entry;
      }
      changed = true;
      return { ...entry, text: to, ref: { ...entry.ref, name: to } };
    });
    if (changed) {
      db.prepare(`UPDATE roll_tables SET entries_json = ? WHERE id = ?`).run(JSON.stringify(entries), row.id);
    }
  }
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
