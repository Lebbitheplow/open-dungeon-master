import { getDatabase, nowIso } from "@/lib/db/core";

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
};

type RawRow = {
  id: string;
  campaign_id: string;
  chapter_id: string;
  seq_start: number;
  seq_end: number;
  text: string;
  embedding: Buffer;
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
    `INSERT INTO scene_chunks (id, campaign_id, chapter_id, seq_start, seq_end, text, embedding, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
        now,
      );
    }
  });
  run(chunks);
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
