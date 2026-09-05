import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { embed, vectorToBuffer } from "@/lib/embeddings";
import {
  normalizeLoreVisibility,
  type LoreVisibility,
  type WorldLoreCategory,
  type WorldLoreEntry,
} from "@/lib/dm/world-lore-logic";
import { isUploadedImagePath } from "@/lib/uploads";

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
  visibility: string | null;
  image_path: string | null;
  created_at: string;
  updated_at: string;
};

const LORE_COLUMNS =
  "id, campaign_id, category, title, body, tags_json, pinned, visibility, image_path, created_at, updated_at";

function mapEntry(row: LoreRow): WorldLoreEntry {
  const image = row.image_path ?? "";
  return {
    id: row.id,
    campaignId: row.campaign_id,
    category: row.category,
    title: row.title,
    body: row.body,
    tags: parseJson<string[]>(row.tags_json, []),
    pinned: Boolean(row.pinned),
    visibility: normalizeLoreVisibility(row.visibility),
    // Refused rather than trusted: a path this app did not write reads back
    // as no picture.
    imagePath: image && isUploadedImagePath(image) ? image : "",
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
  visibility?: LoreVisibility;
  imagePath?: string;
}): WorldLoreEntry {
  const now = nowIso();
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO lore_entries (id, campaign_id, category, title, body, tags_json, pinned, visibility, image_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.category,
      input.title,
      input.body,
      JSON.stringify(input.tags),
      normalizeLoreVisibility(input.visibility),
      input.imagePath && isUploadedImagePath(input.imagePath) ? input.imagePath : "",
      now,
      now,
    );
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
    visibility?: LoreVisibility;
    // "" takes the picture away.
    imagePath?: string;
  },
): WorldLoreEntry | null {
  const entry = getLoreEntry(entryId);
  if (!entry) {
    return null;
  }
  const textChanged =
    (patch.title !== undefined && patch.title !== entry.title) ||
    (patch.body !== undefined && patch.body !== entry.body);
  const imagePath =
    patch.imagePath === undefined
      ? entry.imagePath
      : patch.imagePath && isUploadedImagePath(patch.imagePath)
        ? patch.imagePath
        : "";
  getDatabase()
    .prepare(
      `UPDATE lore_entries
       SET category = ?, title = ?, body = ?, tags_json = ?, pinned = ?, visibility = ?, image_path = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      patch.category ?? entry.category,
      patch.title ?? entry.title,
      patch.body ?? entry.body,
      JSON.stringify(patch.tags ?? entry.tags),
      patch.pinned === undefined ? (entry.pinned ? 1 : 0) : patch.pinned ? 1 : 0,
      patch.visibility ?? entry.visibility,
      imagePath,
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

// Background pass over every entry in a campaign that still has no vector.
// Rows written in bulk (a workshop import) skip the per-insert embed so the
// copy stays one transaction; this is how they catch up afterwards.
export async function embedPendingLore(campaignId: string) {
  const pending = getDatabase()
    .prepare(`SELECT id FROM lore_entries WHERE campaign_id = ? AND embedding IS NULL`)
    .all(campaignId) as Array<{ id: string }>;
  for (const row of pending) {
    await embedLoreEntry(row.id);
  }
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
