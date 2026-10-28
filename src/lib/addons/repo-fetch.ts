import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { safeEntryPath } from "@/lib/addons/archive";

// Fetching an addon's folder from its repository at one commit, file by
// file: the list of files git recorded for that commit, then each file
// streamed to disk and checked against the hash git recorded for it. There
// is no archive in between, so nothing has to fit in one: a repository that
// holds much more than the addon costs only the addon's folder, and every
// file goes straight to disk. Big programs, models and textures do not
// belong in the repository at all (GitHub refuses files over 100 MB); an
// addon's setup downloads them (src/lib/addons/setup.ts).
//
// The same code serves the server (GitHub), the catalog tool and its pull
// request check (GitHub, or a local clone), so an entry's content hash is
// computed the same way everywhere.

// Guards against a mistaken listing, not a packaging limit.
export const MAX_REPO_FILES = 50_000;
export const MAX_REPO_BYTES = 16 * 1024 * 1024 * 1024;

export type RepoFile = { path: string; size: number; sha: string; executable: boolean };

// Where one folder of one commit comes from.
export type RepoReader = {
  label: string;
  // Every file under the folder, paths relative to it.
  list(): Promise<RepoFile[]>;
  // One file's bytes.
  open(relative: string, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
};

const AGENT = { "user-agent": "open-game-master" };

function trimBase(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, "");
}

type TreeEntry = { path: string; mode: string; type: string; sha: string; size?: number };

function toFiles(entries: TreeEntry[], prefix: string): RepoFile[] {
  const files: RepoFile[] = [];
  for (const entry of entries) {
    if (prefix && !entry.path.startsWith(prefix)) continue;
    const relative = entry.path.slice(prefix.length);
    if (entry.type === "tree") continue;
    if (entry.type === "commit") throw new Error(`${relative} is a git submodule; an addon's folder holds plain files only.`);
    if (entry.mode === "120000") throw new Error(`${relative} is a link; an addon's folder holds plain files only.`);
    files.push({ path: relative, size: entry.size ?? 0, sha: entry.sha, executable: entry.mode === "100755" });
  }
  return files;
}

