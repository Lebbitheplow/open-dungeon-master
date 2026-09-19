"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Eye, EyeOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { listObjects, refKey, type MapObjects, type ObjectKind, type ObjectRef } from "@/lib/battlemap/objects";
import type { HiddenLayers, MapLayer } from "@/app/campaigns/[campaignId]/terrainDraw";
import { FinePrint, PanelHead } from "@/app/campaigns/[campaignId]/mapUi";

// The layers panel (docs/visual-overhaul-plan.md 4.4): one row per layer of a
// map with how many things it holds and an eye that hides it on the canvas,
// terrain and picture included. A row of placed things opens into the list
// the old "Placed things" panel showed, with the same checkbox, the same DM
// marker and the same bin, sharing its selection with the canvas.

type Row = {
  layer: MapLayer;
  label: string;
  meta: string;
  // The object kind this layer lists, when it lists any.
  kind?: ObjectKind;
};

const ROWS: Row[] = [
  { layer: "labels", label: "Labels", meta: "names on tiles", kind: "labels" },
  { layer: "props", label: "Props", meta: "things and bystanders", kind: "props" },
  { layer: "lights", label: "Lights", meta: "placed light sources", kind: "lights" },
  { layer: "zones", label: "Light zones", meta: "boxes of light or dark", kind: "zones" },
  { layer: "doors", label: "Doors", meta: "locked and secret", kind: "doors" },
  { layer: "terrain", label: "Terrain", meta: "one character per tile" },
  { layer: "backdrop", label: "Backdrop", meta: "the picture under the grid" },
  { layer: "overlay", label: "Overlay", meta: "your annotated picture" },
  { layer: "drawings", label: "Drawings", meta: "marks made at the table", kind: "drawings" },
];

