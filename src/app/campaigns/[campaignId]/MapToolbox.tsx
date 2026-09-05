"use client";

import { useEffect } from "react";
import {
  Armchair,
  Brush as BrushIcon,
  DoorClosed,
  Flame,
  Hand,
  Minus,
  PaintBucket,
  Pipette,
  Redo2,
  Shapes,
  Square,
  SquareDashed,
  Sun,
  Tag,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Brush as BrushName } from "@/lib/battlemap/paint";
import type { StampKind } from "@/lib/battlemap/stamp";
import { SHAPE_EFFECTS, type ShapeTool } from "@/lib/battlemap/tools";
import { LIGHT_LIMITS, LIGHT_PRESETS, describeLight } from "@/lib/battlemap/lights";
import { TILE_FEET, type AmbientLight } from "@/lib/battlemap/types";
import { BrushPalette, StampPalette } from "@/app/campaigns/[campaignId]/MapTools";
import { DoorHint, LabelDial, PropDial, ZoneDial } from "@/app/campaigns/[campaignId]/MapSceneTools";
import type { CanvasTool } from "@/app/campaigns/[campaignId]/TerrainCanvas";

// The map editor's toolbox: which tool is in hand, and the dials for it.
//
// One state shape for the studio and the library, so a DM who picks the
// water brush and then clicks through three maps is still holding the
// water brush. Nothing here touches a map: the toolbox says what the next
// pointer press means, and the canvas reports it.

export type ToolMode =
  | "brush"
  | "line"
  | "rect"
  | "box"
  | "fill"
  | "stamp"
  | "light"
  | "label"
  | "prop"
  | "door"
  | "zone"
  | "pick"
  | "pan"
  | "";

export type MapTools = {
  mode: ToolMode;
  brush: BrushName;
  // Square brush, in tiles either side of the centre. 0 paints one tile.
  radius: number;
  stamp: StampKind;
  stampSize: { width: number; height: number };
  light: { brightRadius: number; dimRadius: number };
  label: { text: string; dmOnly: boolean };
  prop: { name: string; kind: "prop" | "npc" };
  zone: AmbientLight;
};

export const DEFAULT_MAP_TOOLS: MapTools = {
  mode: "",
  brush: "wall",
  radius: 0,
  stamp: "room",
  stampSize: { width: 5, height: 4 },
  light: { brightRadius: 4, dimRadius: 8 },
  label: { text: "", dmOnly: false },
  prop: { name: "", kind: "prop" },
  zone: "dark",
};

// What this surface can hold. The library holds everything; the live board
// holds no props (they are tokens there) and no lights yet.
export type SurfaceCaps = { lights: boolean; props: boolean; scene: boolean };
export const LIBRARY_CAPS: SurfaceCaps = { lights: true, props: true, scene: true };
export const BOARD_CAPS: SurfaceCaps = { lights: false, props: false, scene: true };

const SHAPE_MODES: ReadonlyArray<ShapeTool> = ["line", "rect", "box", "fill"];

export function canvasToolFor(tools: MapTools, caps: SurfaceCaps): CanvasTool | null {
  switch (tools.mode) {
    case "brush":
      return { kind: "brush", brush: tools.brush, radius: tools.radius };
    case "line":
    case "rect":
    case "box":
    case "fill":
      return { kind: "shape", tool: tools.mode, brush: tools.brush };
    case "stamp":
      return { kind: "stamp", stamp: { kind: tools.stamp, ...tools.stampSize } };
    case "light":
      return caps.lights ? { kind: "light", ...tools.light } : null;
    case "label":
      return caps.scene ? { kind: "label" } : null;
    case "prop":
      return caps.props ? { kind: "prop" } : null;
    case "door":
      return caps.scene ? { kind: "door" } : null;
    case "zone":
      return caps.scene ? { kind: "zone", ambient: tools.zone } : null;
    case "pick":
      return { kind: "pick" };
    case "pan":
      return { kind: "pan" };
    default:
      return null;
  }
}

