import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  normalizeAttributes,
  removeAttribute,
  setAttribute,
  type Attribute,
  type AttributeTarget,
} from "@/lib/dm/attributes-logic";

// Freeform attributes, stored per (campaign, target kind, target id).
//
// A table rather than a column, because the targets are things that do not
// all have a row of their own: an NPC is a name in a facts table, a faction
// may exist only in the DM's head, and "the campaign" is a target too. One
// narrow table keyed by kind and id covers every case without any of them
// needing a schema of its own, which is the whole point of the feature.

export type AttributeRecord = {
  campaignId: string;
  target: AttributeTarget;
  targetId: string;
  attributes: Attribute[];
  updatedAt: string;
};

type Row = {
  campaign_id: string;
  target_kind: string;
  target_id: string;
  attributes_json: string;
  updated_at: string;
};

function mapRow(row: Row): AttributeRecord {
  return {
    campaignId: row.campaign_id,
    target: row.target_kind as AttributeTarget,
    targetId: row.target_id,
    attributes: normalizeAttributes(parseJson(row.attributes_json, [])),
    updatedAt: row.updated_at,
  };
}

// Targets are matched case-insensitively on the id, because an NPC's id is
// their name and a DM types "The Harbour Guild" one day and "the harbour
// guild" the next.
function normalizeId(targetId: string): string {
  return targetId.trim().toLowerCase().slice(0, 120);
}

export function getAttributes(
  campaignId: string,
  target: AttributeTarget,
  targetId: string,
): Attribute[] {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM entity_attributes
        WHERE campaign_id = ? AND target_kind = ? AND target_id = ?`,
    )
    .get(campaignId, target, normalizeId(targetId)) as Row | undefined;
  return row ? mapRow(row).attributes : [];
}

export function listAttributeRecords(campaignId: string): AttributeRecord[] {
  return (
    getDatabase()
      .prepare(
        `SELECT * FROM entity_attributes WHERE campaign_id = ? ORDER BY target_kind, target_id`,
      )
      .all(campaignId) as Row[]
  ).map(mapRow);
}

export function saveAttributes(
  campaignId: string,
  target: AttributeTarget,
  targetId: string,
  attributes: Attribute[],
) {
  const id = normalizeId(targetId);
  if (!attributes.length) {
    // An empty set leaves no row: a target the DM cleared should not linger
    // in the list as an empty heading.
    getDatabase()
      .prepare(
        `DELETE FROM entity_attributes
          WHERE campaign_id = ? AND target_kind = ? AND target_id = ?`,
      )
      .run(campaignId, target, id);
    return;
  }
  getDatabase()
    .prepare(
      `INSERT INTO entity_attributes (campaign_id, target_kind, target_id, attributes_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(campaign_id, target_kind, target_id)
       DO UPDATE SET attributes_json = excluded.attributes_json, updated_at = excluded.updated_at`,
    )
    .run(campaignId, target, id, JSON.stringify(attributes), nowIso());
}

// Read, change, write, so two edits landing together cannot both write from
// the same stale list.
export function putAttribute(
  campaignId: string,
  target: AttributeTarget,
  targetId: string,
  attribute: Attribute,
): { attributes: Attribute[] } | { error: string } {
  const next = setAttribute(getAttributes(campaignId, target, targetId), attribute);
  if ("error" in next) {
    return next;
  }
  saveAttributes(campaignId, target, targetId, next.attributes);
  return next;
}

export function dropAttribute(
  campaignId: string,
  target: AttributeTarget,
  targetId: string,
  key: string,
): Attribute[] {
  const next = removeAttribute(getAttributes(campaignId, target, targetId), key);
  saveAttributes(campaignId, target, targetId, next);
  return next;
}
