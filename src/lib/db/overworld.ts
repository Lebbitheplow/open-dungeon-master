import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { listLocations, type CampaignLocation } from "@/lib/db/locations";
import {
  OVERWORLD_HEIGHT,
  OVERWORLD_WIDTH,
  generateOverworldTerrain,
  placeAnchor,
  tileAt,
  type XY,
} from "@/lib/overworld/logic";

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

function createMap(campaignId: string, seed: number): OverworldMap {
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO overworld_maps
         (campaign_id, seed, width, height, terrain, anchors_json, pins_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', '[]', ?, ?)`,
    )
    .run(
      campaignId,
      seed,
      OVERWORLD_WIDTH,
      OVERWORLD_HEIGHT,
      generateOverworldTerrain(seed, OVERWORLD_WIDTH, OVERWORLD_HEIGHT),
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
// the new ground (anything now on water or mountain is re-placed).
export function regenerateOverworld(campaignId: string): OverworldMap {
  const previous = readRow(campaignId);
  const fresh = createMap(campaignId, (Math.random() * 0xffffffff) >>> 0);
  if (previous) {
    const carried: Record<string, XY> = {};
    for (const [locationId, anchor] of Object.entries(previous.anchors)) {
      const tile = tileAt(fresh.terrain, fresh.width, anchor.x, anchor.y);
      if (tile !== "w" && tile !== "m") {
        carried[locationId] = anchor;
      }
    }
    saveAnchors(campaignId, carried);
    getDatabase()
      .prepare(`UPDATE overworld_maps SET pins_json = ?, updated_at = ? WHERE campaign_id = ?`)
      .run(JSON.stringify(previous.pins), nowIso(), campaignId);
  }
  return getOverworld(campaignId);
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
