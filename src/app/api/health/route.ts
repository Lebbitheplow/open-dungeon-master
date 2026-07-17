import { serverEnv } from "@/lib/server-env";
import { LOCAL_TEXT_MODEL_IDS } from "@/lib/text-models";

export const runtime = "nodejs";

export async function GET() {
  const workerUrl = serverEnv("FLUX_WORKER_URL", "http://127.0.0.1:7869");
  const ollamaUrl = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");

  let flux = { ok: false, loaded: false };
  try {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/health`, {
      cache: "no-store",
    });
    if (response.ok) {
      flux = await response.json();
    }
  } catch {
    flux = { ok: false, loaded: false };
  }

  let localText = { ok: false, installedModels: [] as string[] };
  try {
    const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/tags`, {
      cache: "no-store",
    });
    if (response.ok) {
      const data = (await response.json()) as { models?: Array<{ name?: string }> };
      // Ollama resolves model names case-insensitively, so match the same way
      // (a pre-existing "Gemma4" repo can store tags with different casing).
      const installed = new Set(
        (data.models || [])
          .map((model) => (model.name || "").toLowerCase())
          .filter(Boolean),
      );
      localText = {
        ok: true,
        installedModels: LOCAL_TEXT_MODEL_IDS.filter((id) =>
          installed.has(id.toLowerCase()),
        ),
      };
    }
  } catch {
    localText = { ok: false, installedModels: [] };
  }

  return Response.json({
    openRouterConfigured: Boolean(serverEnv("OPENROUTER_API_KEY")),
    model: serverEnv("OPENROUTER_MODEL", "google/gemini-3.5-flash"),
    maxTokens: Number.parseInt(serverEnv("OPENROUTER_MAX_TOKENS", "16384"), 10),
    localText,
    flux,
  });
}
