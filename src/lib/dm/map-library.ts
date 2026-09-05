import type { Campaign } from "@/lib/db/campaigns";
import { createEncounter, getActiveBoard, getActiveScene } from "@/lib/db/encounters";
import {
  clearExplored,
  createBattleMap,
  getBattleMapForEncounter,
  listTokens,
  moveToken,
  placeTokens,
  replaceBattleMapTerrain,
  setBattleMapBackdrop,
} from "@/lib/db/battle-maps";
import {
  createPreparedMap,
  getPreparedMap,
  listPreparedMaps,
  updatePreparedMap,
  type PreparedMap,
} from "@/lib/db/prepared-maps";
import { listSheets } from "@/lib/db/sheets";
import { isWorkshop } from "@/lib/workshop/kind";
import {
  MAP_SIZE,
  generateBattleMap,
  partySpawnTiles,
  type MapTheme,
} from "@/lib/battlemap/generate";
import { nearestOpenTile, paintTerrain } from "@/lib/battlemap/paint";
import { compilePaint, emptyPaintIsFine, type PaintRequest } from "@/lib/battlemap/tools";
import { normalizeLights, toggleLight, type LightToggle } from "@/lib/battlemap/lights";
import { toggleDoor, type SceneAmbience } from "@/lib/battlemap/scene";
import { handleSetAmbience } from "@/lib/dm/ambience-tools";
import { parseUvtt } from "@/lib/battlemap/uvtt";
import { normalizeBackdropTransform, type BackdropTransform } from "@/lib/battlemap/backdrop";
import { TERRAIN, tileIndex, type AmbientLight, type XY } from "@/lib/battlemap/types";
import { carriedLightRadius, publishBattleMapUpdate } from "@/lib/dm/map-tools";

// The map library: building maps that no encounter has asked for yet.
//
// The studio (src/lib/dm/map-studio.ts) edits the board on the table. This
// edits maps that are not on any table, which is the difference that makes a
// workshop useful: a workshop has no party, so it can never open a scene,
// and until now its map tab could only roll previews it had nowhere to put.
//
// Everything a DM does to a prepared map goes through the same painter the
// live board uses, so a prepared map is never a picture that only becomes
// illegal at the moment it is deployed.

export type LibraryOutcome<T> = { ok: true; map: T } | { error: string };

// A blank field to carve or to furnish. Rock is the dungeon starting point
// (stamp rooms into it); ground is the outdoor one (paint what interrupts
// it). Both come with the walled border the engine assumes.
export const BLANK_FILLS = ["rock", "ground"] as const;
export type BlankFill = (typeof BLANK_FILLS)[number];

export function blankTerrain(width: number, height: number, fill: BlankFill): string {
  const inner = fill === "rock" ? TERRAIN.wall : TERRAIN.floor;
  const tiles = new Array<string>(width * height).fill(inner);
  for (let x = 0; x < width; x += 1) {
    tiles[tileIndex(width, x, 0)] = TERRAIN.wall;
    tiles[tileIndex(width, x, height - 1)] = TERRAIN.wall;
  }
  for (let y = 0; y < height; y += 1) {
    tiles[tileIndex(width, 0, y)] = TERRAIN.wall;
    tiles[tileIndex(width, width - 1, y)] = TERRAIN.wall;
  }
  return tiles.join("");
}

