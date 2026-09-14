import { OVERWORLD_BRUSH_TILES, type OverworldBrush, type OverworldStroke } from "@/lib/overworld/paint";

// Undo for hand-painted terrain (docs/vtt-parity-implementation-plan.md
// section 10.5). The region route only takes strokes, never a whole
// terrain, so undo is the difference between what is painted now and what
// was painted before, expressed as single-tile strokes in the brush that
// paints each earlier tile. Tiles no brush can paint are left as they are.

const TILE_BRUSH = new Map<string, OverworldBrush>(
  (Object.entries(OVERWORLD_BRUSH_TILES) as Array<[OverworldBrush, string]>).map(([brush, tile]) => [tile, brush]),
);

export function terrainDiffStrokes(current: string, previous: string, width: number): OverworldStroke[] {
  const strokes: OverworldStroke[] = [];
  for (let index = 0; index < previous.length && index < current.length; index += 1) {
    if (current[index] === previous[index]) {
      continue;
    }
    const brush = TILE_BRUSH.get(previous[index] ?? "");
    if (!brush) {
      continue;
    }
    strokes.push({ x: index % width, y: Math.floor(index / width), brush, radius: 0 });
  }
  return strokes;
}
