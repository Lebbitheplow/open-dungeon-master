import { backdropRect, type Backdrop } from "@/lib/battlemap/backdrop";
import { stampFootprint } from "@/lib/battlemap/stamp";
import { shapeStrokes } from "@/lib/battlemap/tools";
import type { DoorStates, LightZone, MapLabel, MapProp } from "@/lib/battlemap/scene";
import { parseDoorKey } from "@/lib/battlemap/scene";
import { TERRAIN, type MapLight, type XY } from "@/lib/battlemap/types";
import type { CanvasTool } from "@/app/campaigns/[campaignId]/TerrainCanvas";

// The drawing passes behind TerrainCanvas, as plain functions over a 2D
// context so the component keeps only its pointer logic. Nothing here
// decides a rule: every layer draws what the server said is true.

const TILE_FILL: Record<string, string> = {
  [TERRAIN.floor]: "#3f3a33",
  [TERRAIN.wall]: "#1b1815",
  [TERRAIN.water]: "#26495e",
  [TERRAIN.difficult]: "#4a4126",
  [TERRAIN.door]: "#6b4f2a",
  [TERRAIN.lowwall]: "#5a5147",
};

// Over a backdrop the terrain stops being the surface and becomes the
// markings on it, the same reasoning the play view follows in
// battleMapCells.tsx: the art is the floor, and the tint says what the rules
// think is there.
const TILE_TINT: Record<string, { fill: string; alpha: number }> = {
  [TERRAIN.wall]: { fill: "#1b1815", alpha: 0.55 },
  [TERRAIN.water]: { fill: "#26495e", alpha: 0.45 },
  [TERRAIN.difficult]: { fill: "#4a4126", alpha: 0.4 },
  [TERRAIN.door]: { fill: "#6b4f2a", alpha: 0.5 },
  [TERRAIN.lowwall]: { fill: "#8a7f70", alpha: 0.5 },
};

const BRUSH_PREVIEW: Record<string, string> = {
  [TERRAIN.floor]: "rgba(214, 203, 180, 0.55)",
  [TERRAIN.wall]: "rgba(20, 16, 12, 0.7)",
  [TERRAIN.water]: "rgba(80, 160, 210, 0.55)",
  [TERRAIN.difficult]: "rgba(200, 160, 60, 0.55)",
  [TERRAIN.door]: "rgba(220, 150, 70, 0.6)",
  [TERRAIN.lowwall]: "rgba(190, 180, 160, 0.6)",
};

const ZONE_TINT: Record<LightZone["ambient"], string> = {
  bright: "rgba(253, 224, 71, 0.16)",
  dim: "rgba(120, 113, 108, 0.28)",
  dark: "rgba(2, 6, 23, 0.55)",
};

// The layers the editor's eye toggles can hide (MapLayersPanel.tsx).
export type MapLayer = "labels" | "props" | "lights" | "zones" | "doors" | "terrain" | "backdrop" | "overlay" | "drawings";
export type HiddenLayers = Partial<Record<MapLayer, boolean>>;

export type Scene = {
  labels?: MapLabel[];
  props?: MapProp[];
  doors?: DoorStates;
  zones?: LightZone[];
  overlay?: { path: string; element: HTMLImageElement } | null;
};

export function drawGround(
  context: CanvasRenderingContext2D,
  input: {
    terrain: string;
    width: number;
    height: number;
    tile: number;
    backdrop: Backdrop | null | undefined;
    image: HTMLImageElement | null;
    // False hides the terrain layer: the picture alone, or the bare well.
    showTerrain?: boolean;
  },
) {
  const { terrain, width, height, tile, backdrop, image } = input;
  const art = Boolean(backdrop && image);
  if (backdrop && image) {
    const rect = backdropRect(backdrop.transform, width, height, tile);
    context.globalAlpha = backdrop.transform.opacity;
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    context.globalAlpha = 1;
  }
  if (input.showTerrain === false) {
    return;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ch = terrain[y * width + x];
      if (art) {
        const tint = TILE_TINT[ch];
        if (!tint) {
          continue;
        }
        context.globalAlpha = tint.alpha;
        context.fillStyle = tint.fill;
        context.fillRect(x * tile, y * tile, tile, tile);
        context.globalAlpha = 1;
        continue;
      }
      context.fillStyle = TILE_FILL[ch] ?? "#2a2724";
      context.fillRect(x * tile, y * tile, tile, tile);
    }
  }
}

