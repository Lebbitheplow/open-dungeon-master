import { getGlobalConfig } from "@/lib/db/app-settings";
import { serverEnv } from "@/lib/server-env";

export { getGlobalConfig };

// Global setting resolution order: admin panel value (DB app_settings) wins
// over the env var (.env.server / process.env), which wins over the code
// default. Per-campaign story settings sit above all of this and are
// resolved by their own callers.
export function configValue(dbValue: string, envKey: string, fallback = ""): string {
  const fromDb = dbValue.trim();
  if (fromDb) return fromDb;
  return serverEnv(envKey, fallback);
}
