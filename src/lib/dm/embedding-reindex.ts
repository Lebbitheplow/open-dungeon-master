import { getDatabase, nowIso } from "@/lib/db/core";
import { embedPendingLore } from "@/lib/db/lore";
import { embedPendingNotes } from "@/lib/db/notes";
import { embedRuleChunks } from "@/lib/db/rules";
import { EMBEDDING_DIM, EMBEDDING_KEY, embed, embeddingIndexStale } from "@/lib/embeddings";
import {
  embedPendingChapterSummaries,
  embedPendingFacts,
  reembedSceneChunks,
} from "@/lib/dm/memory-index";

// Keeps the stored vectors and the configured embedding model in step.
//
// Vectors from two models compare without error but rank at random, so the
// database records which model built its vectors (app_settings.embedding_model,
// "<model id>@<dtype>"). At boot, before the first request, a mismatch blanks
// every stored vector in one transaction: recall and search fall back to
// keyword matching for anything not yet re-embedded, never to a cosine
// between two models. The background pass then re-embeds everything with the
// configured model. The same pass fills vectors that are missing for any
// other reason (a save-time embed that failed, an import that skipped it).

export const EMBEDDING_MODEL_SETTING = "embedding_model";

// Every column that stores a vector. scripts/test-embedding-reindex.mjs checks
// this against the live schema, so a new vector column cannot be missed here.
// scene_chunks.embedding is NOT NULL, so it is blanked to a zero-length BLOB,
// which every reader already treats as "not indexed yet".
export const VECTOR_COLUMNS = [
  { table: "world_facts", nullable: true },
  { table: "lore_entries", nullable: true },
  { table: "campaign_notes", nullable: true },
  { table: "rule_chunks", nullable: true },
  { table: "chapters", nullable: true },
  { table: "scene_chunks", nullable: false },
] as const;

export type EmbeddingReconcile = {
  previous: string | null;
  current: string;
  // Stored vectors that were blanked because they came from another model.
  cleared: number;
};

export function readEmbeddingModelStamp(): string | null {
  const row = getDatabase()
    .prepare(`SELECT value_json FROM app_settings WHERE key = ?`)
    .get(EMBEDDING_MODEL_SETTING) as { value_json: string } | undefined;
  if (!row) {
    return null;
  }
  try {
    const value = JSON.parse(row.value_json);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

// Synchronous and idempotent: a no-op once the stamp matches.
export function reconcileEmbeddingModel(current = EMBEDDING_KEY): EmbeddingReconcile {
  const db = getDatabase();
  const previous = readEmbeddingModelStamp();
  if (previous === current) {
    return { previous, current, cleared: 0 };
  }
  let cleared = 0;
  db.transaction(() => {
    if (embeddingIndexStale(previous, current)) {
      for (const { table, nullable } of VECTOR_COLUMNS) {
        const info = nullable
          ? db.prepare(`UPDATE ${table} SET embedding = NULL WHERE embedding IS NOT NULL`).run()
          : db.prepare(`UPDATE ${table} SET embedding = X'' WHERE length(embedding) > 0`).run();
        cleared += info.changes;
      }
    }
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
         updated_at = excluded.updated_at`,
    ).run(EMBEDDING_MODEL_SETTING, JSON.stringify(current), nowIso());
  })();
  if (cleared) {
    console.log(
      `[embeddings] Embedding model changed from ${previous ?? "the original default"} to ${current}: ` +
        `cleared ${cleared} stored vectors; re-embedding them in the background.`,
    );
  }
  return { previous, current, cleared };
}

// Vectors the background pass would write. Counted first so a server with
// nothing to do never loads the model at boot.
export function countMissingVectors(): number {
  const db = getDatabase();
  const one = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { n: number }).n;
  return (
    one(`SELECT count(*) AS n FROM world_facts WHERE status = 'active' AND embedding IS NULL`) +
    one(`SELECT count(*) AS n FROM lore_entries WHERE embedding IS NULL`) +
    one(`SELECT count(*) AS n FROM campaign_notes WHERE embedding IS NULL`) +
    one(`SELECT count(*) AS n FROM rule_chunks WHERE embedding IS NULL`) +
    one(
      `SELECT count(*) AS n FROM chapters
       WHERE status = 'closed' AND embedding IS NULL
         AND length(trim(COALESCE(title, '') || COALESCE(summary, ''))) > 0`,
    ) +
    one(`SELECT count(*) AS n FROM scene_chunks WHERE length(embedding) != ?`, EMBEDDING_DIM * 4)
  );
}

declare global {
  var __odmEmbeddingCatchUp: Promise<number> | undefined;
}

// Fills every missing vector, campaign by campaign, through the shared embed
// queue (so live turns interleave with it). Returns how many were missing
// when it started. One pass at a time per process.
export function embedMissingVectors(): Promise<number> {
  globalThis.__odmEmbeddingCatchUp ??= runCatchUp().finally(() => {
    globalThis.__odmEmbeddingCatchUp = undefined;
  });
  return globalThis.__odmEmbeddingCatchUp;
}

// This host cannot embed by design: transformers.js was left out of the
// install (the Android app prunes it), or the ONNX runtime has no native
// build for this OS and CPU (Intel Macs, for one). Only those: a present
// transformers.js that cannot find the onnxruntime-node package is a broken
// install (a standalone build once shipped exactly that) and stays an error.
// Turbopack wraps the failure as "Failed to load external module <id>:
// Error: Cannot find module '<name>'", so the quoted name tells them apart.
export function runtimeNotInstalled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const missing = /Cannot find (?:module|package) '([^']+)'/.exec(message)?.[1] ?? "";
  return missing.startsWith("@huggingface/transformers") || missing.endsWith("onnxruntime_binding.node");
}

async function runCatchUp(): Promise<number> {
  const missing = countMissingVectors();
  if (!missing) {
    return 0;
  }
  try {
    // One probe instead of an error per row when the model cannot load.
    await embed(["probe"]);
  } catch (error) {
    if (runtimeNotInstalled(error)) {
      // Expected on this host, so a note rather than an error per start.
      console.log(
        `[embeddings] No embedding runtime for this host (${process.platform}/${process.arch}); ` +
          "search stays keyword-only.",
      );
    } else {
      console.error(
        `[embeddings] ${missing} stored vectors are missing but the embedding model did not load; ` +
          "search stays keyword-only for them until the next start.",
        error,
      );
    }
    return missing;
  }
  const started = Date.now();
  const campaigns = getDatabase().prepare(`SELECT id FROM campaigns`).all() as Array<{ id: string }>;
  for (const { id } of campaigns) {
    try {
      await embedPendingLore(id);
      await embedPendingNotes(id);
      await embedRuleChunks(id);
      await embedPendingFacts(id);
      await embedPendingChapterSummaries(id);
      await reembedSceneChunks(id);
    } catch (error) {
      console.error(`[embeddings] catch-up failed for campaign ${id}`, error);
    }
  }
  const left = countMissingVectors();
  console.log(
    `[embeddings] Re-embedded ${missing - left} of ${missing} missing vectors in ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
  return missing;
}
