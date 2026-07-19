import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { AmbientLight, BattleToken, MapLight, TokenKind, XY } from "@/lib/battlemap/types";
import type { MapTheme } from "@/lib/battlemap/generate";

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
};

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
}): BattleMap {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO battle_maps (id, encounter_id, campaign_id, width, height, terrain, ambient, theme, lights_json, seed, round_marker, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
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

export function insertToken(input: {
  mapId: string;
  campaignId: string;
  kind: TokenKind;
  refId: string;
  name: string;
  x: number;
  y: number;
  lightRadius?: number;
}): BattleToken {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO battle_tokens (id, map_id, campaign_id, kind, ref_id, name, x, y, moved_this_round, light_radius, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT (map_id, ref_id) DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`,
    )
    .run(id, input.mapId, input.campaignId, input.kind, input.refId, input.name, input.x, input.y, input.lightRadius ?? 0, nowIso());
  return getTokenByRef(input.mapId, input.refId) as BattleToken;
}

export function listTokens(mapId: string): BattleToken[] {
  const rows = getDatabase()
    .prepare(
      `SELECT id, kind, ref_id, name, x, y, moved_this_round, light_radius
       FROM battle_tokens WHERE map_id = ? ORDER BY kind DESC, name ASC`,
    )
    .all(mapId) as TokenRow[];
  return rows.map(mapToken);
}

export function getTokenByRef(mapId: string, refId: string): BattleToken | null {
  const row = getDatabase()
    .prepare(
      `SELECT id, kind, ref_id, name, x, y, moved_this_round, light_radius
       FROM battle_tokens WHERE map_id = ? AND ref_id = ?`,
    )
    .get(mapId, refId) as TokenRow | undefined;
  return row ? mapToken(row) : null;
}

export function moveToken(tokenId: string, x: number, y: number, movedThisRound: number) {
  getDatabase()
    .prepare(`UPDATE battle_tokens SET x = ?, y = ?, moved_this_round = ?, updated_at = ? WHERE id = ?`)
    .run(x, y, movedThisRound, nowIso(), tokenId);
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
