// Addons end to end, with the example addon as the program under test:
// installing a package from a zip (and refusing a hostile or mismatched
// one), switching it on, its setup and the asset library it fills, starting
// it over MCP, running its workshop importer through an upload and its map
// generator into a library, setup downloads (some chosen by a setting),
// required settings, installing and updating from a GitHub link (GitHub's
// answers stubbed) and refusing to replace a different copy unasked,
// conflicting addons, shared resources taken in turn, pictures in a sampling
// request, the environment it is started with, a development folder, and
// removal.
//
// Points SQLITE_DB_PATH, ADDONS_DIR and the working directory (where
// public/uploads lives) at a scratch folder.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = path.join(repo, "examples", "addons", "hello-dungeon");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-addons-run-"));
const devDir = path.join(dir, "dev-addon");
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ADDONS_DIR = path.join(dir, "addons");
process.env.ODM_ADDON_DEV_DIRS = devDir;
// A provider key the server holds: it must never reach an addon.
process.env.OPENAI_COMPAT_API_KEY = "sk-test-never-leaves-the-server";
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { installAddonArchive, removeAddon } = await import("../src/lib/addons/install.ts");
const { listInstalledAddons, readyAddon } = await import("../src/lib/addons/installed.ts");
const { setAddonState, addonState } = await import("../src/lib/addons/store.ts");
const { probeAddon, callAddonTool, stopAddon, readAddonLog } = await import("../src/lib/addons/runtime.ts");
const { beginUpload, appendChunk } = await import("../src/lib/addons/uploads.ts");
const { startImport, importedBundleText } = await import("../src/lib/addons/run-importer.ts");
const { startMapGeneration } = await import("../src/lib/addons/run-map.ts");
const { getTask } = await import("../src/lib/addons/tasks.ts");
const { offeredContributions } = await import("../src/lib/addons/offered.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { getPreparedMap, copyPreparedMaps, listPreparedMaps } = await import("../src/lib/db/prepared-maps.ts");
const { mayReadMedia } = await import("../src/lib/media-access.ts");
const { toolPayload } = await import("../src/lib/addons/contracts.ts");
const { startSetup, settingsEdit } = await import("../src/lib/addons/setup.ts");
const { archiveContentHash } = await import("../src/lib/addons/archive.ts");
const { catalogEntry } = await import("../src/lib/addons/catalog-entry.ts");
const { conflictsWith, findInstalledAddon } = await import("../src/lib/addons/installed.ts");
const { withExclusive } = await import("../src/lib/addons/resources.ts");
const { createTask, cancelTask, finishTask } = await import("../src/lib/addons/tasks.ts");
const { installFromGitHub, updateFromGitHub, installFromRegistry } = await import("../src/lib/addons/install.ts");
const { githubUpdate } = await import("../src/lib/addons/github.ts");
const { inlineBundleFiles } = await import("../src/lib/addons/run-importer.ts");
const { samplingMessages } = await import("../src/lib/addons/sampling.ts");
const { GET: getAsset } = await import("../src/app/api/addons/[addonId]/assets/[...path]/route.ts");

// GitHub and download hosts, answered here: `routes` maps an address to a
// Response, or null for anything this test does not expect.
const realFetch = globalThis.fetch;
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const answer = routes(url);
    if (answer) return answer;
    if (url.startsWith("https://")) return new Response("not stubbed", { status: 404 });
    return realFetch(input, init);
  };
  return calls;
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// A repository as GitHub serves it to the server: listed by the trees API
// and fetched file by file from raw.githubusercontent.com. `repos` maps
// "owner/repo" to { head: () => commit, files: () => { path: bytes } }.
function folderFiles(folder, prefix) {
  const files = {};
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(current, entry.name), `${rel}${entry.name}/`);
      else files[`${prefix}${rel}${entry.name}`] = fs.readFileSync(path.join(current, entry.name));
    }
  };
  walk(folder, "");
  return files;
}

function gitBlobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function githubAnswers(repos) {
  const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  return (url) => {
    let match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/commits\/([^/?]+)$/.exec(url);
    if (match && repos[match[1]]) return json({ sha: repos[match[1]].head() });
    match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/git\/trees\/([0-9a-f]{40})\?recursive=1$/.exec(url);
    if (match && repos[match[1]]) {
      const files = repos[match[1]].files();
      return json({
        truncated: false,
        tree: Object.entries(files).map(([file, bytes]) => ({ path: file, mode: "100644", type: "blob", sha: gitBlobSha(bytes), size: bytes.length })),
      });
    }
    match = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([0-9a-f]{40})\/(.+)$/.exec(url);
    if (match && repos[match[1]]) {
      const bytes = (repos[match[1]].served ?? repos[match[1]].files)()[match[3].split("/").map(decodeURIComponent).join("/")];
      return bytes ? new Response(bytes) : null;
    }
    return null;
  };
}

async function zipFolder(folder, prefix = "hello-dungeon/") {
  const zip = new JSZip();
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, `${rel}${entry.name}/`);
      else zip.file(`${prefix}${rel}${entry.name}`, fs.readFileSync(full));
    }
  };
  walk(folder, "");
  return zip;
}

