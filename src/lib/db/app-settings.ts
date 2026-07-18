import { getDatabase, nowIso } from "@/lib/db/core";
import {
  DEFAULT_GLOBAL_CONFIG,
  globalConfigSchema,
  type GlobalConfig,
} from "@/lib/schemas/global-config";

const GLOBAL_CONFIG_KEY = "global_config";

export function getAppSetting<T>(key: string, fallback: T): T {
  const row = getDatabase()
    .prepare(`SELECT value_json FROM app_settings WHERE key = ?`)
    .get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export function setAppSetting(key: string, value: unknown) {
  getDatabase()
    .prepare(
      `
        INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `,
    )
    .run(key, JSON.stringify(value), nowIso());
}

// Deliberately uncached: a single-row synchronous SQLite read per call keeps
// admin edits live without any invalidation logic. If a cache is ever added,
// saveGlobalConfig must bust it (single-process assumption).
export function getGlobalConfig(): GlobalConfig {
  const raw = getAppSetting<unknown>(GLOBAL_CONFIG_KEY, null);
  if (raw === null) return DEFAULT_GLOBAL_CONFIG;
  const parsed = globalConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_GLOBAL_CONFIG;
}

export type GlobalConfigPatch = {
  signupsEnabled?: boolean;
  publicUrl?: string;
  text?: Partial<GlobalConfig["text"]>;
  images?: Partial<GlobalConfig["images"]>;
  speech?: Partial<GlobalConfig["speech"]>;
  discord?: Partial<GlobalConfig["discord"]>;
};

// Merges a partial update over the stored config. Secret fields follow the
// same rule as everything else: undefined = keep, "" = clear, value = set.
export function saveGlobalConfig(patch: GlobalConfigPatch): GlobalConfig {
  const current = getGlobalConfig();
  const merged = globalConfigSchema.parse({
    signupsEnabled: patch.signupsEnabled ?? current.signupsEnabled,
    publicUrl: patch.publicUrl ?? current.publicUrl,
    text: { ...current.text, ...patch.text },
    images: { ...current.images, ...patch.images },
    speech: { ...current.speech, ...patch.speech },
    discord: { ...current.discord, ...patch.discord },
  });
  setAppSetting(GLOBAL_CONFIG_KEY, merged);
  return merged;
}
