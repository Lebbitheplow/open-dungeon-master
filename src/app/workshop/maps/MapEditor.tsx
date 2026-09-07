"use client";

import { useCallback } from "react";
import { Copy, Play, Trash2, Upload } from "lucide-react";
import { MAP_THEMES } from "@/lib/battlemap/generate";
import { TERRAIN, tileAt } from "@/lib/battlemap/types";
import type { Brush as BrushName } from "@/lib/battlemap/paint";
import { collectTags } from "@/lib/workshop/pickers";
import { AddFromList } from "@/components/ui/AddFromList";
import { TerrainCanvas } from "@/app/campaigns/[campaignId]/TerrainCanvas";
import { BackdropControls } from "@/app/campaigns/[campaignId]/MapTools";
import { AmbienceControls, OverlayControls } from "@/app/campaigns/[campaignId]/MapSceneTools";
import {
  LIBRARY_CAPS,
  MapToolbox,
  canvasToolFor,
  useMapHotkeys,
  type MapTools,
} from "@/app/campaigns/[campaignId]/MapToolbox";
import { usePainter } from "@/app/campaigns/[campaignId]/usePainter";
import { THEME_LABELS, type LibraryState, type PreparedMap } from "@/app/workshop/maps/types";

// One prepared map, open for editing: the canvas, its name and dials, the
// toolbox, the scene layer, the backdrop, and what can be done with it.
// Split out of DmMapLibraryPanel so the workshop gallery can show the same
// editor inside a sheet; the drawer still renders it inline, unchanged.
//
// The tool state stays with the caller on purpose: a DM who picks the water
// brush and then clicks through three maps expects to still be holding the
// water brush. The undo history is this map's own and starts fresh per map.

export type { MapTools } from "@/app/campaigns/[campaignId]/MapToolbox";

