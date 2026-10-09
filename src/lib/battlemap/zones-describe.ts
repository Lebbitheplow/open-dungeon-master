// What the narrator reads of the spell areas on a board (GAME STATE, via
// src/lib/battlemap/serialize.ts): one line per area. Pure.

import type { SpellZone } from "@/lib/battlemap/zones";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";

const rowOf = (zone: SpellZone) => zoneRowFor(zone);

function span(zone: SpellZone, width: number): string {
  if (!zone.cells.length) {
    return "no squares";
  }
  const xs = zone.cells.map((cell) => cell % width);
  const ys = zone.cells.map((cell) => Math.floor(cell / width));
  return `(${Math.min(...xs)},${Math.min(...ys)})-(${Math.max(...xs)},${Math.max(...ys)})`;
}

// One line per area for GAME STATE: whose, how long, where, what it does.
export function describeZones(zones: SpellZone[], width: number): string[] {
  if (!zones.length) {
    return [];
  }
  const lines = ["Spell areas on the board (the server applies them to movement, sight, casting and turns; never narrate their numbers yourself):"];
  for (const zone of zones) {
    const row = rowOf(zone);
    if (!row) {
      continue;
    }
    const lasting = zone.concentration
      ? `${zone.casterName || "its caster"}'s concentration`
      : zone.untilRound === null
        ? "the rest of the fight"
        : `through round ${zone.untilRound}`;
    lines.push(`- ${zone.spell} (${zone.casterName || "unknown caster"}; lasts ${lasting}) covering ${span(zone, width)}, ${zone.cells.length} squares: ${row.summary}.`);
  }
  return lines;
}
