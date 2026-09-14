import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { clampPower, normalizeFactionAttitude, type Faction, type FactionAttitude } from "@/lib/dm/faction-logic";
import { isUploadedImagePath } from "@/lib/uploads";

// Faction storage (docs/vtt-parity-implementation-plan.md section 6).

type Row = {
  id: string;
  campaign_id: string;
  name: string;
  blurb: string;
  goal: string;
  attitude_to_party: string;
  power: number;
  tags_json: string;
  portrait_path: string | null;
  created_at: string;
  updated_at: string;
};

function map(row: Row): Faction {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    blurb: row.blurb,
    goal: row.goal,
    attitude: normalizeFactionAttitude(row.attitude_to_party),
    power: clampPower(row.power),
    tags: parseJson<string[]>(row.tags_json, []),
    portraitPath: isUploadedImagePath(row.portrait_path) ? row.portrait_path : "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listFactions(campaignId: string): Faction[] {
  return (
    getDatabase()
      .prepare(`SELECT * FROM factions WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`)
      .all(campaignId) as Row[]
  ).map(map);
}

export function getFaction(factionId: string): Faction | null {
  const row = getDatabase().prepare(`SELECT * FROM factions WHERE id = ?`).get(factionId) as Row | undefined;
  return row ? map(row) : null;
}

// Exact first, then the loose match a model tends to produce ("the reed
// court", "Reed Court"): one side contains the other, articles aside.
export function findFactionByName(campaignId: string, name: string): Faction | null {
  const wanted = name.trim();
  const row = getDatabase()
    .prepare(`SELECT * FROM factions WHERE campaign_id = ? AND name = ? COLLATE NOCASE LIMIT 1`)
    .get(campaignId, wanted) as Row | undefined;
  if (row) {
    return map(row);
  }
  const loose = wanted.toLowerCase().replace(/^the\s+/, "");
  if (loose.length < 3) {
    return null;
  }
  const candidates = listFactions(campaignId).filter((faction) => {
    const own = faction.name.toLowerCase().replace(/^the\s+/, "");
    return own === loose || own.includes(loose) || loose.includes(own);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export type FactionInput = {
  name: string;
  blurb?: string;
  goal?: string;
  attitude?: FactionAttitude;
  power?: number;
  tags?: string[];
  portraitPath?: string;
};

export function insertFaction(campaignId: string, input: FactionInput): Faction {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO factions (id, campaign_id, name, blurb, goal, attitude_to_party, power, tags_json, portrait_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      campaignId,
      input.name.trim().slice(0, 80),
      (input.blurb ?? "").trim().slice(0, 400),
      (input.goal ?? "").trim().slice(0, 400),
      normalizeFactionAttitude(input.attitude),
      clampPower(input.power ?? 1),
      JSON.stringify((input.tags ?? []).map((tag) => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 8)),
      input.portraitPath && isUploadedImagePath(input.portraitPath) ? input.portraitPath : "",
      now,
      now,
    );
  return getFaction(id)!;
}

export function updateFaction(factionId: string, patch: Partial<FactionInput>): Faction | null {
  const current = getFaction(factionId);
  if (!current) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE factions SET name = ?, blurb = ?, goal = ?, attitude_to_party = ?, power = ?, tags_json = ?, portrait_path = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      (patch.name ?? current.name).trim().slice(0, 80) || current.name,
      (patch.blurb ?? current.blurb).trim().slice(0, 400),
      (patch.goal ?? current.goal).trim().slice(0, 400),
      normalizeFactionAttitude(patch.attitude ?? current.attitude),
      clampPower(patch.power ?? current.power),
      JSON.stringify((patch.tags ?? current.tags).map((tag) => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 8)),
      patch.portraitPath === undefined ? current.portraitPath : isUploadedImagePath(patch.portraitPath) ? patch.portraitPath : "",
      nowIso(),
      factionId,
    );
  return getFaction(factionId);
}

export function deleteFaction(factionId: string): void {
  const db = getDatabase();
  db.prepare(`UPDATE npcs SET faction_id = '' WHERE faction_id = ?`).run(factionId);
  db.prepare(`DELETE FROM factions WHERE id = ?`).run(factionId);
}
