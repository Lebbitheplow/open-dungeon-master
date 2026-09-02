import { z } from "zod";

// App-wide settings editable from /admin, stored as one JSON blob under
// app_settings.key = 'global_config'. Every string field treats "" as "no
// override": resolution falls through to the matching env var and then the
// code default (see src/lib/app-config.ts), and an admin can clear an
// override by blanking the field.
export const globalConfigSchema = z.object({
  signupsEnabled: z.boolean().default(true),
  // Three-state signup policy for client apps and closed servers. Blank means
  // "not chosen yet": derive open/closed from the legacy signupsEnabled
  // boolean so existing installs keep their behavior (see resolveSignupMode).
  // "invite" requires a valid admin-minted code from account_invites.
  signupMode: z.enum(["", "open", "invite", "closed"]).default(""),
  // Shown by client apps in their server picker and on the login screen.
  // Blank = the product name.
  serverName: z.string().trim().max(100).default(""),
  // The URL players actually reach the app on (e.g. https://dungeon.example.org).
  // Used for OAuth redirect URIs; blank = APP_PUBLIC_URL env, then forwarded
  // proxy headers, then the raw request origin.
  publicUrl: z.string().trim().max(500).default(""),
  // Index of downloadable community world packs, fetched by the plugin
  // browser. Blank = WORLD_REGISTRY_URL env, then nothing, in which case the
  // browser offers manual file install only. Deliberately not defaulted to
  // any host: the packs a registry lists are third-party content this
  // project neither ships nor vets, so pointing at one is an explicit act.
  worldRegistryUrl: z.string().trim().max(500).default(""),
  // Per-role sampling (src/lib/dm/sampling-logic.ts). Blank profile plus
  // empty overrides means "send exactly what the build sends today", so this
  // is a no-op until an admin changes something. presence_penalty is
  // deliberately absent: model-client pins it to 0 because a positive value
  // suppresses tool calls over the long DM prompt.
  sampling: z
    .object({
      profile: z.enum(["", "default", "balanced", "creative", "precise"]).default(""),
      story: z
        .object({
          temperature: z.number().min(0).max(2).optional(),
          top_p: z.number().min(0).max(1).optional(),
          top_k: z.number().int().min(0).max(200).optional(),
          min_p: z.number().min(0).max(1).optional(),
          repeat_penalty: z.number().min(0).max(2).optional(),
        })
        .default({}),
      utility: z
        .object({
          temperature: z.number().min(0).max(2).optional(),
          top_p: z.number().min(0).max(1).optional(),
          top_k: z.number().int().min(0).max(200).optional(),
          min_p: z.number().min(0).max(1).optional(),
          repeat_penalty: z.number().min(0).max(2).optional(),
        })
        .default({}),
    })
    .default({ profile: "", story: {}, utility: {} }),
  text: z
    .object({
      // "none" is an explicit "this server has no AI DM": campaigns default
      // to a human DM and the story path fails fast with a plain message
      // instead of dialing the shipped 127.0.0.1:8001 default.
      provider: z.enum(["", "local", "custom", "none"]).default(""),
      localTextModel: z.string().trim().max(200).default(""),
      customBaseUrl: z.string().trim().max(500).default(""),
      customModel: z.string().trim().max(200).default(""),
      customApiKey: z.string().trim().max(400).default(""),
      // Optional second model for mechanical work (compaction, chapter
      // summaries, world-arc ticks, lore checks, Ask). Blank utilityModel
      // means "off": those calls run on the story model, as they always did.
      utilityProvider: z.enum(["", "local", "custom"]).default(""),
      utilityModel: z.string().trim().max(200).default(""),
      utilityBaseUrl: z.string().trim().max(500).default(""),
      utilityApiKey: z.string().trim().max(400).default(""),
    })
    .prefault({}),
  images: z
    .object({
      // Server-wide default backend for new campaigns. Blank = the
      // DEFAULT_IMAGE_BACKEND env var, then the built-in default (ComfyUI).
      defaultBackend: z
        .enum(["", "comfyui", "openai", "mflux-hs", "sdnq-hs"])
        .default(""),
      comfyUrl: z.string().trim().max(500).default(""),
      comfyCheckpoint: z.string().trim().max(300).default(""),
      fluxWorkerUrl: z.string().trim().max(500).default(""),
      // The "openai" backend: any OpenAI-compatible images API. The key is
      // the server owner's, applied at request time only, and never leaves
      // the server (masked like the Discord secret on the way to the admin
      // UI). Blank model = gpt-image-1.
      openaiBaseUrl: z.string().trim().max(500).default(""),
      openaiModel: z.string().trim().max(200).default(""),
      openaiApiKey: z.string().trim().max(400).default(""),
    })
    .prefault({}),
  speech: z
    .object({
      kokoroUrl: z.string().trim().max(500).default(""),
      sttUrl: z.string().trim().max(500).default(""),
    })
    .prefault({}),
  // Live voice chat (src/lib/voice/). Separate from `speech` above, which is
  // Kokoro TTS and Whisper STT: different feature, similar-sounding name.
  //
  // `enabled` is tri-state rather than a boolean so it follows the same
  // "blank = fall through to the env var" rule as every string field here.
  // Voice stays off unless something says on, because it cannot work until
  // the owner also opens the media port and serves the app over https.
  voiceChat: z
    .object({
      enabled: z.enum(["", "on", "off"]).default(""),
      // "" or "sfu" = the mediasoup SFU (needs the open media port).
      // "mesh" = browser-to-browser WebRTC: no port, works through an HTTP
      // tunnel, meant for small tables hosted by the desktop app.
      mode: z.enum(["", "sfu", "mesh"]).default(""),
      // The address a player's browser can reach this host on.
      announcedIp: z.string().trim().max(200).default(""),
      // Optional hostname announced instead of the IP. Must resolve straight
      // to this host: a proxied (Cloudflare orange cloud) name will not do.
      domain: z.string().trim().max(300).default(""),
      // Kept as a string so blank means "no override", like every other
      // field. Parsed where it is used.
      rtcPort: z.string().trim().max(10).default(""),
    })
    .prefault({}),
  discord: z
    .object({
      clientId: z.string().trim().max(100).default(""),
      clientSecret: z.string().trim().max(200).default(""),
    })
    .prefault({}),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const DEFAULT_GLOBAL_CONFIG: GlobalConfig = globalConfigSchema.parse({});

export type SignupMode = "open" | "invite" | "closed";

// Blank signupMode falls back to the legacy boolean, so a server whose admin
// last touched the old checkbox keeps exactly the policy they chose.
export function resolveSignupMode(config: GlobalConfig): SignupMode {
  if (config.signupMode !== "") {
    return config.signupMode;
  }
  return config.signupsEnabled ? "open" : "closed";
}
