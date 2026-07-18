import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import type { GeneratedImage } from "@/lib/types";

// Structured location state: the DM records each area's layout and exits so
// narration stays spatially consistent and maps render per area.

export type CampaignLocation = {
  id: string;
  campaignId: string;
  name: string;
  layoutDescription: string;
  connections: string[];
  visited: boolean;
  isCurrent: boolean;
  mapImage: GeneratedImage | null;
  createdAt: string;
  updatedAt: string;
};

type LocationRow = {
  id: string;
  campaign_id: string;
  name: string;
  layout_description: string;
  connections_json: string;
  visited: number;
  is_current: number;
  map_image_json: string | null;
  created_at: string;
  updated_at: string;
};

function mapLocation(row: LocationRow): CampaignLocation {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    layoutDescription: row.layout_description,
    connections: parseJson<string[]>(row.connections_json, []),
    visited: Boolean(row.visited),
    isCurrent: Boolean(row.is_current),
    mapImage: parseJson<GeneratedImage | null>(row.map_image_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getLocation(id: string): CampaignLocation | null {
  const row = getDatabase().prepare(`SELECT * FROM locations WHERE id = ?`).get(id) as
    | LocationRow
    | undefined;
  return row ? mapLocation(row) : null;
}

export function getLocationByName(campaignId: string, name: string): CampaignLocation | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM locations WHERE campaign_id = ? AND name = ? COLLATE NOCASE`)
    .get(campaignId, name) as LocationRow | undefined;
  return row ? mapLocation(row) : null;
}

export function listLocations(campaignId: string): CampaignLocation[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM locations WHERE campaign_id = ? ORDER BY updated_at DESC`)
    .all(campaignId) as LocationRow[];
  return rows.map(mapLocation);
}

export function getCurrentLocation(campaignId: string): CampaignLocation | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM locations WHERE campaign_id = ? AND is_current = 1 LIMIT 1`)
    .get(campaignId) as LocationRow | undefined;
  return row ? mapLocation(row) : null;
}

// Create-or-update by name, mark it current + visited, clear other currents.
export function upsertCurrentLocation(input: {
  campaignId: string;
  name: string;
  layoutDescription?: string;
  connections?: string[];
}): CampaignLocation {
  const db = getDatabase();
  const now = nowIso();
  const existing = getLocationByName(input.campaignId, input.name);

  const apply = db.transaction(() => {
    db.prepare(`UPDATE locations SET is_current = 0 WHERE campaign_id = ?`).run(input.campaignId);
    if (existing) {
      db.prepare(
        `
          UPDATE locations SET
            layout_description = ?, connections_json = ?, visited = 1,
            is_current = 1, updated_at = ?
          WHERE id = ?
        `,
      ).run(
        input.layoutDescription?.trim() || existing.layoutDescription,
        JSON.stringify(input.connections ?? existing.connections),
        now,
        existing.id,
      );
      return existing.id;
    }
    const id = crypto.randomUUID();
    db.prepare(
      `
        INSERT INTO locations (
          id, campaign_id, name, layout_description, connections_json,
          visited, is_current, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)
      `,
    ).run(
      id,
      input.campaignId,
      input.name.trim().slice(0, 80),
      (input.layoutDescription ?? "").trim().slice(0, 2_000),
      JSON.stringify(input.connections ?? []),
      now,
      now,
    );
    return id;
  });

  const id = apply();
  const location = getLocation(id);
  if (!location) {
    throw new Error("Failed to upsert location.");
  }
  return location;
}

export function updateCurrentLocationDetails(
  campaignId: string,
  patch: { layoutDescription?: string; connections?: string[] },
): CampaignLocation | null {
  const current = getCurrentLocation(campaignId);
  if (!current) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE locations SET layout_description = ?, connections_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      (patch.layoutDescription ?? current.layoutDescription).trim().slice(0, 2_000),
      JSON.stringify(patch.connections ?? current.connections),
      nowIso(),
      current.id,
    );
  return getLocation(current.id);
}

export function setLocationMap(locationId: string, image: GeneratedImage): boolean {
  const result = getDatabase()
    .prepare(`UPDATE locations SET map_image_json = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(image), nowIso(), locationId);
  return result.changes > 0;
}