// The keys, in the order the chips show them. Written for the title text,
// which is how a person on a desk finds out they exist; on a phone the
// chips are the only way in and that is fine.
const MODES: ReadonlyArray<{ mode: ToolMode; label: string; key: string; icon: LucideIcon; hint: string; needs?: keyof SurfaceCaps }> = [
  { mode: "brush", label: "Brush", key: "B", icon: BrushIcon, hint: "Drag to paint, one tile or a square of them." },
  { mode: "line", label: "Line", key: "L", icon: Minus, hint: SHAPE_EFFECTS.line },
  { mode: "rect", label: "Outline", key: "R", icon: SquareDashed, hint: SHAPE_EFFECTS.rect },
  { mode: "box", label: "Box", key: "X", icon: Square, hint: SHAPE_EFFECTS.box },
  { mode: "fill", label: "Fill", key: "F", icon: PaintBucket, hint: SHAPE_EFFECTS.fill },
  { mode: "stamp", label: "Stamp", key: "S", icon: Shapes, hint: "Rooms and corridors in one tap." },
  { mode: "light", label: "Light", key: "T", icon: Flame, hint: "Tap a tile to put a light there, or take one away.", needs: "lights" },
  { mode: "door", label: "Door", key: "D", icon: DoorClosed, hint: "Tap a door: open, locked, secret.", needs: "scene" },
  { mode: "label", label: "Label", key: "A", icon: Tag, hint: "Tap a tile to name it.", needs: "scene" },
  { mode: "prop", label: "Prop", key: "P", icon: Armchair, hint: "Tap a tile to put furniture or a bystander there.", needs: "props" },
  { mode: "zone", label: "Light zone", key: "Z", icon: Sun, hint: "Drag a box of light or dark.", needs: "scene" },
  { mode: "pick", label: "Pick", key: "I", icon: Pipette, hint: "Tap a tile to pick up the brush that painted it." },
  { mode: "pan", label: "Move", key: "M", icon: Hand, hint: "Drag to move the map. Two fingers or the wheel zoom it." },
];

const BRUSH_KEYS: Record<string, BrushName> = { "1": "floor", "2": "wall", "3": "water", "4": "difficult", "5": "door" };

export type UndoControls = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

function typingSomewhere(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
}

// The keys, while an editor is on screen. With on-screen equivalents for
// every one, because the phone has no keys.
export function useMapHotkeys({
  enabled,
  tools,
  onTools,
  caps,
  undo,
}: {
  enabled: boolean;
  tools: MapTools;
  onTools: (next: MapTools) => void;
  caps: SurfaceCaps;
  undo?: UndoControls;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (typingSomewhere(event.target)) {
        return;
      }
      const meta = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (meta && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          undo?.onRedo();
        } else {
          undo?.onUndo();
        }
        return;
      }
      if (meta && key === "y") {
        event.preventDefault();
        undo?.onRedo();
        return;
      }
      if (meta || event.altKey) {
        return;
      }
      if (event.key === "Escape") {
        onTools({ ...tools, mode: "" });
        return;
      }
      const brush = BRUSH_KEYS[event.key];
      if (brush) {
        const painting = ["brush", "line", "rect", "box", "fill"].includes(tools.mode);
        onTools({ ...tools, brush, mode: painting ? tools.mode : "brush" });
        return;
      }
      const chip = MODES.find((entry) => entry.key.toLowerCase() === key);
      if (chip && (!chip.needs || caps[chip.needs])) {
        onTools({ ...tools, mode: tools.mode === chip.mode ? "" : chip.mode });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, tools, onTools, caps, undo]);
}

