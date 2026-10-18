// The addon contracts without a database or a running addon: the manifest
// schema and what it refuses (setup included), a catalog that holds a bad
// entry, GitHub links, archive paths a hostile zip uses, the option and
// setting normalizers, the board bridge's snapshot, moments and message
// guard, and a map's stored view data.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { addonManifestSchema, addonFit, compareVersions } = await import("../src/lib/addons/manifest.ts");
const { importerResultSchema, mapResultSchema, normalizeOptionValues, toolPayload } = await import("../src/lib/addons/contracts.ts");
const { readRegistry, pickAddonRegistryUrl, DEFAULT_ADDON_REGISTRY_URL } = await import("../src/lib/addons/registry.ts");
const { sourceFacts } = await import("../src/lib/addons/registry-index.ts");
const { parseGitHubLink, linkFor } = await import("../src/lib/addons/github.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { safeEntryPath, archiveContentHash } = await import("../src/lib/addons/archive.ts");
const { catalogEntry, catalogProblems, withEntry, emptyCatalog, entryDifferences } = await import("../src/lib/addons/catalog-entry.ts");
const JSZip = (await import("jszip")).default;
const { unzipFile } = await import("../src/lib/addons/unzip.ts");
const os = await import("node:os");
const fsp = await import("node:fs/promises");
const nodePath = (await import("node:path")).default;
const { cleanSettings, effectiveSettings, missingRequiredSettings, setupSettingKeys, downloadApplies } = await import("../src/lib/addons/settings.ts");
const { boardSnapshot, boardFx, readViewMessage, fileForRequest } = await import("../src/lib/addons/board-bridge.ts");
const { normalizeMapAddonView } = await import("../src/lib/addons/map-view.ts");
const { withManifestDefaults } = await import("../src/lib/addons/import-defaults.ts");
const { sniffImage } = await import("../src/lib/addons/sniff.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const example = JSON.parse(readFileSync(new URL("../examples/addons/hello-dungeon/addon.json", import.meta.url), "utf8"));
const host = { platform: "linux", arch: "x64", serverVersion: "0.27.2" };

// ---- the manifest ----

await test("the example addon's manifest reads", () => {
  const parsed = addonManifestSchema.parse(example);
  assert.equal(parsed.id, "hello-dungeon");
  assert.equal(parsed.contributes.workshopImporters[0].maxInputMB, 4);
  assert.equal(parsed.contributes.boardViews[0].needsViewData, false);
  assert.deepEqual(addonFit(parsed, host), { ok: true });
});

await test("ids, paths and empty addons are refused", () => {
  const bad = (patch) => addonManifestSchema.safeParse({ ...example, ...patch }).success;
  assert.equal(bad({ id: "Hello_Dungeon" }), false);
  assert.equal(bad({ id: "tasks" }), false, "a route name is reserved");
  assert.equal(bad({ runtime: { kind: "node", entry: "../outside.mjs" } }), false);
  assert.equal(bad({ runtime: { kind: "node", entry: "/etc/passwd" } }), false);
  assert.equal(bad({ runtime: { kind: "node", entry: "server\\main.mjs" } }), false);
  assert.equal(bad({ runtime: { kind: "node", entry: ".hidden/main.mjs" } }), false);
  assert.equal(bad({ contributes: {} }), false, "an addon must contribute something");
  const viewOutsideUi = { ...example.contributes, boardViews: [{ id: "x", title: "X", entry: "board.html" }] };
  assert.equal(bad({ contributes: viewOutsideUi }), false);
  assert.equal(bad({ permissions: ["root"] }), false);
  assert.equal(bad({ version: "one" }), false);
});

await test("setup: https downloads with a checksum, Python only for Python addons", () => {
  const withSetup = (setup, runtime = example.runtime) => addonManifestSchema.safeParse({ ...example, runtime, setup });
  const download = { id: "model", url: "https://example.com/m.bin", sha256: "a".repeat(64), bytes: 10, to: "models/m.bin" };
  assert.equal(withSetup({ tool: "odm_setup", downloads: [download] }).success, true);
  assert.equal(withSetup({ downloads: [{ ...download, url: "http://example.com/m.bin" }] }).success, false, "http is refused");
  assert.equal(withSetup({ downloads: [{ ...download, sha256: "nope" }] }).success, false);
  assert.equal(withSetup({ downloads: [{ ...download, to: "../outside" }] }).success, false);
  assert.equal(withSetup({ downloads: [{ ...download, platforms: ["linux-x64", "beos-ppc"] }] }).success, false);
  assert.equal(withSetup({ downloads: [download, download] }).success, false, "download ids are unique");
  assert.equal(withSetup({ python: { requirements: "requirements.txt" } }).success, false, "a node addon has no Python setup");
  assert.equal(withSetup({ python: { requirements: "requirements.txt" } }, { kind: "python", entry: "main.py" }).success, true);
  assert.equal(addonManifestSchema.parse(example).setup.tool, "odm_setup");
});

await test("conflicts, shared resources, view options and conditional downloads are held to their rules", () => {
  const parse = (patch) => addonManifestSchema.safeParse({ ...example, ...patch });
  assert.equal(parse({ conflicts: [{ id: "other-3d-board", reason: "Both draw the board in 3D." }] }).success, true);
  assert.equal(parse({ conflicts: [{ id: "hello-dungeon", reason: "Itself." }] }).success, false, "an addon cannot conflict with itself");
  assert.equal(parse({ conflicts: [{ id: "Other", reason: "x" }] }).success, false);
  assert.equal(parse({ conflicts: [{ id: "other", reason: "" }] }).success, false, "a conflict says why");
  assert.deepEqual(parse({ exclusive: ["gpu", "blender"] }).data.exclusive, ["gpu", "blender"]);
  assert.equal(parse({ exclusive: ["GPU!"] }).success, false);
  const download = { id: "big", url: "https://example.com/big.bin", sha256: "a".repeat(64), bytes: 10, to: "models/big.bin" };
  assert.equal(parse({ setup: { downloads: [{ ...download, when: { setting: "floorTexture", equals: "flagstone" } }] } }).success, true);
  assert.equal(parse({ setup: { downloads: [{ ...download, when: { setting: "nope", equals: "x" } }] } }).success, false, "a when names one of its settings");
  const parsed = addonManifestSchema.parse(example);
  assert.equal(parsed.contributes.boardViews[0].options.length, 2);
  assert.equal(parsed.settings.find((field) => field.key === "floorTexture").affectsSetup, true);
  assert.equal(parsed.settings.find((field) => field.key === "wallStyle").required, false);
});

await test("required settings, the settings setup reads, and which downloads apply", () => {
  const fields = addonManifestSchema.parse({
    ...example,
    settings: [
      { key: "apiKey", label: "API key", type: "secret", required: true },
      { key: "modelDir", label: "Model folder", type: "path", required: true, default: "/models" },
      { key: "quality", label: "Quality", type: "select", choices: [{ value: "low", label: "Low" }, { value: "high", label: "High" }], default: "low" },
      { key: "seed", label: "Seed", type: "number", affectsSetup: true },
    ],
    setup: { downloads: [{ id: "big", url: "https://example.com/b", sha256: "b".repeat(64), bytes: 1, to: "b", when: { setting: "quality", equals: ["high"] } }] },
  });
  assert.deepEqual(missingRequiredSettings(fields.settings, {}).map((field) => field.key), ["apiKey"], "a default fills a required path");
  assert.deepEqual(missingRequiredSettings(fields.settings, { apiKey: "k", modelDir: "  " }).map((field) => field.key), ["modelDir"]);
  assert.deepEqual([...setupSettingKeys(fields)].sort(), ["quality", "seed"]);
  const [big] = fields.setup.downloads;
  assert.equal(downloadApplies(big, "linux-x64", effectiveSettings(fields.settings, {})), false);
  assert.equal(downloadApplies(big, "linux-x64", { quality: "high" }), true);
  assert.equal(downloadApplies({ ...big, when: undefined, platforms: ["win32-x64"] }, "linux-x64", {}), false);
});

await test("a requirement may only point at a path setting", () => {
  const parsed = addonManifestSchema.safeParse({
    ...example,
    requires: [{ program: "blender", setting: "wallStyle" }],
  });
  assert.equal(parsed.success, false);
  const ok = addonManifestSchema.safeParse({
    ...example,
    settings: [...example.settings, { key: "blenderPath", label: "Blender", type: "path" }],
    requires: [{ program: "blender", setting: "blenderPath", versionPattern: "Blender (\\d+\\.\\d+)", minVersion: "4.2" }],
  });
  assert.equal(ok.success, true);
});

await test("fit: contract version, platform, executables and server version", () => {
  const parsed = addonManifestSchema.parse(example);
  assert.equal(addonFit({ ...parsed, apiVersion: 2 }, host).ok, false);
  assert.match(addonFit({ ...parsed, platforms: ["win32"] }, host).reason, /Windows only/);
  assert.match(addonFit({ ...parsed, minServerVersion: "9.0.0" }, host).reason, /9\.0\.0/);
  const exe = { ...parsed, runtime: { kind: "executable", executables: { "win32-x64": "bin/a.exe" }, args: [] } };
  assert.match(addonFit(exe, host).reason, /no program for Linux/);
  assert.equal(compareVersions("1.2.0", "1.10.0"), -1);
  assert.equal(compareVersions("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareVersions("0.28.0", "0.27.9"), 1);
});

// ---- the catalog ----

const pinned = { repo: "someone/odm-hello", path: "", commit: "c".repeat(40), tag: "" };

await test("a catalog keeps its good entries when one is bad", () => {
  const entry = {
    id: "hello-dungeon",
    name: "Hello",
    version: "1.0.0",
    apiVersion: 1,
    source: pinned,
    contentSha256: "a".repeat(64),
    bytes: 10,
  };
  const read = readRegistry({ kind: "odm.addons", version: 1, addons: [entry, { id: "Bad Id" }, entry] });
  assert.equal(read.ok, true);
  assert.equal(read.addons.length, 1, "duplicates and broken rows are skipped");
  assert.equal(read.skipped, 2);
  assert.equal(readRegistry({ kind: "odm.workshop", version: 1, addons: [] }).ok, false);
});

await test("a catalog entry names the GitHub source that was audited", () => {
  const base = {
    id: "iso-board",
    name: "Iso board",
    version: "1.0.0",
    apiVersion: 1,
    source: pinned,
    contentSha256: "b".repeat(64),
    bytes: 100,
  };
  const commit = "c".repeat(40);
  const read = readRegistry({
    kind: "odm.addons",
    version: 1,
    addons: [
      { ...base, source: { repo: "someone/odm-iso", path: "addons/iso-board", commit, tag: "v1.0.0" }, setupMB: 300 },
      { ...base, id: "bad-source", source: { repo: "not a repo", commit } },
      { ...base, id: "short-commit", source: { repo: "a/b", commit: "abc123" } },
      { ...base, id: "escaping-path", source: { repo: "a/b", path: "../etc", commit } },
      { ...base, id: "no-hash", contentSha256: undefined },
    ],
  });
  assert.equal(read.ok, true);
  assert.deepEqual(read.addons.map((entry) => entry.id), ["iso-board"]);
  assert.equal(read.skipped, 4);
  assert.equal(read.addons[0].setupMB, 300);
  assert.deepEqual(read.addons[0].conflicts, []);
  const withClash = readRegistry({ kind: "odm.addons", version: 1, addons: [{ ...base, conflicts: [{ id: "other", reason: "Both use the GPU." }], exclusive: ["gpu"] }] });
  assert.deepEqual(withClash.addons[0].conflicts, [{ id: "other", reason: "Both use the GPU." }]);
  assert.deepEqual(withClash.addons[0].exclusive, ["gpu"]);
  assert.deepEqual(sourceFacts(read.addons[0].source), {
    owner: "someone",
    repo: "someone/odm-iso",
    url: `https://github.com/someone/odm-iso/tree/${commit}/addons/iso-board`,
  });
  assert.equal(sourceFacts(undefined), null);
});

await test("an addon's content hash is its files, however they were zipped", async () => {
  const pack = async (prefix, order, date) => {
    const zip = new JSZip();
    const files = { "addon.json": "{}", "server/main.mjs": "export {}", "ui/board.html": "<p>" };
    for (const name of order) zip.file(`${prefix}${name}`, files[name], { date });
    return zip.generateAsync({ type: "nodebuffer" });
  };
  const a = await archiveContentHash(await pack("", ["addon.json", "server/main.mjs", "ui/board.html"], new Date("2020-01-01")));
  const b = await archiveContentHash(await pack("repo-abc123/", ["ui/board.html", "addon.json", "server/main.mjs"], new Date("2026-10-16")));
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.sha256, b.sha256, "order, top folder and dates do not change it");
  assert.equal(a.files, 3);
  const inside = await archiveContentHash(await pack("repo-abc123/tools/iso/", ["addon.json", "server/main.mjs", "ui/board.html"], new Date()), "tools/iso");
  assert.equal(inside.sha256, a.sha256, "a folder inside a repository hashes like the folder alone");
  const zip = new JSZip();
  zip.file("addon.json", "{}");
  zip.file("server/main.mjs", "export { changed }");
  zip.file("ui/board.html", "<p>");
  const changed = await archiveContentHash(await zip.generateAsync({ type: "nodebuffer" }));
  assert.notEqual(changed.sha256, a.sha256, "one changed file changes it");
  assert.equal((await archiveContentHash(await pack("", ["server/main.mjs"], new Date()))).ok, false, "no addon.json, no hash");
});

await test("a setup download's zip unpacks from disk, entry by entry, and refuses what a hostile zip does", async () => {
  const scratch = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "odm-unzip-"));
  try {
    const zip = new JSZip();
    zip.file("blender/README.txt", "stored", { compression: "STORE" });
    zip.file("blender/lib/data.bin", Buffer.alloc(200_000, 7), { compression: "DEFLATE" });
    zip.file("blender/blender", "#!/bin/sh\necho hi\n", { unixPermissions: 0o100755 });
    zip.file("blender/empty.txt", "");
    zip.folder("blender/scripts");
    const file = nodePath.join(scratch, "pack.zip");
    await fsp.writeFile(file, await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" }));
    const out = nodePath.join(scratch, "out");
    const result = await unzipFile(file, out);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.files, 4);
    assert.equal(await fsp.readFile(nodePath.join(out, "blender", "README.txt"), "utf8"), "stored");
    assert.equal((await fsp.readFile(nodePath.join(out, "blender", "lib", "data.bin"))).length, 200_000);
    assert.equal((await fsp.readFile(nodePath.join(out, "blender", "empty.txt"))).length, 0);
    assert.equal((await fsp.stat(nodePath.join(out, "blender", "scripts"))).isDirectory(), true);
    if (process.platform !== "win32") assert.ok((await fsp.stat(nodePath.join(out, "blender", "blender"))).mode & 0o100, "the executable bit travels");
    // A name that climbs out of the folder (written as "aa/" and patched to
    // "../" in both headers, since the zip library cleans such names).
    const climbing = new JSZip();
    climbing.file("aa/evil.txt", "x");
    const bytes = await climbing.generateAsync({ type: "nodebuffer" });
    const patched = Buffer.from(bytes.toString("latin1").split("aa/evil.txt").join("../evil.txt"), "latin1");
    await fsp.writeFile(nodePath.join(scratch, "climb.zip"), patched);
    const climbed = await unzipFile(nodePath.join(scratch, "climb.zip"), nodePath.join(scratch, "climb"));
    assert.equal(climbed.ok, false);
    assert.match(climbed.error, /not a safe path/);
    const linked = new JSZip();
    linked.file("link", "/etc/passwd", { unixPermissions: 0o120777 });
    await fsp.writeFile(nodePath.join(scratch, "link.zip"), await linked.generateAsync({ type: "nodebuffer", platform: "UNIX" }));
    assert.match((await unzipFile(nodePath.join(scratch, "link.zip"), nodePath.join(scratch, "link"))).error, /is a link/);
    await fsp.writeFile(nodePath.join(scratch, "not.zip"), "plain text");
    assert.match((await unzipFile(nodePath.join(scratch, "not.zip"), nodePath.join(scratch, "not"))).error, /not a zip/);
  } finally {
    await fsp.rm(scratch, { recursive: true, force: true });
  }
});

await test("catalog entries come from the manifest, and the list is held to its shape", () => {
  const manifest = addonManifestSchema.parse(example);
  const entry = catalogEntry(manifest, { ...pinned, path: "examples/addons/hello-dungeon" }, { contentSha256: "d".repeat(64), bytes: 4096 }, "tools");
  assert.equal(entry.name, "Hello Dungeon");
  assert.equal(entry.author, "Open Dungeon Master");
  assert.deepEqual(entry.contributes.boardViews, ["Isometric"]);
  assert.deepEqual(entry.permissions, ["ai.text"]);
  assert.equal(entry.setupMB, 1);
  const second = { ...entry, id: "another-addon" };
  const catalog = withEntry(withEntry(emptyCatalog(), second), entry);
  assert.deepEqual(catalog.addons.map((item) => item.id), ["another-addon", "hello-dungeon"], "kept sorted by id");
  assert.deepEqual(catalogProblems(catalog), []);
  assert.match(catalogProblems({ ...catalog, addons: [entry, second] })[0], /not sorted/);
  assert.match(catalogProblems({ ...catalog, addons: [entry, entry] }).join(" "), /listed twice/);
  assert.match(catalogProblems({ kind: "odm.addons", version: 1 })[0], /must be/);
  assert.deepEqual(entryDifferences(entry, { ...entry, name: "Renamed", contentSha256: "e".repeat(64) }).sort(), ["contentSha256", "name"]);
});

await test("addons/catalog.json, the list this build ships with, reads", () => {
  const shipped = JSON.parse(readFileSync(new URL("../addons/catalog.json", import.meta.url), "utf8"));
  assert.deepEqual(catalogProblems(shipped), []);
  assert.equal(readRegistry(shipped).ok, true);
  assert.match(DEFAULT_ADDON_REGISTRY_URL, /^https:\/\/raw\.githubusercontent\.com\/Lebbitheplow\/open-dungeon-master\/main\/addons\/catalog\.json$/);
});

await test("GitHub links: owner/repo, the repository, a release, a folder at a branch", () => {
  assert.deepEqual(parseGitHubLink("someone/odm-iso"), { owner: "someone", repo: "odm-iso", mode: "latest", ref: "", path: "" });
  assert.deepEqual(parseGitHubLink("https://github.com/someone/odm-iso.git"), { owner: "someone", repo: "odm-iso", mode: "latest", ref: "", path: "" });
  assert.deepEqual(parseGitHubLink("https://github.com/someone/odm-iso/releases/tag/v1.2.0"), { owner: "someone", repo: "odm-iso", mode: "release", ref: "v1.2.0", path: "" });
  assert.deepEqual(parseGitHubLink("https://github.com/someone/tools/tree/main/addons/iso/"), { owner: "someone", repo: "tools", mode: "ref", ref: "main", path: "addons/iso" });
  for (const bad of ["", "someone", "https://gitlab.com/a/b", "https://github.com/a/b/tree/main/../../etc", "https://github.com/a/b/issues/3", "javascript:alert(1)", "a/b/c"]) {
    assert.equal(parseGitHubLink(bad), null, bad);
  }
  assert.deepEqual(linkFor({ repo: "a/b", path: "x", ref: "", tag: "v1", commit: "" }), { owner: "a", repo: "b", mode: "latest", ref: "", path: "x" });
  assert.deepEqual(linkFor({ repo: "a/b", path: "", ref: "dev", tag: "", commit: "d".repeat(40) }), { owner: "a", repo: "b", mode: "ref", ref: "dev", path: "" });
});

await test("an addon's bundle may be larger than a pasted one, never unbounded", () => {
  const padded = JSON.stringify({ kind: "nothing", pad: "x".repeat(65 * 1024 * 1024) });
  assert.match(readBundle(padded).error, /caps at 64 MB/);
  assert.doesNotMatch(readBundle(padded, { maxBytes: 256 * 1024 * 1024 }).error ?? "", /caps at/);
});

await test("the catalog address: admin, then env, then built in; off is off", () => {
  assert.equal(pickAddonRegistryUrl("", ""), DEFAULT_ADDON_REGISTRY_URL);
  assert.equal(pickAddonRegistryUrl("", "https://env.example/index.json"), "https://env.example/index.json");
  assert.equal(pickAddonRegistryUrl("https://mine.example/i.json", "https://env.example"), "https://mine.example/i.json");
  assert.equal(pickAddonRegistryUrl("off", "https://env.example"), "");
  assert.equal(pickAddonRegistryUrl("", "OFF"), "");
});

// ---- archives ----

await test("archive entry paths a hostile zip would use are refused", () => {
  assert.equal(safeEntryPath("server/main.mjs"), "server/main.mjs");
  assert.equal(safeEntryPath("./server//main.mjs"), null);
  assert.equal(safeEntryPath("../evil.sh"), null);
  assert.equal(safeEntryPath("ui/../../evil"), null);
  assert.equal(safeEntryPath("/etc/passwd"), null);
  assert.equal(safeEntryPath("C:/Windows/evil"), null);
  assert.equal(safeEntryPath("ui\\evil"), null);
});

// ---- contracts ----

await test("option values are held to their fields", () => {
  const fields = addonManifestSchema.parse(example).contributes.mapGenerators[0].options;
  assert.deepEqual(normalizeOptionValues(fields, { openness: 500, pools: "yes", extra: 1 }), { openness: 75, pools: true });
  assert.deepEqual(normalizeOptionValues(fields, {}), { openness: 55, pools: true });
});

await test("tool results: structured content, JSON text, and errors", () => {
  assert.deepEqual(toolPayload({ structuredContent: { a: 1 }, content: [] }), { ok: true, value: { a: 1 } });
  assert.deepEqual(toolPayload({ content: [{ type: "text", text: '{"b":2}' }] }), { ok: true, value: { b: 2 } });
  assert.equal(toolPayload({ content: [{ type: "text", text: "Blender crashed" }], isError: true }).error, "Blender crashed");
  assert.equal(toolPayload({ content: [{ type: "text", text: "not json" }] }).ok, false);
});

await test("importer results name exactly one bundle", () => {
  assert.equal(importerResultSchema.safeParse({ bundleFile: "bundle.json" }).success, true);
  assert.equal(importerResultSchema.safeParse({}).success, false);
  assert.equal(importerResultSchema.safeParse({ bundleFile: "a.json", bundle: {} }).success, false);
  assert.equal(importerResultSchema.safeParse({ bundleFile: "../etc/passwd" }).success, false);
});

await test("map results: terrain alphabet, size, lights and view files", () => {
  const map = { width: 4, height: 4, terrain: "####" + "#..#" + "#.~#" + "####" };
  assert.equal(mapResultSchema.safeParse({ map }).success, true);
  const issue = (value) => mapResultSchema.safeParse(value).error?.issues[0]?.message ?? "";
  assert.match(issue({ map: { ...map, terrain: "###" } }), /needs 16/);
  assert.match(issue({ map: { ...map, terrain: "####" + "#..#" + "#.X#" + "####" } }), /not a terrain character/);
  assert.match(issue({ map: { ...map, lights: [{ x: 9, y: 0, brightRadius: 1, dimRadius: 2 }] } }), /off the map/);
  assert.match(issue({ map, view: { files: ["scene.fbx"] } }), /board view's files/);
  assert.equal(mapResultSchema.safeParse({ map, view: { files: ["scene.glb", "tex.webp"] } }).success, true);
  // Issue 414: view data over the cap is refused where the addon hears it,
  // never stored as null for the view to find empty later.
  const big = mapResultSchema.safeParse({ map, view: { data: { blob: "x".repeat(300_000) } } });
  assert.equal(big.success, false);
  assert.deepEqual(big.error.issues[0].path, ["view", "data"]);
  assert.match(big.error.issues[0].message, /256 KB as JSON, and this is 293 KB; put anything larger in a file/);
  assert.equal(mapResultSchema.safeParse({ map, view: { data: { blob: "x".repeat(200_000) } } }).success, true);
});

await test("a bundle's map view data over the cap is refused with its map, not dropped", () => {
  const map = { name: "Cave", width: 4, height: 4, terrain: "#".repeat(16), addonView: { addonId: "hello-dungeon", data: { heights: "9".repeat(300_000) }, files: [] } };
  const bundleOf = (maps) => JSON.stringify(withManifestDefaults({ maps }, "cave.pdf", "Cave Maker"));
  const read = readBundle(bundleOf([map]));
  assert.match(read.error ?? "", /malformed at maps\.0\.addonView\.data: A board view's data may be 256 KB/);
  const small = { ...map, addonView: { ...map.addonView, data: { heights: [1, 2, 3] } } };
  const fine = readBundle(bundleOf([small]));
  assert.deepEqual(fine.bundle?.maps[0].addonView?.data, { heights: [1, 2, 3] });
});

await test("an importer's bundle gets the manifest fields it left out", () => {
  const bundle = withManifestDefaults({ monsters: [] }, "Monster_Manual-2.pdf", "Rulebook Reader");
  assert.equal(bundle.kind, "odm.workshop");
  assert.equal(bundle.manifest.name, "Monster Manual 2");
  assert.equal(bundle.manifest.inspiredBy, "Monster_Manual-2.pdf");
  assert.match(bundle.manifest.blurb, /Rulebook Reader/);
  const kept = withManifestDefaults({ manifest: { name: "Mine", blurb: "B", inspiredBy: "I" } }, "x.pdf", "A");
  assert.equal(kept.manifest.name, "Mine");
});

await test("pictures are known by their bytes, not their names", () => {
  assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>")), null);
});

// ---- settings ----

await test("settings follow their fields; secrets keep, clear and set", () => {
  const fields = [
    { key: "apiKey", label: "Key", type: "secret", help: "", default: "" },
    { key: "style", label: "Style", type: "select", help: "", default: "a", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
    { key: "count", label: "Count", type: "number", help: "", default: 2, min: 1, max: 5, step: 1 },
  ];
  const current = { apiKey: "s3cret", style: "a" };
  assert.deepEqual(cleanSettings(fields, current, { count: 9, unknown: "x" }), { values: { apiKey: "s3cret", style: "a", count: 5 } });
  assert.deepEqual(cleanSettings(fields, current, { apiKey: "" }), { values: { style: "a" } });
  assert.match(cleanSettings(fields, current, { style: "z" }).error, /one of A, B/);
  assert.deepEqual(effectiveSettings(fields, {}), { style: "a", count: 2 });
});

// ---- the board bridge ----

const view = {
  mapId: "m1",
  width: 3,
  height: 2,
  ambient: "dim",
  outdoors: false,
  theme: "cave",
  terrain: "#.. .#",
  backdrop: { path: "/uploads/abc.png", transform: { offsetX: 0, offsetY: 0, scale: 1, opacity: 1 } },
  skin: { id: "stone-dungeon", bind: { ".": "flagstone-granite", "#": "wall-dungeon-mossy" } },
  addonView: { addonId: "hello-dungeon", data: { heights: [1] }, files: [{ name: "cave.glb", path: "/uploads/def.glb", type: "model/gltf-binary", bytes: 10 }] },
  visible: [1, 2],
  explored: [0, 1, 2, 4, 5],
  tokens: [{ id: "t1", kind: "pc", refId: "c1", name: "Ada", x: 1, y: 0, mine: true, down: false, hidden: false, light: null, stamp: "" }],
  lights: [],
  reachable: [2],
  budgetLeft: 6,
  myTokenId: "t1",
  round: 1,
  currentTurnName: "Ada",
  board: "fight",
  fullVision: false,
  labels: [],
  drawings: [],
  tokenConditions: { t1: [{ id: "prone", label: "Prone" }] },
  edges: {},
  tokenHealth: { t1: "healthy" },
  tokenAuras: {},
  tokenFootprint: {},
  tokenElevation: {},
  turn: { tokenId: "t1", round: 1 },
  targets: {},
  intents: [],
  spellZones: [],
};

await test("a snapshot is the viewer's projection, with only this addon's view data", () => {
  const appearance = { theme: "night", reducedMotion: false };
  const mine = boardSnapshot(view, "hello-dungeon", { canDirect: false, appearance });
  assert.equal(mine.terrain, view.terrain, "unexplored squares stay blank");
  assert.deepEqual(mine.skin, view.skin, "only the public skin binding is forwarded");
  assert.equal(mine.genre, null, "existing callers need not supply a genre");
  assert.equal(mine.appearance.audio, undefined, "existing callers need not supply audio preferences");
  const publicOptions = { canDirect: false, genre: "cyberpunk", appearance: { ...appearance, audio: { muted: true, volume: 0.2 } } };
  const presentation = boardSnapshot(view, "hello-dungeon", publicOptions);
  assert.equal(presentation.genre, "cyberpunk");
  assert.deepEqual(presentation.appearance.audio, { muted: true, volume: 0.2 });
  assert.deepEqual(mine.tokens[0].conditions, ["Prone"]);
  assert.equal(mine.tokens[0].size, 1);
  assert.equal(mine.view.files[0].name, "cave.glb");
  assert.equal("path" in mine.view.files[0], false, "stored paths never reach the frame");
  assert.equal(boardSnapshot(view, "other-addon", { canDirect: false, appearance }).view, null);
});

await test("a snapshot carries the flat board's layers, only about figures this viewer sees", () => {
  const appearance = { theme: "night", reducedMotion: false };
  const fuller = {
    ...view,
    tokens: [...view.tokens, { id: "t2", kind: "enemy", refId: "e1", name: "Ghoul", x: 2, y: 0, mine: false, down: false, hidden: false, light: null, stamp: "" }],
    tokenAuras: { t1: [{ id: "a", radiusFeet: 10, tone: "ward" }] },
    spellZones: [{ id: "z1", spell: "Fog Cloud", casterName: "Ada", tone: "neutral", look: "cloud", cells: [1, 2], hot: [], label: "Fog", concentration: true, untilRound: 4 }],
    labels: [{ x: 1, y: 0, text: "Altar", dmOnly: false }],
    drawings: [{ id: "d1", kind: "arrow", points: [{ x: 0, y: 0 }, { x: 2, y: 1 }], tone: "gold", dmOnly: false }],
    targets: { t2: ["t1", "hidden-token"], ghost: ["t1"] },
    intents: [
      { actorTokenId: "t2", verb: "Claw", targetTokenId: "t1", expected: 7, source: "engine", round: 1 },
      { actorTokenId: "hidden-token", verb: "Stab", targetTokenId: "t1", source: "engine", round: 1 },
    ],
  };
  const looks = new Map([
    ["e1", { creature: { type: "undead", slug: "ghoul", cr: 1 } }],
    ["c1", { character: { race: "elf", class: "wizard" } }],
  ]);
  const snap = boardSnapshot(fuller, "hello-dungeon", { canDirect: false, appearance, looks });
  assert.deepEqual(snap.tokens[1].creature, { type: "undead", slug: "ghoul", cr: 1 });
  assert.deepEqual(snap.tokens[0].character, { race: "elf", class: "wizard" });
  assert.equal(snap.tokens[1].character, null);
  assert.deepEqual(snap.tokens[0].auras, [{ radiusFeet: 10, tone: "ward" }]);
  assert.equal(snap.zones[0].look, "cloud");
  assert.deepEqual(snap.zones[0].cells, [1, 2]);
  assert.equal(snap.labels[0].text, "Altar");
  assert.equal(snap.marks[0].points.length, 2);
  assert.deepEqual(snap.intents, [{ tokenId: "t2", verb: "Claw", targetTokenId: "t1", expected: 7, stale: false }]);
  assert.deepEqual(snap.targets, { t2: ["t1"] }, "nothing about a figure this viewer cannot see");
  assert.equal(snap.doors, null, "a player gets no door states");
  assert.equal(snap.assetsUrl, "/api/addons/hello-dungeon/assets/");
  const dm = boardSnapshot({ ...fuller, doors: { "1,0": "secret" }, round: 3 }, "hello-dungeon", { canDirect: true, appearance, assetsUrl: "https://host/api/addons/hello-dungeon/assets/" });
  assert.deepEqual(dm.doors, { "1,0": "secret" });
  assert.equal(dm.intents[0].stale, true, "an intent from an earlier round is stale");
  assert.equal(dm.assetsUrl, "https://host/api/addons/hello-dungeon/assets/");
});

await test("a view's options arrive checked against its fields, defaults filled in", () => {
  const appearance = { theme: "night", reducedMotion: false };
  const fields = addonManifestSchema.parse(example).contributes.boardViews[0].options;
  const snap = (values) => boardSnapshot(view, "hello-dungeon", { canDirect: false, appearance, viewOptions: { fields, values } }).options;
  assert.deepEqual(snap({}), { outlines: true, walls: "normal" });
  assert.deepEqual(snap({ outlines: false, walls: "tall" }), { outlines: false, walls: "tall" });
  assert.deepEqual(snap({ outlines: "no", walls: "towering", extra: 1 }), { outlines: true, walls: "normal" }, "unknown keys and values fall back");
  assert.deepEqual(boardSnapshot(view, "hello-dungeon", { canDirect: false, appearance }).options, {});
});

await test("effects reach a view without their sound cue", () => {
  const [fx] = boardFx([{ id: "f1", kind: "attack", from: { x: 0, y: 0 }, to: { x: 1, y: 0 }, outcome: "hit", amount: 5, sting: "sword", numbers: "all", at: 1 }]);
  assert.equal(fx.amount, 5);
  assert.equal("sting" in fx, false);
  assert.equal("numbers" in fx, false);
});

await test("file requests resolve to the map's own files only", () => {
  assert.deepEqual(fileForRequest(view, "hello-dungeon", "cave.glb"), { path: "/uploads/def.glb", type: "model/gltf-binary" });
  assert.equal(fileForRequest(view, "other-addon", "cave.glb"), null);
  assert.equal(fileForRequest(view, "hello-dungeon", "../../etc/passwd"), null);
  assert.equal(fileForRequest(view, "anyone", "backdrop").path, "/uploads/abc.png");
});

await test("the frame's messages are read strictly", () => {
  assert.deepEqual(readViewMessage({ odm: 1, type: "tile", x: 2, y: 1 }), { type: "tile", x: 2, y: 1 });
  assert.equal(readViewMessage({ odm: 1, type: "tile", x: 1.5, y: 1 }), null);
  assert.equal(readViewMessage({ odm: 2, type: "ready" }), null);
  assert.equal(readViewMessage({ odm: 1, type: "eval", code: "x" }), null);
  assert.equal(readViewMessage({ odm: 1, type: "token", tokenId: "<script>" }), null);
  assert.deepEqual(readViewMessage({ odm: 1, type: "hover", x: null, y: null }), { type: "hover", x: null, y: null });
});

await test("anchors: fractions of the frame, within reason, for a bounded number of figures", () => {
  assert.deepEqual(readViewMessage({ odm: 1, type: "anchors", tokens: { t1: [0.5, 0.6, 0.4] } }), { type: "anchors", tokens: { t1: [0.5, 0.4, 0.6] } });
  assert.equal(readViewMessage({ odm: 1, type: "anchors", tokens: { t1: [0.5, 0.4] } }), null);
  assert.equal(readViewMessage({ odm: 1, type: "anchors", tokens: { t1: [0.5, Number.NaN, 0.6] } }), null);
  assert.equal(readViewMessage({ odm: 1, type: "anchors", tokens: { t1: [50, 0.4, 0.6] } }), null);
  assert.equal(readViewMessage({ odm: 1, type: "anchors", tokens: { "<b>": [0.5, 0.4, 0.6] } }), null);
  const many = Object.fromEntries(Array.from({ length: 301 }, (_, index) => [`t${index}`, [0.1, 0.1, 0.2]]));
  assert.equal(readViewMessage({ odm: 1, type: "anchors", tokens: many }), null);
});

await test("stored view data is normalized: our own paths only", () => {
  const view = normalizeMapAddonView({
    addonId: "hello-dungeon",
    data: { a: 1 },
    files: [
      { name: "a.glb", path: "/uploads/abc.glb" },
      { name: "b.glb", path: "https://evil.example/b.glb" },
      { name: "c.png", path: "/uploads/../../etc/passwd" },
      { name: "a.glb", path: "/uploads/dup.glb" },
    ],
  });
  assert.deepEqual(view.files.map((file) => file.name), ["a.glb"]);
  assert.equal(normalizeMapAddonView({ addonId: "Bad Id", files: [] }), null);
  assert.equal(normalizeMapAddonView({ addonId: "ok-id", data: "x".repeat(300_000) }).data, null);
});

await test("docs/addons/addon.schema.json matches the manifest schema", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./build-addon-schema.mjs", import.meta.url)), "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

await test("Godot resources are isolated, typed and size-limited like other addon assets", async () => {
  const { serveAddonFile } = await import("../src/lib/addons/static-files.ts");
  const folder = await fsp.mkdtemp(nodePath.join(os.tmpdir(), "odm-addon-files-"));
  const root = nodePath.join(folder, "ui");
  await fsp.mkdir(root);
  try {
    for (const [name, mime] of [["board.pck", "application/octet-stream"], ["swish.wav", "audio/wav"], ["board.wasm", "application/wasm"], ["board.js", "text/javascript; charset=utf-8"], ["tile.png", "image/png"]]) {
      await fsp.writeFile(nodePath.join(root, name), "test");
      const response = await serveAddonFile(root, [name], 64);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), mime);
      assert.match(response.headers.get("Content-Security-Policy"), /sandbox allow-scripts/);
      assert.ok(!response.headers.get("Content-Security-Policy").includes("allow-same-origin"));
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
      await response.arrayBuffer();
      assert.equal((await serveAddonFile(root, [name], 1)).status, 404);
    }
    // These files exist: rejection must come from the guards, not ENOENT.
    await fsp.writeFile(nodePath.join(folder, "private.pck"), "private");
    await fsp.writeFile(nodePath.join(root, ".private.pck"), "private");
    await fsp.writeFile(nodePath.join(root, "board.exe"), "not a served format");
    assert.equal((await serveAddonFile(root, ["..", "private.pck"], 64)).status, 404);
    assert.equal((await serveAddonFile(root, ["%2e%2e", "private.pck"], 64)).status, 404);
    assert.equal((await serveAddonFile(root, [".private.pck"], 64)).status, 404);
    assert.equal((await serveAddonFile(root, ["board.exe"], 64)).status, 404);
  } finally { await fsp.rm(folder, { recursive: true, force: true, maxRetries: 3 }); }
});

console.log(`${passed} addon core checks passed`);
