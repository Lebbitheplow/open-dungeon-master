import {
  Armchair,
  Brush as BrushIcon,
  DoorClosed,
  Dices,
  Flame,
  Hand,
  Minus,
  MousePointer2,
  PaintBucket,
  Pipette,
  Shapes,
  Square,
  SquareDashed,
  Sun,
  Tag,
  type LucideIcon,
  Image as ImageIcon,
} from "lucide-react";
import { BRUSH_LABELS, type Brush as BrushName } from "@/lib/battlemap/paint";
import type { ZoneKind } from "@/lib/battlemap/scene";
import type { StampKind } from "@/lib/battlemap/stamp";
import { SHAPE_EFFECTS, type ShapeTool } from "@/lib/battlemap/tools";
import type { AmbientLight } from "@/lib/battlemap/types";
import type { CanvasTool } from "@/app/campaigns/[campaignId]/TerrainCanvas";

// The map editor's toolbox: which tool is in hand, and the dials for it.
// The state, the modes and the keys live here, in a module with no JSX and no
// hooks so scripts/test-map-editor.mjs can hold the rail to the ledger under
// Node; the key handler is MapToolbox.tsx, the rail that shows the modes is
// MapRail.tsx and the dials are MapOptions.tsx.
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
  | "select"
  | "backdrop"
  // Roll the whole field from a seed. It holds nothing on the canvas: the
  // options column shows the forge controls instead.
  | "roll"
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
  // `stamp` is the painted object the next prop is drawn as, if one was picked.
  prop: { name: string; kind: "prop" | "npc"; stamp?: string };
  zone: AmbientLight;
  // Ordinary light, plain darkness, or magical darkness nothing pierces.
  zoneKind: ZoneKind;
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
  zoneKind: "light",
};

// What this surface can hold. The library holds everything; the live board
// holds no props (they are tokens there) and no lights yet.
export type SurfaceCaps = { lights: boolean; props: boolean; scene: boolean };
export const LIBRARY_CAPS: SurfaceCaps = { lights: true, props: true, scene: true };
export const BOARD_CAPS: SurfaceCaps = { lights: false, props: false, scene: true };

export const SHAPE_MODES: ReadonlyArray<ShapeTool> = ["line", "rect", "box", "fill"];

export function isPaintMode(mode: ToolMode): boolean {
  return mode === "brush" || SHAPE_MODES.includes(mode as ShapeTool);
}

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
      return caps.scene ? { kind: "zone", ambient: tools.zone, zoneKind: tools.zoneKind } : null;
    case "pick":
      return { kind: "pick" };
    case "pan":
      return { kind: "pan" };
    case "select":
      return { kind: "select" };
    case "backdrop":
      return { kind: "backdrop" };
    default:
      return null;
  }
}

// The keys, in the order the chips show them. Written for the title text,
// which is how a person on a desk finds out they exist; on a phone the
// chips are the only way in and that is fine.
export type ModeGroup = "paint" | "scene" | "other";
export type ModeEntry = (typeof MODES)[number];

export const MODES: ReadonlyArray<{
  mode: ToolMode;
  label: string;
  key: string;
  icon: LucideIcon;
  hint: string;
  needs?: keyof SurfaceCaps;
  group: ModeGroup;
}> = [
  { mode: "brush", label: "Brush", key: "B", icon: BrushIcon, hint: "Drag to paint, one tile or a square of them.", group: "paint" },
  { mode: "line", label: "Line", key: "L", icon: Minus, hint: SHAPE_EFFECTS.line, group: "paint" },
  { mode: "rect", label: "Outline", key: "R", icon: SquareDashed, hint: SHAPE_EFFECTS.rect, group: "paint" },
  { mode: "box", label: "Box", key: "X", icon: Square, hint: SHAPE_EFFECTS.box, group: "paint" },
  { mode: "fill", label: "Fill", key: "F", icon: PaintBucket, hint: SHAPE_EFFECTS.fill, group: "paint" },
  { mode: "stamp", label: "Stamp", key: "S", icon: Shapes, hint: "Rooms and corridors in one tap.", group: "paint" },
  { mode: "pick", label: "Pick", key: "I", icon: Pipette, hint: "Tap a tile to pick up the brush that painted it.", group: "paint" },
  { mode: "select", label: "Select", key: "V", icon: MousePointer2, hint: "Tap a placed thing to edit, move, copy or delete it. Shift-tap adds to the selection.", needs: "scene", group: "scene" },
  { mode: "light", label: "Light", key: "T", icon: Flame, hint: "Tap a tile to put a light there, or take one away.", needs: "lights", group: "scene" },
  { mode: "door", label: "Door", key: "D", icon: DoorClosed, hint: "Tap a door: open, locked, secret.", needs: "scene", group: "scene" },
  { mode: "label", label: "Label", key: "A", icon: Tag, hint: "Tap a tile to name it.", needs: "scene", group: "scene" },
  { mode: "prop", label: "Prop", key: "P", icon: Armchair, hint: "Tap a tile to put furniture or a bystander there.", needs: "props", group: "scene" },
  { mode: "zone", label: "Light zone", key: "Z", icon: Sun, hint: "Drag a box of light or dark.", needs: "scene", group: "scene" },
  { mode: "roll", label: "Roll", key: "N", icon: Dices, hint: "Roll the whole field from a seed. It lands in the history, so undo puts the old one back.", group: "other" },
  { mode: "pan", label: "Move", key: "M", icon: Hand, hint: "Drag to move the map. Two fingers or the wheel zoom it.", group: "other" },
  { mode: "backdrop", label: "Align picture", key: "K", icon: ImageIcon, hint: "Drag the picture's corners into register with the grid.", group: "other" },
];

// The sheet the `?` key opens (src/components/ui/HotkeyOverlay.tsx).
export function mapHotkeyGroups(caps: SurfaceCaps) {
  const chips = MODES.filter((entry) => !entry.needs || caps[entry.needs]);
  return [
    { title: "Tools", rows: chips.map((entry) => ({ keys: [entry.key], does: entry.label })) },
    {
      title: "Brushes",
      rows: Object.entries(BRUSH_KEYS).map(([key, brush]) => ({ keys: [key], does: BRUSH_LABELS[brush] })),
    },
    {
      title: "Editing",
      rows: [
        { keys: ["Ctrl", "Z"], does: "Undo" },
        { keys: ["Ctrl", "Shift", "Z"], does: "Redo" },
        { keys: ["Esc"], does: "Put the tool down, or clear the selection" },
        { keys: ["Del"], does: "Delete the selection" },
        { keys: ["?"], does: "This sheet" },
      ],
    },
  ];
}

export const BRUSH_KEYS: Record<string, BrushName> = {
  "1": "floor",
  "2": "wall",
  "3": "water",
  "4": "difficult",
  "5": "door",
  "6": "lowwall",
};
