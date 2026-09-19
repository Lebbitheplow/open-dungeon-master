"use client";

import type { ReactNode } from "react";
import type { ObjectEntry } from "@/lib/battlemap/render/painted";
import { BrushPalette, StampPalette } from "@/app/campaigns/[campaignId]/MapTools";
import { DoorHint, LabelDial, LightDial, PropDial, ZoneDial } from "@/app/campaigns/[campaignId]/MapSceneTools";
import { MODES, isPaintMode, type MapTools, type SurfaceCaps } from "@/app/campaigns/[campaignId]/MapToolbox";
import { Blurb, FinePrint, PanelHead } from "@/app/campaigns/[campaignId]/mapUi";

// The options column (docs/visual-overhaul-plan.md 4.3): the held tool's
// name, what it does, and the dial the toolbox has for it. The same content
// fills the phone's tool sheet. Nothing here touches a map: it says what the
// next press on the canvas means.

export type MapCounts = { lights?: number; labels?: number; props?: number; zones?: number };

export function MapOptions({
  tools,
  onTools,
  caps,
  counts,
  onClearLights,
  onClearLabels,
  onClearZones,
  npcNames,
  swatches,
  objects,
  ownSets,
  rollPanel,
  backdropPanel,
}: {
  tools: MapTools;
  onTools: (next: MapTools) => void;
  caps: SurfaceCaps;
  counts?: MapCounts;
  onClearLights?: () => void;
  onClearLabels?: () => void;
  onClearZones?: () => void;
  // The cast, for the bystander token's name dropdown.
  npcNames?: readonly string[];
  // Terrain character to the picture of the skin's material, for the brush
  // swatches and the stamp previews.
  swatches?: Record<string, string>;
  // The painted object set and the sets this map's skin dresses from.
  objects?: readonly ObjectEntry[];
  ownSets?: readonly string[];
  // What the Roll and Align picture tools show; each surface has its own.
  rollPanel?: ReactNode;
  backdropPanel?: ReactNode;
}) {
  const set = (patch: Partial<MapTools>) => onTools({ ...tools, ...patch });
  const entry = MODES.find((mode) => mode.mode === tools.mode);

  if (!entry) {
    return (
      <div className="space-y-2">
        <PanelHead>Tools</PanelHead>
        <Blurb>Pick a tool from the rail and draw on the map.</Blurb>
        <FinePrint>
          Pick a tool. Keys 1 to 6 pick a brush, Escape puts the tool down, Ctrl+Z takes back the last edit.
        </FinePrint>
      </div>
    );
  }

  return (
    // Keyed by mode so the column slides in afresh for each tool.
    <div key={entry.mode} className="map-panel-in space-y-2.5">
      <PanelHead aside={entry.key}>{entry.label}</PanelHead>
      <Blurb>{entry.hint}</Blurb>

      {isPaintMode(tools.mode) ? (
        <BrushPalette
          brush={tools.brush}
          onPick={(next) => (next ? set({ brush: next }) : undefined)}
          radius={tools.mode === "brush" ? tools.radius : undefined}
          onRadius={tools.mode === "brush" ? (radius) => set({ radius }) : undefined}
          swatches={swatches}
        />
      ) : null}

      {tools.mode === "stamp" ? (
        <StampPalette
          stamp={tools.stamp}
          size={tools.stampSize}
          onPick={(next) => (next ? set({ stamp: next }) : set({ mode: "" }))}
          onResize={(stampSize) => set({ stampSize })}
          swatches={swatches}
        />
      ) : null}

      {tools.mode === "light" && caps.lights ? (
        <LightDial value={tools.light} onChange={(light) => set({ light })} count={counts?.lights ?? 0} onClear={onClearLights} />
      ) : null}
      {tools.mode === "label" ? (
        <LabelDial value={tools.label} onChange={(label) => set({ label })} count={counts?.labels ?? 0} onClear={onClearLabels} />
      ) : null}
      {tools.mode === "prop" ? (
        <PropDial
          value={tools.prop}
          onChange={(prop) => set({ prop })}
          count={counts?.props ?? 0}
          npcNames={npcNames}
          objects={objects}
          ownSets={ownSets}
        />
      ) : null}
      {tools.mode === "door" ? <DoorHint /> : null}
      {tools.mode === "zone" ? (
        <ZoneDial
          value={tools.zone}
          kind={tools.zoneKind}
          onChange={(zone) => set({ zone })}
          onKind={(zoneKind) => set({ zoneKind })}
          count={counts?.zones ?? 0}
          onClear={onClearZones}
        />
      ) : null}

      {tools.mode === "pick" ? <FinePrint>Tap a tile to pick up whatever brush painted it.</FinePrint> : null}
      {tools.mode === "pan" ? (
        <FinePrint>Drag to move. Pinch or scroll to zoom; the corner buttons do the same.</FinePrint>
      ) : null}
      {tools.mode === "select" ? (
        <FinePrint>What you select shows in the inspector, with everything that can be done to it.</FinePrint>
      ) : null}
      {tools.mode === "roll" ? rollPanel : null}
      {tools.mode === "backdrop" ? backdropPanel : null}
    </div>
  );
}

// True for the tools whose options are worth raising the phone's sheet for.
// Select, Pick, Move and Door carry only a sentence, so taking them up leaves
// the canvas clear.
export function hasDials(mode: MapTools["mode"]): boolean {
  return mode !== "" && mode !== "select" && mode !== "pick" && mode !== "pan" && mode !== "door";
}
