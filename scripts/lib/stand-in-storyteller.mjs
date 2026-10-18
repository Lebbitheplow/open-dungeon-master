// A storyteller that is set up but never answers: a custom backend on a
// closed port, its probe answered "down" in advance so nothing is dialled.
// The routes refuse an AI seat where no storyteller is set up at all, and
// seat an unnamed one with a person (src/lib/capabilities.ts
// storytellerConfigured), so a suite that wants an AI-run table through the
// routes names this one first, before its world opens: a campaign copies the
// server's backends when it is made. Also what keeps such a suite the same on
// every machine: with nothing named, a developer's own Ollama would count.
export function standInStoryteller() {
  process.env.DEFAULT_TEXT_PROVIDER = "custom";
  process.env.OPENAI_COMPAT_BASE_URL = "http://127.0.0.1:9/v1";
  process.env.OPENAI_COMPAT_MODEL = "stand-in";
  globalThis.__odmCapabilityProbes ??= new Map();
  globalThis.__odmCapabilityProbes.set("http://127.0.0.1:9/v1/models", { probedAt: Date.now() + 86_400_000, reachable: false });
}
