import { z } from "zod";

// App-wide settings editable from /admin, stored as one JSON blob under
// app_settings.key = 'global_config'. Every string field treats "" as "no
// override": resolution falls through to the matching env var and then the
// code default (see src/lib/app-config.ts), and an admin can clear an
// override by blanking the field.
export const globalConfigSchema = z.object({
  signupsEnabled: z.boolean().default(true),
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
      provider: z.enum(["", "local", "custom"]).default(""),
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
      comfyUrl: z.string().trim().max(500).default(""),
      comfyCheckpoint: z.string().trim().max(300).default(""),
      fluxWorkerUrl: z.string().trim().max(500).default(""),
    })
    .prefault({}),
  speech: z
    .object({
      kokoroUrl: z.string().trim().max(500).default(""),
      sttUrl: z.string().trim().max(500).default(""),
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
