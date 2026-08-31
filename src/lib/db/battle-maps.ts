import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { AmbientLight, BattleToken, MapLight, TokenKind, XY } from "@/lib/battlemap/types";
import type { MapTheme } from "@/lib/battlemap/generate";
import {
  normalizeBackdrop,
  type Backdrop,
  type BackdropTransform,
} from "@/lib/battlemap/backdrop";

// Persistence for tactical battle maps. One map per encounter; the active
// map is always found through the active encounter, so ended encounters
// archive their maps for free. Rows never reach clients directly: the
// battle-map GET serves a per-character fogged projection.

export type BattleMap = {
  id: string;
  encounterId: string;
  campaignId: string;
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights: MapLight[];
  seed: number;
  roundMarker: number;
  // Cosmetic art under the grid, or null. Nothing that decides a rule reads
  // it (src/lib/battlemap/backdrop.ts).
  backdrop: Backdrop | null;
};

type MapRow = {
  id: string;
  encounter_id: string;
  campaign_id: string;
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights_json: string;
  seed: number;
  round_marker: number;
  backdrop_path: string | null;
  backdrop_transform_json: string | null;
};

type TokenRow = {
  id: string;
  kind: TokenKind;
  ref_id: string;
  name: string;
  x: number;
  y: number;
  moved_this_round: number;
  light_radius: number;
  hidden: number;
};

// Every token read selects the same columns, in one place, so adding one
// cannot leave a projection quietly missing it.
const TOKEN_COLUMNS = `id, kind, ref_id, name, x, y, moved_this_round, light_radius, hidden`;

function mapRow(row: MapRow): BattleMap {
  return {
    id: row.id,
    encounterId: row.encounter_id,
    campaignId: row.campaign_id,
    width: row.width,
    height: row.height,
    terrain: row.terrain,
    ambient: row.ambient,
    theme: row.theme ?? "field",
    lights: parseJson<MapLight[]>(row.lights_json, []),
    seed: row.seed,
    roundMarker: row.round_marker,
    // Refused rather than trusted: a path that is not one this app wrote is
    // read back as no backdrop at all.
    backdrop: normalizeBackdrop(
      row.backdrop_path ?? "",
      parseJson<unknown>(row.backdrop_transform_json ?? "{}", {}),
    ),
  };
}

function mapToken(row: TokenRow): BattleToken {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.ref_id,
    name: row.name,
    x: row.x,
    y: row.y,
    movedThisRound: row.moved_this_round,
    lightRadius: row.light_radius,
    hidden: row.hidden === 1,
  };
}

export function createBattleMap(input: {
  encounterId: string;
  campaignId: string;
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights: MapLight[];
  seed: number;
  // Carried over when a prepared map is deployed, so the art that was drawn
  // with the walls arrives with them (src/lib/db/prepared-maps.ts).
  backdrop?: Backdrop | null;
}): BattleMap {
  const id = crypto.randomUUID();
  const now = nowIso();
  const backdrop = normalizeBackdrop(input.backdrop?.path ?? "", input.backdrop?.transform);
  getDatabase()
    .prepare(
      `INSERT INTO battle_maps (id, encounter_id, campaign_id, width, height, terrain, ambient, theme, lights_json, seed, round_marker, backdrop_path, backdrop_transform_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.encounterId,
      input.campaignId,
      input.width,
      input.height,
      input.terrain,
      input.ambient,
      input.theme,
      JSON.stringify(input.lights),
      input.seed,
      backdrop?.path ?? "",
      JSON.stringify(backdrop?.transform ?? {}),
      now,
      now,
    );
  return getBattleMap(id) as BattleMap;
}

export function getBattleMap(mapId: string): BattleMap | null {
  const row = getDatabase().prepare(`SELECT * FROM battle_maps WHERE id = ?`).get(mapId) as
    | MapRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function getBattleMapForEncounter(encounterId: string): BattleMap | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM battle_maps WHERE encounter_id = ? LIMIT 1`)
    .get(encounterId) as MapRow | undefined;
  return row ? mapRow(row) : null;
}