export function MapToolbox({
  tools,
  onTools,
  caps,
  counts,
  onClearLights,
  onClearLabels,
  onClearZones,
  undo,
}: {
  tools: MapTools;
  onTools: (next: MapTools) => void;
  caps: SurfaceCaps;
  counts?: { lights?: number; labels?: number; props?: number; zones?: number };
  onClearLights?: () => void;
  onClearLabels?: () => void;
  onClearZones?: () => void;
  undo?: UndoControls;
}) {
  const set = (patch: Partial<MapTools>) => onTools({ ...tools, ...patch });
  const painting = tools.mode === "brush" || SHAPE_MODES.includes(tools.mode as ShapeTool);
  const chips = MODES.filter((entry) => !entry.needs || caps[entry.needs]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1">
        {chips.map(({ mode, label, key, icon: Icon, hint }) => (
          <button
            key={mode}
            type="button"
            title={`${hint} (${key})`}
            aria-pressed={tools.mode === mode}
            onClick={() => set({ mode: tools.mode === mode ? "" : mode })}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]",
              tools.mode === mode
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            <Icon className="size-3" /> {label}
          </button>
        ))}
        {undo ? (
          <span className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={!undo.canUndo}
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              onClick={undo.onUndo}
              className="rounded-md border border-stone-700 p-1 text-stone-300 hover:text-amber-200 disabled:opacity-40"
            >
              <Undo2 className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={!undo.canRedo}
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              onClick={undo.onRedo}
              className="rounded-md border border-stone-700 p-1 text-stone-300 hover:text-amber-200 disabled:opacity-40"
            >
              <Redo2 className="size-3.5" />
            </button>
          </span>
        ) : null}
      </div>

      {painting ? (
        <BrushPalette
          brush={tools.brush}
          onPick={(next) => (next ? set({ brush: next }) : undefined)}
          radius={tools.mode === "brush" ? tools.radius : undefined}
          onRadius={tools.mode === "brush" ? (radius) => set({ radius }) : undefined}
        />
      ) : null}

      {tools.mode === "stamp" ? (
        <StampPalette
          stamp={tools.stamp}
          size={tools.stampSize}
          onPick={(next) => (next ? set({ stamp: next }) : set({ mode: "" }))}
          onResize={(stampSize) => set({ stampSize })}
        />
      ) : null}

      {tools.mode === "light" && caps.lights ? (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-stone-500">
            <Flame className="size-3.5" /> Light a tile
          </p>
          <div className="flex flex-wrap gap-1">
            {LIGHT_PRESETS.map((preset) => {
              const active =
                preset.brightRadius === tools.light.brightRadius && preset.dimRadius === tools.light.dimRadius;
              return (
                <button
                  key={preset.id}
                  type="button"
                  title={describeLight(preset)}
                  onClick={() => set({ light: { brightRadius: preset.brightRadius, dimRadius: preset.dimRadius } })}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[11px]",
                    active
                      ? "border-amber-700 bg-amber-950/50 text-amber-100"
                      : "border-stone-700 text-stone-400 hover:text-stone-200",
                  )}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
            {(["brightRadius", "dimRadius"] as const).map((side) => (
              <label key={side} className="flex items-center gap-1">
                {side === "brightRadius" ? "Bright" : "Dim"}
                <input
                  type="range"
                  min={LIGHT_LIMITS.minRadius}
                  max={LIGHT_LIMITS.maxRadius}
                  value={tools.light[side]}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    const light = { ...tools.light, [side]: value };
                    if (light.dimRadius < light.brightRadius) {
                      light.dimRadius = light.brightRadius;
                    }
                    set({ light });
                  }}
                  className="w-20 accent-amber-500"
                />
                <span className="w-10 tabular-nums text-stone-400">{tools.light[side] * TILE_FEET}ft</span>
              </label>
            ))}
            {counts?.lights && onClearLights ? (
              <button
                type="button"
                onClick={onClearLights}
                className="rounded-md border border-stone-700 px-2 py-0.5 text-stone-400 hover:text-red-300"
              >
                Put out all {counts.lights}
              </button>
            ) : null}
          </div>
          <p className="text-[10px] text-stone-600">
            Tap a tile to light it; tap a lit tile to put it out. Up to {LIGHT_LIMITS.max} on a map.
          </p>
        </div>
      ) : null}

      {tools.mode === "label" ? (
        <LabelDial value={tools.label} onChange={(label) => set({ label })} count={counts?.labels ?? 0} onClear={onClearLabels} />
      ) : null}
      {tools.mode === "prop" ? (
        <PropDial value={tools.prop} onChange={(prop) => set({ prop })} count={counts?.props ?? 0} />
      ) : null}
      {tools.mode === "door" ? <DoorHint /> : null}
      {tools.mode === "zone" ? (
        <ZoneDial value={tools.zone} onChange={(zone) => set({ zone })} count={counts?.zones ?? 0} onClear={onClearZones} />
      ) : null}

      {tools.mode === "pick" ? (
        <p className="text-[10px] text-stone-600">Tap a tile to pick up whatever brush painted it.</p>
      ) : null}
      {tools.mode === "pan" ? (
        <p className="text-[10px] text-stone-600">Drag to move. Pinch or scroll to zoom; the corner buttons do the same.</p>
      ) : null}
      {!tools.mode ? (
        <p className="text-[10px] text-stone-600">
          Pick a tool. Keys 1 to 5 pick a brush, Escape puts the tool down, Ctrl+Z takes back the last edit.
        </p>
      ) : null}
    </div>
  );
}
