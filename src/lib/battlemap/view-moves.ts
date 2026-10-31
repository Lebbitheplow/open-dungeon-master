// What a player's projection says about their own move and the silence on
// the board, asked of the rules the move route and the engine ask: the cost
// of each reachable square for a prone character, a jump's reach, a grapple's
// drag, and the Silence chip on a creature standing in it. Split from
// view.ts, which builds the projection around these. Pure: no database.

import type { EncounterEnemy } from "@/lib/db/encounters";
import { proneCharge } from "@/lib/battlemap/board-move";
import { speedToTiles } from "@/lib/battlemap/movement";
import { tileIndex, type BattleToken } from "@/lib/battlemap/types";
import type { PlayerMapView } from "@/lib/battlemap/view-types";
import { zoneRowFor } from "@/lib/battlemap/zones-spells";
import { dragCostFactor, grappledBy } from "@/lib/dm/drag";
import { computeAbilityScore } from "@/lib/dm/roll-riders";
import type { ViewZone } from "@/lib/dm/zone-view";
import { sizeForRace } from "@/lib/srd";
import { standUpTiles } from "@/lib/srd/authored-effects-more";
import { highJumpFeet, longJumpFeet, RUN_UP_TILES } from "@/lib/srd/jump";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Whether a character's move is priced as standing up or crawling: prone,
// in a fight (a scene has no rounds to spend). view.ts asks it too, to know
// whether to price the crawl.
export function movesProne(sheet: CharacterSheet, scene: boolean): boolean {
  return !scene && sheet.conditions.some((entry) => entry.trim().toLowerCase() === "prone");
}

export function viewerMoves(input: {
  // Each reachable square and the squares it costs to walk there.
  costs: Array<readonly [number, number]>;
  // A prone character's: each square and what crawling there costs.
  crawlCosts?: Array<readonly [number, number]>;
  sheet: CharacterSheet;
  token: BattleToken;
  // An exploration scene: no rounds, so a run-up is always had.
  scene: boolean;
  budget: { speed: number; fullTiles: number };
  enemies: EncounterEnemy[];
}): { reachable: number[]; reachableCost: number[]; moves: NonNullable<PlayerMapView["moves"]> } {
  const { costs, sheet, token, scene, budget } = input;
  // A prone character pays for standing or crawls, every square one extra:
  // the square costs what the move route will charge (board-move.ts
  // proneCharge). A crawl can reach a square the walk's lit budget (half
  // the movement) does not, so both lists are read.
  const prone = movesProne(sheet, scene);
  const stand = standUpTiles(sheet, speedToTiles(budget.speed));
  const walks = new Map(costs);
  const crawls = new Map(input.crawlCosts ?? []);
  const cells = prone ? [...new Set([...walks.keys(), ...crawls.keys()])] : [...walks.keys()];
  const charged = cells
    .map((cell) => [cell, prone ? proneCharge(walks.get(cell), crawls.get(cell), stand, budget.fullTiles)?.cost : walks.get(cell)] as const)
    .filter((entry): entry is readonly [number, number] => entry[1] !== undefined);
  const strength = computeAbilityScore(sheet, "str");
  const runningStart = scene || token.movedThisRound >= RUN_UP_TILES;
  const held = input.enemies.filter((enemy) => enemy.status === "alive" && grappledBy(enemy, sheet.id));
  return {
    reachable: charged.map(([cell]) => cell),
    reachableCost: charged.map(([, cost]) => cost),
    moves: {
      jumpFeet: longJumpFeet(strength, runningStart),
      highJumpFeet: highJumpFeet(strength, runningStart),
      runningStart,
      drag: held.length
        ? {
            factor: dragCostFactor(sizeForRace(sheet.race), held.map((enemy) => ({ refId: enemy.id, name: enemy.displayName, size: enemy.stats.size }))),
            names: held.map((enemy) => enemy.displayName),
          }
        : null,
    },
  };
}

// A creature standing in Silence is deafened by it: the engine reads the
// area, not a condition (src/lib/dm/zone-rules.ts), so its chip is added
// here from the same area the board draws.
export function addSilenceChips(
  spellZones: ViewZone[],
  shownTokens: Array<{ id: string; x: number; y: number }>,
  tokenConditions: PlayerMapView["tokenConditions"],
  width: number,
) {
  const silences = spellZones.filter((zone) => zoneRowFor(zone)?.silence);
  for (const shown of silences.length ? shownTokens : []) {
    const inside = silences.find((zone) => zone.cells.includes(tileIndex(width, shown.x, shown.y)));
    const rows = tokenConditions[shown.id] ?? [];
    if (inside && !rows.some((row) => row.id === "deafened")) {
      tokenConditions[shown.id] = [
        ...rows,
        { id: "deafened", label: `Deafened (${inside.spell})`, note: "no sound inside: no spell with a verbal component, immune to thunder damage" },
      ];
    }
  }
}
