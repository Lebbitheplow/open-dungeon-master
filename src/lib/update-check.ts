import packageJson from "../../package.json";
import {
  describeBuild,
  newestRelease,
  parseLatestRelease,
  parseUpdateChannel,
  REPOSITORY,
  updateStatus,
  type BuildInfo,
  type LatestRelease,
  type UpdateChannel,
  type UpdateStatus,
} from "@/lib/build-info";
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
//
// ODM_UPDATE_CHANNEL=beta compares against the newest release of any kind,
// the nightly betas included, instead of the latest stable one
// (docs/releases.md).

export function currentBuild(): BuildInfo {
  return describeBuild({
    version: packageJson.version,
    describe: process.env.ODM_BUILD_DESCRIBE ?? "",
    commit: process.env.ODM_BUILD_COMMIT ?? "",
    builtAt: process.env.ODM_BUILD_TIME ?? "",
  });
}

type Kept = { at: number; channel: UpdateChannel; latest: LatestRelease | null };

declare global {
  var __odmLatestRelease: Kept | undefined;
  var __odmLatestReleaseAsk: Promise<Kept> | undefined;
}

const KEEP_MS = 6 * 60 * 60 * 1000;
// A failed ask is tried again sooner, but not on every open of the dialog.
const RETRY_MS = 15 * 60 * 1000;

// Stable is GitHub's own "latest release", which never names a prerelease;
// beta reads the most recent releases and takes the highest version.
async function askGitHub(channel: UpdateChannel): Promise<Kept> {
  let latest: LatestRelease | null = null;
  try {
    const path = channel === "beta" ? "releases?per_page=30" : "releases/latest";
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json", "User-Agent": `open-dungeon-master/${packageJson.version}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) {
      const payload = await response.json().catch(() => null);
      latest = channel === "beta" ? newestRelease(payload, channel) : parseLatestRelease(payload, channel);
    }
  } catch {
    // Offline, blocked or rate limited: the dialog says it could not check.
  }
  const kept = { at: Date.now(), channel, latest };
  globalThis.__odmLatestRelease = kept;
  return kept;
}

export function updateCheckEnabled(): boolean {
  return !["off", "0", "false", "no"].includes(serverEnv("ODM_UPDATE_CHECK").trim().toLowerCase());
}

export function updateChannel(): UpdateChannel {
  return parseUpdateChannel(serverEnv("ODM_UPDATE_CHANNEL"));
}

export async function checkForUpdate(build: Pick<BuildInfo, "version"> = currentBuild(), fresh = false): Promise<UpdateStatus> {
  if (isDeviceWorld()) {
    return { state: "off", reason: "device_world" };
  }
  if (!updateCheckEnabled()) {
    return { state: "off", reason: "disabled" };
  }
  const channel = updateChannel();
  let kept = globalThis.__odmLatestRelease;
  const age = kept ? Date.now() - kept.at : Infinity;
  if (!kept || kept.channel !== channel || fresh || age > (kept.latest ? KEEP_MS : RETRY_MS)) {
    // One ask at a time, however many dialogs open at once.
    globalThis.__odmLatestReleaseAsk ??= askGitHub(channel).finally(() => {
      globalThis.__odmLatestReleaseAsk = undefined;
    });
    kept = await globalThis.__odmLatestReleaseAsk;
  }
  return updateStatus(build, kept.latest, new Date(kept.at).toISOString(), kept.channel);
}
