import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { getGlobalConfig, saveGlobalConfig } from "@/lib/db/app-settings";
import { serverEnv } from "@/lib/server-env";
import { resolveSignupMode, type GlobalConfig } from "@/lib/schemas/global-config";
import { announcedAddressFor, isUnroutableAddress, voiceConfig } from "@/lib/voice/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Secrets never leave the server. GET replaces them with has* booleans; PATCH
// treats undefined as keep, "" as clear, and any other string as set.
function maskedConfig(config: GlobalConfig) {
  return {
    signupsEnabled: config.signupsEnabled,
    signupMode: resolveSignupMode(config),
    serverName: config.serverName,
    publicUrl: config.publicUrl,
    worldRegistryUrl: config.worldRegistryUrl,
    text: {
      provider: config.text.provider,
      localTextModel: config.text.localTextModel,
      customBaseUrl: config.text.customBaseUrl,
      customModel: config.text.customModel,
      hasCustomApiKey: config.text.customApiKey !== "",
      utilityProvider: config.text.utilityProvider,
      utilityModel: config.text.utilityModel,
      utilityBaseUrl: config.text.utilityBaseUrl,
      hasUtilityApiKey: config.text.utilityApiKey !== "",
    },
    images: {
      defaultBackend: config.images.defaultBackend,
      comfyUrl: config.images.comfyUrl,
      comfyCheckpoint: config.images.comfyCheckpoint,
      fluxWorkerUrl: config.images.fluxWorkerUrl,
      openaiBaseUrl: config.images.openaiBaseUrl,
      openaiModel: config.images.openaiModel,
      hasOpenaiApiKey: config.images.openaiApiKey !== "",
    },
    speech: config.speech,
    voiceChat: config.voiceChat,
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
    imageBackend: serverEnv("DEFAULT_IMAGE_BACKEND"),
    hasOpenaiImageApiKey:
      serverEnv("OPENAI_IMAGE_API_KEY") !== "" || serverEnv("OPENAI_API_KEY") !== "",
    kokoroUrl: serverEnv("KOKORO_URL", "http://127.0.0.1:8880"),
    sttUrl: serverEnv("STT_URL", "http://127.0.0.1:8870"),
    discordClientId: serverEnv("DISCORD_CLIENT_ID"),
    hasDiscordClientSecret: serverEnv("DISCORD_CLIENT_SECRET") !== "",
    publicUrl: serverEnv("APP_PUBLIC_URL"),
    voiceEnabled: serverEnv("VOICE_ENABLED", "0") === "1",
    voiceAnnouncedIp: serverEnv("VOICE_ANNOUNCED_IP"),
    voiceDomain: serverEnv("VOICE_DOMAIN"),
    voiceRtcPort: serverEnv("VOICE_RTC_PORT", "44444"),
    worldRegistryUrl: serverEnv("WORLD_REGISTRY_URL"),
  };
}

// SFU voice announcing an address remote browsers cannot dial is the silent
// call failure (src/lib/voice/config.ts). Decided server side because the
// announced-address fallback chain ends at the bind address, which the
// masked config never carries.
function voiceAnnounceUnroutable(): boolean {
  const voice = voiceConfig();
  return voice.mode === "sfu" && isUnroutableAddress(announcedAddressFor(voice));
}

export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json({
    config: maskedConfig(getGlobalConfig()),
    envDefaults: envDefaults(),
    voiceAnnounceUnroutable: voiceAnnounceUnroutable(),
  });
}

const patchSchema = z.object({
  signupsEnabled: z.boolean().optional(),
  signupMode: z.enum(["open", "invite", "closed"]).optional(),
  serverName: z.string().trim().max(100).optional(),
  publicUrl: z.string().trim().max(500).optional(),
  worldRegistryUrl: z.string().trim().max(500).optional(),
  text: z
    .object({
      // "none" lets an admin (or the desktop shell) record that this server
      // has no AI DM, so the UI can say so instead of failing a first turn.
      provider: z.enum(["", "local", "custom", "none"]).optional(),
      localTextModel: z.string().trim().max(200).optional(),
      customBaseUrl: z.string().trim().max(500).optional(),
      customModel: z.string().trim().max(200).optional(),
      customApiKey: z.string().trim().max(400).optional(),
      utilityProvider: z.enum(["", "local", "custom"]).optional(),
      utilityModel: z.string().trim().max(200).optional(),
      utilityBaseUrl: z.string().trim().max(500).optional(),
      utilityApiKey: z.string().trim().max(400).optional(),
    })
    .optional(),
  images: z
    .object({
      defaultBackend: z.enum(["", "comfyui", "openai", "mflux-hs", "sdnq-hs"]).optional(),
      comfyUrl: z.string().trim().max(500).optional(),
      comfyCheckpoint: z.string().trim().max(300).optional(),
      fluxWorkerUrl: z.string().trim().max(500).optional(),
      openaiBaseUrl: z.string().trim().max(500).optional(),
      openaiModel: z.string().trim().max(200).optional(),
      openaiApiKey: z.string().trim().max(400).optional(),
    })
    .optional(),
  speech: z
    .object({
      kokoroUrl: z.string().trim().max(500).optional(),
      sttUrl: z.string().trim().max(500).optional(),
    })
    .optional(),
  voiceChat: z
    .object({
      enabled: z.enum(["", "on", "off"]).optional(),
      mode: z.enum(["", "sfu", "mesh"]).optional(),
      announcedIp: z.string().trim().max(200).optional(),
      domain: z.string().trim().max(300).optional(),
      rtcPort: z.string().trim().max(10).optional(),
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
  return Response.json({
    config: maskedConfig(saved),
    envDefaults: envDefaults(),
    voiceAnnounceUnroutable: voiceAnnounceUnroutable(),
  });
}
