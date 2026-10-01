// Two walls whose rules reach past their own squares (SRD 5.1). Pure, like
// the rest of this directory; src/lib/dm/zone-store.ts, zone-cast.ts,
// zone-triggers.ts and zone-walls.ts read the board and write it back.
//
//   - Wind Wall "keeps fog, smoke, and other gases at bay": a cloud of gas
//     (a row marked `gas`) loses the wall's own squares and every square
//     whose line from the cloud's centre crosses the wall.
//   - Wall of Ice is made of 10-foot sections, numbered from the end it was
//     laid from ("Wall of Ice section 1"), each with its own armor class and
//     hit points; a section brought to 0 leaves a sheet of frigid air.

import { chebyshev, type XY } from "@/lib/battlemap/types";
import { lineCells, type SpellZone } from "@/lib/battlemap/zones";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";

const xyOf = (cell: number, width: number): XY => ({ x: cell % width, y: Math.floor(cell / width) });

// The areas with every gas cloud held back by the Wind Walls among them.
export function holdGasesBack(zones: SpellZone[], width: number): SpellZone[] {
  const barrier = new Set(zones.filter((zone) => zoneRowFor(zone.spell)?.keepsGasesOut).flatMap((zone) => zone.cells));
  if (!barrier.size) {
    return zones;
  }
  return zones.map((zone) => {
    if (!zoneRowFor(zone.spell)?.gas) {
      return zone;
    }
    const kept = zone.cells.filter((cell) => !lineCells(width, zone.origin, xyOf(cell, width)).some((step) => barrier.has(step)));
    return kept.length === zone.cells.length ? zone : { ...zone, cells: kept };
  });
}

// The section a square of a sectioned wall belongs to: the wall runs from
// its origin one square a step, so the step count is the distance.
export function sectionOf(zone: Pick<SpellZone, "origin">, cell: number, width: number, sectionFeet: number): number {
  const at = xyOf(cell, width);
  return Math.floor(chebyshev(zone.origin.x, zone.origin.y, at.x, at.y) / Math.max(1, Math.round(sectionFeet / 5))) + 1;
}

export function sectionCells(zone: Pick<SpellZone, "origin" | "cells">, section: number, width: number, sectionFeet: number): number[] {
  return zone.cells.filter((cell) => sectionOf(zone, cell, width, sectionFeet) === section);
}

// "Wall of Ice section 3", "wall of ice, section 3", "Wall of Ice #3":
// the wall's spell name and the section number, or null for another name.
export function parseSectionName(name: string): { spell: string; section: number | null } | null {
  const text = name.trim().toLowerCase().replace(/\s+/g, " ");
  const numbered = /^(?:the )?(.*?)[,:]?\s*(?:section|#|no\.?)\s*(\d{1,3})$/.exec(text);
  const spell = numbered ? numbered[1].trim() : text.replace(/^the /, "");
  const row = zoneRowFor(spell);
  if (!row?.sections) {
    return null;
  }
  return { spell, section: numbered ? Number(numbered[2]) : null };
}
