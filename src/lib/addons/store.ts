import { z } from "zod";
import { getAppSetting, setAppSetting } from "@/lib/db/app-settings";
import { ADDON_ID } from "@/lib/addons/manifest";
import { setPageIsolation } from "@/lib/page-isolation";

// What the server remembers about its addons, as one app_settings row: the
// catalog to browse, whether files may be installed by hand, and per addon
// where it came from, whether it is on, the permissions the admin accepted
// and the values of its settings.
//
// The packages themselves are on disk (src/lib/addons/paths.ts). The two can
// disagree after a restore or a hand edit; src/lib/addons/installed.ts reads
// both and reports the difference instead of trusting either alone.

const ADDONS_KEY = "addons";

const settingValueSchema = z.union([z.string().max(4_000), z.number(), z.boolean()]);

// Where a GitHub-installed addon came from, so its card can say so and an
// update can be looked for: the repository, the folder inside it, and the
// release tag or branch it was taken from (with the commit, for a branch).
const githubOriginSchema = z.object({
  repo: z.string().max(140),
  path: z.string().max(200).default(""),
  ref: z.string().max(200).default(""),
  tag: z.string().max(200).default(""),
  commit: z.string().max(64).default(""),
});

export type GitHubOrigin = z.infer<typeof githubOriginSchema>;

const addonStateSchema = z.object({
  version: z.string().max(50).default(""),
  source: z.enum(["registry", "file", "github", "dev"]).default("registry"),
  github: githubOriginSchema.nullable().default(null),
  // The version whose setup (src/lib/addons/setup.ts) last finished, and
  // what went wrong the last time it did not.
  setupVersion: z.string().max(50).default(""),
  setupError: z.string().max(600).default(""),
  sha256: z.string().max(64).default(""),
  installedAt: z.string().max(40).default(""),
  enabled: z.boolean().default(false),
  // The permission list the admin said yes to, as it stood when they did.
  granted: z.array(z.string().max(40)).max(20).default([]),
  settings: z.record(z.string().max(40), settingValueSchema).default({}),
});

export type AddonState = z.infer<typeof addonStateSchema>;

const addonConfigSchema = z.object({
  // "" falls through to ADDON_REGISTRY_URL and then the built-in catalog;
  // "off" browses nothing.
  registryUrl: z.string().trim().max(500).default(""),
  // Installing from a .zip the admin picked or a GitHub link they pasted,
  // which nobody has reviewed.
  allowFiles: z.boolean().default(false),
  addons: z.record(z.string().max(60), addonStateSchema).default({}),
});

export type AddonConfig = z.infer<typeof addonConfigSchema>;

export function readAddonConfig(): AddonConfig {
  const raw = getAppSetting<unknown>(ADDONS_KEY, {});
  const parsed = addonConfigSchema.safeParse(raw);
  if (parsed.success) {
    // An id that is not an id never came from this server; it is dropped
    // rather than allowed to name a folder.
    for (const id of Object.keys(parsed.data.addons)) {
      if (!ADDON_ID.test(id)) delete parsed.data.addons[id];
    }
    return parsed.data;
  }
  return addonConfigSchema.parse({});
}

export function writeAddonConfig(config: AddonConfig): void {
  setAppSetting(ADDONS_KEY, addonConfigSchema.parse(config));
  setPageIsolation(threadsGranted(config));
}

// Whether an addon that is on was given the threads permission, which is
// what makes the server's pages cross-origin isolated (src/lib/page-isolation.ts).
function threadsGranted(config: AddonConfig): boolean {
  return Object.values(config.addons).some((state) => state.enabled && state.granted.includes("threads"));
}

// At start, from what the server remembers.
export function refreshPageIsolation(): void {
  setPageIsolation(threadsGranted(readAddonConfig()));
}

export function updateAddonConfig(change: (config: AddonConfig) => void): AddonConfig {
  const config = readAddonConfig();
  change(config);
  writeAddonConfig(config);
  return config;
}

export function addonState(id: string): AddonState | null {
  return readAddonConfig().addons[id] ?? null;
}

export function setAddonState(id: string, patch: Partial<AddonState>): AddonState {
  let next: AddonState | null = null;
  updateAddonConfig((config) => {
    const current = config.addons[id] ?? addonStateSchema.parse({});
    next = addonStateSchema.parse({ ...current, ...patch });
    config.addons[id] = next;
  });
  return next as unknown as AddonState;
}

export function forgetAddonState(id: string): void {
  updateAddonConfig((config) => {
    delete config.addons[id];
  });
}
