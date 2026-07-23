import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { embed, vectorToBuffer } from "@/lib/embeddings";
import type { WorldLoreCategory, WorldLoreEntry } from "@/lib/dm/world-lore-logic";

// World lore builder storage (lore_entries): lead-authored world bible
// entries the DM prompt samples from and search_lore queries. Embeddings
// fill in asynchronously; a NULL embedding only means keyword fallback.

type LoreRow = {
  id: string;
  campaign_id: string;
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags_json: string;
  pinned: number;
  created_at: string;
  updated_at: string;
};

const LORE_COLUMNS = "id, campaign_id, category, title, body, tags_json, pinned, created_at, updated_at";

function mapEntry(row: LoreRow): WorldLoreEntry {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    category: row.category,
    title: row.title,
    body: row.body,
    tags: parseJson<string[]>(row.tags_json, []),
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listLoreEntries(campaignId: string): WorldLoreEntry[] {
  const rows = getDatabase()
    .prepare(
      `SELECT ${LORE_COLUMNS} FROM lore_entries
       WHERE campaign_id = ? ORDER BY category ASC, created_at ASC`,
    )
    .all(campaignId) as LoreRow[];
  return rows.map(mapEntry);
}

export function getLoreEntry(entryId: string): WorldLoreEntry | null {
  const row = getDatabase()
    .prepare(`SELECT ${LORE_COLUMNS} FROM lore_entries WHERE id = ?`)
    .get(entryId) as LoreRow | undefined;
  return row ? mapEntry(row) : null;
}

export function insertLoreEntry(input: {
  campaignId: string;
  category: WorldLoreCategory;
  title: string;
  body: string;
  tags: string[];
}): WorldLoreEntry {
  const now = nowIso();
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO lore_entries (id, campaign_id, category, title, body, tags_json, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, input.campaignId, input.category, input.title, input.body, JSON.stringify(input.tags), now, now);
  void embedLoreEntry(id);
  return getLoreEntry(id)!;
}

export function updateLoreEntry(
  entryId: string,
  patch: {
    category?: WorldLoreCategory;
    title?: string;
    body?: string;
    tags?: string[];
    pinned?: boolean;
  },
): WorldLoreEntry | null {
  const entry = getLoreEntry(entryId);
  if (!entry) {
    return null;
  }
  const textChanged =
    (patch.title !== undefined && patch.title !== entry.title) ||
    (patch.body !== undefined && patch.body !== entry.body);
  getDatabase()
    .prepare(
      `UPDATE lore_entries
       SET category = ?, title = ?, body = ?, tags_json = ?, pinned = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.category ?? entry.category,
      patch.title ?? entry.title,
      patch.body ?? entry.body,
      JSON.stringify(patch.tags ?? entry.tags),
      patch.pinned === undefined ? (entry.pinned ? 1 : 0) : patch.pinned ? 1 : 0,
      nowIso(),
      entryId,
    );
  if (textChanged) {
    void embedLoreEntry(entryId);
  }
  return getLoreEntry(entryId);
}

export function deleteLoreEntry(entryId: string) {
  getDatabase().prepare(`DELETE FROM lore_entries WHERE id = ?`).run(entryId);
}

// Retrieval view: entries with their embedding buffers (NULL = not yet
// indexed; callers fall back to keyword scoring).
export function listLoreWithEmbeddings(
  campaignId: string,
): Array<{ entry: WorldLoreEntry; embedding: Buffer | null }> {
  const rows = getDatabase()
    .prepare(`SELECT ${LORE_COLUMNS}, embedding FROM lore_entries WHERE campaign_id = ?`)
    .all(campaignId) as Array<LoreRow & { embedding: Buffer | null }>;
  return rows.map((row) => ({ entry: mapEntry(row), embedding: row.embedding }));
}

// Fire-and-forget MiniLM embedding of title+body; failures leave the
// embedding NULL, which retrieval treats as keyword-only.
async function embedLoreEntry(entryId: string) {
  try {
    const entry = getLoreEntry(entryId);
    if (!entry) {
      return;
    }
    const [vector] = await embed([`${entry.title}\n${entry.body}`]);
    if (vector) {
      getDatabase()
        .prepare(`UPDATE lore_entries SET embedding = ? WHERE id = ?`)
        .run(vectorToBuffer(vector), entryId);
    }
  } catch (error) {
    console.error("[lore] embedding failed", error);
  }
}
