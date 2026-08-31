import type { Campaign } from "@/lib/db/campaigns";
import {
  createEncounter,
  endEncounter,
  getActiveBoard,
  getActiveScene,
  listEnemies,
} from "@/lib/db/encounters";
import {
  clearExplored,
  createBattleMap,
  getBattleMapForEncounter,
  listTokens,
  moveToken,
  placeTokens,
  replaceBattleMapTerrain,
  setBattleMapBackdrop,
  setBattleMapTerrain,
  type BattleMap,
} from "@/lib/db/battle-maps";
import { getCurrentLocation } from "@/lib/db/locations";
import { listSheets } from "@/lib/db/sheets";
import { generateBattleMap, type GeneratedMap, type MapTheme } from "@/lib/battlemap/generate";
import { nearestOpenTile, paintTerrain, type Stroke } from "@/lib/battlemap/paint";
import { tileIndex, type AmbientLight, type XY } from "@/lib/battlemap/types";
import type { BackdropTransform } from "@/lib/battlemap/backdrop";
import { carriedLightRadius, publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { publishEncounter } from "@/lib/dm/enemy-damage";

// The map studio: a DM builds a tactical map on purpose instead of accepting
// the one a sentence produced.
//
// Everything here is DM-side prep, so none of it is an adjudication. The
// generator, the terrain alphabet and the token layer are the same ones
// start_encounter uses; what this adds is a preview nobody else sees, a
// reroll, a brush, and a board with nobody to fight on it.

export type StudioSettings = {
  seed?: number;
  width?: number;
  height?: number;
  theme?: MapTheme;
  ambient?: AmbientLight;
  hint?: string;
};

// The counts a preview should spawn for. Taken from the board when one is
// open so what the DM previews is what they will get, and from the party
// otherwise.
function crowdFor(campaign: Campaign): { pcCount: number; enemyCount: number } {
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (map) {
    const tokens = listTokens(map.id);
    return {
      pcCount: Math.max(1, tokens.filter((token) => token.kind === "pc").length),
      enemyCount: tokens.filter((token) => token.kind === "enemy").length,
    };
  }
  return { pcCount: Math.max(1, listSheets(campaign.id).length), enemyCount: 0 };
}

// A seed the DM can write down. Random when they have not named one, so
// "reroll" is one click and "give me that one again" is one number.
export function studioSeed(settings: StudioSettings): number {
  return typeof settings.seed === "number" && Number.isFinite(settings.seed)
    ? settings.seed >>> 0
    : (Math.random() * 0xffffffff) >>> 0;
}

export function generateForStudio(
  campaign: Campaign,
  settings: StudioSettings,
  crowd: { pcCount: number; enemyCount: number },
): { seed: number; map: GeneratedMap } {
  const location = getCurrentLocation(campaign.id);
  const seed = studioSeed(settings);
  return {
    seed,
    map: generateBattleMap({
      seed,
      width: settings.width,
      height: settings.height,
      genre: campaign.gameSettings.genre,
      locationName: location?.name,
      layoutDescription: location?.layoutDescription,
      hint: settings.hint,
      theme: settings.theme,
      ambient: settings.ambient,
      pcCount: crowd.pcCount,
      enemyCount: crowd.enemyCount,
    }),
  };
}

// A map nobody else can see yet. Writes nothing: the DM spins this until it
// looks right and only then applies it, which is the whole reason the studio
// exists rather than a "regenerate" button on the live board.
export function previewStudioMap(
  campaign: Campaign,
  settings: StudioSettings,
): { seed: number; map: GeneratedMap } {
  return generateForStudio(campaign, settings, crowdFor(campaign));
}

// Stands everyone somewhere legal on ground that just changed under them.
// Spawns first, in the generator's own order, so a fresh map opens with the
// party on one side and the enemies on the other exactly as a new fight
// does; anyone left over walks to the nearest open tile.
function restandTokens(map: BattleMap, generated: GeneratedMap) {
  const tokens = listTokens(map.id);
  const pcs = tokens.filter((token) => token.kind === "pc");
  const enemies = tokens.filter((token) => token.kind === "enemy");
  const taken = new Set<number>();
  const settle = (spot: XY) => {
    taken.add(tileIndex(generated.width, spot.x, spot.y));
    return spot;
  };
  const place = (index: number, spawns: XY[], from: XY) => {
    const spawn = spawns[index];
    if (spawn && !taken.has(tileIndex(generated.width, spawn.x, spawn.y))) {
      return settle(spawn);
    }
    const clamped = {
      x: Math.min(generated.width - 1, Math.max(0, from.x)),
      y: Math.min(generated.height - 1, Math.max(0, from.y)),
    };
    return settle(
      nearestOpenTile(generated.terrain, generated.width, generated.height, clamped, taken),
    );
  };
  pcs.forEach((token, index) => {
    const at = place(index, generated.pcSpawns, token);
    // The ground moved, so the round's movement budget starts again: a
    // combatant should not be charged for steps taken on a map that is gone.
    moveToken(token.id, at.x, at.y, 0);
  });
  enemies.forEach((token, index) => {
    const at = place(index, generated.enemySpawns, token);
    moveToken(token.id, at.x, at.y, 0);
  });
}

export type StudioOutcome = { ok: true; seed: number } | { error: string };

// Replaces the board's ground with a generated map, keeping the map row so
// tokens and the encounter link survive. Fog memory does not: it is a memory
// of a map that no longer exists.
export function applyStudioMap(campaign: Campaign, settings: StudioSettings): StudioOutcome {
  const board = getActiveBoard(campaign.id);
  if (!board) {
    return { error: "There is no board to put a map on. Open a scene or start a fight first." };
  }
  const map = getBattleMapForEncounter(board.id);
  if (!map) {
    return { error: "This encounter has no battle map." };
  }
  const tokens = listTokens(map.id);
  const { seed, map: generated } = generateForStudio(campaign, settings, {
    pcCount: Math.max(1, tokens.filter((token) => token.kind === "pc").length),
    enemyCount: tokens.filter((token) => token.kind === "enemy").length,
  });
  replaceBattleMapTerrain(map.id, {
    width: generated.width,
    height: generated.height,
    terrain: generated.terrain,
    ambient: generated.ambient,
    theme: generated.theme,
    lights: generated.lights,
    seed,
  });
  restandTokens({ ...map, width: generated.width, height: generated.height }, generated);
  clearExplored(map.id);
  publishBattleMapUpdate(campaign.id);
  return { ok: true, seed };
}

// One brush pass over the live board. The validation that matters is in
// src/lib/battlemap/paint.ts; this is the part that knows who is standing
// where and writes the result.
export function paintStudioMap(campaign: Campaign, strokes: Stroke[]): StudioOutcome {
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!map) {
    return { error: "There is no board to paint on." };
  }
  const painted = paintTerrain({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    strokes,
    occupied: listTokens(map.id).map((token) => ({ x: token.x, y: token.y })),
  });
  if ("error" in painted) {
    return { error: painted.error };
  }
  setBattleMapTerrain(map.id, painted.terrain);
  // A painted wall is a wall a character has already "seen" through, so the
  // fog memory is stale in exactly the way a replaced map's is.
  clearExplored(map.id);
  publishBattleMapUpdate(campaign.id);
  return { ok: true, seed: map.seed };
}