// GitHub, through its API for the listing and raw.githubusercontent.com for
// the files. The bases are replaceable for a test or a local stand-in.
export function githubReader(options: {
  repo: string;
  commit: string;
  folder: string;
  apiBase?: string;
  rawBase?: string;
}): RepoReader {
  const api = trimBase(options.apiBase, "https://api.github.com");
  const raw = trimBase(options.rawBase, "https://raw.githubusercontent.com");
  const { repo, commit, folder } = options;
  const getTree = async (sha: string, recursive: boolean) => {
    const response = await fetch(`${api}/repos/${repo}/git/trees/${sha}${recursive ? "?recursive=1" : ""}`, {
      headers: { ...AGENT, accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} listing ${repo} at ${commit.slice(0, 7)}.`);
    return (await response.json()) as { tree: TreeEntry[]; truncated?: boolean };
  };
  return {
    label: `${repo}${folder ? `/${folder}` : ""} at ${commit.slice(0, 7)}`,
    async list() {
      // The whole commit in one request when GitHub gives it whole; for a
      // very large repository, down to the addon's folder a level at a time.
      const whole = await getTree(commit, true);
      if (!whole.truncated) return toFiles(whole.tree, folder ? `${folder}/` : "");
      let sha = commit;
      for (const part of folder ? folder.split("/") : []) {
        const level = await getTree(sha, false);
        const next = level.tree.find((entry) => entry.type === "tree" && entry.path === part);
        if (!next) throw new Error(`There is no folder ${folder} in ${repo} at ${commit.slice(0, 7)}.`);
        sha = next.sha;
      }
      const inside = await getTree(sha, true);
      if (inside.truncated) throw new Error(`${folder || repo} holds more files than GitHub lists at once.`);
      return toFiles(inside.tree, "");
    },
    async open(relative, signal) {
      const full = folder ? `${folder}/${relative}` : relative;
      const response = await fetch(`${raw}/${repo}/${commit}/${full.split("/").map(encodeURIComponent).join("/")}`, { headers: AGENT, signal });
      if (!response.ok || !response.body) throw new Error(`GitHub answered ${response.status} for ${full}.`);
      return response.body as unknown as AsyncIterable<Uint8Array>;
    },
  };
}

export type FetchedFolder = { ok: true; contentSha256: string; files: number; bytes: number } | { ok: false; error: string };

const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";

// One small file (addon.json), read whole, checked against git's hash.
export async function readRepoFile(reader: RepoReader, file: RepoFile, limit: number): Promise<Buffer> {
  if (file.size > limit) throw new Error(`${file.path} is larger than ${Math.round(limit / 1024)} KB.`);
  const chunks: Uint8Array[] = [];
  for await (const chunk of await reader.open(file.path)) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (blob !== file.sha) throw new Error(`${file.path} does not match the commit.`);
  return bytes;
}

async function fetchOne(reader: RepoReader, file: RepoFile, target: string, signal?: AbortSignal): Promise<string> {
  const destination = path.join(target, ...file.path.split("/"));
  if (!destination.startsWith(target + path.sep)) throw new Error(`${file.path} is not a safe path.`);
  await mkdir(path.dirname(destination), { recursive: true });
  const blob = createHash("sha1").update(`blob ${file.size}\0`);
  const content = createHash("sha256");
  const out = createWriteStream(destination);
  let received = 0;
  let head = "";
  try {
    for await (const chunk of await reader.open(file.path, signal)) {
      received += chunk.byteLength;
      if (received > file.size) throw new Error(`${file.path} is larger than the commit says.`);
      if (head.length < LFS_POINTER.length) head += Buffer.from(chunk).toString("latin1", 0, LFS_POINTER.length);
      blob.update(chunk);
      content.update(chunk);
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
  } finally {
    await new Promise<void>((resolve) => out.end(() => resolve()));
  }
  if (received !== file.size || blob.digest("hex") !== file.sha) throw new Error(`${file.path} does not match the commit.`);
  if (file.size < 1024 && head.startsWith(LFS_POINTER)) {
    throw new Error(`${file.path} is kept in Git LFS. Put large files in a release or another host and fetch them in the addon's setup.`);
  }
  if (file.executable) await chmod(destination, 0o755).catch(() => undefined);
  return content.digest("hex");
}

// Every file of the folder into `target` (empty or missing), with the hash
// of what landed: the SHA-256 over each file's path and the SHA-256 of its
// contents, sorted by path, the same hash archiveContentHash gives a zip of
// the same files.
export async function fetchAddonFolder(
  reader: RepoReader,
  target: string,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; files?: RepoFile[] } = {},
): Promise<FetchedFolder> {
  let files: RepoFile[];
  try {
    files = options.files ?? (await reader.list());
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (!files.some((file) => file.path === "addon.json")) return { ok: false, error: `There is no addon.json in ${reader.label}.` };
  if (files.length > MAX_REPO_FILES) return { ok: false, error: `${reader.label} holds more than ${MAX_REPO_FILES} files.` };
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (bytes > MAX_REPO_BYTES) return { ok: false, error: `${reader.label} holds more than ${MAX_REPO_BYTES / 1024 ** 3} GB.` };
  for (const file of files) {
    if (safeEntryPath(file.path) !== file.path) return { ok: false, error: `${file.path} is not a safe path.` };
  }
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hashes = new Map<string, string>();
  await mkdir(target, { recursive: true });
  let next = 0;
  let done = 0;
  try {
    // A few at a time: the files are many and mostly small.
    await Promise.all(
      Array.from({ length: Math.min(6, sorted.length) }, async () => {
        while (next < sorted.length) {
          const file = sorted[next++];
          if (options.signal?.aborted) throw new Error("Cancelled.");
          hashes.set(file.path, await fetchOne(reader, file, target, options.signal));
          done += 1;
          options.onProgress?.(done, sorted.length);
        }
      }),
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const outer = createHash("sha256");
  for (const file of sorted) outer.update(`${file.path}\n${hashes.get(file.path)}\n`);
  return { ok: true, contentSha256: outer.digest("hex"), files: sorted.length, bytes };
}
