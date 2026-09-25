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

// Survives dev-mode HMR, same pattern as the DM queues.
declare global {
  var __odmEmbedderPromise: Promise<Embedder> | undefined;
  var __odmEmbedQueue: Promise<unknown> | undefined;
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
  env.cacheDir = path.join(process.cwd(), "models", "embeddings");
  const pipe = (await pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE })) as unknown as Embedder;
  const probe = await pipe(["probe"], { pooling: "mean", normalize: true });
  checkEmbeddingDim(MODEL_ID, probe.tolist()[0].length);
  return pipe;
}

function embedderPromise(): Promise<Embedder> {
  return (globalThis.__odmEmbedderPromise ??= loadEmbedder());
}

// Embeds a batch of texts into unit-normalized Float32Array(384) vectors.
// Serialized: concurrent callers wait their turn rather than competing.
export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) {
    return [];
  }
  const run = async () => {
    const embedder = await embedderPromise();
    const output = await embedder(texts, { pooling: "mean", normalize: true });
    return output.tolist().map((vector) => Float32Array.from(vector));
  };
  const queued = (globalThis.__odmEmbedQueue ?? Promise.resolve()).then(run, run);
  globalThis.__odmEmbedQueue = queued.catch(() => undefined);
  return queued;
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
