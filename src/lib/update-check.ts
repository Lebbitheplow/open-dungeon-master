import packageJson from "../../package.json";
import { describeBuild, parseLatestRelease, REPOSITORY, updateStatus, type BuildInfo, type LatestRelease, type UpdateStatus } from "@/lib/build-info";
import { isDeviceWorld, serverEnv } from "@/lib/server-env";

// This server's build, and whether a newer release exists (issue 102).
//
// The build's git facts were written into the bundle by next.config.ts. The
// newest release is asked of GitHub's public API by the server, never by the
// browser, and kept: one unauthenticated request every six hours at most,
// whoever opens the About dialog, and it carries nothing about this server
// but its address. ODM_UPDATE_CHECK=off stops it for a server that is not
// to talk to anything outside. A world hosted by the desktop or Android app
// is not asked about at all: it is updated by updating the app.

export function currentBuild(): BuildInfo {
  return describeBuild({
    version: packageJson.version,
    describe: process.env.ODM_BUILD_DESCRIBE ?? "",
    commit: process.env.ODM_BUILD_COMMIT ?? "",
    builtAt: process.env.ODM_BUILD_TIME ?? "",
  });
}

type Kept = { at: number; latest: LatestRelease | null };

declare global {
  var __odmLatestRelease: Kept | undefined;
  var __odmLatestReleaseAsk: Promise<Kept> | undefined;
}

const KEEP_MS = 6 * 60 * 60 * 1000;
// A failed ask is tried again sooner, but not on every open of the dialog.
const RETRY_MS = 15 * 60 * 1000;

async function askGitHub(): Promise<Kept> {
  let latest: LatestRelease | null = null;
  try {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json", "User-Agent": `open-dungeon-master/${packageJson.version}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      latest = parseLatestRelease(await response.json().catch(() => null));
    }
  } catch {
    // Offline, blocked or rate limited: the dialog says it could not check.
  }
  const kept = { at: Date.now(), latest };
  globalThis.__odmLatestRelease = kept;
  return kept;
}

export function updateCheckEnabled(): boolean {
  return !["off", "0", "false", "no"].includes(serverEnv("ODM_UPDATE_CHECK").trim().toLowerCase());
}

export async function checkForUpdate(build: Pick<BuildInfo, "version"> = currentBuild(), fresh = false): Promise<UpdateStatus> {
  if (isDeviceWorld()) {
    return { state: "off", reason: "device_world" };
  }
  if (!updateCheckEnabled()) {
    return { state: "off", reason: "disabled" };
  }
  let kept = globalThis.__odmLatestRelease;
  const age = kept ? Date.now() - kept.at : Infinity;
  if (!kept || fresh || age > (kept.latest ? KEEP_MS : RETRY_MS)) {
    // One ask at a time, however many dialogs open at once.
    globalThis.__odmLatestReleaseAsk ??= askGitHub().finally(() => {
      globalThis.__odmLatestReleaseAsk = undefined;
    });
    kept = await globalThis.__odmLatestReleaseAsk;
  }
  return updateStatus(build, kept.latest, new Date(kept.at).toISOString());
}
