// Prefetches the app's local embedding model (EMBEDDING_MODEL, default MiniLM)
// into models/embeddings so the app has it warm before the first live embed.
// The model is no longer bundled in git; transformers.js also auto-downloads it
// on first use, but running this once (online) is handy for offline setups.
// Usage: npm run fetch-model
import path from "node:path";
import { embed, MODEL_ID } from "../src/lib/embeddings.ts";

const cacheDir = path.join(process.cwd(), "models", "embeddings");
console.log(`[fetch-embedding-model] downloading ${MODEL_ID} into ${cacheDir} ...`);
await embed(["warm-up"]);
console.log("[fetch-embedding-model] done.");