// The picture under the live board. Cosmetic only: the terrain string is
// still the only thing pathfinding, sight and cover read, which is the
// separation src/lib/battlemap/backdrop.ts exists to keep honest.
export function setStudioBackdrop(
  campaign: Campaign,
  path: string,
  transform: BackdropTransform | null,
): StudioOutcome {
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!map) {
    return { error: "There is no board to put a picture under." };
  }
  setBattleMapBackdrop(map.id, path, transform);
  publishBattleMapUpdate(campaign.id);
  return { ok: true, seed: map.seed };
}

// ---- exploration scenes ----

// A tactical board with nobody to fight. battle_maps.encounter_id is NOT
// NULL, so a standalone map would mean an FK change and a second lifecycle
// for tokens, fog and movement; a zero-enemy encounter marked 'scene' reuses
// all of it and costs one column (src/lib/db/encounters.ts).
export function openScene(
  campaign: Campaign,
  settings: StudioSettings & { summary?: string },
): { ok: true; seed: number; encounterId: string } | { error: string } {
  const sheets = listSheets(campaign.id);
  if (!sheets.length) {
    return { error: "There are no characters to put on a map yet." };
  }
  const existing = getActiveScene(campaign.id);
  if (existing) {
    return { error: "A scene is already on the table. Close it before opening another." };
  }
  const encounter = createEncounter(
    campaign.id,
    (settings.summary ?? "").slice(0, 300),
    "scene",
  );
  if (!encounter) {
    return { error: "A fight is running; end it before opening a scene." };
  }
  const { seed, map: generated } = generateForStudio(campaign, settings, {
    pcCount: sheets.length,
    enemyCount: 0,
  });
  const map = createBattleMap({
    encounterId: encounter.id,
    campaignId: campaign.id,
    width: generated.width,
    height: generated.height,
    terrain: generated.terrain,
    ambient: generated.ambient,
    theme: generated.theme,
    lights: generated.lights,
    seed,
  });
  placeTokens(
    map.id,
    campaign.id,
    sheets.map((sheet, index) => ({
      kind: "pc" as const,
      refId: sheet.id,
      name: sheet.name,
      spot: generated.pcSpawns[index] ?? generated.pcSpawns[0] ?? { x: 1, y: 1 },
      lightRadius: carriedLightRadius(sheet),
    })),
  );
  publishBattleMapUpdate(campaign.id);
  return { ok: true, seed, encounterId: encounter.id };
}

export function closeScene(campaign: Campaign): StudioOutcome {
  const scene = getActiveScene(campaign.id);
  if (!scene) {
    return { error: "There is no scene on the table." };
  }
  endEncounter(scene.id, "the scene ended");
  // Players watch for battle_map_updated; the encounter ping keeps any panel
  // that was showing the board in step with it going away.
  publishBattleMapUpdate(campaign.id);
  publishEncounter(campaign.id);
  return { ok: true, seed: 0 };
}

// What the studio panel needs to render itself: whether a board is open,
// which kind, and the settings the current map was built from so a reroll
// starts from what is on the table rather than from nothing.
export function studioState(campaign: Campaign) {
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  return {
    board: board ? board.kind : null,
    enemyCount: board && board.kind === "fight" ? listEnemies(board.id).length : 0,
    map: map
      ? {
          seed: map.seed,
          width: map.width,
          height: map.height,
          theme: map.theme,
          ambient: map.ambient,
          // The whole board, unfogged. This route is DM-only, and the DM's
          // own projection has never had fog (src/lib/battlemap/view.ts).
          terrain: map.terrain,
          backdrop: map.backdrop,
        }
      : null,
  };
}
