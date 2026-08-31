import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  EMPTY_TEMPLATE_MAP,
  type TemplateEnemy,
  type TemplateMap,
} from "@/lib/dm/encounter-template-logic";

// Storage for prepared encounters. Rows are text: a roster, a battlefield
// hint, saved map settings and the DM's notes. Nothing here is a live
// combatant, which is the point; deploying a template runs the ordinary
// start_encounter path (src/lib/dm/encounter-templates.ts).

export type EncounterTemplate = {
  id: string;
  campaignId: string;
  name: string;
  enemies: TemplateEnemy[];
  battlefield: string;
  map: TemplateMap;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

type TemplateRow = {
  id: string;
  campaign_id: string;
  name: string;
  enemies_json: string;
  battlefield: string;
  map_json: string;
  notes: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
};

function mapTemplate(row: TemplateRow): EncounterTemplate {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    name: row.name,
    enemies: parseJson<TemplateEnemy[]>(row.enemies_json, []),
    battlefield: row.battlefield ?? "",
    map: { ...EMPTY_TEMPLATE_MAP, ...parseJson<Partial<TemplateMap>>(row.map_json, {}) },
    notes: row.notes ?? "",
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listEncounterTemplates(campaignId: string): EncounterTemplate[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM encounter_templates WHERE campaign_id = ? ORDER BY name COLLATE NOCASE`)
    .all(campaignId) as TemplateRow[];
  return rows.map(mapTemplate);
}

export function getEncounterTemplate(id: string): EncounterTemplate | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM encounter_templates WHERE id = ?`)
    .get(id) as TemplateRow | undefined;
  return row ? mapTemplate(row) : null;
}

export function insertEncounterTemplate(input: {
  campaignId: string;
  name: string;
  enemies: TemplateEnemy[];
  battlefield: string;
  map: TemplateMap;
  notes: string;
  createdByUserId: string;
}): EncounterTemplate {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO encounter_templates
         (id, campaign_id, name, enemies_json, battlefield, map_json, notes,
          created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.name,
      JSON.stringify(input.enemies),
      input.battlefield,
      JSON.stringify(input.map),
      input.notes,
      input.createdByUserId,
      now,
      now,
    );
  return getEncounterTemplate(id) as EncounterTemplate;
}

export function updateEncounterTemplate(
  id: string,
  patch: {
    name: string;
    enemies: TemplateEnemy[];
    battlefield: string;
    map: TemplateMap;
    notes: string;
  },
): EncounterTemplate | null {
  getDatabase()
    .prepare(
      `UPDATE encounter_templates SET name = ?, enemies_json = ?, battlefield = ?,
         map_json = ?, notes = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      patch.name,
      JSON.stringify(patch.enemies),
      patch.battlefield,
      JSON.stringify(patch.map),
      patch.notes,
      nowIso(),
      id,
    );
  return getEncounterTemplate(id);
}

export function deleteEncounterTemplate(id: string) {
  getDatabase().prepare(`DELETE FROM encounter_templates WHERE id = ?`).run(id);
}
