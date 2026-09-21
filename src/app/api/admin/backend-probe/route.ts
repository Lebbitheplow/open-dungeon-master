import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { DEFAULT_STORY_SETTINGS } from "@/lib/defaults";
import { serverEnv } from "@/lib/server-env";
import { DEFAULT_LOCAL_TEXT_MODEL } from "@/lib/text-models";
// The same three-stage probe the CLI runs (scripts/probe-openai-backend.mjs):
// streamed text, a real structured tool call, and a continuation after the
// tool result. One source of truth, so the admin panel and the CLI can never
// disagree about what "capable" means.
import { probeBackend } from "../../../../../scripts/lib/provider-capability-probe.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const probeSchema = z.object({
  // Which saved settings fill in blanks and supply the stored key.
  which: z.enum(["story", "utility"]).default("story"),
  baseUrl: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
  // An unsaved key typed into the field; the stored key or env is the
  // fallback, mirroring how a real turn would resolve it.
  apiKey: z.string().trim().max(400).optional(),
});

// Tries a backend exactly as the DM loop needs it before anyone plays on it.
// A /models list or a plain chat proves nothing; this needs streaming,
// structured tool calls, and a post-tool continuation.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = probeSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid probe request." },
      { status: 400 },
    );
  }
  const { which, baseUrl, model, apiKey } = parsed.data;
  const config = getGlobalConfig();
  // Mirror how a real turn resolves this backend (configuredDefaultStorySettings
  // + model-client): "local" means Ollama at OLLAMA_BASE_URL, everything else
  // is the OpenAI-compatible endpoint. Otherwise the probe would test a
  // different endpoint than the campaign actually talks to.
  const provider =
    (which === "utility" ? config.text.utilityProvider : config.text.provider) ||
    serverEnv(which === "utility" ? "UTILITY_TEXT_PROVIDER" : "DEFAULT_TEXT_PROVIDER") ||
    (which === "utility"
      ? DEFAULT_STORY_SETTINGS.utilityProvider
      : DEFAULT_STORY_SETTINGS.textProvider);
  const local = provider === "local";
  const ollamaBaseUrl = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");

  const resolvedBaseUrl =
    baseUrl ||
    (local
      ? ollamaBaseUrl
      : which === "utility"
        ? config.text.utilityBaseUrl || serverEnv("UTILITY_TEXT_BASE_URL")
        : config.text.customBaseUrl ||
          serverEnv("OPENAI_COMPAT_BASE_URL") ||
          DEFAULT_STORY_SETTINGS.customBaseUrl);
  const resolvedModel =
    model ||
    (which === "utility"
      ? config.text.utilityModel || serverEnv("UTILITY_TEXT_MODEL")
      : local
        ? config.text.localTextModel ||
          serverEnv("LOCAL_TEXT_MODEL") ||
          DEFAULT_LOCAL_TEXT_MODEL
        : config.text.customModel ||
          serverEnv("OPENAI_COMPAT_MODEL") ||
          (/(^|\.)openrouter\.ai/i.test(resolvedBaseUrl)
            ? serverEnv("OPENROUTER_MODEL", "google/gemini-3.5-flash")
            : DEFAULT_STORY_SETTINGS.customModel));
  const resolvedKey =
    apiKey ||
    (which === "utility"
      ? config.text.utilityApiKey || config.text.customApiKey
      : config.text.customApiKey) ||
    serverEnv("OPENAI_COMPAT_API_KEY") ||
    serverEnv("OPENROUTER_API_KEY");
  if (!resolvedModel) {
    return Response.json(
      {
        ok: false,
        error:
          which === "utility"
            ? "No utility model is set; utility calls run on the story model. Set a model or probe the story backend."
            : "No story model is set.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await probeBackend({
      baseUrl: resolvedBaseUrl,
      model: resolvedModel,
      apiKey: resolvedKey,
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Probe failed." },
      { status: 502 },
    );
  }
}
