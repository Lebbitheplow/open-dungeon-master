import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { DEFAULT_STORY_SETTINGS } from "@/lib/defaults";
import { endpointKind } from "@/lib/dm/sampling-logic";
import { probeCustomContextWindow, storyContextTokens, storyWindowAssumed } from "@/lib/model-client";
import { serverEnv } from "@/lib/server-env";
import { ollamaModelInfo, soleListedModel } from "@/lib/model-registry/discovery";
import { recordModelProbe } from "@/lib/model-registry/probes";
import { keyForListing } from "@/lib/setup/discovery-logic";
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
  // The provider the guided setup is about to save; absent, the saved one.
  provider: z.enum(["local", "custom"]).optional(),
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
  const { which, baseUrl, model, apiKey, provider: unsaved } = parsed.data;
  const config = getGlobalConfig();
  // Mirror how a real turn resolves this backend (configuredDefaultStorySettings
  // + model-client): "local" means Ollama at OLLAMA_BASE_URL, everything else
  // is the OpenAI-compatible endpoint. Otherwise the probe would test a
  // different endpoint than the campaign actually talks to.
  const provider =
    unsaved ||
    (which === "utility" ? config.text.utilityProvider : config.text.provider) ||
    serverEnv(which === "utility" ? "UTILITY_TEXT_PROVIDER" : "DEFAULT_TEXT_PROVIDER") ||
    (which === "utility"
      ? DEFAULT_STORY_SETTINGS.utilityProvider
      : DEFAULT_STORY_SETTINGS.textProvider);
  const local = provider === "local";
  const ollamaBaseUrl = serverEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");

  const savedBaseUrl = local
    ? ollamaBaseUrl
    : which === "utility"
      ? config.text.utilityBaseUrl || serverEnv("UTILITY_TEXT_BASE_URL")
      : config.text.customBaseUrl || serverEnv("OPENAI_COMPAT_BASE_URL") || DEFAULT_STORY_SETTINGS.customBaseUrl;
  const resolvedBaseUrl = baseUrl || savedBaseUrl;
  const resolvedModel =
    model ||
    (which === "utility"
      ? config.text.utilityModel || serverEnv("UTILITY_TEXT_MODEL")
      : local
        ? config.text.localTextModel || serverEnv("LOCAL_TEXT_MODEL")
        : config.text.customModel ||
          serverEnv("OPENAI_COMPAT_MODEL") ||
          (endpointKind(resolvedBaseUrl) === "openrouter" ? serverEnv("OPENROUTER_MODEL") : "") ||
          (await soleListedModel({ provider: local ? "local" : "custom", baseUrl: resolvedBaseUrl, apiKey: apiKey || "" })));
  // A saved key is tried only against the host it was saved for: probing a
  // newly typed address must not hand it the key of the old one (the guided
  // setup probes a local server while an OpenAI key is still saved).
  const savedPairs: Array<[string, string]> =
    which === "utility"
      ? [
          [savedBaseUrl, config.text.utilityApiKey],
          [config.text.customBaseUrl || serverEnv("OPENAI_COMPAT_BASE_URL") || DEFAULT_STORY_SETTINGS.customBaseUrl, config.text.customApiKey],
        ]
      : [[savedBaseUrl, config.text.customApiKey]];
  const savedKey =
    savedPairs
      .map(([savedBase, key]) => keyForListing({ typed: "", savedKey: key, savedBaseUrl: savedBase, baseUrl: resolvedBaseUrl }))
      .find(Boolean) ?? "";
  const resolvedKey =
    apiKey ||
    savedKey ||
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
    // Remembered per host and model (no key, no address), so the model
    // pickers can say what this server found of it.
    recordModelProbe(resolvedBaseUrl, resolvedModel, result as unknown as Parameters<typeof recordModelProbe>[2]);
    // The window a campaign on this backend packs against, read the way a
    // turn reads it, so setup can say whether it is big enough to narrate
    // and to fight (src/lib/story-window.ts). `reported` is false when the
    // server named no size and the conservative stand-in is all there is.
    let window: { tokens: number; reported: boolean } | undefined;
    if (which === "story" && result.ok) {
      const settings = {
        textProvider: local ? "local" : "custom",
        localTextModel: resolvedModel,
        customBaseUrl: resolvedBaseUrl,
        customModel: resolvedModel,
      };
      // Ollama's own word on the model's window, which caps what it is asked for.
      if (local) await ollamaModelInfo(resolvedModel, ollamaBaseUrl);
      else await probeCustomContextWindow(resolvedBaseUrl, resolvedKey, resolvedModel);
      window = { tokens: storyContextTokens(settings), reported: !storyWindowAssumed(settings) };
    }
    return Response.json(window ? { ...result, window } : result);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Probe failed." },
      { status: 502 },
    );
  }
}