// The renderer's picture as the ground (docs/visual-overhaul-plan.md 4.2).
// It is repainted a beat after the terrain changes, so any square that
// differs from the string it was painted from is filled flat until the
// picture catches up: a stroke shows under the brush at once, then turns to
// paint.
export function drawPaintedGround(
  context: CanvasRenderingContext2D,
  input: { terrain: string; width: number; height: number; tile: number; picture: CanvasImageSource; paintedFrom: string },
) {
  const { terrain, width, height, tile, picture, paintedFrom } = input;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(picture, 0, 0, width * tile, height * tile);
  if (paintedFrom === terrain) {
    return;
  }
  for (let index = 0; index < terrain.length; index += 1) {
    if (terrain[index] === paintedFrom[index]) {
      continue;
    }
    const x = index % width;
    const y = Math.floor(index / width);
    context.fillStyle = TILE_FILL[terrain[index]] ?? "#2a2724";
    context.fillRect(x * tile, y * tile, tile, tile);
  }
}

// The edge the painter never opens, drawn so a refused stroke is no surprise.
export function drawBorderGuard(context: CanvasRenderingContext2D, width: number, height: number, tile: number) {
  context.save();
  context.setLineDash([5, 4]);
  context.strokeStyle = "rgba(255, 157, 92, 0.55)";
  context.lineWidth = 1;
  context.strokeRect(tile + 0.5, tile + 0.5, (width - 2) * tile - 1, (height - 2) * tile - 1);
  context.restore();
}

// The backdrop tool's frame: the picture's edge, its two grips, and how many
// pixels of picture one square is showing.
export function drawBackdropHandles(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  width: number,
) {
  context.setLineDash([4, 4]);
  context.strokeStyle = "#d4ab3a";
  context.lineWidth = 1.5;
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.setLineDash([]);
  for (const corner of [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ]) {
    context.fillStyle = "#0c0a09";
    context.beginPath();
    context.arc(corner.x, corner.y, 7, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#d4ab3a";
    context.lineWidth = 2;
    context.stroke();
  }
  context.fillStyle = "rgba(12, 10, 9, 0.85)";
  context.fillRect(4, 4, 150, 18);
  context.fillStyle = "#fde68a";
  context.font = "11px sans-serif";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText(`one square is ${Math.round((rect.width / width) * 10) / 10} px of picture`, 8, 17);
}

export function drawSelection(
  context: CanvasRenderingContext2D,
  boxes: Array<{ x0: number; y0: number; x1: number; y1: number }>,
  tile: number,
) {
  for (const box of boxes) {
    const x = box.x0 * tile + 1;
    const y = box.y0 * tile + 1;
    const w = (box.x1 - box.x0 + 1) * tile - 2;
    const h = (box.y1 - box.y0 + 1) * tile - 2;
    // The halo and the wash only: the line itself is the marching ants laid
    // over the canvas (SelectionAnts in terrainCanvasParts.tsx).
    context.setLineDash([]);
    context.fillStyle = "rgba(212, 171, 58, 0.1)";
    context.fillRect(x, y, w, h);
    context.strokeStyle = "rgba(212, 171, 58, 0.35)";
    context.lineWidth = 6;
    context.strokeRect(x, y, w, h);
  }
}

// ---- a placed thing pops in ----
// The mockup's pop-in keyframes, computed here because the things are paint on
// a canvas, not nodes: half size, past full at 60%, settled at the end.
export const POP_MS = 260;
export function popScale(t: number): number {
  if (t >= 1) {
    return 1;
  }
  if (t <= 0) {
    return 0.5;
  }
  return t < 0.6 ? 0.5 + (0.65 * t) / 0.6 : 1.15 - (0.15 * (t - 0.6)) / 0.4;
}

export type Births = { known: Set<string>; born: Map<string, number> };

// Notes which keys are new since the last draw and forgets the ones whose pop
// has finished. True while anything is still popping, so the caller draws again.
export function trackBirths(births: Births, keys: string[], now: number, still: boolean): boolean {
  for (const [key, at] of births.born) {
    if (now - at >= POP_MS) {
      births.born.delete(key);
    }
  }
  if (!still) {
    for (const key of keys) {
      if (!births.known.has(key)) {
        births.born.set(key, now);
      }
    }
  }
  births.known = new Set(keys);
  for (const key of births.born.keys()) {
    if (!births.known.has(key)) {
      births.born.delete(key);
    }
  }
  return births.born.size > 0;
}

export function withPop(context: CanvasRenderingContext2D, cx: number, cy: number, scale: number, paint: () => void) {
  context.save();
  context.translate(cx, cy);
  context.scale(scale, scale);
  context.translate(-cx, -cy);
  paint();
  context.restore();
}

export function drawLights(context: CanvasRenderingContext2D, lights: MapLight[], tile: number) {
  // A warm pool to the dim radius, a firmer ring at the bright radius, and
  // a spark at the source so the tile can be found again.
  for (const light of lights) {
    const cx = light.x * tile + tile / 2;
    const cy = light.y * tile + tile / 2;
    const dim = context.createRadialGradient(cx, cy, 0, cx, cy, light.dimRadius * tile);
    dim.addColorStop(0, "rgba(251, 191, 36, 0.32)");
    dim.addColorStop(1, "rgba(251, 191, 36, 0)");
    context.fillStyle = dim;
    context.fillRect(cx - light.dimRadius * tile, cy - light.dimRadius * tile, light.dimRadius * tile * 2, light.dimRadius * tile * 2);
    context.strokeStyle = "rgba(251, 191, 36, 0.35)";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(cx, cy, light.brightRadius * tile, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#fbbf24";
    context.beginPath();
    context.arc(cx, cy, Math.max(2, tile * 0.18), 0, Math.PI * 2);
    context.fill();
  }
}

export function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, tile: number) {
  context.strokeStyle = "rgba(0, 0, 0, 0.25)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 1) {
    context.beginPath();
    context.moveTo(x * tile, 0);
    context.lineTo(x * tile, height * tile);
    context.stroke();
  }
  for (let y = 0; y <= height; y += 1) {
    context.beginPath();
    context.moveTo(0, y * tile);
    context.lineTo(width * tile, y * tile);
    context.stroke();
  }
}

