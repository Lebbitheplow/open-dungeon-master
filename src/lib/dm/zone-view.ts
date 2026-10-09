// The spell areas as a viewer's board draws them (src/lib/battlemap/view.ts
// PlayerMapView.spellZones): each area's squares that viewer knows (explored,
// or the whole area when it is theirs, they stand in it or see its edge), its
// look and a one-line label. The DM's view passes every square.

import type { BattleMap } from "@/lib/db/battle-maps";
import type { Encounter } from "@/lib/db/encounters";
import { zoneRowFor, type ZoneTone } from "@/lib/battlemap/zones-spells";
import { liveZones } from "@/lib/dm/zone-store";
import { sectionOf } from "@/lib/battlemap/zones-walls";
import { knownZoneCells, type ZoneViewer } from "@/lib/battlemap/zone-known";

export type ViewZone = {
  id: string;
  spell: string;
  casterName: string;
  tone: ZoneTone;
  // How it is drawn: a wall is a band, a cloud a soft fill, the rest a tint
  // with an edge.
  look: "wall" | "cloud" | "ground" | "light" | "dark" | "ward";
  cells: number[];
  // Wall of Fire's burning side.
  hot: number[];
  label: string;
  concentration: boolean;
  untilRound: number | null;
  // A sectioned wall (Wall of Ice): each standing section's number and one
  // of its squares, so the board can label what damage_object names.
  sections?: Array<{ n: number; at: number }>;
};

export function viewZones(
  map: BattleMap,
  encounter: Pick<Encounter, "round">,
  explored: Set<number>,
  // A player's character and square; null for the DM's full view.
  viewer: ZoneViewer | null = null,
): ViewZone[] {
  const out: ViewZone[] = [];
  for (const zone of liveZones(map, encounter)) {
    const row = zoneRowFor(zone);
    // Darkness is never "explored": the area is drawn whole where the
    // character knows it (src/lib/battlemap/zone-known.ts).
    const cells = knownZoneCells(zone, explored, map.width, viewer);
    const known = new Set(cells);
    if (!row || !cells.length) {
      continue;
    }
    const look: ViewZone["look"] = row.shape === "wall"
      ? "wall"
      : row.darkness
        ? "dark"
        : row.light
          ? "light"
          : row.obscured === "heavy"
            ? "cloud"
            : row.difficult || row.obscured
              ? "ground"
              : "ward";
    const sectionFeet = row.sections?.feet;
    out.push({
      id: zone.id,
      spell: zone.spell,
      casterName: zone.casterName,
      tone: row.tone,
      look,
      cells,
      hot: (zone.hot ?? []).filter((cell) => known.has(cell)),
      label: `${zone.spell}: ${row.summary}`,
      concentration: zone.concentration,
      untilRound: zone.untilRound,
      ...(sectionFeet
        ? { sections: [...new Map(cells.map((cell) => [sectionOf(zone, cell, map.width, sectionFeet), cell] as const).reverse())].map(([n, at]) => ({ n, at })).sort((a, b) => a.n - b.n) }
        : {}),
    });
  }
  return out;
}
