import { fetchCapped } from "@/lib/addons/registry";
import { parseGitHubLink, type GitHubLink } from "@/lib/addons/github-link";
import type { GitHubOrigin } from "@/lib/addons/store";
import { serverEnv } from "@/lib/server-env";

export { parseGitHubLink, type GitHubLink };

// An addon installed from a GitHub link: the repository, and optionally a
// release, a branch or a folder inside it. The link is resolved through
// GitHub's API to one exact commit (a release's tag, a branch's head), whose
// files are then fetched one by one (src/lib/addons/repo-fetch.ts), so what
// was installed is known, and an update is a newer release, or a newer
// commit on the branch it came from.
//
// Links that are not on the audited list are unreviewed, so they sit behind the
// same admin switch as installing a .zip by hand.

// GitHub refuses API requests without a user agent.
const AGENT = { "user-agent": "open-game-master" };
const HEADERS = { ...AGENT, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
async function api(path: string): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const base = (serverEnv("ADDON_GITHUB_API_BASE") || "https://api.github.com").replace(/\/+$/, "");
  const fetched = await fetchCapped(`${base}${path}`, 2 * 1024 * 1024, undefined, HEADERS);
  if (!fetched.ok) {
    const status = /answered (\d{3})/.exec(fetched.error)?.[1];
    return { ok: false, status: status ? Number(status) : 502, error: fetched.error };
  }
  try {
    return { ok: true, value: JSON.parse(fetched.bytes.toString("utf8")) as Record<string, unknown> };
  } catch {
    return { ok: false, status: 502, error: "GitHub's answer was not JSON." };
  }
}

export type ResolvedSource = { origin: GitHubOrigin; label: string };

// A branch, tag or commit of the repository as its commit.
async function commitOf(link: GitHubLink, ref: string): Promise<string | { error: string }> {
  const commit = await api(`/repos/${link.owner}/${link.repo}/commits/${encodeURIComponent(ref)}`);
  if (!commit.ok) return { error: commit.status === 404 ? `${link.owner}/${link.repo} has no branch, tag or commit "${ref}".` : commit.error };
  const sha = String(commit.value.sha ?? "");
  return /^[a-f0-9]{40}$/.test(sha) ? sha : { error: "GitHub did not name the commit." };
}

async function fromRelease(link: GitHubLink, release: Record<string, unknown>): Promise<ResolvedSource | { error: string }> {
  const tag = String(release.tag_name ?? "");
  const sha = await commitOf(link, tag);
  if (typeof sha !== "string") return sha;
  return {
    origin: { repo: `${link.owner}/${link.repo}`, path: link.path, ref: "", tag, commit: sha },
    label: `release ${tag}`,
  };
}

async function fromRef(link: GitHubLink, ref: string): Promise<ResolvedSource | { error: string }> {
  const sha = await commitOf(link, ref);
  if (typeof sha !== "string") return sha;
  return {
    origin: { repo: `${link.owner}/${link.repo}`, path: link.path, ref, tag: "", commit: sha },
    label: `${ref} at ${sha.slice(0, 7)}`,
  };
}

// The exact commit a link means right now.
export async function resolveGitHubLink(link: GitHubLink): Promise<ResolvedSource | { error: string }> {
  const base = `/repos/${link.owner}/${link.repo}`;
  if (link.mode === "release") {
    const release = await api(`${base}/releases/tags/${encodeURIComponent(link.ref)}`);
    if (!release.ok) return { error: release.status === 404 ? `${link.owner}/${link.repo} has no release "${link.ref}".` : release.error };
    return fromRelease(link, release.value);
  }
  if (link.mode === "ref") return fromRef(link, link.ref);
  const latest = await api(`${base}/releases/latest`);
  if (latest.ok) return fromRelease(link, latest.value);
  if (latest.status !== 404) return { error: latest.error };
  // No releases: the default branch as it stands.
  const repository = await api(base);
  if (!repository.ok) return { error: repository.status === 404 ? `There is no public repository ${link.owner}/${link.repo}.` : repository.error };
  return fromRef(link, String(repository.value.default_branch ?? "main"));
}

// The link an installed addon would be updated from: its newest release when
// it came from one, else the branch it came from.
export function linkFor(origin: GitHubOrigin): GitHubLink | null {
  const [owner, repo] = origin.repo.split("/");
  if (!owner || !repo) return null;
  return origin.tag
    ? { owner, repo, mode: "latest", ref: "", path: origin.path }
    : { owner, repo, mode: "ref", ref: origin.ref, path: origin.path };
}

type CachedCheck = { at: number; label: string };

declare global {
  var __odmGitHubChecks: Map<string, CachedCheck> | undefined;
}

const CHECK_TTL_MS = 15 * 60_000;

// A newer release or commit than the installed one, as a label ("release
// v1.3.0", "main at 1a2b3c4"), or "". Remembered for a quarter of an hour so
// the admin panel stays well inside GitHub's limit for unsigned requests.
export async function githubUpdate(origin: GitHubOrigin): Promise<string> {
  const link = linkFor(origin);
  if (!link) return "";
  const key = `${origin.repo}|${origin.path}|${origin.ref}`;
  const cache = (globalThis.__odmGitHubChecks ??= new Map());
  const hit = cache.get(key);
  let label = "";
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) {
    label = hit.label;
  } else {
    const resolved = await resolveGitHubLink(link);
    label = "error" in resolved ? "" : `${resolved.origin.tag}|${resolved.origin.commit}|${resolved.label}`;
    cache.set(key, { at: Date.now(), label });
  }
  if (!label) return "";
  const [tag, commit, text] = label.split("|");
  const newer = origin.tag ? tag && tag !== origin.tag : commit && commit !== origin.commit;
  return newer ? text : "";
}
