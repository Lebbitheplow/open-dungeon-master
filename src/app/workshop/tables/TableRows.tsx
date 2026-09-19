"use client";

import { useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { dieForTable, tableGaps, type RollTableEntry } from "@/lib/dm/roll-table-logic";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { ListTally, sortRows, type RowSort } from "@/app/workshop/ListHead";
import { GlyphPlate, RowMenu } from "@/app/workshop/kit";
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

// The painted die nearest the one the table rolls.
const PAINTED_DICE = [4, 6, 8, 10, 12, 20, 100];
function dieGlyph(die: number): string {
  return `die-d${PAINTED_DICE.find((faces) => faces >= die) ?? 100}`;
}

const COVERED = "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
const PATCHY = "border-amber-500/40 bg-amber-500/10 text-amber-300";

export type RollResult = {
  tableId: string;
  total: number;
  text: string;
  // Every step when a row rolled another table; empty for a plain roll.
  chain: string[];
  // Results still undealt on a table that draws without replacement.
  remaining: number | null;
};

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
  const [sort, setSort] = useState<RowSort>("made");
  const shown = sortRows(
    needle ? tables.filter((table) => table.name.toLowerCase().includes(needle)) : tables,
    sort,
    (table) => table.name,
  );

  return (
    <div className="space-y-2">
      <label className="relative block" data-tour="tables-search">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your tables"
          aria-label="Search your tables by name"
          className={`${ui.input} pl-9`}
        />
      </label>
      <ListTally shown={shown.length} total={tables.length} noun={["table", "tables"]} sort={sort} onSort={setSort} />

      <ul className="stagger-up grid gap-2 lg:grid-cols-2">
        {shown.map((table) => {
          const coverage = coverageOf(table.entries);
          const clean = !coverage.gaps && !coverage.overlaps;
          // Roll stays the row's visible button; the rest live behind the
          // kebab and the right-click or long-press menu, the same list.
          const items: ContextMenuItem[] = [
            { id: "open", label: "Open", glyph: "system-tables", onSelect: () => onOpen(table) },
            { id: "roll", label: "Roll", glyph: dieGlyph(coverage.die), disabled: busy === table.id, onSelect: () => onRoll(table) },
            { id: "duplicate", label: "Duplicate", glyph: "tab-notes", disabled: busy === `copy-${table.id}`, onSelect: () => onDuplicate(table) },
            { id: "delete", label: "Delete", glyph: "quest-failed", tone: "danger", separated: true, onSelect: () => onDelete(table) },
          ];
          return (
            <ContextMenu as="li" key={table.id} label={table.name} items={items} className={cn(ui.cardHover, "min-w-0 p-3")}>
              <div className="flex items-start gap-3">
                <GlyphPlate glyph={dieGlyph(coverage.die)} />
                <button
                  type="button"
                  onClick={() => onOpen(table)}
                  className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-display tracking-wide text-amber-50">{table.name}</span>
                    <span className="rounded-sm border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 font-display text-[10px] tracking-wider text-amber-300">
                      d{coverage.die}
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-stone-500">
                    <span>
                      {coverage.rows} {coverage.rows === 1 ? "row" : "rows"}
                    </span>
                    <span
                      className={cn(
                        "rounded-sm border px-1.5 py-0.5 font-display text-[10px] tracking-wider",
                        clean ? COVERED : PATCHY,
                      )}
                    >
                      {coverageLabel(coverage)}
                    </span>
                    {table.noReplacement ? (
                      <span className="rounded-sm border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 font-display text-[10px] tracking-wider text-violet-300">
                        deck, {table.drawn.length} dealt
                      </span>
                    ) : null}
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onRoll(table)}
                    disabled={busy === table.id}
                    className={cn(ui.btnSecondary, "h-9")}
                  >
                    {busy === table.id ? <Loader2 className="size-3.5 animate-spin" /> : "Roll"}
                  </button>
                  <RowMenu items={items} label={table.name} />
                </span>
              </div>
              {result?.tableId === table.id ? (
                <div className="live-in mt-2 rounded-lg border border-amber-500/20 bg-stone-950/50 px-3 py-2 text-sm text-stone-300">
                  <p>
                    <span className="text-amber-200">{result.total}:</span> {result.text}
                    {result.remaining !== null ? (
                      <span className="ml-1 text-stone-500">({result.remaining} left)</span>
                    ) : null}
                  </p>
                  {result.chain.map((line, index) => (
                    <p key={index} className="text-[11px] text-stone-500">
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </ContextMenu>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => onOpen(null)}
            data-tour="tables-new"
            className={cn(
              ui.cardHover,
              "flex h-full w-full items-center gap-3 border-dashed p-3 text-left text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
            )}
          >
            <span className="relative shrink-0">
              <GameIcon icon={{ kind: "glyph", key: "system-tables" }} size="size-10" />
              <Plus className="absolute -bottom-1 -right-1 size-4 rounded-full bg-stone-900 text-amber-300" aria-hidden="true" />
            </span>
            <span className="font-display tracking-wide">New table</span>
          </button>
        </li>
      </ul>

      {tables.length === 0 ? (
        <p className="reveal text-[11px] text-stone-500">
          {loaded ? "No tables yet. Start one with New table, or paste one out of a book." : "Loading..."}
        </p>
      ) : shown.length === 0 ? (
        <p className="live-in text-xs text-stone-500">No table by that name.</p>
      ) : null}
    </div>
  );
}
