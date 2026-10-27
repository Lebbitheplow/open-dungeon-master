#!/usr/bin/env node
// The downloader list, addons/catalog.json: how an addon is added to it and
// how a pull request that changes it is checked (docs/addons/guidelines.md).
//
//   node scripts/addon-catalog.mjs add <github link> [--category maps|content|table|tools]
//       Writes the entry for an addon from its own repository: a link to the
//       repository, a release, or a folder at a branch or commit
//       (https://github.com/you/your-addon/tree/<commit>/addons/iso). A branch
//       or tag is resolved to its commit, which is what gets audited.
//   node scripts/addon-catalog.mjs verify [--changed <git ref>] [--out-dir <dir>] [--summary <file>]
//       Derives every entry (or those changed since <git ref>) again from
//       GitHub and fails on any difference. --out-dir writes each checked
//       addon there, for scripts/check-addon.mjs; --summary appends what a
//       reviewer reads (the source, what changed, permissions, downloads).
//   node scripts/addon-catalog.mjs check
//       The file's shape, offline: every entry reads, ids unique and sorted.
//
// Common options: --catalog <file> (default addons/catalog.json), and
// --local owner/repo=<clone> to read a repository from a local clone instead
// of GitHub. Either way the addon's folder is read file by file at the
// commit, as a server reads it (src/lib/addons/repo-fetch.ts): no archive.
// Nothing from an addon is run here.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register("./lib/register-alias.mjs", import.meta.url);

const { addonManifestSchema, describeManifestError } = await import("../src/lib/addons/manifest.ts");
const { fetchAddonFolder, githubReader } = await import("../src/lib/addons/repo-fetch.ts");
const { parseGitHubLink } = await import("../src/lib/addons/github-link.ts");
const { CATALOG_CATEGORIES, catalogEntry, catalogProblems, emptyCatalog, entryDifferences, withEntry } = await import(
  "../src/lib/addons/catalog-entry.ts"
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[a-f0-9]{40}$/;
const AGENT = { "user-agent": "open-game-master" };

const argv = process.argv.slice(2);
const [command, target] = argv;
function option(name) {
  const index = argv.indexOf(name);
  return index > 0 ? argv[index + 1] : undefined;
}
const catalogFile = path.resolve(option("--catalog") ?? path.join(ROOT, "addons", "catalog.json"));
const locals = new Map(
  argv
    .filter((_, index) => argv[index - 1] === "--local")
    .map((value) => value.split("="))
    .filter((pair) => pair.length === 2)
    .map(([repo, dir]) => [repo.toLowerCase(), path.resolve(dir)]),
);

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function readCatalog(file = catalogFile) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : emptyCatalog();
}

function writeCatalog(catalog) {
  fs.mkdirSync(path.dirname(catalogFile), { recursive: true });
  fs.writeFileSync(catalogFile, `${JSON.stringify({ ...catalog, generated: "" }, null, 2)}\n`);
}

async function githubJson(apiPath) {
  const base = (process.env.ADDON_GITHUB_API_BASE || "https://api.github.com").replace(/\/+$/, "");
  const response = await fetch(`${base}${apiPath}`, { headers: { ...AGENT, accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${apiPath}`);
  return response.json();
}

// A branch, tag or commit of the repository as a full commit hash.
async function commitFor(repo, ref) {
  if (COMMIT.test(ref)) return ref;
  const local = locals.get(repo.toLowerCase());
  if (local) return execFileSync("git", ["-C", local, "rev-parse", `${ref}^{commit}`], { encoding: "utf8" }).trim();
  return (await githubJson(`/repos/${repo}/commits/${encodeURIComponent(ref)}`)).sha;
}

async function defaultRef(repo) {
  const local = locals.get(repo.toLowerCase());
  if (local) return "HEAD";
  return (await githubJson(`/repos/${repo}`)).default_branch;
}

// A folder of a local clone at a commit, read through git the way GitHub's
// listing and raw files read it.
function localReader(dir, commit, folder) {
  const prefix = folder ? `${folder}/` : "";
  return {
    label: `${dir}${folder ? `/${folder}` : ""} at ${commit.slice(0, 7)}`,
    async list() {
      const out = execFileSync("git", ["-C", dir, "ls-tree", "-r", "-l", "-z", "--full-tree", commit, ...(folder ? ["--", prefix] : [])], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      });
      return out
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const [meta, filePath] = line.split("\t");
          const [mode, type, sha, size] = meta.trim().split(/\s+/);
          const relative = filePath.slice(prefix.length);
          if (type === "commit") throw new Error(`${relative} is a git submodule; an addon's folder holds plain files only.`);
          if (mode === "120000") throw new Error(`${relative} is a link; an addon's folder holds plain files only.`);
          return { path: relative, size: Number(size), sha, executable: mode === "100755" };
        });
    },
    async open(relative) {
      return spawn("git", ["-C", dir, "cat-file", "blob", `${commit}:${prefix}${relative}`]).stdout;
    },
  };
}

