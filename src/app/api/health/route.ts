import { configValue, getGlobalConfig } from "@/lib/app-config";
import { currentUser } from "@/lib/auth";
import { imagesConfigured, storyConfigured } from "@/lib/capabilities";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { serverEnv } from "@/lib/server-env";
import { LOCAL_TEXT_MODEL_IDS } from "@/lib/text-models";

export const runtime = "nodejs";

export async function GET() {
  // Unauthenticated callers get a bare liveness probe; configuration details
  // (model names, which keys are set, backend reachability) require a login.
  const user = await currentUser();
  if (!user) {
    return Response.json({ ok: true });
  }

  const workerUrl = serverEnv("FLUX_WORKER_URL", "http://127.0.0.1:7869");
  const ollamaUrl = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");

  let flux = { ok: false, loaded: false };
  try {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      // A dead worker must cost this endpoint a bounded wait, not a hang.
      signal: AbortSignal.timeout(3_000),
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
      signal: AbortSignal.timeout(3_000),
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

  // The env-var flags above predate the admin panel; the DB-backed config is
  // what the desktop shell writes and what the DM path resolves, so report it
  // too. Config-only flags, no probes: /api/capabilities owns reachability.
  const settings = configuredDefaultStorySettings();
  const cfg = getGlobalConfig();
  const hasOpenaiImageKey = Boolean(
    cfg.images.openaiApiKey || serverEnv("OPENAI_IMAGE_API_KEY") || serverEnv("OPENAI_API_KEY"),
  );

  return Response.json({
    openRouterConfigured: Boolean(serverEnv("OPENROUTER_API_KEY")),
    model: serverEnv("OPENROUTER_MODEL", "google/gemini-3.5-flash"),
    maxTokens: Number.parseInt(serverEnv("OPENROUTER_MAX_TOKENS", "16384"), 10),
    localText,
    flux,
    custom: {
      configured: settings.textProvider === "custom" && storyConfigured(settings),
      story: storyConfigured(settings),
      // Config-only, like the rest of this block: a self-hosted backend
      // counts here only when its URL was named. /api/capabilities adds the
      // default-URL probe.
      images: imagesConfigured(
        settings.imageBackend,
        hasOpenaiImageKey,
        settings.imageBackend === "comfyui"
          ? configValue(cfg.images.comfyUrl, "COMFYUI_URL")
          : serverEnv("FLUX_WORKER_URL"),
        false,
      ),
      tts: Boolean(configValue(cfg.speech.kokoroUrl, "KOKORO_URL")),
    },
  });
}