const CHAR_TO_BRUSH = Object.fromEntries(
  Object.entries(TERRAIN).map(([brush, char]) => [char, brush]),
) as Record<string, BrushName>;

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
  npcNames,
}: {
  selected: PreparedMap;
  state: LibraryState;
  busy: boolean;
  tools: MapTools;
  onTools: (next: MapTools) => void;
  // Resolves true when the server took the edit.
  patch: (body: Record<string, unknown>) => Promise<boolean>;
  act: (action: "deploy" | "open-scene") => Promise<void>;
  duplicate: () => Promise<void>;
  remove: () => Promise<void>;
  // The cast, for the bystander token's name dropdown.
  npcNames?: readonly string[];
}) {
  const canDeploy = state.board !== null;
  // Tags already used on the other maps, offered beside the tag field.
  const knownTags = collectTags(state.maps.filter((map) => map.id !== selected.id));
  const painter = usePainter({ key: selected.id, terrain: selected.terrain, send: patch });
  const undo = {
    canUndo: painter.canUndo,
    canRedo: painter.canRedo,
    onUndo: () => void painter.undo(),
    onRedo: () => void painter.redo(),
  };
  useMapHotkeys({ enabled: true, tools, onTools, caps: LIBRARY_CAPS, undo });

  const pick = useCallback(
    (x: number, y: number) => {
      const brush = CHAR_TO_BRUSH[tileAt(selected.terrain, selected.width, x, y)];
      if (brush) {
        onTools({ ...tools, brush, mode: "brush" });
      }
    },
    [selected, tools, onTools],
  );

  // A tap on a labelled tile takes the label away; anywhere else puts the
  // dial's text there. Props work the same way.
  function label(x: number, y: number) {
    const existing = selected.labels.find((entry) => entry.x === x && entry.y === y);
    const rest = selected.labels.filter((entry) => !(entry.x === x && entry.y === y));
    if (existing) {
      void patch({ labels: rest });
      return;
    }
    if (tools.label.text.trim()) {
      void patch({ labels: [...rest, { x, y, text: tools.label.text.trim(), dmOnly: tools.label.dmOnly }] });
    }
  }

  function prop(x: number, y: number) {
    const existing = selected.props.find((entry) => entry.x === x && entry.y === y);
    const rest = selected.props.filter((entry) => !(entry.x === x && entry.y === y));
    if (existing) {
      void patch({ props: rest });
      return;
    }
    if (tools.prop.name.trim()) {
      void patch({ props: [...rest, { x, y, name: tools.prop.name.trim(), kind: tools.prop.kind }] });
    }
  }

  return (
    <section className="space-y-2.5">
      <TerrainCanvas
        terrain={selected.terrain}
        width={selected.width}
        height={selected.height}
        backdrop={selected.backdrop}
        lights={selected.lights}
        labels={selected.labels}
        props={selected.props}
        doors={selected.doors}
        zones={selected.zones}
        overlayPath={selected.overlayPath}
        tool={canvasToolFor(tools, LIBRARY_CAPS)}
        zoomable
        onStroke={(x, y) => painter.stroke(x, y, tools.brush, tools.radius)}
        onStrokeEnd={painter.strokeEnd}
        onShape={(from, to) => void painter.shape(tools.mode, tools.brush, from, to)}
        onStamp={(x, y) => void painter.edit({ stamp: { kind: tools.stamp, x, y, ...tools.stampSize } })}
        onLight={(x, y) => void patch({ light: { x, y, ...tools.light } })}
        onLabel={label}
        onProp={prop}
        onDoor={(x, y) => void patch({ door: { x, y } })}
        onZone={(from, to) =>
          void patch({ zones: [...selected.zones, { x0: from.x, y0: from.y, x1: to.x, y1: to.y, ambient: tools.zone }] })
        }
        onPick={pick}
      />

      <MapToolbox
        tools={tools}
        onTools={onTools}
        caps={LIBRARY_CAPS}
        counts={{
          lights: selected.lights.length,
          labels: selected.labels.length,
          props: selected.props.length,
          zones: selected.zones.length,
        }}
        onClearLights={() => void patch({ lights: [] })}
        onClearLabels={() => void patch({ labels: [] })}
        onClearZones={() => void patch({ zones: [] })}
        undo={undo}
        npcNames={npcNames}
      />

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          defaultValue={selected.name}
          key={`name-${selected.id}`}
          aria-label="Map name"
          onBlur={(event) =>
            event.target.value.trim() && event.target.value !== selected.name
              ? void patch({ name: event.target.value.trim() })
              : undefined
          }
          className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
        />
        <select
          value={selected.theme}
          aria-label="Theme"
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
          aria-label="Ambient light"
          onChange={(event) => void patch({ ambient: event.target.value })}
          className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
        >
          <option value="bright">Daylight</option>
          <option value="dim">Dim</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          defaultValue={selected.tags.join(", ")}
          key={`tags-${selected.id}-${selected.tags.join("|")}`}
          aria-label="Tags"
          placeholder="Tags, comma separated: crypt, undead, act two"
          onBlur={(event) => {
            const tags = event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean);
            if (tags.join("\n") !== selected.tags.join("\n")) {
              void patch({ tags });
            }
          }}
          className="min-w-40 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
        />
        <AddFromList
          prompt="Add a tag you already use"
          options={knownTags.filter((tag) => !selected.tags.includes(tag))}
          onPick={(tag) => void patch({ tags: [...selected.tags, tag] })}
        />
      </div>

      <textarea
        defaultValue={selected.notes}
        key={`notes-${selected.id}`}
        aria-label="Notes"
        onBlur={(event) =>
          event.target.value !== selected.notes ? void patch({ notes: event.target.value }) : undefined
        }
        rows={2}
        placeholder="What lives here. Nobody but you reads this."
        className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
      />

      <AmbienceControls value={selected.ambience} onChange={(ambience) => void patch({ ambience })} />

      <BackdropControls
        backdrop={selected.backdrop}
        busy={busy}
        onChange={(next) => void patch({ backdropPath: next.path, backdropTransform: next.transform })}
      />
      <OverlayControls overlayPath={selected.overlayPath} busy={busy} onChange={(overlayPath) => void patch({ overlayPath })} />

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
