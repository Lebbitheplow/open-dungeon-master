import { getDatabase, nowIso } from "@/lib/db/core";
import {
  parseBonds,
  parseGoals,
  parsePersonality,
  parsePressure,
  parseRelations,
  type NpcAgency,
} from "@/lib/dm/npc-logic";

// Persistent NPCs and their disposition toward the party. Before this, an
// NPC's attitude lived only in the model's narration and reset every turn;
// now a grudge or a friendship survives sessions and drives the DC of the
// next social check (src/lib/dm/social.ts). The agency columns add inner
// life on top: personality axes, goals advanced by background dice, bonds
// per character, NPC-to-NPC relations, and a pressure meter
// (src/lib/dm/npc-logic.ts).

export type Attitude = "hostile" | "indifferent" | "friendly";

export type Npc = {
  id: string;
  campaignId: string;
  name: string;
  attitude: Attitude;
  trait: string;
  location: string;
  lastShiftTurn: string;
  agency: NpcAgency;
  arcCastId: string;
  createdAt: string;
  updatedAt: string;
};

type NpcRow = {
  id: string;
  campaign_id: string;
  name: string;
  attitude: Attitude;
  trait: string;
  location: string;
  last_shift_turn: string;
  personality_json: string;
  goals_json: string;
  relations_json: string;
  bonds_json: string;
  pressure_json: string;
  arc_cast_id: string;
  created_at: string;
  updated_at: string;
};

function mapNpc(row: NpcRow): Npc {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    attitude: row.attitude,
    trait: row.trait,
    location: row.location,
    lastShiftTurn: row.last_shift_turn,
    agency: {
      personality: parsePersonality(row.personality_json),
      goals: parseGoals(row.goals_json),
      relations: parseRelations(row.relations_json),
      bonds: parseBonds(row.bonds_json),
      pressure: parsePressure(row.pressure_json),
    },
    arcCastId: row.arc_cast_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listNpcs(campaignId: string): Npc[] {
  return (
    getDatabase()
      .prepare(`SELECT * FROM npcs WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`)
      .all(campaignId) as NpcRow[]
  ).map(mapNpc);
}

export function getNpcByName(campaignId: string, name: string): Npc | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM npcs WHERE campaign_id = ? AND name = ? COLLATE NOCASE LIMIT 1`,
    )
    .get(campaignId, name.trim()) as NpcRow | undefined;
  return row ? mapNpc(row) : null;
}

// Registers an NPC or updates the mutable descriptive fields of an existing
// one by name. Attitude is only overwritten when explicitly provided, so
// re-registering a known NPC never silently resets a grudge.
export function upsertNpc(input: {
  campaignId: string;
  name: string;
  attitude?: Attitude;
  trait?: string;
  location?: string;
}): Npc {
  const db = getDatabase();
  const now = nowIso();
  const existing = getNpcByName(input.campaignId, input.name);
  if (existing) {
    db.prepare(
      `UPDATE npcs
       SET attitude = ?, trait = ?, location = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.attitude ?? existing.attitude,
      input.trait ?? existing.trait,
      input.location ?? existing.location,
      now,
      existing.id,
    );
    return getNpcByName(input.campaignId, input.name) ?? existing;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO npcs (id, campaign_id, name, attitude, trait, location, last_shift_turn, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
  ).run(
    id,
    input.campaignId,
    input.name.trim(),
    input.attitude ?? "indifferent",
    input.trait ?? "",
    input.location ?? "",
    now,
    now,
  );
  return mapNpc(
    db.prepare(`SELECT * FROM npcs WHERE id = ?`).get(id) as NpcRow,
  );
}

// Records an attitude change and the turn it happened on (the one-shift-per-
// exchange guard reads last_shift_turn).
export function setNpcAttitude(id: string, attitude: Attitude, turnId: string): Npc | null {
  const db = getDatabase();
  db.prepare(`UPDATE npcs SET attitude = ?, last_shift_turn = ?, updated_at = ? WHERE id = ?`).run(
    attitude,
    turnId,
    nowIso(),
    id,
  );
  const row = db.prepare(`SELECT * FROM npcs WHERE id = ?`).get(id) as NpcRow | undefined;
  return row ? mapNpc(row) : null;
}

export function deleteNpc(id: string): boolean {
  return getDatabase().prepare(`DELETE FROM npcs WHERE id = ?`).run(id).changes > 0;
}

// Writes any subset of the agency state; untouched pieces keep their column.
export function patchNpcAgency(
  id: string,
  patch: Partial<NpcAgency> & { arcCastId?: string },
): Npc | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM npcs WHERE id = ?`).get(id) as NpcRow | undefined;
  if (!row) {
    return null;
  }
  db.prepare(
    `UPDATE npcs
     SET personality_json = ?, goals_json = ?, relations_json = ?,
         bonds_json = ?, pressure_json = ?, arc_cast_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.personality !== undefined
      ? patch.personality
        ? JSON.stringify(patch.personality)
        : ""
      : row.personality_json,
    patch.goals !== undefined ? JSON.stringify(patch.goals) : row.goals_json,
    patch.relations !== undefined ? JSON.stringify(patch.relations) : row.relations_json,
    patch.bonds !== undefined ? JSON.stringify(patch.bonds) : row.bonds_json,
    patch.pressure !== undefined ? JSON.stringify(patch.pressure) : row.pressure_json,
    patch.arcCastId !== undefined ? patch.arcCastId : row.arc_cast_id,
    nowIso(),
    id,
  );
  const updated = db.prepare(`SELECT * FROM npcs WHERE id = ?`).get(id) as NpcRow | undefined;
  return updated ? mapNpc(updated) : null;
}