// Replaces the ground under an existing map, keeping its id so tokens, fog
// rows and the encounter link all survive. The caller is responsible for
// standing anyone who was on a tile that is now a wall somewhere legal
// (src/lib/dm/map-studio.ts) before anybody reads the board again.
export function replaceBattleMapTerrain(
  mapId: string,
  input: {
    width: number;
    height: number;
    terrain: string;
    ambient: AmbientLight;
    theme: MapTheme;
    lights: MapLight[];
    seed: number;
  },
) {
  getDatabase()
    .prepare(
      `UPDATE battle_maps SET width = ?, height = ?, terrain = ?, ambient = ?, theme = ?,
         lights_json = ?, seed = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      input.width,
      input.height,
      input.terrain,
      input.ambient,
      input.theme,
      JSON.stringify(input.lights),
      input.seed,
      nowIso(),
      mapId,
    );
}

// The picture under the grid. Passing an empty path takes it away, which is
// the only way to clear one: a backdrop nobody can see is worse than none.
export function setBattleMapBackdrop(
  mapId: string,
  path: string,
  transform: BackdropTransform | null,
) {
  const backdrop = normalizeBackdrop(path, transform);
  getDatabase()
    .prepare(
      `UPDATE battle_maps SET backdrop_path = ?, backdrop_transform_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      backdrop?.path ?? "",
      JSON.stringify(backdrop?.transform ?? {}),
      nowIso(),
      mapId,
    );
}

// Terrain only: a painted stroke changes the ground and nothing else.
export function setBattleMapTerrain(mapId: string, terrain: string) {
  getDatabase()
    .prepare(`UPDATE battle_maps SET terrain = ?, updated_at = ? WHERE id = ?`)
    .run(terrain, nowIso(), mapId);
}

// Fog memory is a memory of a map that no longer exists once the ground is
// replaced, so it goes with it rather than leaving characters remembering
// walls that were never there.
export function clearExplored(mapId: string) {
  getDatabase().prepare(`DELETE FROM battle_explored WHERE map_id = ?`).run(mapId);
}

export function insertToken(input: {
  mapId: string;
  campaignId: string;
  kind: TokenKind;
  refId: string;
  name: string;
  x: number;
  y: number;
  lightRadius?: number;
  hidden?: boolean;
}): BattleToken {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO battle_tokens (id, map_id, campaign_id, kind, ref_id, name, x, y, moved_this_round, light_radius, hidden, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT (map_id, ref_id) DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.mapId,
      input.campaignId,
      input.kind,
      input.refId,
      input.name,
      input.x,
      input.y,
      input.lightRadius ?? 0,
      input.hidden ? 1 : 0,
      nowIso(),
    );
  return getTokenByRef(input.mapId, input.refId) as BattleToken;
}

