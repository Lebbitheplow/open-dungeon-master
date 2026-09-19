"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ListControls, useListControls, type Listed } from "@/components/ui/ListControls";

// The same head on every workshop list long enough to need one: the shared
// search, tag and sort controls (src/components/ui/ListControls.tsx) and a
// count beside them. A list of a handful shows nothing, because a search box
// over four rows is furniture, not help.

export const LIST_HEAD_MIN = 6;

// Wraps a list's own rows as Listed items without changing their shape: the
// caller says where the name, the tags and the time live, and gets its own
// rows back, filtered and sorted.
export function useListHead<T>(
  rows: readonly T[],
  read: (row: T) => Listed,
) {
  const listed = useMemo(() => rows.map((row) => ({ ...read(row), row })), [rows, read]);
  const controls = useListControls(listed);
  const active = rows.length >= LIST_HEAD_MIN;
  return {
    controls,
    total: rows.length,
    active,
    // Below the threshold the list is handed back untouched, order included.
    shown: active ? controls.shown.map((entry) => entry.row) : [...rows],
  };
}

export function ListHead({
  head,
  noun,
  placeholder,
  className = "mb-2",
}: {
  head: { controls: ReturnType<typeof useListControls>; total: number; active: boolean; shown: readonly unknown[] };
  // What one row is called: "monster", "entry".
  noun: [one: string, many: string];
  placeholder?: string;
  className?: string;
}) {
  if (!head.active) {
    return null;
  }
  const count = head.shown.length;
  return (
    <div className={className}>
      <ListControls controls={head.controls} placeholder={placeholder} />
      <p className="mt-1 text-[11px] text-stone-500" aria-live="polite">
        {count === head.total
          ? `${head.total} ${head.total === 1 ? noun[0] : noun[1]}`
          : `${count} of ${head.total} ${noun[1]}`}
      </p>
    </div>
  );
}

// For the lists that already own a search box (lore, cast, tables, homebrew:
// each searches more than the name, so its box stays): the same count and the
// same two sort buttons, under that box.
export type RowSort = "made" | "name";

export function sortRows<T>(rows: readonly T[], sort: RowSort, name: (row: T) => string): T[] {
  return sort === "name" ? [...rows].sort((a, b) => name(a).localeCompare(name(b))) : [...rows];
}

export function ListTally({
  shown,
  total,
  noun,
  sort,
  onSort,
}: {
  shown: number;
  total: number;
  noun: [one: string, many: string];
  sort: RowSort;
  onSort: (sort: RowSort) => void;
}) {
  if (total < LIST_HEAD_MIN) {
    return null;
  }
  const button = (value: RowSort, label: string) => (
    <button
      type="button"
      aria-pressed={sort === value}
      onClick={() => onSort(value)}
      data-on={sort === value ? "" : undefined}
      className={cn(ui.btnSmall, "px-2 py-1", sort === value && "border-amber-500/60 bg-amber-400/10 text-amber-200")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
      <span aria-live="polite">
        {shown === total ? `${total} ${total === 1 ? noun[0] : noun[1]}` : `${shown} of ${total} ${noun[1]}`}
      </span>
      <span data-pill-group="" className="ml-auto flex items-center gap-1">
        {button("made", "As made")}
        {button("name", "By name")}
      </span>
    </div>
  );
}
