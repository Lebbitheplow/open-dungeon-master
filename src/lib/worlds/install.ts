// Installing and removing world pack plugins.
//
// Everything here writes to the server's data directory, so every entry point
// is admin-gated at the route and every path is derived from a schema-checked
// pack id rather than from anything a caller supplied.
import fs from "node:fs/promises";
import {
  INSTALLED_DIR,
  installedPackPath,
  resetWorldPackCache,
  worldPackSource,
} from "@/lib/worlds";
import { worldPackSchema, registryIndexSchema, type WorldPack, type RegistryEntry } from "@/lib/worlds/types";

// A manifest is prose and tables, not media. Anything larger than this is not
// a world pack, and the cap is what stops a hostile registry from streaming
// until the disk fills.
export const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

// The registry every deployment browses unless its operator says otherwise.
//
// The packs it lists are community works built on other people's settings:
// they are not distributed with this app, are not covered by its MIT license,
// and nothing here installs on its own. Listing them is not endorsing them,
// which is why UnofficialPackNotice.tsx exists and why installing is still an
// explicit, admin-only act.
//
// Google Drive throttles heavily-downloaded public files, so if this registry
// ever gets busy the index and the manifests want a plain static host. That is
// a change to this constant plus a re-upload; nothing else knows the URL.
export const DEFAULT_WORLD_REGISTRY_URL =
  "https://drive.google.com/uc?export=download&id=1Bnt-kefuVgV0dQ3uiv6rzL1TWI-xgt1c";

// The opt-out. Blank has to keep meaning "fall through to the next source",
// or an operator could never express "no registry at all" once there is a
// built-in default to fall back to.
export const REGISTRY_DISABLED = "off";

// Which registry is in force: admin setting, then environment, then the
// built-in default. Kept pure and separate from the settings lookup so both
// routes share one precedence rule, and so it can be tested without a
// database.
export function pickRegistryUrl(configured: string | undefined, fromEnv: string | undefined): string {
  const chosen = (configured || "").trim() || (fromEnv || "").trim() || DEFAULT_WORLD_REGISTRY_URL;
  return chosen.toLowerCase() === REGISTRY_DISABLED ? "" : chosen;
}

export type InstallResult =
  | { ok: true; pack: WorldPack; replaced: boolean }
  | { ok: false; error: string; status: number };

// Validates a manifest and writes it into the installed directory. Shared by
// the registry install and the manual file upload, so both get the same
// checks and neither can bypass them.
export async function installWorldPack(raw: unknown): Promise<InstallResult> {
  const parsed = worldPackSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      status: 400,
      error: `That file is not a valid world pack: ${first ? `${first.path.join(".")} ${first.message}` : "unknown problem"}.`,
    };
  }
  const pack = parsed.data;
  const target = installedPackPath(pack.id);
  if (!target) {
    return { ok: false, status: 400, error: "That pack has an unusable id." };
  }
  // A bundled id can be shadowed, which is a legitimate way to ship your own
  // build of a world we ship. Knowing whether we replaced something is what
  // lets the UI say so instead of silently swapping a world under a campaign.
  const replaced = worldPackSource(pack.id) !== null;

  try {
    await fs.mkdir(INSTALLED_DIR, { recursive: true });
    await fs.writeFile(target, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: `Could not write the pack to disk: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
  resetWorldPackCache();
  return { ok: true, pack, replaced };
}

export type RemoveResult = { ok: true } | { ok: false; error: string; status: number };

export async function removeWorldPack(id: string): Promise<RemoveResult> {
  const source = worldPackSource(id);
  if (source === null) {
    return { ok: false, status: 404, error: "That world pack is not installed." };
  }
  if (source === "bundled") {
    // Bundled packs live in the repository; removing one would be undone by
    // the next deploy and would mean deleting a tracked file at runtime.
    return { ok: false, status: 400, error: "Bundled worlds ship with the app and cannot be removed." };
  }
  const target = installedPackPath(id);
  if (!target) {
    return { ok: false, status: 400, error: "That pack has an unusable id." };
  }
  try {
    await fs.unlink(target);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: `Could not remove the pack: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
  resetWorldPackCache();
  return { ok: true };
}

// Reads a remote body with a hard ceiling, rather than trusting
// Content-Length or buffering whatever arrives. A registry is admin-supplied
// and therefore semi-trusted, but semi-trusted is not trusted.
async function fetchJsonCapped(url: string): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, error: "That is not a valid URL." };
  }
  if (parsedUrl.protocol !== "https:") {
    return { ok: false, error: "World pack sources must be https." };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsedUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      return { ok: false, error: `The source answered ${response.status}.` };
    }
    const body = response.body;
    if (!body) {
      return { ok: false, error: "The source sent an empty response." };
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        return { ok: false, error: "That file is larger than 2MB, so it is not a world pack." };
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      return { ok: false, error: "The source did not return JSON." };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "The source timed out." };
    }
    return { ok: false, error: "Could not reach the source." };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRegistryIndex(
  url: string,
): Promise<{ ok: true; packs: RegistryEntry[] } | { ok: false; error: string }> {
  const fetched = await fetchJsonCapped(url);
  if (!fetched.ok) {
    return fetched;
  }
  const parsed = registryIndexSchema.safeParse(fetched.value);
  if (!parsed.success) {
    return { ok: false, error: "That registry index is not in the expected format." };
  }
  return { ok: true, packs: parsed.data.packs };
}

export async function installFromUrl(url: string, expectedId?: string): Promise<InstallResult> {
  const fetched = await fetchJsonCapped(url);
  if (!fetched.ok) {
    return { ok: false, status: 502, error: fetched.error };
  }
  const result = await installWorldPack(fetched.value);
  if (result.ok && expectedId && result.pack.id !== expectedId) {
    // The registry listed one world and the download turned out to be a
    // different one. It is already written, so say plainly which id landed
    // rather than pretending the install matched the listing.
    return {
      ok: false,
      status: 409,
      error: `The registry listed "${expectedId}" but the download contained "${result.pack.id}". It was installed under its own id.`,
    };
  }
  return result;
}
