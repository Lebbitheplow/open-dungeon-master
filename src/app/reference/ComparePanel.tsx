"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CompareKind, CompareTable } from "@/lib/reference/compare";

// Several monsters or spells side by side, with the rows that differ marked.
//
// The picking happens in the browse tab, which already knows how to search;
// this panel only renders what was picked. "Only what differs" is on by
// default, because a comparison of two SRD spells is mostly rows that agree
// and those rows are not why anyone opened this.

export type CompareSelection = {
  kind: CompareKind;
  entries: Array<{ slug: string; name: string }>;
};

export function ComparePanel({
  selection,
  onRemove,
  onClear,
}: {
  selection: CompareSelection;
  onRemove: (slug: string) => void;
  onClear: () => void;
}) {
  const [table, setTable] = useState<CompareTable | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [onlyDiffering, setOnlyDiffering] = useState(true);

  const slugs = selection.entries.map((entry) => entry.slug).join("|");

  useEffect(() => {
    const picked = slugs ? slugs.split("|") : [];
    let cancelled = false;
    // Debounced, and every setState inside the timeout rather than the effect
    // body: ticking a third box while the second is still in flight should
    // not fire two requests, and the lint rule bans a synchronous setState
    // in an effect anyway.
    const timer = setTimeout(async () => {
      if (picked.length < 2) {
        setTable(null);
        setError("");
        return;
      }
      setLoading(true);
      try {
        const response = await fetch("/api/reference/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: selection.kind, slugs: picked }),
        });
        const data = await response.json();
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setError(data.error ?? "That comparison could not be built.");
          setTable(null);
          return;
        }
        setError("");
        setTable(data.table);
      } catch {
        if (!cancelled) {
          setError("That comparison could not be built.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slugs, selection.kind]);

  if (selection.entries.length < 2) {
    return (
      <p className="text-sm text-stone-500">
        Pick two or more spells or monsters in Browse to compare them. Only one kind at a time.
      </p>
    );
  }

  const rows = table ? table.rows.filter((row) => !onlyDiffering || row.differs) : [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {selection.entries.map((entry) => (
          <span
            key={entry.slug}
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-700 px-3 py-1 text-xs text-stone-300"
          >
            {entry.name}
            <button
              type="button"
              onClick={() => onRemove(entry.slug)}
              aria-label={`Remove ${entry.name}`}
              className="text-stone-600 hover:text-amber-200"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <button type="button" onClick={onClear} className={ui.btnSmall}>
          Clear
        </button>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-stone-500">
          <Loader2 className="size-4 animate-spin" /> Building the table
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {table ? (
        <>
          <label className="mb-3 flex items-center gap-2 text-xs text-stone-400">
            <input
              type="checkbox"
              checked={onlyDiffering}
              onChange={(event) => setOnlyDiffering(event.target.checked)}
              className="accent-amber-500"
            />
            Only what differs ({table.differingRows} of {table.rows.length} rows)
          </label>

          <div className="overflow-x-auto rounded-xl border border-stone-800">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-950/60">
                  <th className="px-3 py-2 text-xs uppercase tracking-wide text-stone-500" />
                  {table.columns.map((column) => (
                    <th
                      key={column.slug}
                      className={cn(
                        "px-3 py-2 font-normal",
                        column.source === "homebrew" ? "text-amber-300" : "text-stone-200",
                      )}
                    >
                      {column.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-stone-900 last:border-0">
                    <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-normal uppercase tracking-wide text-stone-500">
                      {row.label}
                    </th>
                    {row.cells.map((cell, index) => (
                      <td
                        key={`${row.label}-${table.columns[index]?.slug ?? index}`}
                        className={cn(
                          "px-3 py-2 align-top",
                          row.differs ? "text-stone-100" : "text-stone-400",
                        )}
                      >
                        {cell.text}
                        {cell.detail ? (
                          <span className="block text-xs text-stone-500">{cell.detail}</span>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}
                {!rows.length ? (
                  <tr>
                    <td
                      colSpan={table.columns.length + 1}
                      className="px-3 py-4 text-sm text-stone-500"
                    >
                      These agree on every row the table checks.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
