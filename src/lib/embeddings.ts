// Local CPU embeddings: MiniLM (384-dim) via @huggingface/transformers ONNX,
// weights cached under models/embeddings so the app stays fully on-device.
// CPU-only by design: the iGPU belongs to the DM model. The pipeline loads
// lazily on first use and all embed calls run through one serial queue so
// background indexing never fans out across every core mid-turn.

import path from "node:path";

export const EMBEDDING_DIM = 384;
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

type Embedder = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

// Survives dev-mode HMR, same pattern as the DM queues.
declare global {
  var __odmEmbedderPromise: Promise<Embedder> | undefined;
  var __odmEmbedQueue: Promise<unknown> | undefined;
}

async function loadEmbedder(): Promise<Embedder> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = path.join(process.cwd(), "models", "embeddings");
  const pipe = await pipeline("feature-extraction", MODEL_ID);
  return pipe as unknown as Embedder;
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