function clampSide(value: number | undefined, min: number, max: number, fallback: number): number {
  const number = Math.round(value ?? fallback);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

// A new map in the library, either rolled by the generator or blank. Nothing
// is put on the table: this is the "prepare" half of prepare-then-deploy.
export function createLibraryMap(
  campaign: Campaign,
  input: {
    name: string;
    width?: number;
    height?: number;
    theme?: MapTheme;
    ambient?: AmbientLight;
    hint?: string;
    seed?: number;
    // Absent means roll one with the generator.
    blank?: BlankFill;
  },
): LibraryOutcome<PreparedMap> {
  const name = input.name.trim();
  if (!name) {
    return { error: "Give the map a name you will recognise in three weeks." };
  }
  const width = clampSide(input.width, MAP_SIZE.minWidth, MAP_SIZE.maxWidth, 20);
  const height = clampSide(input.height, MAP_SIZE.minHeight, MAP_SIZE.maxHeight, 15);

  if (input.blank) {
    return {
      ok: true,
      map: createPreparedMap({
        campaignId: campaign.id,
        name,
        width,
        height,
        terrain: blankTerrain(width, height, input.blank),
        ambient: input.ambient ?? "bright",
        theme: input.theme ?? (input.blank === "rock" ? "cave" : "field"),
        lights: [],
        seed: 0,
      }),
    };
  }

  const seed =
    typeof input.seed === "number" && Number.isFinite(input.seed)
      ? input.seed >>> 0
      : (Math.random() * 0xffffffff) >>> 0;
  // Spawn counts the generator uses to guarantee open ground at both ends.
  // A prepared map has no party yet, so it asks for a plausible one rather
  // than none, which would let the generator hand back a sealed cave.
  const generated = generateBattleMap({
    seed,
    width,
    height,
    genre: campaign.gameSettings.genre,
    hint: input.hint,
    theme: input.theme,
    ambient: input.ambient,
    pcCount: 4,
    enemyCount: 4,
  });
  return {
    ok: true,
    map: createPreparedMap({
      campaignId: campaign.id,
      name,
      width: generated.width,
      height: generated.height,
      terrain: generated.terrain,
      ambient: generated.ambient,
      theme: generated.theme,
      lights: generated.lights,
      seed,
    }),
  };
}

// One brush pass or one stamp on a stored map. No tokens exist on a prepared
// map, so the painter's occupancy rules have nothing to check; what it still
// enforces is the walled border, which is the promise the engine needs kept
// whether or not anybody is standing on the map yet.
//
// Four ways in, one painter: hand strokes, a stamp, a shape tool, or a whole
// terrain to go back to (undo), all compiled by src/lib/battlemap/tools.ts.
export function paintLibraryMap(
  campaign: Campaign,
  mapId: string,
  input: PaintRequest,
): LibraryOutcome<PreparedMap> {
  const map = getPreparedMap(campaign.id, mapId);
  if (!map) {
    return { error: "That map is not in this library." };
  }
  const compiled = compilePaint(input, map.terrain, map.width, map.height);
  if ("error" in compiled) {
    return { error: compiled.error };
  }
  if (!compiled.strokes.length) {
    return emptyPaintIsFine(input) ? { ok: true, map } : { error: "Nothing was painted." };
  }
  const painted = paintTerrain({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    strokes: compiled.strokes,
    limit: Math.min(compiled.limit, map.width * map.height),
  });
  if ("error" in painted) {
    return { error: painted.error };
  }
  const updated = updatePreparedMap(campaign.id, mapId, { terrain: painted.terrain });
  return updated ? { ok: true, map: updated } : { error: "That map is not in this library." };
}

// The lights on a stored map: place or remove one, or hand over the whole
// list. Nothing about a light touches the terrain, so this never runs the
// painter; it runs the light rules (src/lib/battlemap/lights.ts) instead.
export function setLibraryLights(
  campaign: Campaign,
  mapId: string,
  input: { toggle?: LightToggle; lights?: unknown },
): LibraryOutcome<PreparedMap> & { placed?: boolean } {
  const map = getPreparedMap(campaign.id, mapId);
  if (!map) {
    return { error: "That map is not in this library." };
  }
  let lights = map.lights;
  let placed: boolean | undefined;
  if (input.lights !== undefined) {
    lights = normalizeLights(input.lights, map.width, map.height);
  }
  if (input.toggle) {
    const toggled = toggleLight(lights, input.toggle, map.terrain, map.width, map.height);
    if ("error" in toggled) {
      return { error: toggled.error };
    }
    lights = toggled.lights;
    placed = toggled.placed;
  }
  const updated = updatePreparedMap(campaign.id, mapId, { lights });
  return updated ? { ok: true, map: updated, placed } : { error: "That map is not in this library." };
}

// The scene layer on a stored map: labels, furniture, door states, patches
// of light, the DM's overlay and the sound it makes. A door tap walks the
// state round (open, locked, secret); everything else is handed over whole.
export function setLibraryScene(
  campaign: Campaign,
  mapId: string,
  input: {
    labels?: unknown;
    props?: unknown;
    zones?: unknown;
    overlayPath?: string;
    ambience?: unknown;
    door?: XY;
  },
): LibraryOutcome<PreparedMap> & { door?: string | null } {
  const map = getPreparedMap(campaign.id, mapId);
  if (!map) {
    return { error: "That map is not in this library." };
  }
  let doors = map.doors;
  let door: string | null | undefined;
  if (input.door) {
    const toggled = toggleDoor(doors, input.door, map.terrain, map.width, map.height);
    if ("error" in toggled) {
      return { error: toggled.error };
    }
    doors = toggled.doors;
    door = toggled.state;
  }
  const updated = updatePreparedMap(campaign.id, mapId, {
    scene: {
      doors,
      ...(input.labels !== undefined ? { labels: input.labels as PreparedMap["labels"] } : {}),
      ...(input.props !== undefined ? { props: input.props as PreparedMap["props"] } : {}),
      ...(input.zones !== undefined ? { zones: input.zones as PreparedMap["zones"] } : {}),
      ...(input.overlayPath !== undefined ? { overlayPath: input.overlayPath } : {}),
      ...(input.ambience !== undefined ? { ambience: input.ambience as SceneAmbience } : {}),
    },
  });
  return updated ? { ok: true, map: updated, door } : { error: "That map is not in this library." };
}

// The sound a prepared map makes, played when it goes on the table. Runs
// through the same tool the model uses, so the cue ids are checked and the
// change is announced the same way.
function playPreparedAmbience(campaign: Campaign, ambience: SceneAmbience) {
  if (!ambience.bed && !ambience.music) {
    return;
  }
  handleSetAmbience(
    campaign,
    JSON.stringify({
      ...(ambience.bed ? { bed: ambience.bed } : {}),
      ...(ambience.music ? { music: ambience.music } : {}),
    }),
  );
}

// The picture under the grid. The path has already been written to
// public/uploads by /api/upload, which is the only place in this app that
// turns bytes into a file, and normalizeBackdrop refuses anything that does
// not look like one of ours.
export function setLibraryBackdrop(
  campaign: Campaign,
  mapId: string,
  path: string,
  transform: BackdropTransform | null,
): LibraryOutcome<PreparedMap> {
  const updated = updatePreparedMap(campaign.id, mapId, {
    backdropPath: path,
    backdropTransform: transform ? normalizeBackdropTransform(transform) : null,
  });
  return updated ? { ok: true, map: updated } : { error: "That map is not in this library." };
}

// A Universal VTT export becomes a prepared map. The geometry is converted
// here (src/lib/battlemap/uvtt.ts); the picture was uploaded first and
// arrives as a path, because this app has exactly one image writer and it is
// not this one.
export function importUvttIntoLibrary(
  campaign: Campaign,
  input: { name: string; file: unknown; backdropPath?: string },
): LibraryOutcome<PreparedMap> & { notes?: string[] } {
  const parsed = parseUvtt(input.file);
  if ("error" in parsed) {
    return { error: parsed.error };
  }
  const name = input.name.trim() || "Imported map";
  const map = createPreparedMap({
    campaignId: campaign.id,
    name,
    notes: parsed.map.notes.join("\n\n"),
    tags: ["imported"],
    width: parsed.map.width,
    height: parsed.map.height,
    terrain: parsed.map.terrain,
    ambient: parsed.map.ambient,
    theme: parsed.map.theme,
    lights: parsed.map.lights,
    seed: 0,
    backdrop: input.backdropPath
      ? { path: input.backdropPath, transform: normalizeBackdropTransform({}) }
      : null,
  });
  return { ok: true, map, notes: parsed.map.notes };
}

// Saving what is on the table so it can be used again. The tokens and the
// fog stay behind: a prepared map is ground, not a moment in a fight.
export function captureBoardIntoLibrary(
  campaign: Campaign,
  name: string,
): LibraryOutcome<PreparedMap> {
  const board = getActiveBoard(campaign.id);
  const map = board ? getBattleMapForEncounter(board.id) : null;
  if (!map) {
    return { error: "There is nothing on the table to save." };
  }
  if (!name.trim()) {
    return { error: "Give the map a name you will recognise in three weeks." };
  }
  return {
    ok: true,
    map: createPreparedMap({
      campaignId: campaign.id,
      name: name.trim(),
      width: map.width,
      height: map.height,
      // The drawn terrain, doors and all: a locked door on the table is
      // still a door in the drawer.
      terrain: map.drawnTerrain,
      ambient: map.ambient,
      theme: map.theme,
      lights: map.lights,
      seed: map.seed,
      backdrop: map.backdrop,
      scene: { doors: map.doors, labels: map.labels, zones: map.zones, overlayPath: map.overlayPath },
    }),
  };
}

// Everyone standing on ground that just changed under them walks to the
// nearest tile they can stand on. A prepared map carries no spawn list, so
// unlike a regenerated map there are no sides to re-form: people stay where
// they were if they still can, which is what a DM swapping the ground under
// a running fight means by it.
function restandOnPrepared(mapId: string, map: PreparedMap) {
  const tokens = listTokens(mapId);
  const taken = new Set<number>();
  for (const token of tokens) {
    const from = {
      x: Math.min(map.width - 1, Math.max(0, token.x)),
      y: Math.min(map.height - 1, Math.max(0, token.y)),
    };
    const spot = nearestOpenTile(map.terrain, map.width, map.height, from, taken);
    taken.add(tileIndex(map.width, spot.x, spot.y));
    // The ground moved, so the round's movement budget starts again: a
    // combatant should not be charged for steps taken on a map that is gone.
    moveToken(token.id, spot.x, spot.y, 0);
  }
}

// Put a stored map on the table under whatever is already there.
export function deployPreparedMap(campaign: Campaign, mapId: string): LibraryOutcome<PreparedMap> {
  const prepared = getPreparedMap(campaign.id, mapId);
  if (!prepared) {
    return { error: "That map is not in this library." };
  }
  const board = getActiveBoard(campaign.id);
  if (!board) {
    return { error: "There is no board to put a map on. Open a scene or start a fight first." };
  }
  const live = getBattleMapForEncounter(board.id);
  if (!live) {
    return { error: "This encounter has no battle map." };
  }
  replaceBattleMapTerrain(live.id, {
    width: prepared.width,
    height: prepared.height,
    terrain: prepared.terrain,
    ambient: prepared.ambient,
    theme: prepared.theme,
    lights: prepared.lights,
    seed: prepared.seed,
    scene: {
      doors: prepared.doors,
      labels: prepared.labels,
      zones: prepared.zones,
      overlayPath: prepared.overlayPath,
    },
  });
  setBattleMapBackdrop(live.id, prepared.backdrop?.path ?? "", prepared.backdrop?.transform ?? null);
  restandOnPrepared(live.id, prepared);
  placeProps(live.id, campaign.id, prepared);
  // Fog memory is a memory of a map that no longer exists.
  clearExplored(live.id);
  publishBattleMapUpdate(campaign.id);
  playPreparedAmbience(campaign, prepared.ambience);
  return { ok: true, map: prepared };
}

// The furniture a prepared map was drawn with, as the DM's own npc and prop
// tokens. They carry no stat block, so nothing in the rules engine can
// target them (src/lib/battlemap/types.ts). A tile somebody is already
// standing on is skipped rather than doubled up.
function placeProps(mapId: string, campaignId: string, prepared: PreparedMap) {
  if (!prepared.props.length) {
    return;
  }
  const taken = new Set(listTokens(mapId).map((token) => tileIndex(prepared.width, token.x, token.y)));
  placeTokens(
    mapId,
    campaignId,
    prepared.props
      .filter((prop) => !taken.has(tileIndex(prepared.width, prop.x, prop.y)))
      .map((prop) => ({
        kind: prop.kind,
        refId: crypto.randomUUID(),
        name: prop.name,
        spot: { x: prop.x, y: prop.y },
      })),
  );
}

// Open a stored map as an exploration scene: the party walks it, with
// nobody to fight. Same zero-enemy encounter the studio uses, so tokens, fog
// and movement need no second lifecycle (src/lib/dm/map-studio.ts).
export function openSceneOnPreparedMap(
  campaign: Campaign,
  mapId: string,
  summary: string,
): LibraryOutcome<PreparedMap> {
  const prepared = getPreparedMap(campaign.id, mapId);
  if (!prepared) {
    return { error: "That map is not in this library." };
  }
  const sheets = listSheets(campaign.id);
  if (!sheets.length) {
    return { error: "There are no characters to put on a map yet." };
  }
  if (getActiveScene(campaign.id)) {
    return { error: "A scene is already on the table. Close it before opening another." };
  }
  const encounter = createEncounter(campaign.id, summary.slice(0, 300), "scene");
  if (!encounter) {
    return { error: "A fight is running; end it before opening a scene." };
  }
  const map = createBattleMap({
    encounterId: encounter.id,
    campaignId: campaign.id,
    width: prepared.width,
    height: prepared.height,
    terrain: prepared.terrain,
    ambient: prepared.ambient,
    theme: prepared.theme,
    lights: prepared.lights,
    seed: prepared.seed,
    backdrop: prepared.backdrop,
    scene: {
      doors: prepared.doors,
      labels: prepared.labels,
      zones: prepared.zones,
      overlayPath: prepared.overlayPath,
    },
  });
  const spawns = partySpawnTiles(prepared.terrain, prepared.width, prepared.height, sheets.length);
  const fallback: XY = spawns[0] ?? { x: 1, y: 1 };
  placeTokens(
    map.id,
    campaign.id,
    sheets.map((sheet, index) => ({
      kind: "pc" as const,
      refId: sheet.id,
      name: sheet.name,
      spot: spawns[index] ?? fallback,
      lightRadius: carriedLightRadius(sheet),
    })),
  );
  placeProps(map.id, campaign.id, prepared);
  publishBattleMapUpdate(campaign.id);
  playPreparedAmbience(campaign, prepared.ambience);
  return { ok: true, map: prepared };
}

// What the library panel needs to render itself. Terrain rides along so the
// list can draw a real thumbnail rather than a placeholder, which is cheap:
// the biggest map this engine runs is a few thousand characters.
export function libraryState(campaign: Campaign) {
  const board = getActiveBoard(campaign.id);
  return {
    maps: listPreparedMaps(campaign.id),
    // Whether "put it on the table" and "open it as a scene" can do anything
    // here at all. A workshop has neither, and says so rather than offering
    // buttons that always fail.
    board: board ? board.kind : null,
    hasParty: listSheets(campaign.id).length > 0,
    // hasParty says a scene cannot open YET; this says it never can, so the
    // panel hides the control instead of disabling it forever.
    workshop: isWorkshop(campaign),
  };
}
