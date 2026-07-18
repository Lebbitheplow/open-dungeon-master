import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig, saveGlobalConfig } from "@/lib/db/app-settings";
import { serverEnv } from "@/lib/server-env";
import type { GlobalConfig } from "@/lib/schemas/global-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Secrets never leave the server. GET replaces them with has* booleans; PATCH
// treats undefined as keep, "" as clear, and any other string as set.
function maskedConfig(config: GlobalConfig) {
  return {
    signupsEnabled: config.signupsEnabled,
    publicUrl: config.publicUrl,
    text: {
      provider: config.text.provider,
      localTextModel: config.text.localTextModel,
      customBaseUrl: config.text.customBaseUrl,
      customModel: config.text.customModel,
      hasCustomApiKey: config.text.customApiKey !== "",
    },
    images: config.images,
    speech: config.speech,
    discord: {
      clientId: config.discord.clientId,
      hasClientSecret: config.discord.clientSecret !== "",
    },
  };
}

// Read-only hints so the admin UI can show what a cleared field falls back to.
function envDefaults() {
  return {
    customBaseUrl: serverEnv("OPENAI_COMPAT_BASE_URL"),
    customModel: serverEnv("OPENAI_COMPAT_MODEL"),
    hasCustomApiKey: serverEnv("OPENAI_COMPAT_API_KEY") !== "" || serverEnv("OPENROUTER_API_KEY") !== "",
    comfyUrl: serverEnv("COMFYUI_URL", "http://127.0.0.1:8188"),
    fluxWorkerUrl: serverEnv("FLUX_WORKER_URL", "http://127.0.0.1:7869"),
    kokoroUrl: serverEnv("KOKORO_URL", "http://127.0.0.1:8880"),
    sttUrl: serverEnv("STT_URL", "http://127.0.0.1:8870"),
    discordClientId: serverEnv("DISCORD_CLIENT_ID"),
    hasDiscordClientSecret: serverEnv("DISCORD_CLIENT_SECRET") !== "",
    publicUrl: serverEnv("APP_PUBLIC_URL"),
  };
}

export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json({ config: maskedConfig(getGlobalConfig()), envDefaults: envDefaults() });
}

const patchSchema = z.object({
  signupsEnabled: z.boolean().optional(),
  publicUrl: z.string().trim().max(500).optional(),
  text: z
    .object({
      provider: z.enum(["", "local", "custom"]).optional(),
      localTextModel: z.string().trim().max(200).optional(),
      customBaseUrl: z.string().trim().max(500).optional(),
      customModel: z.string().trim().max(200).optional(),
      customApiKey: z.string().trim().max(400).optional(),
    })
    .optional(),
  images: z
    .object({
      comfyUrl: z.string().trim().max(500).optional(),
      comfyCheckpoint: z.string().trim().max(300).optional(),
      fluxWorkerUrl: z.string().trim().max(500).optional(),
    })
    .optional(),
  speech: z
    .object({
      kokoroUrl: z.string().trim().max(500).optional(),
      sttUrl: z.string().trim().max(500).optional(),
    })
    .optional(),
  discord: z
    .object({
      clientId: z.string().trim().max(100).optional(),
      clientSecret: z.string().trim().max(200).optional(),
    })
    .optional(),
});

export async function PATCH(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid settings." },
      { status: 400 },
    );
  }
  const saved = saveGlobalConfig(parsed.data);
  return Response.json({ config: maskedConfig(saved), envDefaults: envDefaults() });
}
