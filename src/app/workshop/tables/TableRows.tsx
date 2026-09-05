"use client";

import { useState } from "react";
import { Copy, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { dieForTable, tableGaps, type RollTableEntry } from "@/lib/dm/roll-table-logic";
import type { RollTable } from "@/lib/db/roll-tables";

// The workshop's view of the DM's tables: one full-width row per table with
// the die it rolls, how many rows it has and whether every face of that die
// lands on exactly one of them, plus Roll, Duplicate and Delete in the row.
// Tapping the name hands the table to the caller, which opens the editor.
// The requests stay in DmTablesPanel; this file only draws.

export type TableCoverage = {
  die: number;
  rows: number;
  gaps: number;
  overlaps: number;
};

export function coverageOf(entries: RollTableEntry[]): TableCoverage {
  const gaps = tableGaps(entries);
  return {
    die: dieForTable(entries),
    rows: entries.length,
    gaps: gaps.uncovered.length,
    overlaps: gaps.overlapping.length,
  };
}

// Green when every face lands on one row; amber with the counts when a roll
// can land nowhere or on two rows at once. Which numbers are the trouble is
// the editor's coverage line, where the DM can fix them.
export function coverageLabel(coverage: TableCoverage): string {
  if (!coverage.gaps && !coverage.overlaps) {
    return `covers 1 to ${coverage.die}`;
  }
  const parts: string[] = [];
  if (coverage.gaps) {
    parts.push(`${coverage.gaps} ${coverage.gaps === 1 ? "gap" : "gaps"}`);
  }
  if (coverage.overlaps) {
    parts.push(`${coverage.overlaps} ${coverage.overlaps === 1 ? "overlap" : "overlaps"}`);
  }
  return parts.join(", ");
}

const COVERED = "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
const PATCHY = "border-amber-500/40 bg-amber-500/10 text-amber-300";

export type RollResult = { tableId: string; total: number; text: string };

type RowsProps = {
  tables: RollTable[];
  loaded: boolean;
  // The panel's busy key: a table id while it rolls, "copy-" and the id
  // while it copies. Same convention as the console list.
  busy: string;
  result: RollResult | null;
  onOpen: (table: RollTable | null) => void;
  onRoll: (table: RollTable) => void;
  onDuplicate: (table: RollTable) => void;
  onDelete: (table: RollTable) => void;
};

export function TableRows({
  tables,
  loaded,
  busy,
  result,
  onOpen,
  onRoll,
  onDuplicate,
  onDelete,
}: RowsProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? tables.filter((table) => table.name.toLowerCase().includes(needle))
    : tables;

  return (
    <div className="space-y-2">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your tables"
          aria-label="Search your tables by name"
          className={`${ui.input} pl-9`}
        />
      </label>

      <ul className="grid gap-2 lg:grid-cols-2">
        {shown.map((table) => {
          const coverage = coverageOf(table.entries);
          const clean = !coverage.gaps && !coverage.overlaps;
          return (
            <li key={table.id} className={cn(ui.cardHover, "p-3")}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => onOpen(table)}
                  className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display tracking-wide text-amber-50">{table.name}</span>
                    <span className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                      d{coverage.die}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500">
                    <span>
                      {coverage.rows} {coverage.rows === 1 ? "row" : "rows"}
                    </span>
                    <span
                      className={cn(
                        "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                        clean ? COVERED : PATCHY,
                      )}
                    >
                      {coverageLabel(coverage)}
                    </span>
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRoll(table)}
                    disabled={busy === table.id}
                    className="rounded-md border border-amber-700 bg-amber-950/50 px-2.5 py-1 text-xs text-amber-100 hover:bg-amber-900/50 disabled:opacity-40"
                  >
                    {busy === table.id ? <Loader2 className="size-3.5 animate-spin" /> : "Roll"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDuplicate(table)}
                    disabled={busy === `copy-${table.id}`}
                    aria-label={`Duplicate ${table.name}`}
                    className="rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-stone-300 disabled:opacity-40"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(table)}
                    aria-label={`Delete ${table.name}`}
                    title="Delete this table"
                    className="rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-red-300"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </div>
              {result?.tableId === table.id ? (
                <p className="mt-2 text-xs text-stone-300">
                  <span className="text-amber-200">{result.total}:</span> {result.text}
                </p>
              ) : null}
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => onOpen(null)}
            className={cn(
              ui.cardHover,
              "flex h-full w-full items-center gap-3 border-dashed p-3 text-left text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-stone-600">
              <Plus className="size-4" />
            </span>
            <span className="font-display tracking-wide">New table</span>
          </button>
        </li>
      </ul>

      {tables.length === 0 ? (
        <p className="text-[11px] text-stone-500">
          {loaded ? "No tables yet. Start one with New table, or paste one out of a book." : "Loading..."}
        </p>
      ) : shown.length === 0 ? (
        <p className="text-[11px] text-stone-500">No table by that name.</p>
      ) : null}
    </div>
  );
}