function readerFor(source) {
  const local = locals.get(source.repo.toLowerCase());
  if (local) return localReader(local, source.commit, source.path);
  return githubReader({
    repo: source.repo,
    commit: source.commit,
    folder: source.path,
    apiBase: process.env.ADDON_GITHUB_API_BASE,
    rawBase: process.env.ADDON_GITHUB_RAW_BASE,
  });
}

// The entry an addon's files at a commit make. The files land in `into` (a
// scratch folder unless the caller wants them kept, for the checker).
async function deriveEntry(source, category, into) {
  const target = into ?? fs.mkdtempSync(path.join(os.tmpdir(), "odm-addon-entry-"));
  try {
    const fetched = await fetchAddonFolder(readerFor(source), target);
    if (!fetched.ok) throw new Error(fetched.error);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(target, "addon.json"), "utf8"));
    } catch {
      throw new Error("addon.json is not valid JSON.");
    }
    const parsed = addonManifestSchema.safeParse(raw);
    if (!parsed.success) throw new Error(`addon.json does not read: ${describeManifestError(parsed.error)}`);
    return catalogEntry(parsed.data, source, { contentSha256: fetched.contentSha256, bytes: fetched.bytes }, category);
  } finally {
    if (!into) fs.rmSync(target, { recursive: true, force: true });
  }
}

async function add() {
  const link = target ? parseGitHubLink(target) : null;
  if (!link) {
    fail("Give a GitHub link: owner/repo, the repository's page, a release page, or a folder at a branch or commit.");
    return;
  }
  const repo = `${link.owner}/${link.repo}`;
  const ref = link.ref || (await defaultRef(repo));
  const commit = await commitFor(repo, ref);
  const catalog = readCatalog();
  const category = option("--category");
  if (category && !CATALOG_CATEGORIES.includes(category)) {
    fail(`--category is one of ${CATALOG_CATEGORIES.join(", ")}.`);
    return;
  }
  const entry = await deriveEntry({ repo, path: link.path, commit, tag: link.mode === "release" ? link.ref : "" }, category ?? "tools");
  const previous = catalog.addons.find((existing) => existing.id === entry.id);
  const final = category || !previous ? entry : { ...entry, category: previous.category };
  writeCatalog(withEntry(catalog, final));
  console.log(`${previous ? "Updated" : "Added"} ${final.name} ${final.version} (${final.id}) from ${repo}${link.path ? `/${link.path}` : ""} at ${commit.slice(0, 7)}.`);
  if (previous && previous.version === final.version && previous.source.commit !== final.source.commit) {
    console.log("Note: the commit changed but the version did not. Servers offer an update when the version changes; bump it in addon.json.");
  }
}

function changedIds(ref) {
  let before;
  try {
    before = JSON.parse(execFileSync("git", ["show", `${ref}:${path.relative(ROOT, catalogFile)}`], { cwd: ROOT, encoding: "utf8" }));
  } catch {
    before = emptyCatalog();
  }
  const now = readCatalog();
  const old = new Map(before.addons.map((entry) => [entry.id, entry]));
  const changed = now.addons.filter((entry) => JSON.stringify(old.get(entry.id)) !== JSON.stringify(entry)).map((entry) => entry.id);
  const removed = before.addons.filter((entry) => !now.addons.some((current) => current.id === entry.id)).map((entry) => entry.id);
  return { changed, removed, old };
}