export function MapLayersPanel({
  objects,
  refs,
  hidden,
  onHidden,
  counts,
  layers,
  editable,
  onSelect,
  onDelete,
  onDmOnly,
  extras,
}: {
  objects: MapObjects;
  refs: ObjectRef[];
  hidden: HiddenLayers;
  onHidden: (next: HiddenLayers) => void;
  // Counts for the layers that are not lists of objects.
  counts: { terrain: number; backdrop: number; overlay: number };
  // Which rows this surface has: the live board holds no props or lights.
  layers: readonly MapLayer[];
  // Kinds whose objects can be selected and deleted here.
  editable: readonly ObjectKind[];
  onSelect: (refs: ObjectRef[]) => void;
  onDelete: (refs: ObjectRef[]) => void;
  onDmOnly: (refs: ObjectRef[], dmOnly: boolean) => void;
  // Controls shown inside a row when it is open (the overlay's upload, the
  // backdrop's sliders).
  extras?: Partial<Record<MapLayer, ReactNode>>;
}) {
  const [open, setOpen] = useState<Partial<Record<MapLayer, boolean>>>({});
  const all = useMemo(() => listObjects(objects), [objects]);
  const selectedKeys = new Set(refs.map(refKey));

  return (
    <section className="space-y-1.5">
      <PanelHead>Layers</PanelHead>
      {refs.length > 1 ? (
        <div className="map-row-in flex flex-wrap items-center gap-1 text-[11px] text-stone-400">
          {refs.length} selected
          <button type="button" onClick={() => onDelete(refs)} className="ml-auto flex min-h-7 items-center gap-1 rounded-md border border-red-900/60 px-2 text-red-300">
            <Trash2 className="size-3" /> Delete
          </button>
          <button type="button" onClick={() => onDmOnly(refs, true)} className="flex min-h-7 items-center gap-1 rounded-md border border-stone-700 px-2">
            <EyeOff className="size-3" /> DM only
          </button>
          <button type="button" onClick={() => onDmOnly(refs, false)} className="flex min-h-7 items-center gap-1 rounded-md border border-stone-700 px-2">
            <Eye className="size-3" /> Shown
          </button>
        </div>
      ) : null}
      <ul className="space-y-1">
        {ROWS.filter((row) => layers.includes(row.layer)).map((row, index) => {
          const items = row.kind ? all.filter((entry) => entry.ref.kind === row.kind) : [];
          const count = row.kind ? items.length : counts[row.layer as "terrain" | "backdrop" | "overlay"];
          const isHidden = Boolean(hidden[row.layer]);
          const extra = extras?.[row.layer];
          const expandable = items.length > 0 || Boolean(extra);
          const isOpen = expandable && Boolean(open[row.layer]);
          const holdsSelection = items.some((entry) => selectedKeys.has(refKey(entry.ref)));
          // Drawings are made and shown at the table; this canvas never draws
          // them, so an eye here would be a switch wired to nothing.
          const canHide = row.layer !== "drawings";
          return (
            <li
              key={row.layer}
              className={cn(
                "map-row-in map-layer-row rounded-lg border bg-stone-950/40",
                holdsSelection ? "border-amber-500/50" : "border-stone-800",
                isHidden && "opacity-60",
              )}
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <div className="flex items-center gap-1 px-1.5 py-1">
                {canHide ? (
                  <button
                    type="button"
                    aria-pressed={!isHidden}
                    aria-label={`${isHidden ? "Show" : "Hide"} ${row.label.toLowerCase()}`}
                    title={isHidden ? "Hidden on the canvas" : "Shown on the canvas"}
                    onClick={() => onHidden({ ...hidden, [row.layer]: !isHidden })}
                    className={cn(
                      "map-eye flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-stone-900 hover:text-amber-200",
                      isHidden ? "text-stone-600" : "text-amber-200/80",
                    )}
                  >
                    {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                ) : (
                  <span className="size-7 shrink-0" />
                )}
                <button
                  type="button"
                  disabled={!expandable}
                  aria-expanded={expandable ? isOpen : undefined}
                  onClick={() => setOpen((current) => ({ ...current, [row.layer]: !isOpen }))}
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] text-stone-200">{row.label}</span>
                    <span className="block truncate font-mono text-[8px] text-stone-600">{row.meta}</span>
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-1.5 font-mono text-[9px] tabular-nums",
                      count ? "border-amber-500/40 text-amber-200" : "border-stone-700 text-stone-500",
                    )}
                  >
                    {count}
                  </span>
                  {expandable ? (
                    <ChevronRight className={cn("chevron-turn size-3 text-stone-500", isOpen && "rotate-90")} />
                  ) : (
                    <span className="size-3" />
                  )}
                </button>
              </div>
              {isOpen ? (
                <div className="map-row-in space-y-1.5 border-t border-stone-800 px-1.5 py-1.5">
                  {items.length ? (
                    <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                      {items.map((entry) => {
                        const key = refKey(entry.ref);
                        const selected = selectedKeys.has(key);
                        const canEdit = editable.includes(entry.ref.kind);
                        return (
                          <li key={key} className="flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={!canEdit}
                              aria-label={`Select ${entry.name}`}
                              onChange={(event) =>
                                onSelect(event.target.checked ? [...refs, entry.ref] : refs.filter((ref) => refKey(ref) !== key))
                              }
                              className="size-3.5 accent-amber-400"
                            />
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => onSelect([entry.ref])}
                              title={entry.detail}
                              className={cn(
                                "min-w-0 flex-1 truncate rounded px-1 py-1 text-left text-[11px]",
                                selected ? "bg-amber-400/10 text-amber-100" : "text-stone-300 hover:bg-stone-900",
                              )}
                            >
                              {entry.name}
                              <span className="ml-1 text-[9px] text-stone-500">{entry.detail}</span>
                              {entry.dmOnly ? <span className="ml-1 text-[9px] text-violet-300">DM</span> : null}
                            </button>
                            {canEdit && entry.ref.kind !== "doors" ? (
                              <button
                                type="button"
                                onClick={() => onDelete([entry.ref])}
                                aria-label={`Delete ${entry.name}`}
                                className="flex size-7 items-center justify-center rounded text-stone-600 hover:text-red-300"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {extra}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <FinePrint>The eye hides a layer here only. Nothing about the map changes.</FinePrint>
    </section>
  );
}
