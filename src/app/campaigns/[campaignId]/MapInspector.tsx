"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import { BRUSH_EFFECTS, BRUSH_LABELS, type Brush as BrushName } from "@/lib/battlemap/paint";
import { listObjects, objectAt, refKey, sameRef, type MapObjects, type ObjectRef } from "@/lib/battlemap/objects";
import { TERRAIN, TILE_FEET, tileAt, type XY } from "@/lib/battlemap/types";
import { PanelHead } from "@/app/campaigns/[campaignId]/mapUi";

// The inspector and the status line (docs/visual-overhaul-plan.md 4.4): what
// is selected, else what is under the pointer, else a sentence. The pointer's
// tile lives in a small store of its own, outside React state, so moving the
// mouse across the map repaints these two readouts and nothing else in the
// editor.

export type HoverStore = {
  get: () => XY | null;
  set: (at: XY | null) => void;
  subscribe: (listener: () => void) => () => void;
};

export function createHoverStore(): HoverStore {
  let at: XY | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => at,
    set: (next) => {
      if (next?.x === at?.x && next?.y === at?.y) {
        return;
      }
      at = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function useHover(store: HoverStore): XY | null {
  return useSyncExternalStore(store.subscribe, store.get, () => null);
}

const CHAR_TO_BRUSH = Object.fromEntries(Object.entries(TERRAIN).map(([brush, char]) => [char, brush])) as Record<string, BrushName>;

function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <dt className="font-display text-[9px] uppercase tracking-[0.16em] text-stone-500">{name}</dt>
      <dd className="min-w-0 truncate text-right text-stone-200">{children}</dd>
    </div>
  );
}

export function MapInspector({
  store,
  terrain,
  width,
  height,
  objects,
  refs,
  selectionTitle,
  selectionBar,
}: {
  store: HoverStore;
  terrain: string;
  width: number;
  height: number;
  objects: MapObjects;
  refs: ObjectRef[];
  selectionTitle: string;
  // The selection's actions (edit, move, duplicate, DM only, delete).
  selectionBar: ReactNode;
}) {
  const hover = useHover(store);
  const rows = useMemo(() => listObjects(objects), [objects]);
  const first = refs[0] ?? null;
  const selected = first ? rows.find((row) => sameRef(row.ref, first)) : undefined;

  let body: ReactNode;
  if (first) {
    body = (
      // Keyed by the thing, so the facts rise again when the selection moves on.
      <div key={refKey(first)} className="map-inspect-in space-y-2">
        <p className="truncate text-[12px] text-amber-100">{refs.length > 1 ? `${refs.length} things selected` : selectionTitle}</p>
        {refs.length === 1 && selected ? (
          <dl className="space-y-1">
            <Fact name="Where">{selected.detail}</Fact>
            <Fact name="Seen by">{selected.dmOnly ? "Only you" : "Everyone who has been there"}</Fact>
          </dl>
        ) : null}
        {selectionBar}
      </div>
    );
  } else if (hover && hover.x < width && hover.y < height) {
    const brush = CHAR_TO_BRUSH[tileAt(terrain, width, hover.x, hover.y)];
    const under = objectAt(objects, hover.x, hover.y);
    const thing = under ? rows.find((row) => sameRef(row.ref, under)) : undefined;
    body = (
      <dl className="space-y-1">
        <Fact name="Tile">
          {hover.x}, {hover.y}
        </Fact>
        <Fact name="Ground">{brush ? BRUSH_LABELS[brush] : "Unknown"}</Fact>
        <Fact name="On it">{thing ? thing.name : "Nothing placed"}</Fact>
        {brush ? <p className="pt-1 font-mono text-[9px] leading-snug text-stone-500">{BRUSH_EFFECTS[brush]}</p> : null}
      </dl>
    );
  } else {
    body = (
      <p className="font-serif text-[12px] italic leading-snug text-stone-500">
        Move over the canvas to read a tile, or take up Select and tap a placed thing to work on it.
      </p>
    );
  }

  return (
    <section className="space-y-1.5">
      <PanelHead>Inspector</PanelHead>
      {body}
    </section>
  );
}

// The line under the canvas: where the pointer is, what is under it, how big
// the map is, and what is in hand.
export function MapStatusLine({
  store,
  terrain,
  width,
  height,
  holding,
  extra,
}: {
  store: HoverStore;
  terrain: string;
  width: number;
  height: number;
  holding: string;
  extra?: ReactNode;
}) {
  const hover = useHover(store);
  const brush = hover && hover.x < width && hover.y < height ? CHAR_TO_BRUSH[tileAt(terrain, width, hover.x, hover.y)] : undefined;
  const cell = (name: string, value: ReactNode) => (
    <span className="flex shrink-0 items-baseline gap-1.5">
      <span className="font-display text-[8px] uppercase tracking-[0.16em] text-stone-600">{name}</span>
      <span className="font-mono text-[10px] text-stone-300">{value}</span>
    </span>
  );
  return (
    <div className="flex shrink-0 items-center gap-4 overflow-x-auto border-t border-stone-800 bg-stone-950/60 px-3 py-1.5 [scrollbar-width:none]">
      {cell("Tile", hover ? `${hover.x}, ${hover.y}` : "·")}
      {cell("Under", brush ? BRUSH_LABELS[brush] : "·")}
      {cell("Size", `${width} × ${height} · ${width * TILE_FEET} × ${height * TILE_FEET} ft`)}
      {cell("Holding", <span className="text-amber-200">{holding}</span>)}
      {extra}
    </div>
  );
}
