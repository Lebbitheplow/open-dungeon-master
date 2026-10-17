// Local CPU embeddings: MiniLM by default (384-dim, EMBEDDING_MODEL picks
// another) via @huggingface/transformers ONNX, weights cached under
// models/embeddings so the app stays fully on-device. CPU-only by design:
// the iGPU belongs to the DM model. The pipeline loads lazily on first use
// and all embed calls run through one serial queue so background indexing
// never fans out across every core mid-turn.

import path from "node:path";
import type { DataType } from "@huggingface/transformers";
import { serverEnv } from "./server-env.ts";

export const EMBEDDING_DIM = 384;

// The weight files transformers.js can select for CPU. "auto" is left out on
// purpose: it resolves from the model's own config, so the same setting could
// name different weights after a model update.
const KNOWN_DTYPES: ReadonlySet<string> = new Set([
  "fp32", "fp16", "int8", "uint8", "q8", "q4", "q2", "q1", "q4f16", "q2f16", "q1f16", "bnb4",
]);

// transformers.js would quietly load fp32 for a dtype it does not know. That
// is fine for loading but not for the index key below: "Q8" and "q8" must not
// read as two different models, and a typo must not trigger a full re-embed
// while fp32 weights are what actually run.
export function resolveEmbeddingDtype(raw: string): DataType {
  const value = raw.trim().toLowerCase();
  if (!value) {
    return "fp32";
  }
  if (KNOWN_DTYPES.has(value)) {
    return value as DataType;
  }
  console.warn(`[embeddings] Unknown EMBEDDING_DTYPE "${raw}"; using fp32.`);
  return "fp32";
}

export const MODEL_ID = serverEnv("EMBEDDING_MODEL", "Xenova/all-MiniLM-L6-v2").trim();
const DTYPE = resolveEmbeddingDtype(serverEnv("EMBEDDING_DTYPE", "fp32"));

// Vectors from two models compare without error but rank at random, so the
// database records which model and dtype built its vectors (src/lib/dm/
// embedding-reindex.ts) and re-embeds everything when this key changes.
export const EMBEDDING_KEY = `${MODEL_ID}@${DTYPE}`;
// Every database indexed before the key was recorded was built by the
// original hard-coded model at its default fp32 weights.
export const LEGACY_EMBEDDING_KEY = "Xenova/all-MiniLM-L6-v2@fp32";

// Whether vectors stored under `stored` (null: never recorded) are unusable
// with the configured model.
export function embeddingIndexStale(stored: string | null, current = EMBEDDING_KEY): boolean {
  return (stored ?? LEGACY_EMBEDDING_KEY) !== current;
}

type Embedder = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

// `dropped`: the caller stopped waiting before the task began, so it is
// skipped rather than run for nobody.
type EmbedTask = { run: () => Promise<void>; dropped?: boolean };

// A foreground embed (a turn's search query, search_lore, recall) waits this
// long, then the caller's keyword fallback carries on (issue #383: an
// embedder that never answered held the turn, and every turn after it,
// forever). Background indexing waits as long as it takes.
const FOREGROUND_EMBED_TIMEOUT_MS = 20_000;
// One task holding the serial queue longer than this has hung; the queue
// moves on and the embedder is treated as failed (the load backoff below).
const EMBED_TASK_CEILING_MS = 5 * 60_000;

declare global {
  var __odmEmbedTimeouts: { foregroundMs: number; ceilingMs: number } | undefined;
}

function embedTimeouts() {
  return (globalThis.__odmEmbedTimeouts ??= {
    foregroundMs: FOREGROUND_EMBED_TIMEOUT_MS,
    ceilingMs: EMBED_TASK_CEILING_MS,
  });
}

// Tests run the deadlines fast.
export function configureEmbedTimeouts(settings: { foregroundMs?: number; ceilingMs?: number }): void {
  Object.assign(embedTimeouts(), Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)));
}

