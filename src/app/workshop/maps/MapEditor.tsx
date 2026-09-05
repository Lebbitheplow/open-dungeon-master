"use client";

import { Copy, Play, Trash2, Upload } from "lucide-react";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import type { Brush as BrushName } from "@/lib/battlemap/paint";
import type { StampKind } from "@/lib/battlemap/stamp";
import { TerrainCanvas } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import {
  BackdropControls,
  BrushPalette,
  StampPalette,
} from "@/app/campaigns/[campaignId]/MapTools";
import { THEME_LABELS, type LibraryState, type PreparedMap } from "@/app/workshop/maps/types";

// One prepared map, open for editing: the canvas, its name and dials, the
// brush and stamp palettes, the backdrop, and what can be done with it.
// Split out of DmMapLibraryPanel so the workshop gallery can show the same
// editor inside a sheet; the drawer still renders it inline, unchanged.
//
// The brush and stamp state stays with the caller on purpose: a DM who picks
// the water brush and then clicks through three maps expects to still be
// holding the water brush.

export type MapTools = {
  brush: BrushName | "";
  stamp: StampKind | "";
  stampSize: { width: number; height: number };
};

export function MapEditor({
  selected,
  state,
  busy,
  tools,
  onTools,
  patch,
  act,
  duplicate,
  remove,
}: {
  selected: PreparedMap;
  state: LibraryState;
  busy: boolean;
  tools: MapTools;
  onTools: (next: MapTools) => void;
  patch: (body: Record<string, unknown>) => Promise<void>;
  act: (action: "deploy" | "open-scene") => Promise<void>;
  duplicate: () => Promise<void>;
  remove: () => Promise<void>;
}) {
  const { brush, stamp, stampSize } = tools;
  const canDeploy = state.board !== null;

  return (
    <section className="space-y-2.5">
      <TerrainCanvas
        terrain={selected.terrain}
        width={selected.width}
        height={selected.height}
        backdrop={selected.backdrop}
        onPaint={
          brush && !stamp ? (x, y) => void patch({ strokes: [{ x, y, brush }] }) : undefined
        }
        onStamp={
          stamp ? (x, y) => void patch({ stamp: { kind: stamp, x, y, ...stampSize } }) : undefined
        }
        stamp={stamp ? { kind: stamp, ...stampSize } : null}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          defaultValue={selected.name}
          key={`name-${selected.id}`}
          onBlur={(event) =>
            event.target.value.trim() && event.target.value !== selected.name
              ? void patch({ name: event.target.value.trim() })
              : undefined
          }
          className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
        />
        <select
          value={selected.theme}
          onChange={(event) => void patch({ theme: event.target.value })}
          className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
        >
          {MAP_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {THEME_LABELS[theme]}
            </option>
          ))}
        </select>
        <select
          value={selected.ambient}
          onChange={(event) => void patch({ ambient: event.target.value })}
          className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
        >
          <option value="bright">Daylight</option>
          <option value="dim">Dim</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <textarea
        defaultValue={selected.notes}
        key={`notes-${selected.id}`}
        onBlur={(event) =>
          event.target.value !== selected.notes ? void patch({ notes: event.target.value }) : undefined
        }
        rows={2}
        placeholder="What lives here. Nobody but you reads this."
        className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
      />

      <BrushPalette
        brush={brush}
        onPick={(next) => onTools({ ...tools, brush: next, stamp: next ? "" : stamp })}
      />
      <StampPalette
        stamp={stamp}
        size={stampSize}
        onPick={(next) => onTools({ ...tools, stamp: next, brush: next ? "" : brush })}
        onResize={(next) => onTools({ ...tools, stampSize: next })}
      />
      <BackdropControls
        backdrop={selected.backdrop}
        busy={busy}
        onChange={(next) => void patch({ backdropPath: next.path, backdropTransform: next.transform })}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy || !canDeploy}
          title={canDeploy ? "Replace the board's ground with this map" : "Nothing is on the table to replace"}
          onClick={() => void act("deploy")}
          className="flex items-center gap-1 rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
        >
          <Upload className="size-3" /> Put it on the table
        </button>
        {state.workshop ? null : (
          <button
            type="button"
            disabled={busy || !state.hasParty || state.board !== null}
            title={
              !state.hasParty
                ? "There is nobody to put on it yet"
                : state.board
                  ? "Something is already on the table"
                  : "Put the party on this map with nobody to fight"
            }
            onClick={() => void act("open-scene")}
            className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
          >
            <Play className="size-3" /> Open it as a scene
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          aria-label={`Duplicate ${selected.name}`}
          onClick={() => void duplicate()}
          className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
        >
          <Copy className="size-3" /> Duplicate
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="ml-auto flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-500 hover:text-red-300 disabled:opacity-50"
        >
          <Trash2 className="size-3" /> Forget it
        </button>
      </div>
      {selected.seed ? <p className="text-[10px] text-stone-600">Seed {selected.seed}.</p> : null}
    </section>
  );
}
