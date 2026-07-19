import { getFloor } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { getSheetForUser, listSheets } from "@/lib/db/sheets";
import {
  getBattleMapForEncounter,
  getExplored,
  getTokenByRef,
  listTokens,
  mergeExplored,
  type BattleMap,
} from "@/lib/db/battle-maps";
import { darkvisionTilesFromText, litTiles, visibleTiles } from "@/lib/battlemap/los";
import { reachableTiles, speedToTiles } from "@/lib/battlemap/movement";
import { tileIndex, type AmbientLight, type BattleToken } from "@/lib/battlemap/types";
import type { MapTheme } from "@/lib/battlemap/generate";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Per-player projection of the battle map. This is the ONLY battlemap
// module that touches the DB, and the only shape clients ever see: terrain
// is blanked outside explored tiles, enemy tokens are fog-gated, and ally
// PC tokens are always shown (the party coordinates aloud at the table).

export type PlayerMapView = {
  mapId: string;
  width: number;
  height: number;
  ambient: AmbientLight;
  theme: MapTheme;
  // Row-major terrain chars; unexplored tiles are replaced with a space.
  terrain: string;
  visible: number[];
  explored: number[];
  tokens: Array<{
    id: string;
    kind: "pc" | "enemy";
    refId: string;
    name: string;
    x: number;
    y: number;
    mine: boolean;
    // PC at 0 HP: rendered downed, never removed from the map.
    down: boolean;
  }>;
  lights: Array<{ x: number; y: number; radius: number }>;
  reachable: number[];
  budgetLeft: number;
  myTokenId: string | null;
  round: number;
  currentTurnName: string;
};

export function sheetDarkvisionTiles(sheet: CharacterSheet): number {
  return darkvisionTilesFromText([...sheet.features.map((feature) => feature.name), sheet.race]);
}

// Whether this player's PC may move right now: open floor, or their own
// slot in the initiative order.
function canMoveNow(campaignId: string, characterId: string): boolean {
  const floor = getFloor(campaignId);
  if (floor.mode === "open") {
    return true;
  }
  if (floor.mode !== "initiative") {
    return false;
  }
  const encounter = getActiveEncounter(campaignId);
  if (!encounter || !encounter.orderReady) {
    return false;
  }
  const current = encounter.order[encounter.turnIndex];
  return current?.kind === "pc" && current.characterId === characterId;
}

export function getActiveBattleMap(campaignId: string): BattleMap | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  return getBattleMapForEncounter(encounter.id);
}

export function buildPlayerMapView(campaignId: string, userId: string): PlayerMapView | null {
  const encounter = getActiveEncounter(campaignId);
  if (!encounter) {
    return null;
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return null;
  }
  const sheet = getSheetForUser(campaignId, userId);
  const tokens = listTokens(map.id);
  const tileCount = map.width * map.height;
  const myToken = sheet ? getTokenByRef(map.id, sheet.id) : null;

  // Spectators (no sheet/token) see only ally positions on a dark field.
  const vision = { terrain: map.terrain, width: map.width, height: map.height, ambient: map.ambient };
  const lit = litTiles(vision, tokens, map.lights);
  let visible = new Set<number>();
  let explored = new Set<number>();
  if (sheet && myToken) {
    visible = visibleTiles(
      vision,
      { x: myToken.x, y: myToken.y, darkvisionTiles: sheetDarkvisionTiles(sheet) },
      tokens,
      map.lights,
      lit,
    );
    explored = mergeExplored(map.id, sheet.id, visible, tileCount);
  } else if (sheet) {
    explored = getExplored(map.id, sheet.id, tileCount);
  }

  // Terrain memory: what the character has explored, blanked elsewhere.
  const terrainChars = map.terrain.split("");
  for (let i = 0; i < tileCount; i += 1) {
    if (!explored.has(i)) {
      terrainChars[i] = " ";
    }
  }

  const enemiesById = new Map(listEnemies(encounter.id).map((enemy) => [enemy.id, enemy]));
  const sheetsById = new Map(listSheets(campaignId).map((entry) => [entry.id, entry]));
  const shownTokens = tokens
    .filter((token) => {
      if (token.kind === "enemy") {
        const enemy = enemiesById.get(token.refId);
        if (!enemy || enemy.status !== "alive") {
          return false;
        }
        return visible.has(tileIndex(map.width, token.x, token.y));
      }
      return true;
    })
    .map((token) => ({
      id: token.id,
      kind: token.kind,
      refId: token.refId,
      name: token.name,
      x: token.x,
      y: token.y,
      mine: myToken !== null && token.id === myToken.id,
      down:
        token.kind === "pc" && (sheetsById.get(token.refId)?.currentHp ?? 1) <= 0,
    }));

  // Reachable tiles for click-to-move, only when the player may move now.
  let reachable: number[] = [];
  let budgetLeft = 0;
  if (sheet && myToken && sheet.currentHp > 0 && canMoveNow(campaignId, sheet.id)) {
    budgetLeft = Math.max(0, speedToTiles(sheet.speed) - myToken.movedThisRound);
    if (budgetLeft > 0) {
      const occupied = occupiedTiles(map, tokens, myToken);
      reachable = [
        ...reachableTiles(map.terrain, map.width, map.height, occupied, myToken, budgetLeft).keys(),
      ];
    }
  }

  const currentEntry = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  return {
    mapId: map.id,
    width: map.width,
    height: map.height,
    ambient: map.ambient,
    theme: map.theme,
    terrain: terrainChars.join(""),
    visible: [...visible],
    explored: [...explored],
    tokens: shownTokens,
    lights: map.lights
      .filter((light) => explored.has(tileIndex(map.width, light.x, light.y)))
      .map((light) => ({ x: light.x, y: light.y, radius: light.brightRadius })),
    reachable,
    budgetLeft,
    myTokenId: myToken?.id ?? null,
    round: encounter.round,
    currentTurnName: currentEntry?.name ?? "",
  };
}

// Tiles no one may move through or onto: every living token except the
// mover. Dead enemies keep no token (removed on death), but guard anyway.
export function occupiedTiles(
  map: BattleMap,
  tokens: BattleToken[],
  mover: BattleToken | null,
): Set<number> {
  const occupied = new Set<number>();
  for (const token of tokens) {
    if (mover && token.id === mover.id) {
      continue;
    }
    occupied.add(tileIndex(map.width, token.x, token.y));
  }
  return occupied;
}
