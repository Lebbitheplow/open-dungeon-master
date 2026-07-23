import { getDatabase, nowIso, parseJson } from "@/lib/db/core";

// Story chapters: closed spans of the campaign transcript, each with an AI
// title, summary, and highlights. Exactly one chapter per campaign is open
// and accumulates messages until a scene break or size cap closes it.

export type Chapter = {
  id: string;
  campaignId: string;
  index: number;
  title: string;
  summary: string;
  highlights: string[];
  seqStart: number;
  seqEnd: number | null;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
};

type ChapterRow = {
  id: string;
  campaign_id: string;
  chapter_index: number;
  title: string;
  summary: string;
  highlights_json: string;
  seq_start: number;
  seq_end: number | null;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
};

// Explicit column list so the embedding BLOB never rides along on ordinary
// chapter reads (listChapters runs every DM turn).
const CHAPTER_COLUMNS =
  "id, campaign_id, chapter_index, title, summary, highlights_json, seq_start, seq_end, status, created_at, updated_at";

function mapChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    index: row.chapter_index,
    title: row.title,
    summary: row.summary,
    highlights: parseJson<string[]>(row.highlights_json, []),
    seqStart: row.seq_start,
    seqEnd: row.seq_end,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listChapters(campaignId: string): Chapter[] {
  const rows = getDatabase()
    .prepare(`SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE campaign_id = ? ORDER BY chapter_index ASC`)
    .all(campaignId) as ChapterRow[];
  return rows.map(mapChapter);
}

export function getChapter(chapterId: string): Chapter | null {
  const row = getDatabase()
    .prepare(`SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE id = ?`)
    .get(chapterId) as ChapterRow | undefined;
  return row ? mapChapter(row) : null;
}

export function getOpenChapter(campaignId: string): Chapter | null {
  const row = getDatabase()
    .prepare(`SELECT ${CHAPTER_COLUMNS} FROM chapters WHERE campaign_id = ? AND status = 'open'`)
    .get(campaignId) as ChapterRow | undefined;
  return row ? mapChapter(row) : null;
}

// The open chapter, created lazily at index 1 (covering the whole log so
// far) for campaigns that predate the chapter system.
export function ensureOpenChapter(campaignId: string): Chapter {
  const existing = getOpenChapter(campaignId);
  if (existing) {
    return existing;
  }
  const db = getDatabase();
  const last = db
    .prepare(
      `SELECT chapter_index, seq_end FROM chapters WHERE campaign_id = ? ORDER BY chapter_index DESC LIMIT 1`,
    )
    .get(campaignId) as { chapter_index: number; seq_end: number | null } | undefined;
  const now = nowIso();
  const id = crypto.randomUUID();
  db.prepare(
    `
      INSERT INTO chapters (
        id, campaign_id, chapter_index, seq_start, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, 'open', ?, ?)
    `,
  ).run(id, campaignId, (last?.chapter_index ?? 0) + 1, (last?.seq_end ?? -1) + 1, now, now);
  return getChapter(id)!;
}

// Closes the open chapter with its generated title/summary/highlights and
// opens the next one, atomically.
export function closeChapterRow(
  chapterId: string,
  input: { title: string; summary: string; highlights: string[]; seqEnd: number },
): { closed: Chapter; opened: Chapter } | null {
  const db = getDatabase();
  const chapter = getChapter(chapterId);
  if (!chapter || chapter.status !== "open") {
    return null;
  }
  const now = nowIso();
  const nextId = crypto.randomUUID();
  db.transaction(() => {
    db.prepare(
      `
        UPDATE chapters
        SET status = 'closed', title = ?, summary = ?, highlights_json = ?,
            seq_end = ?, updated_at = ?
        WHERE id = ? AND status = 'open'
      `,
    ).run(
      input.title.slice(0, 120),
      input.summary.slice(0, 8_000),
      JSON.stringify(input.highlights.slice(0, 6).map((entry) => entry.slice(0, 300))),
      input.seqEnd,
      now,
      chapterId,
    );
    db.prepare(
      `
        INSERT INTO chapters (
          id, campaign_id, chapter_index, seq_start, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, 'open', ?, ?)
      `,
    ).run(nextId, chapter.campaignId, chapter.index + 1, input.seqEnd + 1, now, now);
  })();
  return { closed: getChapter(chapterId)!, opened: getChapter(nextId)! };
}

// Semantic-index support: the chapter summary's MiniLM embedding, used for
// phase-1 chapter picking in recall (src/lib/dm/memory-index.ts).
export function setChapterEmbedding(chapterId: string, embedding: Buffer) {
  getDatabase()
    .prepare(`UPDATE chapters SET embedding = ? WHERE id = ?`)
    .run(embedding, chapterId);
}

export function listChapterEmbeddings(
  campaignId: string,
): Array<{ id: string; index: number; embedding: Buffer | null }> {
  return getDatabase()
    .prepare(
      `SELECT id, chapter_index, embedding FROM chapters
       WHERE campaign_id = ? AND status = 'closed'
       ORDER BY chapter_index ASC`,
    )
    .all(campaignId)
    .map((row) => {
      const raw = row as { id: string; chapter_index: number; embedding: Buffer | null };
      return { id: raw.id, index: raw.chapter_index, embedding: raw.embedding };
    });
}

// Party lead edits to a closed chapter's title/summary/highlights.
export function updateChapter(
  chapterId: string,
  patch: { title?: string; summary?: string; highlights?: string[] },
): Chapter | null {
  const chapter = getChapter(chapterId);
  if (!chapter) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE chapters SET title = ?, summary = ?, highlights_json = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      (patch.title ?? chapter.title).slice(0, 120),
      (patch.summary ?? chapter.summary).slice(0, 8_000),
      JSON.stringify((patch.highlights ?? chapter.highlights).slice(0, 6)),
      nowIso(),
      chapterId,
    );
  return getChapter(chapterId);
}
