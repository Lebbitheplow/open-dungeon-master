// Prefetches the local MiniLM embedding model (Xenova/all-MiniLM-L6-v2, ~86MB)
// into models/embeddings so the app has it warm before the first live embed.
// The model is no longer bundled in git; transformers.js also auto-downloads it
// on first use, but running this once (online) is handy for offline setups.
// Usage: npm run fetch-model
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

env.cacheDir = path.join(process.cwd(), "models", "embeddings");
console.log(`[fetch-embedding-model] downloading ${MODEL_ID} into ${env.cacheDir} ...`);
await pipeline("feature-extraction", MODEL_ID);
console.log("[fetch-embedding-model] done.");