export function listTokens(mapId: string): BattleToken[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${TOKEN_COLUMNS} FROM battle_tokens WHERE map_id = ? ORDER BY kind DESC, name ASC`,
    )
    .all(mapId) as TokenRow[];
  return rows.map(mapToken);
}

export function getTokenByRef(mapId: string, refId: string): BattleToken | null {
  const row = getDatabase()
    .prepare(
      `SELECT ${TOKEN_COLUMNS} FROM battle_tokens WHERE map_id = ? AND ref_id = ?`,
    )
    .get(mapId, refId) as TokenRow | undefined;
  return row ? mapToken(row) : null;
}

export function moveToken(tokenId: string, x: number, y: number, movedThisRound: number) {
  getDatabase()
    .prepare(`UPDATE battle_tokens SET x = ?, y = ?, moved_this_round = ?, updated_at = ? WHERE id = ?`)
    .run(x, y, movedThisRound, nowIso(), tokenId);
}

export function getToken(tokenId: string): BattleToken | null {
  const row = getDatabase()
    .prepare(`SELECT ${TOKEN_COLUMNS} FROM battle_tokens WHERE id = ?`)
    .get(tokenId) as TokenRow | undefined;
  return row ? mapToken(row) : null;
}

// The DM picking a token up and putting it down. Deliberately not moveToken:
// free placement never touches moved_this_round, because the round's budget
// belongs to the combatant's own movement and a DM repositioning the board
// is not the combatant walking. It also skips terrain and reach entirely;
// the caller checks what it wants to check (src/lib/dm/board.ts).
export function placeToken(tokenId: string, x: number, y: number) {
  getDatabase()
    .prepare(`UPDATE battle_tokens SET x = ?, y = ?, updated_at = ? WHERE id = ?`)
    .run(x, y, nowIso(), tokenId);
}

export function setTokenHidden(tokenId: string, hidden: boolean) {
  getDatabase()
    .prepare(`UPDATE battle_tokens SET hidden = ?, updated_at = ? WHERE id = ?`)
    .run(hidden ? 1 : 0, nowIso(), tokenId);
}

// Ref ids of every token the DM is keeping off the table. The initiative
// tracker asks for these too, so one flag hides a combatant in both places
// (src/lib/db/encounters.ts).
export function listHiddenRefIds(mapId: string): string[] {
  const rows = getDatabase()
    .prepare(`SELECT ref_id FROM battle_tokens WHERE map_id = ? AND hidden = 1`)
    .all(mapId) as Array<{ ref_id: string }>;
  return rows.map((row) => row.ref_id);
}

export function deleteToken(tokenId: string) {
  getDatabase().prepare(`DELETE FROM battle_tokens WHERE id = ?`).run(tokenId);
}

export function removeTokenByRef(mapId: string, refId: string) {
  getDatabase().prepare(`DELETE FROM battle_tokens WHERE map_id = ? AND ref_id = ?`).run(mapId, refId);
}

// New round: everyone's movement budget refills.
export function resetRoundBudgets(mapId: string, round: number) {
  const now = nowIso();
  const db = getDatabase();
  db.transaction(() => {
    db.prepare(`UPDATE battle_tokens SET moved_this_round = 0, updated_at = ? WHERE map_id = ?`).run(now, mapId);
    db.prepare(`UPDATE battle_maps SET round_marker = ?, updated_at = ? WHERE id = ?`).run(round, now, mapId);
  })();
}

// ---- per-character explored-tile memory (hex bitfield) ----

export function decodeExplored(hex: string, tileCount: number): Set<number> {
  const seen = new Set<number>();
  for (let i = 0; i < tileCount; i += 1) {
    const nibble = parseInt(hex[i >> 2] ?? "0", 16);
    if (nibble & (1 << (i & 3))) {
      seen.add(i);
    }
  }
  return seen;
}

export function encodeExplored(tiles: Set<number>, tileCount: number): string {
  const nibbles = new Array(Math.ceil(tileCount / 4)).fill(0);
  for (const idx of tiles) {
    if (idx >= 0 && idx < tileCount) {
      nibbles[idx >> 2] |= 1 << (idx & 3);
    }
  }
  return nibbles.map((n) => n.toString(16)).join("");
}

export function getExplored(mapId: string, characterId: string, tileCount: number): Set<number> {
  const row = getDatabase()
    .prepare(`SELECT tiles_hex FROM battle_explored WHERE map_id = ? AND character_id = ?`)
    .get(mapId, characterId) as { tiles_hex: string } | undefined;
  return decodeExplored(row?.tiles_hex ?? "", tileCount);
}

// Merge newly seen tiles into the character's memory; returns the union.
export function mergeExplored(
  mapId: string,
  characterId: string,
  seen: Set<number>,
  tileCount: number,
): Set<number> {
  const merged = getExplored(mapId, characterId, tileCount);
  let grew = false;
  for (const idx of seen) {
    if (!merged.has(idx)) {
      merged.add(idx);
      grew = true;
    }
  }
  if (grew) {
    getDatabase()
      .prepare(
        `INSERT INTO battle_explored (map_id, character_id, tiles_hex, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (map_id, character_id) DO UPDATE SET tiles_hex = excluded.tiles_hex, updated_at = excluded.updated_at`,
      )
      .run(mapId, characterId, encodeExplored(merged, tileCount), nowIso());
  }
  return merged;
}

// Positions of every spawn on creation, in one transaction.
export function placeTokens(
  mapId: string,
  campaignId: string,
  tokens: Array<{ kind: TokenKind; refId: string; name: string; spot: XY; lightRadius?: number }>,
) {
  const db = getDatabase();
  db.transaction(() => {
    for (const token of tokens) {
      insertToken({
        mapId,
        campaignId,
        kind: token.kind,
        refId: token.refId,
        name: token.name,
        x: token.spot.x,
        y: token.spot.y,
        lightRadius: token.lightRadius,
      });
    }
  })();
}
