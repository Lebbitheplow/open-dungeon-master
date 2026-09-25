import { getDatabase, nowIso } from "@/lib/db/core";
import { embed, vectorToBuffer } from "@/lib/embeddings";
import {
  HOUSE_RULES_MAX,
  carryChunkFlags,
  chunkHouseRules,
} from "@/lib/dm/rules-logic";

// Rules manager storage: campaigns.house_rules_text is the lead-edited
// source of truth; rule_chunks holds its retrieval pieces. Saving rechunks
// everything (flags carry over by fuzzy match) and re-embeds in the
// background; NULL embeddings only mean keyword fallback.

export type RuleChunk = {
  id: string;
  campaignId: string;
  chunkIndex: number;
  heading: string;
  text: string;
  enabled: boolean;
  pinned: boolean;
  // Words that force this chunk into the prompt when they appear.
  triggerKeywords: string;
  // 'house' for the house rules; a lore entry id for an attached PDF.
  source: string;
  createdAt: string;
  updatedAt: string;
};

type RuleChunkRow = {
  id: string;
  campaign_id: string;
  chunk_index: number;
  heading: string;
  text: string;
  enabled: number;
  pinned: number;
  trigger_keywords: string;
  source: string | null;
  created_at: string;
  updated_at: string;
};

const CHUNK_COLUMNS =
  "id, campaign_id, chunk_index, heading, text, enabled, pinned, trigger_keywords, source, created_at, updated_at";

function mapChunk(row: RuleChunkRow): RuleChunk {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    chunkIndex: row.chunk_index,
    heading: row.heading,
    text: row.text,
    enabled: Boolean(row.enabled),
    pinned: Boolean(row.pinned),
    triggerKeywords: row.trigger_keywords ?? "",
    source: row.source || "house",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getHouseRulesText(campaignId: string): string {
  const row = getDatabase()
    .prepare(`SELECT house_rules_text FROM campaigns WHERE id = ?`)
    .get(campaignId) as { house_rules_text: string } | undefined;
  return row?.house_rules_text ?? "";
}

export function listRuleChunks(campaignId: string): RuleChunk[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${CHUNK_COLUMNS} FROM rule_chunks WHERE campaign_id = ? ORDER BY chunk_index ASC`,
    )
    .all(campaignId) as RuleChunkRow[];
  return rows.map(mapChunk);
}

export function listRuleChunksWithEmbeddings(
  campaignId: string,
): Array<{ chunk: RuleChunk; embedding: Buffer | null }> {
  const rows = getDatabase()
    .prepare(
      `SELECT ${CHUNK_COLUMNS}, embedding FROM rule_chunks
       WHERE campaign_id = ? ORDER BY chunk_index ASC`,
    )
    .all(campaignId) as Array<RuleChunkRow & { embedding: Buffer | null }>;
  return rows.map((row) => ({ chunk: mapChunk(row), embedding: row.embedding }));
}

// Saves the house-rules text and rebuilds its chunks; enabled/pinned flags
// survive by heading or leading-text match. Embeddings refill async.
export function setHouseRules(campaignId: string, text: string): RuleChunk[] {
  const db = getDatabase();
  const clipped = text.slice(0, HOUSE_RULES_MAX);
  const previous = listRuleChunks(campaignId).filter((chunk) => chunk.source === "house");
  const drafts = carryChunkFlags(chunkHouseRules(clipped), previous);
  db.prepare(`UPDATE campaigns SET house_rules_text = ? WHERE id = ?`).run(clipped, campaignId);
  replaceSourceChunks(campaignId, "house", drafts);
  return listRuleChunks(campaignId);
}

// Rewrites every chunk of one source (the house rules, or one attached
// PDF) and leaves the other sources alone. Chunk indexes continue after
// the highest index the campaign already holds so ordering stays stable.
export function replaceSourceChunks(
  campaignId: string,
  source: string,
  drafts: Array<{ heading: string; text: string; enabled?: boolean; pinned?: boolean }>,
): void {
  const db = getDatabase();
  const now = nowIso();
  db.transaction(() => {
    db.prepare(`DELETE FROM rule_chunks WHERE campaign_id = ? AND source = ?`).run(campaignId, source);
    const base = source === "house" ? 0 : 10_000;
    const insert = db.prepare(
      `INSERT INTO rule_chunks (id, campaign_id, chunk_index, heading, text, enabled, pinned, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    drafts.forEach((draft, index) => {
      insert.run(
        crypto.randomUUID(),
        campaignId,
        base + index,
        draft.heading,
        draft.text,
        draft.enabled === false ? 0 : 1,
        draft.pinned ? 1 : 0,
        source,
        now,
        now,
      );
    });
  })();
  void embedRuleChunks(campaignId);
}

export function deleteSourceChunks(campaignId: string, source: string): void {
  getDatabase().prepare(`DELETE FROM rule_chunks WHERE campaign_id = ? AND source = ?`).run(campaignId, source);
}

export function setRuleChunkFlags(
  chunkId: string,
  flags: { enabled?: boolean; pinned?: boolean },
): RuleChunk | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT ${CHUNK_COLUMNS} FROM rule_chunks WHERE id = ?`)
    .get(chunkId) as RuleChunkRow | undefined;
  if (!row) {
    return null;
  }
  db.prepare(`UPDATE rule_chunks SET enabled = ?, pinned = ?, updated_at = ? WHERE id = ?`).run(
    flags.enabled === undefined ? row.enabled : flags.enabled ? 1 : 0,
    flags.pinned === undefined ? row.pinned : flags.pinned ? 1 : 0,
    nowIso(),
    chunkId,
  );
  const updated = db
    .prepare(`SELECT ${CHUNK_COLUMNS} FROM rule_chunks WHERE id = ?`)
    .get(chunkId) as RuleChunkRow;
  return mapChunk(updated);
}

// Background embedding pass over any chunks still missing a vector.
export async function embedRuleChunks(campaignId: string) {
  try {
    const db = getDatabase();
    const pending = db
      .prepare(
        `SELECT id, heading, text FROM rule_chunks
         WHERE campaign_id = ? AND embedding IS NULL`,
      )
      .all(campaignId) as Array<{ id: string; heading: string; text: string }>;
    if (!pending.length) {
      return;
    }
    const vectors = await embed(
      pending.map((chunk) => (chunk.heading ? `${chunk.heading}\n${chunk.text}` : chunk.text)),
    );
    const update = db.prepare(`UPDATE rule_chunks SET embedding = ? WHERE id = ?`);
    pending.forEach((chunk, index) => {
      const vector = vectors[index];
      if (vector) {
        update.run(vectorToBuffer(vector), chunk.id);
      }
    });
  } catch (error) {
    console.error("[rules] embedding failed", error);
  }
}