async function settle(task, limitMs = 30_000) {
  const started = Date.now();
  while (getTask(task.id)?.status === "running") {
    if (Date.now() - started > limitMs) throw new Error(`task ${task.id} did not finish: ${JSON.stringify(getTask(task.id)?.progress)}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return getTask(task.id);
}

try {
  const owner = createUser("addon-dm", "hash");
  const workshop = createWorkshop(owner.id, { title: "Addon prep", description: "", targetParty: { size: 4, level: 3 } });
  const other = createUser("stranger", "hash");

  await test("a hostile archive is refused before anything lands", async () => {
    const zip = await zipFolder(example);
    zip.file("hello-dungeon/../escape.txt", "nope");
    const outcome = await installAddonArchive(await zip.generateAsync({ type: "nodebuffer" }), "file");
    // jszip folds the ".." into the name, so the entry no longer sits in the
    // package's folder; refused either way (safeEntryPath has its own checks
    // in test-addons-core.mjs).
    assert.equal(outcome.ok, false);
    const linked = await zipFolder(example);
    linked.file("hello-dungeon/ui/link", "/etc/passwd", { unixPermissions: 0o120777, platform: "UNIX" });
    const second = await installAddonArchive(await linked.generateAsync({ type: "nodebuffer", platform: "UNIX" }), "file");
    assert.equal(second.ok, false);
    assert.match(second.error, /is a link/);
    assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "packages", "hello-dungeon")), false);
  });

  await test("an addon on the list comes from its author's repository at the audited commit, file by file, checked", async () => {
    const commit = "5e".repeat(20);
    const files = { ...folderFiles(example, "addons/hello/"), "README.md": Buffer.from("the rest of the author's repository") };
    // The hash the list holds, computed here from a zip of the same folder:
    // the server's file-by-file hash must agree with it.
    const content = await archiveContentHash(await (await zipFolder(example, "hello/")).generateAsync({ type: "nodebuffer" }));
    const manifest = JSON.parse(fs.readFileSync(path.join(example, "addon.json"), "utf8"));
    const { addonManifestSchema } = await import("../src/lib/addons/manifest.ts");
    const entry = catalogEntry(
      addonManifestSchema.parse(manifest),
      { repo: "someone/odm-tools", path: "addons/hello", commit, tag: "" },
      { contentSha256: content.sha256, bytes: content.bytes },
      "tools",
    );
    const repos = { "someone/odm-tools": { head: () => commit, files: () => files } };
    const calls = stubFetch(githubAnswers(repos));
    try {
      const tampered = await installFromRegistry({ ...entry, contentSha256: "0".repeat(64) });
      assert.equal(tampered.ok, false);
      assert.match(tampered.error, /do not match the ones that were audited/);
      assert.equal(addonState("hello-dungeon"), null, "nothing was installed");
      const misnamed = await installFromRegistry({ ...entry, id: "other-addon" });
      assert.match(misnamed.error, /list has other-addon/);
      // A file served differently from what the commit records is refused.
      repos["someone/odm-tools"].served = () => ({ ...files, "addons/hello/server/main.mjs": Buffer.from("// not what was audited") });
      const swapped = await installFromRegistry(entry);
      assert.equal(swapped.ok, false);
      assert.match(swapped.error, /does not match the commit/);
      delete repos["someone/odm-tools"].served;
      const installed = await installFromRegistry(entry);
      assert.equal(installed.ok, true, installed.error);
      assert.ok(calls.filter((url) => url.includes("raw.githubusercontent.com")).every((url) => url.includes(`/${commit}/addons/hello/`)), "only the addon's folder, at the audited commit");
      assert.equal(calls.some((url) => url.includes("README.md") || url.includes("/zip")), false, "no archive, nothing outside the folder");
      assert.equal(addonState("hello-dungeon").source, "registry");
      assert.equal(addonState("hello-dungeon").sha256, content.sha256);
      assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "packages", "hello-dungeon", "server", "main.mjs")), true);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal((await removeAddon("hello-dungeon")).ok, true);
  });

  await test("the catalog tool writes an entry from a repository and the pull request check holds it to the commit", async () => {
    if (spawnSync("git", ["--version"]).status !== 0) {
      console.log("  (git is not installed here; skipped)");
      return;
    }
    const clone = path.join(dir, "author-repo");
    fs.mkdirSync(path.join(clone, "addons"), { recursive: true });
    fs.cpSync(example, path.join(clone, "addons", "hello"), { recursive: true });
    const git = (...args) => spawnSync("git", ["-C", clone, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" });
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("commit", "-qm", "an addon");
    const catalogFile = path.join(dir, "catalog-under-test.json");
    const tool = (...args) =>
      spawnSync(process.execPath, [path.join(repo, "scripts", "addon-catalog.mjs"), ...args, "--catalog", catalogFile, "--local", `someone/odm-tools=${clone}`], {
        encoding: "utf8",
      });
    const added = tool("add", "https://github.com/someone/odm-tools/tree/main/addons/hello", "--category", "maps");
    assert.equal(added.status, 0, added.stderr);
    const written = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
    assert.equal(written.addons[0].id, "hello-dungeon");
    assert.equal(written.addons[0].category, "maps");
    assert.match(written.addons[0].source.commit, /^[a-f0-9]{40}$/, "a branch is pinned to its commit");
    assert.equal(tool("verify").status, 0);
    // An entry edited by hand (a nicer description, a hash from elsewhere) fails the check.
    fs.writeFileSync(catalogFile, JSON.stringify({ ...written, addons: [{ ...written.addons[0], description: "Trust me." }] }, null, 2));
    const edited = tool("verify");
    assert.equal(edited.status, 1);
    assert.match(edited.stderr, /does not match .* \(description\)/);
  });

  await test("installing from a zip (one top folder) lands it switched off", async () => {
    const bytes = await (await zipFolder(example)).generateAsync({ type: "nodebuffer" });
    const outcome = await installAddonArchive(bytes, "file");
    assert.equal(outcome.ok, true, outcome.error);
    assert.deepEqual(outcome.newPermissions, ["ai.text"]);
    const addon = listInstalledAddons().find((entry) => entry.id === "hello-dungeon");
    assert.equal(addon.status, "disabled");
    assert.equal(readyAddon("hello-dungeon").ok, false);
    assert.equal(offeredContributions().workshopImporters.length, 0, "nothing is offered while it is off");
  });

  await test("switched on, it waits for its setup; the setup fills its asset library and then it starts", async () => {
    setAddonState("hello-dungeon", { enabled: true, granted: ["ai.text"] });
    assert.equal(listInstalledAddons().find((entry) => entry.id === "hello-dungeon").status, "needs-setup");
    assert.equal(readyAddon("hello-dungeon").ok, false);
    assert.equal(offeredContributions().boardViews.length, 0, "nothing is offered before its setup");
    const started = await startSetup("hello-dungeon", owner);
    assert.equal(started.ok, true, started.error);
    const task = await settle(started.task);
    assert.equal(task.status, "done", task.error);
    assert.equal(addonState("hello-dungeon").setupVersion, "1.2.0");
    assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "data", "hello-dungeon", "public", "flagstone.png")), true);
    assert.ok(readAddonLog("hello-dungeon").some((line) => line.includes("[setup] finished")));
    assert.equal(readyAddon("hello-dungeon").ok, true);
    const probe = await probeAddon("hello-dungeon");
    assert.equal(probe.ok, true, probe.error);
    assert.deepEqual(probe.tools.sort(), ["generate_cavern", "import_statblocks", "odm_setup"]);
    const offered = offeredContributions();
    assert.equal(offered.workshopImporters[0].id, "statblocks");
    assert.match(offered.boardViews[0].url, /^\/api\/addons\/hello-dungeon\/ui\/board\.html\?v=1\.2\.0$/);
    assert.deepEqual(offered.boardViews[0].options.map((field) => field.key), ["outlines", "walls"]);
  });

  await test("the asset library is served by name, sandboxed, and nothing outside it", async () => {
    const ask = (addonId, segments) => getAsset(new Request("http://host/"), { params: Promise.resolve({ addonId, path: segments }) });
    const served = await ask("hello-dungeon", ["flagstone.png"]);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal(served.headers.get("access-control-allow-origin"), "*");
    assert.match(served.headers.get("content-security-policy"), /sandbox allow-scripts/);
    assert.equal((await ask("hello-dungeon", ["..", "..", "packages", "hello-dungeon", "addon.json"])).status, 404);
    assert.equal((await ask("hello-dungeon", ["%2e%2e", "addon.json"])).status, 404);
    assert.equal((await ask("hello-dungeon", [".setup", "x.sha256"])).status, 404);
    assert.equal((await ask("hello-dungeon", ["flagstone.exe"])).status, 404);
    assert.equal((await ask("no-such-addon", ["flagstone.png"])).status, 404);
  });

  await test("the workshop importer reads an upload into a bundle that passes the bundle reader", async () => {
    const sample = fs.readFileSync(path.join(example, "sample", "bestiary.txt"));
    const upload = await beginUpload({ userId: owner.id, name: "Bog Bestiary.txt", mime: "text/plain", size: sample.length });
    assert.equal((await appendChunk(upload, 5, sample)).ok, false, "a piece at the wrong offset is refused");
    const half = Math.floor(sample.length / 2);
    assert.equal((await appendChunk(upload, 0, sample.subarray(0, half))).ok, true);
    assert.equal((await appendChunk(upload, half, sample.subarray(half))).ok, true);
    const started = await startImport({ user: owner, addonId: "hello-dungeon", importerId: "statblocks", upload, options: { blurb: true } });
    assert.equal(started.ok, true, started.error);
    const task = await settle(started.task);
    assert.equal(task.status, "done", task.error);
    assert.deepEqual(task.result.counts.monsters, 2);
    assert.equal(task.result.counts.lore, 1);
    // No model is configured here, so the blurb's sampling request comes back
    // refused and the importer says so instead of failing.
    assert.equal(task.notes.length, 1);
    assert.match(task.notes[0], /blurb was not written/);
    const read = readBundle(await importedBundleText(task));
    assert.equal(read.bundle.manifest.name, "Bog Bestiary");
    const hag = read.bundle.monsters.find((monster) => monster.name === "Bog Hag");
    assert.equal(hag.stats.ac, 15);
    assert.equal(hag.stats.attacks[0].damage, "2d6+3");
  });

  await test("an importer's file: pictures are read from outputDir into the bundle", async () => {
    const out = path.join(dir, "importer-out");
    fs.mkdirSync(path.join(out, "art"), { recursive: true });
    fs.writeFileSync(path.join(out, "art", "hag.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    fs.writeFileSync(path.join(out, "cave.glb"), Buffer.from("glTF...."));
    fs.writeFileSync(path.join(out, "notes.txt"), "plain");
    const inlined = await inlineBundleFiles(
      {
        monsters: [{ name: "Bog Hag", portrait: "file:art/hag.png", description: "file: not a picture field" }],
        maps: [{ name: "Cave", addonView: { addonId: "x", files: [{ name: "cave.glb", data: "file:cave.glb" }] } }],
      },
      out,
    );
    assert.match(inlined.monsters[0].portrait, /^data:image\/png;base64,/);
    assert.equal(inlined.monsters[0].description, "file: not a picture field");
    assert.match(inlined.maps[0].addonView.files[0].data, /^data:model\/gltf-binary;base64,/);
    await assert.rejects(inlineBundleFiles({ image: "file:../outside.png" }, out), /outside outputDir/);
    await assert.rejects(inlineBundleFiles({ image: "file:notes.txt" }, out), /not a PNG, JPEG or WebP/);
    await assert.rejects(inlineBundleFiles({ image: "file:missing.png" }, out), /did not write/);
    // A board view's file is held to its bytes too: the import would drop a
    // bad one without a word (issue 414).
    fs.writeFileSync(path.join(out, "fake.glb"), Buffer.from("<html>not a model</html>"));
    fs.writeFileSync(path.join(out, "fake.png"), Buffer.from("GIF89a"));
    const viewOf = (file) => ({ maps: [{ name: "Cave", addonView: { addonId: "x", files: [{ name: file, data: `file:${file}` }] } }] });
    await assert.rejects(inlineBundleFiles(viewOf("fake.glb"), out), /fake\.glb is not a binary glTF file/);
    await assert.rejects(inlineBundleFiles(viewOf("fake.png"), out), /fake\.png is not a PNG, JPEG or WebP picture/);
    fs.writeFileSync(path.join(out, "tex.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
    const picture = await inlineBundleFiles(viewOf("tex.png"), out);
    assert.match(picture.maps[0].addonView.files[0].data, /^data:image\/png;base64,/);
  });

  await test("an upload of the wrong kind is refused before a run starts", async () => {
    const upload = await beginUpload({ userId: owner.id, name: "book.pdf", mime: "application/pdf", size: 4 });
    await appendChunk(upload, 0, Buffer.from("%PDF"));
    const started = await startImport({ user: owner, addonId: "hello-dungeon", importerId: "statblocks", upload, options: {} });
    assert.equal(started.ok, false);
    assert.match(started.error, /reads \.txt/);
  });

  await test("the map generator adds a map with its picture and model to the library", async () => {
    const started = await startMapGeneration({
      user: owner,
      campaign: workshop,
      addonId: "hello-dungeon",
      generatorId: "cavern",
      request: { name: "Echo Cave", width: 16, height: 12, theme: "cave", ambient: "dim", summary: "a wet cave", seed: 42 },
      options: { openness: 60 },
    });
    assert.equal(started.ok, true, started.error);
    const task = await settle(started.task);
    assert.equal(task.status, "done", task.error);
    const map = getPreparedMap(workshop.id, task.result.preparedMapId);
    assert.equal(map.name, "Echo Cave");
    assert.equal(map.terrain.length, 16 * 12);
    assert.match(map.backdrop.path, /^\/uploads\/[0-9a-f-]+\.png$/);
    assert.equal(map.addonView.addonId, "hello-dungeon");
    const model = map.addonView.files[0];
    assert.match(model.path, /^\/uploads\/[0-9a-f-]+\.glb$/);
    assert.equal(fs.readFileSync(path.join(dir, "public", model.path)).subarray(0, 4).toString(), "glTF");
    assert.equal(map.addonView.data.heights.length, 16 * 12);
    // The workshop's owner may open the model; a stranger may not.
    assert.equal(mayReadMedia(owner, model.path), true);
    assert.equal(mayReadMedia(other, model.path), false);
  });

  await test("a map's view travels with the library into another campaign", async () => {
    const target = createWorkshop(owner.id, { title: "Second", description: "", targetParty: { size: 4, level: 3 } });
    assert.equal(copyPreparedMaps(workshop.id, target.id), 1);
    const copy = listPreparedMaps(target.id)[0];
    assert.equal(copy.addonView.addonId, "hello-dungeon");
    assert.equal(copy.addonView.files[0].name, "cavern.glb");
  });

  await test("a workshop bundle carries a map's model, and the import lands it under a fresh name", async () => {
    const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
    const { workshopBundleSchema } = await import("../src/lib/workshop/bundle.ts");
    const exported = exportWorkshopBundle(workshop.id, { name: "Addon prep", blurb: "Caves.", inspiredBy: "Our own" });
    assert.equal(exported.error, undefined, exported.error);
    const outgoing = exported.bundle.maps.find((map) => map.name === "Echo Cave");
    assert.match(outgoing.addonView.files[0].data, /^data:model\/gltf-binary;base64,/);
    const original = listPreparedMaps(workshop.id).find((map) => map.name === "Echo Cave").addonView.files[0].path;
    const incoming = workshopBundleSchema.parse(JSON.parse(JSON.stringify(exported.bundle)));
    const imported = importWorkshopBundle(owner.id, incoming);
    assert.equal(imported.error, undefined, imported.error);
    const landed = listPreparedMaps(imported.workshopId).find((map) => map.name === "Echo Cave");
    const model = landed.addonView.files[0];
    assert.notEqual(model.path, original);
    assert.equal(fs.readFileSync(path.join(dir, "public", model.path)).subarray(0, 4).toString(), "glTF");
    assert.equal(landed.addonView.data.heights.length, 16 * 12);
    // A forged file in a bundle is dropped rather than written.
    const forged = workshopBundleSchema.parse({
      ...JSON.parse(JSON.stringify(exported.bundle)),
      maps: [{ ...outgoing, addonView: { addonId: "hello-dungeon", files: [{ name: "x.glb", type: "", data: "data:model/gltf-binary;base64," + Buffer.from("<html>").toString("base64") }] } }],
    });
    const second = importWorkshopBundle(owner.id, forged);
    assert.deepEqual(listPreparedMaps(second.workshopId)[0].addonView.files, []);
  });

  await test("a generator that returns broken terrain fails with the contract's words", async () => {
    // Called directly, as the run would, with a size the cave cannot fill.
    const raw = await callAddonTool(
      "hello-dungeon",
      "generate_cavern",
      { request: { name: "x", width: 2, height: 2, theme: "cave", ambient: "dim", summary: "", seed: 1 }, outputDir: dir, options: {} },
      { sampling: { scope: {} } },
    );
    const payload = toolPayload(raw);
    assert.equal(payload.ok, true);
    const { mapResultSchema } = await import("../src/lib/addons/contracts.ts");
    assert.equal(mapResultSchema.safeParse(payload.value).success, false, "a 2 by 2 map is under the minimum side");
  });

  await test("setup downloads are checked by size and checksum, kept, and fetched once", async () => {
    const { createHash } = await import("node:crypto");
    const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const packZip = new JSZip();
    packZip.file("inner/model.txt", "weights");
    const pack = await packZip.generateAsync({ type: "nodebuffer" });
    const note = Buffer.from("a note for the board view");
    const probeDir = path.join(dir, "setup-probe");
    fs.mkdirSync(path.join(probeDir, "server"), { recursive: true });
    fs.copyFileSync(path.join(example, "server", "mcp.mjs"), path.join(probeDir, "server", "mcp.mjs"));
    fs.writeFileSync(
      path.join(probeDir, "server", "main.mjs"),
      `import { createServer } from "./mcp.mjs";
const server = createServer({ name: "setup-probe", version: "1.0.0" });
server.tool("generate", "unused", { type: "object" }, () => ({}));
server.listen();
`,
    );
    fs.writeFileSync(
      path.join(probeDir, "addon.json"),
      JSON.stringify({
        id: "setup-probe",
        name: "Setup probe",
        version: "1.0.0",
        apiVersion: 1,
        description: "Downloads things at setup.",
        author: "tests",
        license: "MIT",
        runtime: { kind: "node", entry: "server/main.mjs" },
        settings: [
          { key: "token", label: "Service token", type: "secret", required: true },
          { key: "quality", label: "Quality", type: "select", default: "low", choices: [{ value: "low", label: "Low" }, { value: "high", label: "High" }] },
        ],
        setup: {
          downloads: [
            { id: "hires", url: "https://downloads.test/hires.bin", sha256: sha(note), bytes: note.length, to: "hires.bin", when: { setting: "quality", equals: "high" } },
            { id: "pack", url: "https://downloads.test/pack.zip", sha256: sha(pack), bytes: pack.length, unpack: "zip", to: "pack" },
            { id: "note", url: "https://downloads.test/note.txt", sha256: sha(note), bytes: note.length, to: "public/note.txt" },
            { id: "elsewhere", url: "https://downloads.test/other.bin", sha256: "f".repeat(64), bytes: 9, platforms: ["win32-arm64", "darwin-arm64"], to: "other.bin" },
          ],
        },
        contributes: { mapGenerators: [{ id: "probe", title: "Probe", tool: "generate" }] },
      }),
    );
    const installed = await installAddonArchive(await (await zipFolder(probeDir, "setup-probe/")).generateAsync({ type: "nodebuffer" }), "file");
    assert.equal(installed.ok, true, installed.error);
    setAddonState("setup-probe", { enabled: true, granted: [] });
    // A required setting comes first: no setup without it.
    assert.equal(findInstalledAddon("setup-probe").status, "needs-settings");
    assert.match(findInstalledAddon("setup-probe").problem, /Service token/);
    const refused = await startSetup("setup-probe", owner);
    assert.equal(refused.ok, false);
    const filled = settingsEdit(findInstalledAddon("setup-probe"), { token: "abc" });
    assert.equal(filled.ok, true);
    setAddonState("setup-probe", filled.patch);
    assert.equal(findInstalledAddon("setup-probe").status, "needs-setup");
    let served = note;
    const calls = stubFetch((url) =>
      url === "https://downloads.test/pack.zip"
        ? new Response(pack)
        : url === "https://downloads.test/note.txt" || url === "https://downloads.test/hires.bin"
          ? new Response(served)
          : null,
    );
    try {
      const first = await settle((await startSetup("setup-probe", owner)).task);
      assert.equal(first.status, "done", first.error);
      const data = path.join(process.env.ADDONS_DIR, "data", "setup-probe");
      assert.equal(fs.readFileSync(path.join(data, "pack", "inner", "model.txt"), "utf8"), "weights");
      assert.equal(fs.readFileSync(path.join(data, "public", "note.txt"), "utf8"), "a note for the board view");
      assert.equal(calls.some((url) => url.includes("other.bin")), false, "a download for another platform is skipped");
      assert.equal(calls.some((url) => url.includes("hires.bin")), false, "a download for a quality not chosen is skipped");
      // Choosing the high tier makes the setup due again, and fetches it.
      const higher = settingsEdit(findInstalledAddon("setup-probe"), { quality: "high" });
      assert.equal(higher.ok, true);
      assert.equal(higher.patch.setupVersion, "");
      setAddonState("setup-probe", higher.patch);
      assert.equal(findInstalledAddon("setup-probe").status, "needs-setup");
      const second = await settle((await startSetup("setup-probe", owner)).task);
      assert.equal(second.status, "done", second.error);
      assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "data", "setup-probe", "hires.bin")), true);
      const unrelated = settingsEdit(findInstalledAddon("setup-probe"), { token: "new" });
      assert.equal(unrelated.patch.setupVersion, undefined, "a setting setup does not read leaves it done");
      const fetched = calls.length;
      const again = await settle((await startSetup("setup-probe", owner)).task);
      assert.equal(again.status, "done", again.error);
      assert.equal(calls.length, fetched, "what is already here with the right checksum is not fetched again");
      // A host that changed the file under the same address: refused, and
      // the copy already here is kept.
      fs.rmSync(path.join(data, ".setup", "note.sha256"));
      served = Buffer.from("a note for the board viex");
      const tampered = await settle((await startSetup("setup-probe", owner)).task);
      assert.equal(tampered.status, "failed");
      assert.match(tampered.error, /checksum/);
      assert.match(addonState("setup-probe").setupError, /checksum/);
      assert.equal(fs.readFileSync(path.join(data, "public", "note.txt"), "utf8"), "a note for the board view");
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal((await removeAddon("setup-probe")).ok, true);
  });

  await test("a GitHub link installs the folder it names, and an update follows its branch", async () => {
    const shaA = "a1".repeat(20);
    const shaB = "b2".repeat(20);
    const repoFiles = (id) => {
      const files = { ...folderFiles(example, "addons/hello-dungeon/"), "README.md": Buffer.from("the rest of the repository") };
      if (id) {
        const manifest = JSON.parse(fs.readFileSync(path.join(example, "addon.json"), "utf8"));
        files["addons/hello-dungeon/addon.json"] = Buffer.from(JSON.stringify({ ...manifest, id }));
      }
      return files;
    };
    let head = shaA;
    let held = repoFiles();
    const repo = { head: () => head, files: () => held };
    const calls = stubFetch(githubAnswers({ "someone/tools": repo, "someone/other-fork": repo }));
    try {
      globalThis.__odmGitHubChecks = undefined;
      // The copy here came from a file: a GitHub copy of the same id is a
      // different source, and waits for the admin to say to replace it.
      const asked = await installFromGitHub("https://github.com/someone/tools/tree/main/addons/hello-dungeon");
      assert.equal(asked.ok, false);
      assert.equal(asked.status, 409);
      assert.deepEqual(asked.replaces, { id: "hello-dungeon", name: "Hello Dungeon", from: "a file" });
      assert.equal(addonState("hello-dungeon").source, "file", "nothing changed");
      const outcome = await installFromGitHub("https://github.com/someone/tools/tree/main/addons/hello-dungeon", { replace: true });
      assert.equal(outcome.ok, true, outcome.error);
      assert.equal(addonState("hello-dungeon").enabled, false, "a replacement starts switched off");
      assert.deepEqual(addonState("hello-dungeon").granted, [], "and asks for its permissions again");
      assert.equal(addonState("hello-dungeon").settings.wallStyle, undefined);
      setAddonState("hello-dungeon", { enabled: true, granted: ["ai.text"] });
      assert.equal(outcome.label, `main at ${shaA.slice(0, 7)}`);
      const state = addonState("hello-dungeon");
      assert.equal(state.source, "github");
      assert.deepEqual(state.github, { repo: "someone/tools", path: "addons/hello-dungeon", ref: "main", tag: "", commit: shaA });
      assert.equal((await installFromGitHub("https://github.com/someone/other-fork/tree/main/addons/hello-dungeon")).status, 409, "a fork elsewhere asks too");
      assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "packages", "hello-dungeon", "README.md")), false, "only the folder it names");
      assert.ok(calls.some((url) => url.includes(`/${shaA}/addons/hello-dungeon/addon.json`)), "the exact commit, file by file");
      // The same files as the copy it replaced (a zip and a repository are
      // hashed by their files alike): its setup still holds.
      assert.equal(listInstalledAddons().find((entry) => entry.id === "hello-dungeon").status, "ready");
      assert.equal(await githubUpdate(state.github), "", "nothing newer yet");
      head = shaB;
      globalThis.__odmGitHubChecks = undefined;
      assert.equal(await githubUpdate(state.github), `main at ${shaB.slice(0, 7)}`);
      // The branch now holds something else under that folder: refused.
      held = repoFiles("other-thing");
      const refused = await updateFromGitHub("hello-dungeon");
      assert.equal(refused.ok, false);
      assert.match(refused.error, /now holds other-thing/);
      assert.equal(addonState("hello-dungeon").github.commit, shaA, "a refused update changes nothing");
      held = repoFiles();
      const updated = await updateFromGitHub("hello-dungeon");
      assert.equal(updated.ok, true, updated.error);
      assert.equal(addonState("hello-dungeon").github.commit, shaB);
      assert.equal(readyAddon("hello-dungeon").ok, true, "the same files keep their setup");
      assert.equal((await installFromGitHub("https://gitlab.com/a/b")).ok, false);
    } finally {
      globalThis.fetch = realFetch;
      globalThis.__odmGitHubChecks = undefined;
    }
  });

  await test("addons that conflict never run together, whichever of them says so", async () => {
    const make = async (id, extra) => {
      const folder = path.join(dir, id);
      fs.mkdirSync(path.join(folder, "server"), { recursive: true });
      fs.copyFileSync(path.join(example, "server", "mcp.mjs"), path.join(folder, "server", "mcp.mjs"));
      fs.writeFileSync(
        path.join(folder, "server", "main.mjs"),
        `import { createServer } from "./mcp.mjs";\nconst server = createServer({ name: "${id}", version: "1.0.0" });\nserver.tool("generate", "unused", { type: "object" }, () => ({}));\nserver.listen();\n`,
      );
      fs.writeFileSync(
        path.join(folder, "addon.json"),
        JSON.stringify({
          id,
          name: id.replace(/-/g, " "),
          version: "1.0.0",
          apiVersion: 1,
          description: "A test addon.",
          author: "tests",
          license: "MIT",
          runtime: { kind: "node", entry: "server/main.mjs" },
          contributes: { mapGenerators: [{ id: "probe", title: "Probe", tool: "generate" }] },
          ...extra,
        }),
      );
      const installed = await installAddonArchive(await (await zipFolder(folder, `${id}/`)).generateAsync({ type: "nodebuffer" }), "file");
      assert.equal(installed.ok, true, installed.error);
    };
    await make("board-alpha", {});
    await make("board-beta", { conflicts: [{ id: "board-alpha", reason: "Both draw the board in 3D." }] });
    setAddonState("board-alpha", { enabled: true, granted: [] });
    // Switching beta on is what the admin route refuses with this list.
    assert.deepEqual(conflictsWith(findInstalledAddon("board-beta"), listInstalledAddons()), [
      { id: "board-alpha", name: "board alpha", reason: "Both draw the board in 3D." },
    ]);
    // Alpha never declared it, and is held to it all the same.
    setAddonState("board-beta", { enabled: true, granted: [] });
    assert.equal(findInstalledAddon("board-alpha").status, "conflict");
    assert.equal(findInstalledAddon("board-beta").status, "conflict");
    assert.equal(readyAddon("board-alpha").ok, false);
    assert.equal(offeredContributions().mapGenerators.some((entry) => entry.addonId.startsWith("board-")), false);
    setAddonState("board-alpha", { enabled: false });
    assert.equal(findInstalledAddon("board-beta").status, "ready");
    assert.equal((await removeAddon("board-alpha")).ok, true);
    assert.equal((await removeAddon("board-beta")).ok, true);
  });

  await test("runs that need the same resource take turns, and a waiting run can be stopped", async () => {
    const newTask = async (addonName) => {
      const created = await createTask({ kind: "map", addonId: addonName.toLowerCase(), addonName, contributionId: "x", title: "t", userId: `user-${addonName}`, campaignId: "" });
      assert.equal(created.ok, true, created.error);
      return created.task;
    };
    const first = await newTask("Blender maps");
    const second = await newTask("Pdf reader");
    const third = await newTask("Pixel board");
    const order = [];
    let releaseFirst;
    const held = withExclusive(["gpu"], first, () => new Promise((resolve) => (releaseFirst = () => resolve(order.push("first")))));
    const queued = withExclusive(["gpu", "blender"], second, async () => order.push("second"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(order, [], "the second waits while the first holds the gpu");
    assert.equal(second.progress.message, "Waiting for Blender maps, which is using the gpu");
    const stopped = withExclusive(["gpu"], third, async () => order.push("third"));
    cancelTask(third);
    await assert.rejects(stopped, /Cancelled/);
    releaseFirst();
    await held;
    await queued;
    assert.deepEqual(order, ["first", "second"]);
    // Nothing named, nothing waited for.
    assert.equal(await withExclusive([], third, async () => "ran"), "ran");
    for (const task of [first, second, third]) finishTask(task, { result: {} });
  });

  await test("a sampling request carries pictures, and refuses audio and oversized sets", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    const [message] = samplingMessages({
      messages: [{ role: "user", content: [{ type: "text", text: "What creature is on this page?" }, { type: "image", mimeType: "image/png", data: png }] }],
    });
    assert.equal(message.content[0].text, "What creature is on this page?");
    assert.equal(message.content[1].image_url.url, `data:image/png;base64,${png}`);
    const ask = (content, role = "user") => () => samplingMessages({ messages: [{ role, content }] });
    assert.throws(ask([{ type: "audio", data: png, mimeType: "audio/wav" }]), /text and pictures/);
    assert.throws(ask([{ type: "image", data: png, mimeType: "image/gif" }]), /PNG, JPEG or WebP/);
    assert.throws(ask([{ type: "image", data: "not base64!", mimeType: "image/png" }]), /base64/);
    assert.throws(ask([{ type: "image", data: png, mimeType: "image/png" }], "assistant"), /user's messages/);
    assert.throws(ask(Array.from({ length: 9 }, () => ({ type: "image", data: png, mimeType: "image/png" }))), /8 pictures/);
  });

  await test("a development folder is listed live, and its environment holds none of the server's keys", async () => {
    fs.mkdirSync(path.join(devDir, "server"), { recursive: true });
    fs.copyFileSync(path.join(example, "server", "mcp.mjs"), path.join(devDir, "server", "mcp.mjs"));
    fs.writeFileSync(
      path.join(devDir, "server", "main.mjs"),
      `import { createServer } from "./mcp.mjs";
const server = createServer({ name: "env-probe", version: "0.0.1" });
server.tool("env", "List the environment's names", { type: "object" }, () => ({ names: Object.keys(process.env), settings: process.env.ODM_ADDON_SETTINGS }));
server.tool("generate", "unused", { type: "object" }, () => ({}));
server.listen();
`,
    );
    fs.writeFileSync(
      path.join(devDir, "addon.json"),
      JSON.stringify({
        id: "env-probe",
        name: "Env probe",
        version: "0.0.1",
        apiVersion: 1,
        description: "Lists its environment.",
        author: "tests",
        license: "MIT",
        runtime: { kind: "node", entry: "server/main.mjs" },
        settings: [{ key: "token", label: "Token", type: "secret" }],
        contributes: { mapGenerators: [{ id: "probe", title: "Probe", tool: "generate" }] },
      }),
    );
    const listed = listInstalledAddons().find((entry) => entry.id === "env-probe");
    assert.equal(listed.source, "dev");
    assert.equal(listed.status, "disabled");
    setAddonState("env-probe", { source: "dev", enabled: true, granted: [], settings: { token: "abc" } });
    const raw = await callAddonTool("env-probe", "env", {}, { sampling: { scope: {} } });
    const { names, settings } = toolPayload(raw).value;
    for (const secret of ["DB_ENCRYPTION_KEY", "OPENAI_COMPAT_API_KEY", "SQLITE_DB_PATH", "ODM_ADDON_DEV_DIRS"]) {
      assert.equal(names.includes(secret), false, `${secret} reached the addon`);
    }
    for (const given of ["ODM_ADDON_ID", "ODM_ADDON_DIR", "ODM_ADDON_DATA_DIR", "ODM_ADDON_SETTINGS", "PATH"]) {
      assert.equal(names.includes(given), true, `${given} is missing`);
    }
    assert.deepEqual(JSON.parse(settings), { token: "abc" });
    await stopAddon("env-probe");
  });

  await test("removing an addon takes its package, its data folder and its state", async () => {
    await stopAddon("hello-dungeon");
    assert.ok(readAddonLog("hello-dungeon").some((line) => line.includes("ready")));
    const removed = await removeAddon("hello-dungeon");
    assert.equal(removed.ok, true);
    assert.equal(addonState("hello-dungeon"), null);
    assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "packages", "hello-dungeon")), false);
    assert.equal(fs.existsSync(path.join(process.env.ADDONS_DIR, "data", "hello-dungeon")), false);
  });
} finally {
  await stopAddon("hello-dungeon").catch(() => undefined);
  await stopAddon("env-probe").catch(() => undefined);
  process.chdir(repo);
  removeTempDir(dir);
}

console.log(`${passed} addon runtime checks passed`);
