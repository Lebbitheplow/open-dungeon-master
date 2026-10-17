// Next's startup hook: the one code path a standalone server is guaranteed
// to run exactly once, which makes it the home for the background job loop.
// Guarded to the node runtime because register() is also evaluated for the
// edge bundle, where there is no database and no interval to own. Every
// node-only import stays inside that guard, so the edge bundle never traces it.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // First, so the admin's Server log holds every line after it
    // (src/lib/server-log.ts). The console still prints all of them.
    const { installServerLog } = await import("@/lib/server-log");
    installServerLog();

    const { startJobRunner } = await import("@/lib/jobs");
    startJobRunner();

    // Runs before the first request, so no search ever compares vectors from
    // two embedding models (src/lib/dm/embedding-reindex.ts). The re-embed
    // itself is left running in the background. A failure here must not stop
    // the server: the worst case is the keyword fallback search already has.
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      // What the last process held in memory and a restart took from the
      // DM, put right from the database before the first request
      // (src/lib/dm/restart-recovery.ts). A failure must not stop the server.
      try {
        const { recoverDmAfterRestart } = await import("@/lib/dm/restart-recovery");
        recoverDmAfterRestart();
      } catch (error) {
        console.error("[dm] could not recover what the restart interrupted", error);
      }

      // Event loop delay for the admin's metrics (src/lib/metrics.ts).
      const { startProcessMetrics } = await import("@/lib/metrics");
      startProcessMetrics();

      // Player decision webhooks, when the operator allowed receiver origins
      // in the environment or Admin > Player agents (src/lib/agents/webhooks.ts;
      // an admin's first address also starts it later, without a restart).
      // A failure must not stop the server.
      try {
        const { startPlayerWebhookRunner } = await import("@/lib/agents/webhooks");
        startPlayerWebhookRunner();
      } catch (error) {
        console.error("[player-webhooks] could not start", error);
      }

      // A server nobody has signed up to yet prints the one-time code that
      // claims its admin account (src/lib/setup-code.ts). The operator
      // reads it in the log; a stranger who found the port first cannot.
      try {
        const { announceSetupCode } = await import("@/lib/setup-code");
        announceSetupCode();
      } catch (error) {
        console.error("[setup] could not check for a first account", error);
      }

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

      // Rules PDFs read by the old first-page-only reader get their whole
      // book, once (src/lib/dm/lore-attachments.ts).
      void import("@/lib/dm/lore-attachments")
        .then(({ rereadRulesAttachments }) => rereadRulesAttachments())
        .catch((error) => console.error("[lore] rules PDF re-read failed", error));
    }
  }
}
