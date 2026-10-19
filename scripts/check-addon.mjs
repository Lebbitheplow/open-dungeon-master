#!/usr/bin/env node
// Checks an addon the way this server will: its addon.json against the real
// manifest schema, the files the manifest names, and (with --run) that the
// program starts, speaks MCP, and offers every tool its contributions name.
//
//   node scripts/check-addon.mjs path/to/addon-folder [--run]
//   node scripts/check-addon.mjs path/to/addon.zip [--run]
//
// The addon catalog check (.github/workflows/addon-catalog.yml) runs this on
// every addon a pull request adds to the downloader list, and authors run it
// before submitting. Exits 1 on any problem.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const args = process.argv.slice(2);
const target = args.find((arg) => !arg.startsWith("--"));
const run = args.includes("--run");
if (!target) {
  console.error("Usage: node scripts/check-addon.mjs <addon folder or .zip> [--run]");
  process.exit(2);
}

const { addonManifestSchema, addonFit, CONTRIBUTION_KINDS, platformName } = await import("../src/lib/addons/manifest.ts");
const { readArchiveManifest, unpackArchive } = await import("../src/lib/addons/archive.ts");
const { resolveInside } = await import("../src/lib/addons/paths.ts");

const problems = [];
const notes = [];
let dir = path.resolve(target);
let scratch = "";

if (fs.statSync(dir).isFile()) {
  const bytes = fs.readFileSync(dir);
  const read = await readArchiveManifest(bytes);
  if (!read.ok) {
    console.error(`FAIL ${read.error}`);
    process.exit(1);
  }
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "odm-check-addon-"));
  const unpacked = await unpackArchive(bytes, path.join(scratch, "addon"));
  if (!unpacked.ok) {
    console.error(`FAIL ${unpacked.error}`);
    process.exit(1);
  }
  dir = path.join(scratch, "addon");
  notes.push(`archive: ${unpacked.files} files, ${Math.round(unpacked.bytes / 1024)} KB unpacked`);
}

let manifest = null;
try {
  const parsed = addonManifestSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, "addon.json"), "utf8")));
  if (parsed.success) manifest = parsed.data;
  else for (const issue of parsed.error.issues) problems.push(`addon.json ${issue.path.join(".") || "(root)"}: ${issue.message}`);
} catch (error) {
  problems.push(`addon.json: ${error instanceof Error ? error.message : error}`);
}

if (manifest) {
  const wanted = [];
  if (manifest.runtime.kind === "executable") wanted.push(...Object.values(manifest.runtime.executables));
  else wanted.push(manifest.runtime.entry);
  for (const view of manifest.contributes.boardViews) wanted.push(view.entry);
  if (manifest.setup?.python) wanted.push(manifest.setup.python.requirements);
  for (const relative of wanted) {
    const resolved = resolveInside(dir, relative);
    if (!resolved || !fs.existsSync(resolved)) problems.push(`${relative} is named in addon.json but is not in the package`);
  }
  for (const platform of ["linux", "win32", "darwin"]) {
    const fit = addonFit(manifest, { platform, arch: "x64", serverVersion: "999.0.0" });
    notes.push(`${platform}: ${fit.ok ? "runs" : fit.reason}`);
  }
}

// A program is started only where it says it runs: an addon for Windows
// alone is not failed on a Linux machine. The catalog audit starts it on a
// runner of every platform (.github/workflows/addon-catalog.yml).
const hostFit = manifest ? addonFit(manifest, { platform: process.platform, arch: process.arch, serverVersion: "999.0.0" }) : null;
const runHere = run && hostFit?.ok === true;
if (run && hostFit && !hostFit.ok) notes.push(`not started on ${platformName(process.platform)}: ${hostFit.reason}`);

if (manifest && runHere && !problems.length) {
  // A throwaway world: the addon runs as a development folder, switched on,
  // with nothing of a real server's around it.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "odm-check-run-"));
  process.env.SQLITE_DB_PATH = path.join(home, "check.sqlite");
  process.env.DB_ENCRYPTION_KEY = "0".repeat(64);
  process.env.ADDONS_DIR = path.join(home, "addons");
  process.env.ODM_ADDON_DEV_DIRS = dir;
  const { setAddonState } = await import("../src/lib/addons/store.ts");
  const { probeAddon, stopAddon, readAddonLog } = await import("../src/lib/addons/runtime.ts");
  // Its setup is not run here (it may download gigabytes); its setup tool,
  // when it has one, must be among the tools it offers.
  setAddonState(manifest.id, { source: "dev", enabled: true, granted: [...manifest.permissions], setupVersion: manifest.version });
  const probe = await probeAddon(manifest.id);
  if (!probe.ok) {
    problems.push(`it did not start: ${probe.error}`);
  } else {
    notes.push(`started as "${probe.server}", offering ${probe.tools.join(", ") || "no tools"}`);
    for (const kind of CONTRIBUTION_KINDS) {
      for (const entry of manifest.contributes[kind]) {
        if ("tool" in entry && !probe.tools.includes(entry.tool)) {
          problems.push(`${kind} "${entry.id}" names the tool ${entry.tool}, which the program does not offer`);
        }
      }
    }
    if (manifest.setup?.tool && !probe.tools.includes(manifest.setup.tool)) {
      problems.push(`setup names the tool ${manifest.setup.tool}, which the program does not offer`);
    }
  }
  await stopAddon(manifest.id);
  for (const line of readAddonLog(manifest.id)) notes.push(`log ${line}`);
  // Close the checker-owned SQLite handle before deleting its scratch world.
  const { closeDatabaseForRestore } = await import("../src/lib/db/core.ts");
  closeDatabaseForRestore();
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
for (const note of notes) console.log(`  ${note}`);
if (problems.length) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  process.exit(1);
}
console.log(`OK ${manifest.id} ${manifest.version}${runHere ? " (started and checked)" : run ? ` (not started on ${platformName(process.platform)})` : ""}`);
process.exit(0);
