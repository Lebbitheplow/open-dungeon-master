// Which squares of a spell area a player's board draws. Magical darkness and
// a fog cloud stop sight, so their squares are never in what a character has
// explored, and a filter on explored squares alone left players a black
// shroud where the DM saw Darkness. A character knows an area's extent when
// it is their own (they cast it), when they stand in it, or when they can see
// its edge (a square of it beside a square they have explored); then the whole
// area is drawn, outline and label. Creatures inside stay hidden: tokens are
// projected apart, by sight. Pure; scripts/test-hand-look.mjs drives it.

export type ZoneViewer = { characterId: string | null; cell: number | null };

export function knownZoneCells(
  zone: { cells: number[]; casterId?: string | null },
  explored: Set<number>,
  width: number,
  viewer: ZoneViewer | null,
): number[] {
  const seen = zone.cells.filter((cell) => explored.has(cell));
  // The DM (no viewer) sees every square anyway.
  if (!viewer || seen.length === zone.cells.length) {
    return seen;
  }
  const own = Boolean(viewer.characterId) && zone.casterId === viewer.characterId;
  const inside = viewer.cell !== null && zone.cells.includes(viewer.cell);
  const edge = zone.cells.some((cell) => {
    const col = cell % width;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if ((dx || dy) && col + dx >= 0 && col + dx < width && explored.has(cell + dy * width + dx)) {
          return true;
        }
      }
    }
    return false;
  });
  return own || inside || edge ? zone.cells : seen;
}
