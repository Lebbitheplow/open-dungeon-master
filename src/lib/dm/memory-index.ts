import {
  getChapter,
  listChapterEmbeddings,
  setChapterEmbedding,
  type Chapter,
} from "@/lib/db/chapters";
import { listMessagesInSeqRange } from "@/lib/db/messages";
import {
  chapterHasChunks,
  insertSceneChunks,
  listSceneChunksForChapters,
} from "@/lib/db/scene-chunks";
import { getDatabase, nowIso } from "@/lib/db/core";
import { bufferToVector, cosine, embed, vectorToBuffer } from "@/lib/embeddings";
import { chunkScenes } from "@/lib/dm/scene-logic";

// The semantic memory index. Chapter close hands each sealed chapter here:
// its transcript is chunked into verbatim scenes, embedded on the CPU, and
// stored; the chapter summary gets its own embedding for phase-1 picking.
// Recall then runs two-phase: cosine over chapter-summary embeddings picks
// the likely chapters, cosine over their scene rows returns the verbatim
// spans. All brute-force JS over a few thousand 384-dim vectors, sub-10ms.

// Indexes one closed chapter. Idempotent (skips chapters that already have
// chunks) and safe to fire-and-forget: any failure just leaves the chapter
// to the keyword fallback and the backfill script.
export async function indexChapter(campaignId: string, chapterId: string): Promise<void> {
  try {
    const chapter = getChapter(chapterId);
    if (!chapter || chapter.status !== "closed" || chapter.seqEnd === null) {
      return;
    }
    if (!chapterHasChunks(chapterId)) {
      const messages = listMessagesInSeqRange(campaignId, chapter.seqStart, chapter.seqEnd);
      const scenes = chunkScenes(messages);
      if (scenes.length) {
        const vectors = await embed(scenes.map((scene) => scene.text));
        insertSceneChunks(
          scenes.map((scene, index) => ({
            campaignId,
            chapterId,
            seqStart: scene.seqStart,
            seqEnd: scene.seqEnd,
            text: scene.text,
            embedding: vectorToBuffer(vectors[index]),
          })),
        );
      }
    }
    const summaryText = `${chapter.title}. ${chapter.summary}`.trim();
    if (summaryText.length > 1) {
      const [vector] = await embed([summaryText]);
      setChapterEmbedding(chapterId, vectorToBuffer(vector));
    }
    await dedupFactsSemantically(campaignId);
  } catch (error) {
    console.error("[memory-index] indexing failed", error);
  }
}

export type RecalledScene = {
  chapterIndex: number;
  seqStart: number;
  seqEnd: number;
  text: string;
  similarity: number;
};

const PHASE1_CHAPTERS = 3;
const PHASE2_SCENES = 3;
const SCENE_FLOOR = 0.25;

// Two-phase semantic recall. Returns [] whenever the index is empty (the
// caller falls back to keyword scoring).
export async function searchScenes(
  campaignId: string,
  query: string,
): Promise<RecalledScene[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const chapters = listChapterEmbeddings(campaignId)
    .map((row) => ({ ...row, vector: bufferToVector(row.embedding) }))
    .filter((row): row is typeof row & { vector: Float32Array } => row.vector !== null);
  if (!chapters.length) {
    return [];
  }
  const [queryVector] = await embed([trimmed]);
  const picked = chapters
    .map((row) => ({ row, similarity: cosine(queryVector, row.vector) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, PHASE1_CHAPTERS);
  const chapterIndexById = new Map(picked.map((entry) => [entry.row.id, entry.row.index]));
  const scenes = listSceneChunksForChapters(
    campaignId,
    picked.map((entry) => entry.row.id),
  );
  return scenes
    .map((scene) => {
      const vector = bufferToVector(scene.embedding);
      return {
        chapterIndex: chapterIndexById.get(scene.chapterId) ?? 0,
        seqStart: scene.seqStart,
        seqEnd: scene.seqEnd,
        text: scene.text,
        similarity: vector ? cosine(queryVector, vector) : 0,
      };
    })
    .filter((scene) => scene.similarity >= SCENE_FLOOR)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, PHASE2_SCENES);
}

// Convenience for the backfill script and chapter close.
export async function indexClosedChapters(campaignId: string, chapters: Chapter[]) {
  for (const chapter of chapters) {
    if (chapter.status === "closed") {
      await indexChapter(campaignId, chapter.id);
    }
  }
}

const FACT_DUP_SIMILARITY = 0.92;

// Semantic upgrade over the token-overlap dedup that runs at insert time:
// embeds facts that lack a vector, then retires an unpinned active fact
// whose wording near-duplicates an older one in the same category. Runs on
// the chapter-close heartbeat, so drift never accumulates for long.
export async function dedupFactsSemantically(campaignId: string): Promise<void> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, category, fact, pinned, embedding, created_at FROM world_facts
       WHERE campaign_id = ? AND status = 'active'
       ORDER BY created_at ASC, id ASC`,
    )
    .all(campaignId) as Array<{
    id: string;
    category: string;
    fact: string;
    pinned: number;
    embedding: Buffer | null;
    created_at: string;
  }>;
  if (!rows.length) {
    return;
  }
  const missing = rows.filter((row) => !bufferToVector(row.embedding));
  if (missing.length) {
    const vectors = await embed(missing.map((row) => row.fact));
    const update = db.prepare(`UPDATE world_facts SET embedding = ? WHERE id = ?`);
    missing.forEach((row, index) => {
      row.embedding = vectorToBuffer(vectors[index]);
      update.run(row.embedding, row.id);
    });
  }
  const retire = db.prepare(
    `UPDATE world_facts SET status = 'superseded', updated_at = ? WHERE id = ?`,
  );
  const kept: Array<{ category: string; vector: Float32Array; pinned: boolean }> = [];
  for (const row of rows) {
    const vector = bufferToVector(row.embedding);
    if (!vector) {
      continue;
    }
    const duplicate =
      row.pinned !== 1 &&
      kept.some(
        (entry) =>
          entry.category === row.category && cosine(entry.vector, vector) >= FACT_DUP_SIMILARITY,
      );
    if (duplicate) {
      retire.run(nowIso(), row.id);
    } else {
      kept.push({ category: row.category, vector, pinned: row.pinned === 1 });
    }
  }
}
