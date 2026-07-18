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
  text: z
    .object({
      provider: z.enum(["", "local", "custom"]).default(""),
      localTextModel: z.string().trim().max(200).default(""),
      customBaseUrl: z.string().trim().max(500).default(""),
      customModel: z.string().trim().max(200).default(""),
      customApiKey: z.string().trim().max(400).default(""),
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
