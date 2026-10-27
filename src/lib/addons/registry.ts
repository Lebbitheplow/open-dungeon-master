import { serverEnv } from "@/lib/server-env";
import { readAddonConfig } from "@/lib/addons/store";
import bundledCatalog from "../../../addons/catalog.json";
import {
  ADDON_REGISTRY_KIND,
  ADDON_REGISTRY_VERSION,
  registryAddonSchema,
  type RegistryAddon,
} from "@/lib/addons/registry-index";

// The addon catalog: where it is, and fetching it and the addons it lists.
// Same rules as the world registry (src/lib/worlds/install.ts): https on
// every hop, and a hard ceiling on what is read.

// The downloader list as it stands on the main branch of the Open Dungeon
// Master repository (addons/catalog.json), so an addon whose pull request
// was audited and merged is offered without waiting for a release. When
// GitHub cannot be reached, the copy this version shipped with is used.
// Nothing here installs on its own: browsing it is a GET, installing is an
// admin's act.
export const DEFAULT_ADDON_REGISTRY_URL =
  "https://raw.githubusercontent.com/Lebbitheplow/open-game-master/main/addons/catalog.json";


export const REGISTRY_OFF = "off";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
export const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;

// Admin setting, then ADDON_REGISTRY_URL, then the built-in catalog; "off"
// at either level means none.
export function pickAddonRegistryUrl(configured: string | undefined, fromEnv: string | undefined): string {
  const chosen = (configured || "").trim() || (fromEnv || "").trim() || DEFAULT_ADDON_REGISTRY_URL;
  return chosen.toLowerCase() === REGISTRY_OFF ? "" : chosen;
}

export function addonRegistryUrl(): string {
  return pickAddonRegistryUrl(readAddonConfig().registryUrl, serverEnv("ADDON_REGISTRY_URL"));
}

type Fetched = { ok: true; bytes: Buffer } | { ok: false; error: string };

// GETs an https address, following redirects by hand so every hop stays
// https, and reads at most `limit` bytes. `headers` go on every hop, so they
// never carry anything secret.
export async function fetchCapped(url: string, limit: number, timeoutMs = FETCH_TIMEOUT_MS, headers?: Record<string, string>): Promise<Fetched> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    return { ok: false, error: "That is not a valid address." };
  }
  if (current.protocol !== "https:") {
    return { ok: false, error: "Addon catalogs and downloads must be https." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    for (let hop = 0; ; hop += 1) {
      response = await fetch(current, { signal: controller.signal, redirect: "manual", headers });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) break;
      await response.body?.cancel();
      if (hop >= MAX_REDIRECTS) return { ok: false, error: "The address redirected too many times." };
      const next = new URL(location, current);
      if (next.protocol !== "https:") {
        return { ok: false, error: "The address redirected somewhere that is not https." };
      }
      current = next;
    }
    if (!response.ok) return { ok: false, error: `The host answered ${response.status}.` };
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > limit) {
      await response.body?.cancel();
      return { ok: false, error: `The file is larger than ${Math.round(limit / 1024 / 1024)} MB.` };
    }
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, error: "The host sent an empty response." };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return { ok: false, error: `The file is larger than ${Math.round(limit / 1024 / 1024)} MB.` };
      }
      chunks.push(value);
    }
    return { ok: true, bytes: Buffer.concat(chunks) };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { ok: false, error: "The host took too long to answer." };
    return { ok: false, error: "Could not reach the host." };
  } finally {
    clearTimeout(timer);
  }
}

export type RegistryRead =
  // `bundled`: GitHub could not be reached, and this is the list this
  // version of the server shipped with.
  | { ok: true; addons: RegistryAddon[]; skipped: number; bundled?: boolean }
  | { ok: false; error: string };

// Reads a catalog. An entry that does not parse is skipped and counted
// rather than taking the whole catalog down with it.
export function readRegistry(value: unknown): RegistryRead {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record || record.kind !== ADDON_REGISTRY_KIND || record.version !== ADDON_REGISTRY_VERSION || !Array.isArray(record.addons)) {
    return { ok: false, error: "That address is not an Open Game Master addon catalog." };
  }
  const addons: RegistryAddon[] = [];
  const ids = new Set<string>();
  let skipped = 0;
  for (const raw of record.addons.slice(0, 500)) {
    const parsed = registryAddonSchema.safeParse(raw);
    if (!parsed.success || ids.has(parsed.data.id)) {
      skipped += 1;
      continue;
    }
    ids.add(parsed.data.id);
    addons.push(parsed.data);
  }
  return { ok: true, addons, skipped };
}

export async function fetchAddonRegistry(url: string): Promise<RegistryRead> {
  const fetched = await fetchCapped(url, MAX_REGISTRY_BYTES, undefined, AGENT);
  let read: RegistryRead;
  if (!fetched.ok) {
    read = fetched;
  } else {
    try {
      read = readRegistry(JSON.parse(fetched.bytes.toString("utf8")));
    } catch {
      read = { ok: false, error: "The catalog is not JSON." };
    }
  }
  // The built-in list falls back to the copy in this build; an operator's
  // own catalog says what went wrong instead.
  if (!read.ok && url === DEFAULT_ADDON_REGISTRY_URL) {
    const shipped = readRegistry(bundledCatalog);
    if (shipped.ok) return { ...shipped, bundled: true };
  }
  return read;
}

const AGENT = { "user-agent": "open-game-master" };
