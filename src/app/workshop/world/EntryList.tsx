"use client";

import { Lock } from "lucide-react";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { WorldDoc } from "@/lib/worldforge/model";
import type { WorldEntity } from "@/lib/db/world-forge";
import { EntityAvatar, typeOf } from "./world-ui";

// The wiki's list of entries (audit WF-24). A 4,000-entry world drew 4,000
// rows: the list took a second or two to appear and to come back after a
// search, and scrolled at about 13 frames a second. Past VIRTUAL_FROM rows
// only the rows in view are drawn, each the same height, with room kept
// above and below for the rest; a small world draws every row as before.
//
// It is a listbox in either case, moved through by keyboard: the arrow
// keys, Home, End, Page Up and Page Down move between entries (the list
// scrolls to the one reached), Enter or Space opens it, and Tab enters the
// list on the open entry or the last one reached. Each row says where it
// stands in the whole list (aria-posinset of aria-setsize), drawn or not.
// The open entry is scrolled into view when it changes, so an entry opened
// by its address shows in the list too.

export const ROW_PX = 44;
const VIRTUAL_FROM = 120;
const OVERSCAN = 6;
const PAGE = 8;

export function EntryList({
  doc,
  shown,
  focus,
  onFocus,
  excerptOf,
  empty,
  toList = 0,
}: {
  doc: Pick<WorldDoc, "types">;
  shown: WorldEntity[];
  focus: string | null;
  onFocus: (ref: string) => void;
  // A search's word on where an entry matched, shown under its name.
  excerptOf?: (ref: string) => string;
  empty: ReactNode;
  // Raised by the search box's Down arrow: the first row takes the focus.
  toList?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);
  // The row reached by keyboard or opened, whether it should take the
  // focus, and where the list should stand for it to show. Changed only by
  // a key, a click or a new open entry, so a search's new rows never pull
  // the list back.
  const [cursor, setCursor] = useState({ at: 0, focus: false, scroll: -1 });
  const virtual = shown.length > VIRTUAL_FROM;
  const focusAt = focus ? shown.findIndex((entity) => entity.ref === focus) : -1;
  // The row Tab lands on: the last one reached, else the open entry.
  const active = Math.min(Math.max(0, cursor.at), Math.max(0, shown.length - 1));

  // Where the list stands to show a row: the least move, or centred.
  const scrollFor = (index: number, center: boolean) => {
    const rowTop = index * ROW_PX;
    if (center) return Math.max(0, rowTop - height / 2 + ROW_PX / 2);
    if (rowTop < top) return rowTop;
    if (rowTop + ROW_PX > top + height) return rowTop + ROW_PX - height;
    return top;
  };
  const goTo = (index: number, takeFocus: boolean, center = false) => {
    const next = Math.min(Math.max(0, shown.length - 1), Math.max(0, index));
    const scroll = scrollFor(next, center);
    setTop(scroll);
    setCursor({ at: next, focus: takeFocus, scroll });
  };

  // A new open entry (or the list's first rows, for an entry opened by its
  // address) moves the cursor to it and into view.
  const hasRows = shown.length > 0;
  const [seen, setSeen] = useState({ focus: null as string | null, hasRows: false, toList: 0 });
  if (seen.focus !== focus || seen.hasRows !== hasRows || seen.toList !== toList) {
    setSeen({ focus, hasRows, toList });
    // The search box's Down arrow: the first row takes the focus.
    if (seen.toList !== toList && hasRows) goTo(0, true);
    // Centred when the list first fills; otherwise the least move.
    else if (focusAt >= 0) goTo(focusAt, false, seen.hasRows !== hasRows);
  }

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight || 600));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The list stands where the cursor asked, and the row reached takes the
  // focus once drawn.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    if (cursor.scroll >= 0) element.scrollTop = cursor.scroll;
    if (cursor.focus) element.querySelector<HTMLElement>(`[data-row="${cursor.at}"]`)?.focus({ preventScroll: true });
  }, [cursor]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: shown.length - 1, PageDown: active + PAGE, PageUp: active - PAGE };
    if (!(event.key in keys) || !shown.length) return;
    event.preventDefault();
    goTo(keys[event.key], true);
  };

  const first = virtual ? Math.max(0, Math.floor(top / ROW_PX) - OVERSCAN) : 0;
  const last = virtual ? Math.min(shown.length, Math.ceil((top + height) / ROW_PX) + OVERSCAN) : shown.length;

  return (
    <div
      ref={box}
      className="flex max-h-[60vh] flex-col overflow-y-auto pr-1"
      role="listbox"
      aria-label="Entries"
      onScroll={(event) => setTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      {shown.length === 0 ? empty : null}
      {virtual ? <div aria-hidden style={{ height: first * ROW_PX, flexShrink: 0 }} /> : null}
      {shown.slice(first, last).map((entity, offset) => {
        const index = first + offset;
        const type = typeOf(doc, entity);
        const excerpt = excerptOf?.(entity.ref) ?? "";
        // shrink-0: motion-press hides overflow, and a flex item that hides
        // overflow has no minimum height, so the capped column squeezed
        // forty entries into slivers over one another instead of scrolling
        // (issue 282).
        return (
          <button
            key={entity.ref}
            type="button"
            role="option"
            data-row={index}
            aria-selected={entity.ref === focus}
            aria-posinset={index + 1}
            aria-setsize={shown.length}
            tabIndex={index === active ? 0 : -1}
            onClick={() => {
              setCursor({ at: index, focus: false, scroll: -1 });
              onFocus(entity.ref);
            }}
            style={{ height: ROW_PX }}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-1.5 text-left motion-press focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-400",
              entity.ref === focus ? "bg-amber-400/10 shadow-[0_0_16px_rgba(212,171,58,0.12)]" : "hover:bg-stone-900/70",
            )}
          >
            <EntityAvatar entity={entity} type={type} size="size-8" />
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-sm", entity.ref === focus ? "text-amber-100" : "text-stone-200")}>{entity.name}</span>
              <span className="block truncate text-[11px]">
                <span style={{ color: type.color }}>{type.name}</span>
                {excerpt ? <span className="text-stone-400"> · {excerpt}</span> : null}
              </span>
            </span>
            {entity.entry.hiddenTruth ? <Lock className="size-3 shrink-0 text-red-400/80" aria-label="Has a hidden truth" /> : null}
          </button>
        );
      })}
      {virtual ? <div aria-hidden style={{ height: (shown.length - last) * ROW_PX, flexShrink: 0 }} /> : null}
    </div>
  );
}
