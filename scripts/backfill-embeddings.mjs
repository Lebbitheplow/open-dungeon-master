// Backfills the semantic memory index for chapters closed before the index
// existed: chunks each closed chapter's transcript into verbatim scenes,
// embeds them with the local MiniLM model (CPU; first run downloads ~90MB
// into models/embeddings), and embeds chapter summaries for recall's
// phase-1 chapter picking. Idempotent: indexed chapters are skipped.
// Usage: node scripts/backfill-embeddings.mjs [campaignId]
// Safe to run while the server is up, but prefer a quiet moment: it shares
// the SQLite file and a few CPU cores with live turns.
import Database from "better-sqlite3-multiple-ciphers";
import { existsSync } from "node:fs";
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";
import { serverEnv } from "../src/lib/server-env.ts";
import { chunkScenes } from "../src/lib/dm/scene-logic.ts";

const dbPath =
  process.env.SQLITE_DB_PATH || path.join(process.cwd(), "data", "local-roleplay.sqlite");

function fail(message) {
  console.error(`[backfill-embeddings] ${message}`);
  process.exit(1);
}

const key = serverEnv("DB_ENCRYPTION_KEY");
if (!key) {
  fail("DB_ENCRYPTION_KEY is not set in .env.server.");
}
if (!existsSync(dbPath)) {
  fail(`No database at ${dbPath}.`);
}

const db = new Database(dbPath);
db.pragma("cipher='chacha20'");
db.pragma(`key='${key.replaceAll("'", "''")}'`);
try {
  db.prepare("SELECT count(*) FROM sqlite_master").get();
} catch {
  db.close();
  fail(`Could not decrypt ${dbPath}: wrong or missing DB_ENCRYPTION_KEY.`);
}

const hasSceneChunks = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='scene_chunks'`)
  .get();
if (!hasSceneChunks) {
  db.close();
  fail("No scene_chunks table yet. Start the app once to migrate, then rerun.");
}

env.cacheDir = path.join(process.cwd(), "models", "embeddings");
console.log("[backfill-embeddings] loading MiniLM (first run downloads the model)...");
const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
async function embed(texts) {
  const output = await embedder(texts, { pooling: "mean", normalize: true });
  return output.tolist().map((vector) => {
    const array = Float32Array.from(vector);
    return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  });
}

const campaignFilter = process.argv[2];
const campaigns = campaignFilter
  ? db.prepare(`SELECT id, title FROM campaigns WHERE id = ?`).all(campaignFilter)
  : db.prepare(`SELECT id, title FROM campaigns`).all();
if (!campaigns.length) {
  db.close();
  fail(campaignFilter ? `No campaign ${campaignFilter}.` : "No campaigns.");
}

const insertChunk = db.prepare(
  `INSERT INTO scene_chunks (id, campaign_id, chapter_id, seq_start, seq_end, text, embedding, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);

let indexedChapters = 0;
let totalScenes = 0;
for (const campaign of campaigns) {
  const chapters = db
    .prepare(
      `SELECT id, chapter_index, title, summary, seq_start, seq_end, embedding FROM chapters
       WHERE campaign_id = ? AND status = 'closed' ORDER BY chapter_index ASC`,
    )
    .all(campaign.id);
  for (const chapter of chapters) {
    const hasChunks = db
      .prepare(`SELECT id FROM scene_chunks WHERE chapter_id = ? LIMIT 1`)
      .get(chapter.id);
    if (!hasChunks && chapter.seq_end !== null) {
      const messages = db
        .prepare(
          `SELECT seq, author_type, content FROM campaign_messages
           WHERE campaign_id = ? AND seq >= ? AND seq <= ? ORDER BY seq ASC`,
        )
        .all(campaign.id, chapter.seq_start, chapter.seq_end)
        .map((row) => ({ seq: row.seq, authorType: row.author_type, content: row.content }));
      const scenes = chunkScenes(messages);
      if (scenes.length) {
        const vectors = await embed(scenes.map((scene) => scene.text));
        const now = new Date().toISOString();
        const write = db.transaction(() => {
          scenes.forEach((scene, index) => {
            insertChunk.run(
              crypto.randomUUID(),
              campaign.id,
              chapter.id,
              scene.seqStart,
              scene.seqEnd,
              scene.text,
              vectors[index],
              now,
            );
          });
        });
        write();
        totalScenes += scenes.length;
      }
    }
    if (!chapter.embedding) {
      const summaryText = `${chapter.title}. ${chapter.summary}`.trim();
      if (summaryText.length > 1) {
        const [vector] = await embed([summaryText]);
        db.prepare(`UPDATE chapters SET embedding = ? WHERE id = ?`).run(vector, chapter.id);
      }
    }
    indexedChapters += 1;
  }
  console.log(
    `[backfill-embeddings] "${campaign.title}": ${chapters.length} closed chapters processed`,
  );
}

db.close();
console.log(
  `[backfill-embeddings] done: ${indexedChapters} chapters checked, ${totalScenes} new scenes embedded`,
);
