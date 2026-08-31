import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { listLocations, type CampaignLocation } from "@/lib/db/locations";
import {
  DEFAULT_OVERWORLD_PARAMS,
  OVERWORLD_HEIGHT,
  OVERWORLD_WIDTH,
  generateOverworldTerrain,
  normalizeOverworldParams,
  placeAnchor,
  tileAt,
  type OverworldParams,
  type XY,
} from "@/lib/overworld/logic";
import {
  paintOverworld,
  type AnchorRef,
  type OverworldStroke,
} from "@/lib/overworld/paint";

// Overworld region map storage: one seeded terrain grid per campaign, with
// known locations anchored at tile coordinates and lead-placed pins.
// Anchors reconcile lazily at read time: any location without one gets
// placed near its first connected anchor, so the map grows as the party
// travels without hooks in the location write path.

export type OverworldPin = { id: string; x: number; y: number; label: string };

export type OverworldMap = {
  campaignId: string;
  seed: number;
  width: number;
  height: number;
  terrain: string;
  anchors: Record<string, XY>;
  pins: OverworldPin[];
  // The dials the terrain was rolled under; a reroll reuses them unless the
  // DM changes them.
  params: OverworldParams;
  // Where the party is standing, when a DM has placed them. Null otherwise:
  // the current location has always been the proxy and still is.
  partyXy: XY | null;
  // The DM's notes on the region. Never leaves the DM's own projection.
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type OverworldRow = {
  campaign_id: string;
  seed: number;
  width: number;
  height: number;
  terrain: string;
  anchors_json: string;
  pins_json: string;
  params_json: string | null;
  party_xy_json: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function mapRow(row: OverworldRow): OverworldMap {
  return {
    campaignId: row.campaign_id,
    seed: row.seed,
    width: row.width,
    height: row.height,
    terrain: row.terrain,
    anchors: parseJson<Record<string, XY>>(row.anchors_json, {}),
    pins: parseJson<OverworldPin[]>(row.pins_json, []),
    params: normalizeOverworldParams(
      parseJson<OverworldParams>(row.params_json, DEFAULT_OVERWORLD_PARAMS),
    ),
    partyXy: parseJson<XY | null>(row.party_xy_json, null),
    notes: row.notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readRow(campaignId: string): OverworldMap | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM overworld_maps WHERE campaign_id = ?`)
    .get(campaignId) as OverworldRow | undefined;
  return row ? mapRow(row) : null;
}

function saveAnchors(campaignId: string, anchors: Record<string, XY>) {
  getDatabase()
    .prepare(`UPDATE overworld_maps SET anchors_json = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(JSON.stringify(anchors), nowIso(), campaignId);
}

function createMap(
  campaignId: string,
  seed: number,
  params: OverworldParams = DEFAULT_OVERWORLD_PARAMS,
): OverworldMap {
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO overworld_maps
         (campaign_id, seed, width, height, terrain, anchors_json, pins_json,
          params_json, party_xy_json, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', '[]', ?, '', '', ?, ?)`,
    )
    .run(
      campaignId,
      seed,
      OVERWORLD_WIDTH,
      OVERWORLD_HEIGHT,
      generateOverworldTerrain(seed, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, params),
      JSON.stringify(params),
      now,
      now,
    );
  return readRow(campaignId)!;
}

// Places anchors for any locations that lack one, oldest first so a
// location lands near the places it was discovered from.
function reconcileAnchors(map: OverworldMap, locations: CampaignLocation[]): OverworldMap {
  const anchorsByLocationId = { ...map.anchors };
  const idByName = new Map(locations.map((location) => [location.name.toLowerCase(), location.id]));
  const ordered = [...locations].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let changed = false;
  for (const location of ordered) {
    if (anchorsByLocationId[location.id]) {
      continue;
    }
    let connected: XY | null = null;
    for (const connectionName of location.connections) {
      const connectedId = idByName.get(connectionName.toLowerCase());
      if (connectedId && anchorsByLocationId[connectedId]) {
        connected = anchorsByLocationId[connectedId];
        break;
      }
    }
    anchorsByLocationId[location.id] = placeAnchor({
      terrain: map.terrain,
      width: map.width,
      height: map.height,
      existing: Object.values(anchorsByLocationId),
      connected,
      name: location.name,
    });
    changed = true;
  }
  // Drop anchors for locations that no longer exist (rollback, cleanup).
  const known = new Set(locations.map((location) => location.id));
  for (const locationId of Object.keys(anchorsByLocationId)) {
    if (!known.has(locationId)) {
      delete anchorsByLocationId[locationId];
      changed = true;
    }
  }
  if (changed) {
    saveAnchors(map.campaignId, anchorsByLocationId);
    return { ...map, anchors: anchorsByLocationId };
  }
  return map;
}

// The campaign's overworld, created on first read and reconciled with the
// known locations on every read.
export function getOverworld(campaignId: string): OverworldMap {
  const map =
    readRow(campaignId) ?? createMap(campaignId, (Math.random() * 0xffffffff) >>> 0);
  return reconcileAnchors(map, listLocations(campaignId));
}

// Lead reroll: new seed and terrain; every anchor is re-validated against
// the new ground (anything now on water or mountain is re-placed). A seed
// may be named, which is what makes the studio's preview and the map the
// table ends up with the same map.
export function regenerateOverworld(
  campaignId: string,
  options: { seed?: number; params?: OverworldParams } = {},
): OverworldMap {
  const previous = readRow(campaignId);
  const fresh = createMap(
    campaignId,
    options.seed ?? (Math.random() * 0xffffffff) >>> 0,
    options.params ?? previous?.params ?? DEFAULT_OVERWORLD_PARAMS,
  );
  if (previous) {
    const carried: Record<string, XY> = {};
    for (const [locationId, anchor] of Object.entries(previous.anchors)) {
      const tile = tileAt(fresh.terrain, fresh.width, anchor.x, anchor.y);
      if (tile !== "w" && tile !== "m") {
        carried[locationId] = anchor;
      }
    }
    saveAnchors(campaignId, carried);
    // Pins, party marker and notes are the DM's own writing, not terrain, so
    // a reroll of the ground keeps them. The marker is re-validated the same
    // way anchors are.
    const partyStillOnLand =
      previous.partyXy &&
      !["w", "m"].includes(tileAt(fresh.terrain, fresh.width, previous.partyXy.x, previous.partyXy.y));
    getDatabase()
      .prepare(
        `UPDATE overworld_maps SET pins_json = ?, party_xy_json = ?, notes = ?, updated_at = ?
         WHERE campaign_id = ?`,
      )
      .run(
        JSON.stringify(previous.pins),
        partyStillOnLand ? JSON.stringify(previous.partyXy) : "",
        previous.notes,
        nowIso(),
        campaignId,
      );
  }
  return getOverworld(campaignId);
}

// One brush pass over the region map. The validation that matters is in
// src/lib/overworld/paint.ts; this is the part that knows where the
// locations are standing and writes the result.
//
// Anchors the paint stranded are REPORTED, never moved. setOverworldAnchor
// below already accepts water and mountains on the grounds that a DM who
// puts a lighthouse on a reef means it, and silently relocating a town
// because the DM widened a lake would contradict that.
export function paintOverworldTerrain(
  campaignId: string,
  strokes: OverworldStroke[],
): { map: OverworldMap; stranded: AnchorRef[]; changed: number } | { error: string } {
  const map = getOverworld(campaignId);
  const locationNames = new Map(
    listLocations(campaignId).map((location) => [location.id, location.name]),
  );
  const painted = paintOverworld({
    terrain: map.terrain,
    width: map.width,
    height: map.height,
    strokes,
    anchors: Object.entries(map.anchors).map(([id, at]) => ({
      id,
      name: locationNames.get(id) ?? "",
      at,
    })),
  });
  if ("error" in painted) {
    return { error: painted.error };
  }
  getDatabase()
    .prepare(`UPDATE overworld_maps SET terrain = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(painted.terrain, nowIso(), campaignId);
  return {
    map: { ...map, terrain: painted.terrain },
    stranded: painted.stranded,
    changed: painted.changed,
  };
}

// The DM drags a location's marker. Clamped to the grid; unlike the
// automatic placement this accepts water and mountains, because a DM who
// puts a lighthouse on a reef means it.
export function setOverworldAnchor(campaignId: string, locationId: string, at: XY): OverworldMap {
  const map = getOverworld(campaignId);
  if (!map.anchors[locationId]) {
    return map;
  }
  const anchors = {
    ...map.anchors,
    [locationId]: {
      x: Math.min(map.width - 1, Math.max(0, Math.round(at.x))),
      y: Math.min(map.height - 1, Math.max(0, Math.round(at.y))),
    },
  };
  saveAnchors(campaignId, anchors);
  return { ...map, anchors };
}

// Null clears the marker, which is the honest state for a party in transit.
export function setOverworldParty(campaignId: string, at: XY | null): OverworldMap {
  const map = getOverworld(campaignId);
  const partyXy = at
    ? {
        x: Math.min(map.width - 1, Math.max(0, Math.round(at.x))),
        y: Math.min(map.height - 1, Math.max(0, Math.round(at.y))),
      }
    : null;
  getDatabase()
    .prepare(`UPDATE overworld_maps SET party_xy_json = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(partyXy ? JSON.stringify(partyXy) : "", nowIso(), campaignId);
  return { ...map, partyXy };
}

export function setOverworldNotes(campaignId: string, notes: string): OverworldMap {
  const map = getOverworld(campaignId);
  const trimmed = notes.slice(0, 4_000);
  getDatabase()
    .prepare(`UPDATE overworld_maps SET notes = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(trimmed, nowIso(), campaignId);
  return { ...map, notes: trimmed };
}

export function setOverworldPins(campaignId: string, pins: OverworldPin[]): OverworldMap {
  const map = getOverworld(campaignId);
  const cleaned = pins.slice(0, 40).map((pin) => ({
    id: pin.id || crypto.randomUUID(),
    x: Math.min(map.width - 1, Math.max(0, Math.round(pin.x))),
    y: Math.min(map.height - 1, Math.max(0, Math.round(pin.y))),
    label: String(pin.label ?? "").slice(0, 60),
  }));
  getDatabase()
    .prepare(`UPDATE overworld_maps SET pins_json = ?, updated_at = ? WHERE campaign_id = ?`)
    .run(JSON.stringify(cleaned), nowIso(), campaignId);
  return { ...map, pins: cleaned };
}
