import { getDatabase, nowIso } from "@/lib/db/core";
import { EMBEDDING_DIM } from "@/lib/embeddings";
import { parseWitnesses, serializeWitnesses } from "@/lib/dm/witness-logic";

// Verbatim transcript spans with embeddings: the storage half of the
// semantic memory index (src/lib/dm/memory-index.ts builds and queries it).

export type SceneChunkRow = {
  id: string;
  campaignId: string;
  chapterId: string;
  seqStart: number;
  seqEnd: number;
  text: string;
  embedding: Buffer;
  // 1-5; see src/lib/dm/importance-logic.ts.
  importance: number;
  // Tracked NPCs present in this span; see src/lib/dm/witness-logic.ts.
  witnesses: string[];
};

type RawRow = {
  id: string;
  campaign_id: string;
  chapter_id: string;
  seq_start: number;
  seq_end: number;
  text: string;
  embedding: Buffer;
  importance: number | null;
  witnesses_json: string | null;
};

function mapRow(row: RawRow): SceneChunkRow {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    chapterId: row.chapter_id,
    seqStart: row.seq_start,
    seqEnd: row.seq_end,
    text: row.text,
    embedding: row.embedding,
    importance: row.importance ?? 3,
    witnesses: parseWitnesses(row.witnesses_json ?? "[]"),
  };
}

export function chapterHasChunks(chapterId: string): boolean {
  return Boolean(
    getDatabase()
      .prepare(`SELECT id FROM scene_chunks WHERE chapter_id = ? LIMIT 1`)
      .get(chapterId),
  );
}

export function insertSceneChunks(
  chunks: Array<Omit<SceneChunkRow, "id">>,
): void {
  const db = getDatabase();
  const insert = db.prepare(
    `INSERT INTO scene_chunks (id, campaign_id, chapter_id, seq_start, seq_end, text, embedding, importance, witnesses_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = nowIso();
  const run = db.transaction((rows: Array<Omit<SceneChunkRow, "id">>) => {
    for (const row of rows) {
      insert.run(
        crypto.randomUUID(),
        row.campaignId,
        row.chapterId,
        row.seqStart,
        row.seqEnd,
        row.text,
        row.embedding,
        row.importance,
        serializeWitnesses(row.witnesses),
        now,
      );
    }
  });
  run(chunks);
}

// Chunks whose vector is not a current one. embedding is NOT NULL, so an
// embedding-model change blanks it to a zero-length BLOB instead
// (src/lib/dm/embedding-reindex.ts); bufferToVector reads any wrong-size
// BLOB as "not indexed yet", and so does this query.
export function listSceneChunksMissingVectors(
  campaignId: string,
): Array<{ id: string; text: string }> {
  return getDatabase()
    .prepare(
      `SELECT id, text FROM scene_chunks
       WHERE campaign_id = ? AND length(embedding) != ?
       ORDER BY seq_start ASC`,
    )
    .all(campaignId, EMBEDDING_DIM * 4) as Array<{ id: string; text: string }>;
}

export function setSceneChunkEmbedding(chunkId: string, embedding: Buffer): void {
  getDatabase()
    .prepare(`UPDATE scene_chunks SET embedding = ? WHERE id = ?`)
    .run(embedding, chunkId);
}

export function listSceneChunksForChapters(
  campaignId: string,
  chapterIds: string[],
): SceneChunkRow[] {
  if (!chapterIds.length) {
    return [];
  }
  const placeholders = chapterIds.map(() => "?").join(",");
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM scene_chunks WHERE campaign_id = ? AND chapter_id IN (${placeholders})`,
    )
    .all(campaignId, ...chapterIds) as RawRow[];
  return rows.map(mapRow);
}
