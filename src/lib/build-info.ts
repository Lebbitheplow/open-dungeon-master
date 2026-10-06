// What is running (issue 102): the release number from package.json and the
// exact build behind it, so "is the fix in what I am running?" has an answer
// a browser can read. The git facts are read once, when the app is built
// (next.config.ts), because a running server may have no repository beside
// it: a Docker image, an app's bundled copy.
//
// The label follows semantic versioning's build metadata, in git's own
// words:
//
//   0.24.6                     the tagged release, nothing on top
//   0.24.6+12.g1a2b3c4         twelve commits past the tag v0.24.6
//   0.24.6+g1a2b3c4            a commit, with no tag to count from
//   0.24.6+12.g1a2b3c4.dirty   built with uncommitted changes in the tree
//
// Pure, so scripts/test-build-info.mjs can check it.

export type BuildFacts = {
  // package.json's version.
  version: string;
  // `git describe --tags --long --dirty`, or "" when there was no git.
  describe: string;
  // The full commit hash, or "".
  commit: string;
  // ISO time of the build, or "".
  builtAt: string;
};

export type BuildInfo = {
  version: string;
  // The version with its build metadata, as above.
  label: string;
  commit: string;
  shortCommit: string;
  // The release tag the build sits on or after ("v0.24.6"), or "".
  tag: string;
  // Commits past that tag.
  ahead: number;
  // Built from a tree with uncommitted changes.
  dirty: boolean;
  // Exactly the tagged release of this version: no commits on top, a clean
  // tree, and the tag is this version's.
  release: boolean;
  builtAt: string;
  // False when the build had no git to ask (a locally built Docker image).
  known: boolean;
};

const DESCRIBED = /^(.*)-(\d+)-g([0-9a-f]{4,40})(-dirty)?$/;
const BARE = /^([0-9a-f]{4,40})(-dirty)?$/;

export function describeBuild(facts: BuildFacts): BuildInfo {
  const version = facts.version.trim();
  const describe = facts.describe.trim();
  let tag = "";
  let ahead = 0;
  let short = "";
  let dirty = false;
  const described = DESCRIBED.exec(describe);
  const bare = described ? null : BARE.exec(describe);
  if (described) {
    tag = described[1];
    ahead = Number(described[2]);
    short = described[3];
    dirty = Boolean(described[4]);
  } else if (bare) {
    // `git describe --always` with no tag to count from.
    short = bare[1];
    dirty = Boolean(bare[2]);
  }
  const commit = facts.commit.trim() || short;
  const shortCommit = (short || commit).slice(0, 7);
  const onThisVersion = tag.replace(/^v/, "") === version;
  const release = Boolean(shortCommit) && onThisVersion && ahead === 0 && !dirty;
  const meta = release
    ? []
    : [
        // Commits are only counted from this version's own tag: "12 past
        // v0.24.5" beside the number 0.24.6 would say nothing true.
        ...(shortCommit ? [onThisVersion && ahead > 0 ? `${ahead}.g${shortCommit}` : `g${shortCommit}`] : []),
        ...(dirty ? ["dirty"] : []),
      ];
  return {
    version,
    label: meta.length ? `${version}+${meta.join(".")}` : version,
    commit,
    shortCommit,
    tag,
    ahead,
    dirty,
    release,
    builtAt: facts.builtAt.trim(),
    known: Boolean(shortCommit),
  };
}

// Dotted numbers, compared piece by piece; a leading "v" and anything after
// a "-" or "+" (pre-release, build) is ignored. Positive when a is newer.
export function compareVersions(a: string, b: string): number {
  const parts = (text: string) =>
    text
      .trim()
      .replace(/^v/i, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((piece) => Number.parseInt(piece, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export const REPOSITORY = "Lebbitheplow/open-dungeon-master";
export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;

export type LatestRelease = { version: string; url: string; publishedAt: string; name: string };

// GitHub's "latest release" answer, reduced to what is shown. Null when it
// is not a published release with a version for a tag.
export function parseLatestRelease(payload: unknown): LatestRelease | null {
  const release = payload as { tag_name?: unknown; html_url?: unknown; published_at?: unknown; name?: unknown; draft?: unknown; prerelease?: unknown } | null;
  if (!release || typeof release.tag_name !== "string" || release.draft === true || release.prerelease === true) {
    return null;
  }
  const version = release.tag_name.trim().replace(/^v/i, "");
  if (!/^\d+(\.\d+)*/.test(version)) {
    return null;
  }
  const url =
    typeof release.html_url === "string" && release.html_url.startsWith(`${REPOSITORY_URL}/`)
      ? release.html_url
      : `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(release.tag_name.trim())}`;
  return {
    version,
    url,
    publishedAt: typeof release.published_at === "string" ? release.published_at : "",
    name: typeof release.name === "string" ? release.name.slice(0, 160) : "",
  };
}

export type UpdateStatus =
  // Not asked: switched off, or a world that updates with the app around it.
  | { state: "off"; reason: "disabled" | "device_world" }
  // Asked, and GitHub could not be reached or made no sense.
  | { state: "unknown"; checkedAt: string }
  | { state: "current" | "available" | "ahead"; latest: LatestRelease; checkedAt: string };

// Where this build stands against the newest release. A build past the
// newest release (a development checkout) is "ahead", not out of date.
export function updateStatus(build: Pick<BuildInfo, "version">, latest: LatestRelease | null, checkedAt: string): UpdateStatus {
  if (!latest) {
    return { state: "unknown", checkedAt };
  }
  const difference = compareVersions(latest.version, build.version);
  return { state: difference > 0 ? "available" : difference < 0 ? "ahead" : "current", latest, checkedAt };
}
