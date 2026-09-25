// Next's startup hook: the one code path a standalone server is guaranteed
// to run exactly once, which makes it the home for the background job loop.
// Guarded to the node runtime because register() is also evaluated for the
// edge bundle, where there is no database and no interval to own. Every
// node-only import stays inside that guard, so the edge bundle never traces it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobRunner } = await import("@/lib/jobs");
    startJobRunner();

    // Runs before the first request, so no search ever compares vectors from
    // two embedding models (src/lib/dm/embedding-reindex.ts). The re-embed
    // itself is left running in the background. A failure here must not stop
    // the server: the worst case is the keyword fallback search already has.
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      try {
        const { embedMissingVectors, reconcileEmbeddingModel } = await import(
          "@/lib/dm/embedding-reindex"
        );
        reconcileEmbeddingModel();
        void embedMissingVectors().catch((error) => {
          console.error("[embeddings] catch-up failed", error);
        });
      } catch (error) {
        console.error("[embeddings] could not check the stored vectors against the model", error);
      }
    }
  }
}