// The scene layer: zones under everything else here, then the overlay
// (the DM's annotated picture), then door badges, furniture and labels.
export function drawScene(
  context: CanvasRenderingContext2D,
  scene: Scene,
  input: {
    width: number;
    height: number;
    tile: number;
    backdrop: Backdrop | null | undefined;
    // "x,y" squares whose prop the renderer already painted as a stamp; the
    // marker is skipped there and only the name is written.
    stamped?: ReadonlySet<string>;
  },
) {
  const { width, height, tile } = input;
  for (const zone of scene.zones ?? []) {
    context.fillStyle =
      zone.kind === "magical_darkness"
        ? "rgba(30, 8, 46, 0.7)"
        : zone.kind === "darkness"
          ? "rgba(2, 6, 23, 0.65)"
          : ZONE_TINT[zone.ambient];
    context.fillRect(zone.x0 * tile, zone.y0 * tile, (zone.x1 - zone.x0 + 1) * tile, (zone.y1 - zone.y0 + 1) * tile);
    context.strokeStyle = "rgba(253, 224, 71, 0.5)";
    context.setLineDash([3, 3]);
    context.lineWidth = 1;
    context.strokeRect(zone.x0 * tile, zone.y0 * tile, (zone.x1 - zone.x0 + 1) * tile, (zone.y1 - zone.y0 + 1) * tile);
    context.setLineDash([]);
  }
  if (scene.overlay) {
    // The same register as the backdrop when there is one, the whole grid
    // otherwise: the overlay is the annotated version of the same picture.
    const rect = input.backdrop
      ? backdropRect(input.backdrop.transform, width, height, tile)
      : { x: 0, y: 0, width: width * tile, height: height * tile };
    context.globalAlpha = 0.85;
    context.drawImage(scene.overlay.element, rect.x, rect.y, rect.width, rect.height);
    context.globalAlpha = 1;
  }
  for (const [key, state] of Object.entries(scene.doors ?? {})) {
    const at = parseDoorKey(key);
    if (!at) {
      continue;
    }
    drawBadge(context, at, tile, state === "locked" ? "L" : "S", state === "locked" ? "#f59e0b" : "#a78bfa");
  }
  for (const prop of scene.props ?? []) {
    const cx = prop.x * tile + tile / 2;
    const cy = prop.y * tile + tile / 2;
    context.fillStyle = prop.kind === "npc" ? "#3b6d4a" : "#221d18";
    context.strokeStyle = prop.kind === "npc" ? "#86efac" : "#d6d3d1";
    context.lineWidth = 1.5;
    if (input.stamped?.has(`${prop.x},${prop.y}`)) {
      drawText(context, prop.name, cx, prop.y * tile + tile + 2, tile, "top");
      continue;
    }
    if (prop.kind === "npc") {
      context.beginPath();
      context.arc(cx, cy, tile * 0.38, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    } else {
      context.fillRect(prop.x * tile + tile * 0.15, prop.y * tile + tile * 0.15, tile * 0.7, tile * 0.7);
      context.strokeRect(prop.x * tile + tile * 0.15, prop.y * tile + tile * 0.15, tile * 0.7, tile * 0.7);
    }
    drawText(context, prop.name, cx, prop.y * tile + tile + 2, tile, "top");
  }
  for (const label of scene.labels ?? []) {
    const cx = label.x * tile + tile / 2;
    const cy = label.y * tile + tile / 2;
    context.fillStyle = label.dmOnly ? "rgba(167, 139, 250, 0.9)" : "rgba(251, 191, 36, 0.95)";
    context.beginPath();
    context.arc(cx, cy, Math.max(2, tile * 0.12), 0, Math.PI * 2);
    context.fill();
    drawText(context, label.text, cx, cy - tile * 0.2, tile, "bottom", label.dmOnly);
  }
}

function drawBadge(context: CanvasRenderingContext2D, at: XY, tile: number, glyph: string, colour: string) {
  const x = at.x * tile + tile * 0.55;
  const y = at.y * tile + tile * 0.05;
  const size = Math.max(8, tile * 0.42);
  context.fillStyle = colour;
  context.fillRect(x, y, size, size);
  context.fillStyle = "#0c0a09";
  context.font = `bold ${Math.max(7, size * 0.75)}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(glyph, x + size / 2, y + size / 2 + 0.5);
}

function drawText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tile: number,
  baseline: "top" | "bottom",
  muted = false,
) {
  const size = Math.max(9, Math.min(14, tile * 0.42));
  context.font = `${size}px sans-serif`;
  context.textAlign = "center";
  context.textBaseline = baseline;
  context.lineWidth = 3;
  context.strokeStyle = "rgba(0, 0, 0, 0.85)";
  context.lineJoin = "round";
  context.strokeText(text, x, y);
  context.fillStyle = muted ? "#c4b5fd" : "#fde68a";
  context.fillText(text, x, y);
}

// What is about to happen, drawn where it will happen. Seeing the room
// before stamping it is the difference between a tool and a guess.
export function drawToolPreview(
  context: CanvasRenderingContext2D,
  input: {
    tool: CanvasTool | null;
    hover: XY | null;
    drag: { from: XY; to: XY } | null;
    painting: boolean;
    terrain: string;
    width: number;
    height: number;
    tile: number;
  },
) {
  const { tool, hover, drag, tile } = input;
  if (!tool || !hover) {
    return;
  }
  context.strokeStyle = "rgba(251, 191, 36, 0.9)";
  context.lineWidth = 2;
  switch (tool.kind) {
    case "stamp": {
      const box = stampFootprint({ ...tool.stamp, x: hover.x, y: hover.y });
      context.strokeRect(box.x0 * tile, box.y0 * tile, (box.x1 - box.x0 + 1) * tile, (box.y1 - box.y0 + 1) * tile);
      return;
    }
    case "brush": {
      if (input.painting) {
        return;
      }
      const r = tool.radius;
      context.lineWidth = 1.5;
      context.strokeRect((hover.x - r) * tile, (hover.y - r) * tile, (2 * r + 1) * tile, (2 * r + 1) * tile);
      return;
    }
    case "shape": {
      if (tool.tool === "fill" || !drag) {
        context.strokeRect(hover.x * tile, hover.y * tile, tile, tile);
        return;
      }
      const strokes = shapeStrokes(
        { tool: tool.tool, brush: tool.brush, from: drag.from, to: drag.to },
        input.terrain,
        input.width,
        input.height,
      );
      context.fillStyle = BRUSH_PREVIEW[TERRAIN[tool.brush]] ?? "rgba(251, 191, 36, 0.5)";
      for (const stroke of strokes) {
        context.fillRect(stroke.x * tile, stroke.y * tile, tile, tile);
      }
      return;
    }
    case "zone": {
      if (!drag) {
        context.strokeRect(hover.x * tile, hover.y * tile, tile, tile);
        return;
      }
      const x0 = Math.min(drag.from.x, drag.to.x);
      const y0 = Math.min(drag.from.y, drag.to.y);
      const x1 = Math.max(drag.from.x, drag.to.x);
      const y1 = Math.max(drag.from.y, drag.to.y);
      context.fillStyle =
        tool.zoneKind === "magical_darkness"
          ? "rgba(30, 8, 46, 0.7)"
          : tool.zoneKind === "darkness"
            ? "rgba(2, 6, 23, 0.65)"
            : ZONE_TINT[tool.ambient];
      context.fillRect(x0 * tile, y0 * tile, (x1 - x0 + 1) * tile, (y1 - y0 + 1) * tile);
      context.strokeRect(x0 * tile, y0 * tile, (x1 - x0 + 1) * tile, (y1 - y0 + 1) * tile);
      return;
    }
    case "light": {
      const cx = hover.x * tile + tile / 2;
      const cy = hover.y * tile + tile / 2;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(cx, cy, tool.brightRadius * tile, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([4, 4]);
      context.beginPath();
      context.arc(cx, cy, tool.dimRadius * tile, 0, Math.PI * 2);
      context.stroke();
      context.setLineDash([]);
      return;
    }
    default:
      // pick, label, prop, door: the tile under the cursor.
      if (tool.kind !== "pan") {
        context.strokeRect(hover.x * tile, hover.y * tile, tile, tile);
      }
  }
}

// The placed things of a map, drawn with the new ones popping. What was there
// last draw is drawn as ever; a newcomer is drawn alone, scaled about its own
// centre. True while anything is still popping.
export function drawPlaced(
  context: CanvasRenderingContext2D,
  births: Births,
  placed: {
    lights: MapLight[];
    labels: MapLabel[];
    props: MapProp[];
    zones: LightZone[];
    doors: Scene["doors"];
    overlay: Scene["overlay"];
    input: Parameters<typeof drawScene>[2];
    still: boolean;
  },
): boolean {
  const { lights, labels, props, zones, input } = placed;
  const tile = input.tile;
  const at = (kind: string, spot: XY) => `${kind}:${spot.x},${spot.y}`;
  const zoneKey = (zone: LightZone) => `zone:${zone.x0},${zone.y0},${zone.x1},${zone.y1}`;
  const now = performance.now();
  const popping = trackBirths(
    births,
    [...lights.map((light) => at("light", light)), ...labels.map((label) => at("label", label)), ...props.map((prop) => at("prop", prop)), ...zones.map(zoneKey)],
    now,
    placed.still,
  );
  const settled = (key: string) => !births.born.has(key);
  drawLights(context, popping ? lights.filter((light) => settled(at("light", light))) : lights, tile);
  drawScene(
    context,
    {
      labels: popping ? labels.filter((label) => settled(at("label", label))) : labels,
      props: popping ? props.filter((prop) => settled(at("prop", prop))) : props,
      doors: placed.doors,
      zones: popping ? zones.filter((zone) => settled(zoneKey(zone))) : zones,
      overlay: placed.overlay,
    },
    input,
  );
  if (!popping) {
    return false;
  }
  const centre = (spot: XY) => [(spot.x + 0.5) * tile, (spot.y + 0.5) * tile] as const;
  const scaleOf = (key: string) => popScale((now - (births.born.get(key) ?? now)) / POP_MS);
  for (const zone of zones.filter((entry) => !settled(zoneKey(entry)))) {
    withPop(context, ((zone.x0 + zone.x1 + 1) / 2) * tile, ((zone.y0 + zone.y1 + 1) / 2) * tile, scaleOf(zoneKey(zone)), () =>
      drawScene(context, { zones: [zone] }, input),
    );
  }
  for (const light of lights.filter((entry) => !settled(at("light", entry)))) {
    withPop(context, ...centre(light), scaleOf(at("light", light)), () => drawLights(context, [light], tile));
  }
  for (const prop of props.filter((entry) => !settled(at("prop", entry)))) {
    withPop(context, ...centre(prop), scaleOf(at("prop", prop)), () => drawScene(context, { props: [prop] }, input));
  }
  for (const label of labels.filter((entry) => !settled(at("label", entry)))) {
    withPop(context, ...centre(label), scaleOf(at("label", label)), () => drawScene(context, { labels: [label] }, input));
  }
  return true;
}