export class EmbedTimeout extends Error {
  constructor(ms: number) {
    super(`The embedding model did not answer within ${ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`}.`);
    this.name = "EmbedTimeout";
  }
}

// A load that failed, and when: the next attempt waits out a backoff
// instead of every embed call either retrying a broken download at once or,
// as before, reusing the one rejected promise until the server restarted.
type LoadFailure = { at: number; failures: number; permanent: boolean; error: unknown };

// Survives dev-mode HMR, same pattern as the DM queues.
declare global {
  var __odmEmbedderPromise: Promise<Embedder> | undefined;
  var __odmEmbedderFailure: LoadFailure | undefined;
  var __odmEmbedTasks: { foreground: EmbedTask[]; background: EmbedTask[]; running: boolean } | undefined;
}

// bufferToVector reads a stored vector of any other size as "not indexed
// yet", so a wrong-size model would switch semantic search off without error.
export function checkEmbeddingDim(modelId: string, size: number): void {
  if (size !== EMBEDDING_DIM) {
    throw new Error(
      `Embedding model ${modelId} produces ${size}-dim vectors; only ${EMBEDDING_DIM}-dim models are supported.`,
    );
  }
}

async function loadEmbedder(): Promise<Embedder> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = path.join(/*turbopackIgnore: true*/ process.cwd(), "models", "embeddings");
  const pipe = (await pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE })) as unknown as Embedder;
  const probe = await pipe(["probe"], { pooling: "mean", normalize: true });
  checkEmbeddingDim(MODEL_ID, probe.tolist()[0].length);
  return pipe;
}

// A first failed load is retried after a minute, then two, four, up to half
// an hour; a successful load clears the record.
const LOAD_RETRY_MS = 60_000;
const LOAD_RETRY_MAX_MS = 30 * 60_000;

export function embedLoadRetryDelay(failures: number): number {
  return Math.min(LOAD_RETRY_MS * 2 ** Math.max(0, failures - 1), LOAD_RETRY_MAX_MS);
}

// A runtime that is simply not there (a build that leaves the embedding
// runtime out, an unsupported model) will not appear by asking again; a
// download that failed or a network that dropped may.
export function isPermanentEmbedLoadFailure(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /only \d+-dim models are supported|Cannot find module|Unsupported model type/i.test(message);
}

function embedderPromise(now = Date.now()): Promise<Embedder> {
  const failure = globalThis.__odmEmbedderFailure;
  if (failure && (failure.permanent || now - failure.at < embedLoadRetryDelay(failure.failures))) {
    return Promise.reject(failure.error);
  }
  return (globalThis.__odmEmbedderPromise ??= loadEmbedder().then(
    (pipe) => {
      globalThis.__odmEmbedderFailure = undefined;
      return pipe;
    },
    (error: unknown) => {
      globalThis.__odmEmbedderPromise = undefined;
      const failures = (globalThis.__odmEmbedderFailure?.failures ?? 0) + 1;
      const permanent = isPermanentEmbedLoadFailure(error);
      globalThis.__odmEmbedderFailure = { at: Date.now(), failures, permanent, error };
      console.error(
        permanent
          ? "[embeddings] the embedding model cannot run on this server; keyword search stands in"
          : `[embeddings] the embedding model did not load (attempt ${failures}); trying again in ${Math.round(embedLoadRetryDelay(failures) / 1000)}s`,
        error,
      );
      throw error;
    },
  ));
}

function embedTasks() {
  return (globalThis.__odmEmbedTasks ??= { foreground: [], background: [], running: false });
}

// One embed at a time, foreground first: a turn waiting on its search query
// goes ahead of a re-index batch that has not started yet, rather than
// behind the whole backlog.
function pumpEmbedTasks() {
  const tasks = embedTasks();
  if (tasks.running) {
    return;
  }
  let next = tasks.foreground.shift() ?? tasks.background.shift();
  while (next?.dropped) {
    next = tasks.foreground.shift() ?? tasks.background.shift();
  }
  if (!next) {
    return;
  }
  tasks.running = true;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      tasks.running = false;
      pumpEmbedTasks();
    }
  };
  // A task that never settles (a model load that hung) would hold every
  // later embed behind it, in every campaign, for the life of the process.
  const ceiling = setTimeout(() => {
    console.error(
      `[embeddings] an embed ran past ${Math.round(embedTimeouts().ceilingMs / 60_000)} minutes; the embedder is treated as failed and keyword search stands in until it loads again`,
    );
    globalThis.__odmEmbedderPromise = undefined;
    const failures = (globalThis.__odmEmbedderFailure?.failures ?? 0) + 1;
    globalThis.__odmEmbedderFailure = { at: Date.now(), failures, permanent: false, error: new Error("The embedding model stopped answering.") };
    release();
  }, embedTimeouts().ceilingMs);
  ceiling.unref?.();
  void next.run().finally(() => {
    clearTimeout(ceiling);
    release();
  });
}

// Embeds a batch of texts into unit-normalized Float32Array(384) vectors.
// Serialized: concurrent callers wait their turn rather than competing.
// `background` marks indexing work (a re-embed, a backfill) that may wait
// for anything a player is waiting on. A foreground caller waits at most
// FOREGROUND_EMBED_TIMEOUT_MS and then rejects with EmbedTimeout, which
// every caller already treats as "no embedder": keyword search carries on.
export async function embed(
  texts: string[],
  options: { background?: boolean } = {},
): Promise<Float32Array[]> {
  if (!texts.length) {
    return [];
  }
  return new Promise<Float32Array[]>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task: EmbedTask = {
      run: async () => {
        try {
          const embedder = await embedderPromise();
          const output = await embedder(texts, { pooling: "mean", normalize: true });
          resolve(output.tolist().map((vector) => Float32Array.from(vector)));
        } catch (error) {
          reject(error);
        } finally {
          clearTimeout(timer);
        }
      },
    };
    if (!options.background) {
      const ms = embedTimeouts().foregroundMs;
      timer = setTimeout(() => {
        task.dropped = true;
        reject(new EmbedTimeout(ms));
      }, ms);
      timer.unref?.();
    }
    embedTasks()[options.background ? "background" : "foreground"].push(task);
    pumpEmbedTasks();
  });
}

// Vectors are unit-normalized, so cosine is a plain dot product.
export function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += a[index] * b[index];
  }
  return sum;
}

// Cosine between the query and a stored BLOB, or null when there is nothing
// to compare: no query vector (the embedder was unavailable) or no embedding
// on the row yet. Rank fusion reads null as "this signal has no opinion",
// which is meaningfully different from a similarity of zero.
export function similarityOf(
  queryVector: Float32Array | null,
  embedding: Buffer | null,
): number | null {
  if (!queryVector || !embedding) {
    return null;
  }
  const vector = bufferToVector(embedding);
  return vector ? cosine(queryVector, vector) : null;
}

// BLOB column round-trip.
export function vectorToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bufferToVector(buffer: Buffer | null | undefined): Float32Array | null {
  if (!buffer || buffer.length !== EMBEDDING_DIM * 4) {
    return null;
  }
  return new Float32Array(buffer.buffer, buffer.byteOffset, EMBEDDING_DIM).slice();
}