function summarize(entry, previous) {
  const folder = entry.source.path ? `/${entry.source.path}` : "";
  const lines = [`### ${entry.name} ${entry.version} (${entry.id})`, "", `By ${entry.author}, from [${entry.source.repo}${folder}](https://github.com/${entry.source.repo}/tree/${entry.source.commit}${folder}) at \`${entry.source.commit.slice(0, 7)}\`.`];
  if (previous && previous.source.commit !== entry.source.commit) {
    lines.push("", `Changes since the last audited commit: https://github.com/${entry.source.repo}/compare/${previous.source.commit}...${entry.source.commit}`);
  } else if (!previous) {
    lines.push("", "A new addon: read all of it.");
  }
  lines.push(
    "",
    `- Runs as: ${entry.runtime}${entry.needs.length ? `, needs ${entry.needs.join(", ")}` : ""}`,
    `- Asks to: ${entry.permissions.join(", ") || "nothing"}`,
    `- Adds: ${Object.entries(entry.contributes).filter(([, titles]) => titles.length).map(([kind, titles]) => `${kind} (${titles.join(", ")})`).join("; ")}`,
    `- Files: ${Math.max(1, Math.round(entry.bytes / 1024))} KB, content SHA-256 \`${entry.contentSha256}\``,
  );
  if (entry.setupMB) lines.push(`- Setup: about ${entry.setupMB} MB (check its downloads in addon.json)`);
  if (entry.conflicts.length) lines.push(`- Conflicts with: ${entry.conflicts.map((conflict) => `${conflict.id} (${conflict.reason})`).join("; ")}`);
  if (entry.exclusive.length) lines.push(`- Takes turns for: ${entry.exclusive.join(", ")}`);
  return `${lines.join("\n")}\n\n`;
}

async function verify() {
  const raw = readCatalog();
  for (const problem of catalogProblems(raw)) fail(problem);
  if (process.exitCode) return;
  const ref = option("--changed");
  const { changed, removed, old } = ref ? changedIds(ref) : { changed: raw.addons.map((entry) => entry.id), removed: [], old: new Map() };
  const outDir = option("--out-dir");
  const summaryFile = option("--summary");
  let summary = "";
  for (const id of changed) {
    const listed = raw.addons.find((entry) => entry.id === id);
    try {
      const into = outDir ? path.join(path.resolve(outDir), id) : undefined;
      if (into) fs.rmSync(into, { recursive: true, force: true });
      const entry = await deriveEntry(listed.source, listed.category, into);
      const differences = entryDifferences(entry, listed);
      if (differences.length) {
        fail(`${id}: the entry does not match ${listed.source.repo} at ${listed.source.commit.slice(0, 7)} (${differences.join(", ")}). Write it with scripts/addon-catalog.mjs add.`);
        continue;
      }
      const previous = old.get(id);
      if (previous && previous.source.commit !== listed.source.commit && previous.version === listed.version) {
        fail(`${id}: the commit changed but the version did not; bump the version in addon.json so servers offer the update.`);
      }
      summary += summarize(listed, previous);
      console.log(`ok ${id} ${listed.version} matches ${listed.source.repo} at ${listed.source.commit.slice(0, 7)}`);
    } catch (error) {
      fail(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const id of removed) summary += `### ${id} removed from the list\n\n`;
  if (summaryFile && summary) fs.appendFileSync(summaryFile, summary);
  if (!changed.length && !removed.length) console.log("No entry changed.");
}

function check() {
  const problems = catalogProblems(readCatalog());
  for (const problem of problems) fail(problem);
  if (!problems.length) console.log(`OK ${readCatalog().addons.length} addon(s) on the list`);
}

try {
  if (command === "add") await add();
  else if (command === "verify") await verify();
  else if (command === "check") check();
  else {
    console.error("Usage: addon-catalog.mjs add <github link> [--category c] | verify [--changed ref] [--out-dir dir] [--summary file] | check");
    process.exitCode = 2;
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
