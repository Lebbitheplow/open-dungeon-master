// The world pack plugin system: manifest validation, path safety, the
// bundled/installed split, and the install and remove lifecycle.
//
// Installing writes a file to the server's data directory from a manifest that
// may have been downloaded, so the path derivation is the part that most needs
// a test with teeth.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

// Point the loader at a scratch directory BEFORE importing it, so nothing here
// touches a real install.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "odm-worlds-"));
process.env.WORLD_PACKS_DIR = scratch;

const { worldPackSchema, registryIndexSchema } = await import("../src/lib/worlds/types.ts");
const { installedPackPath, listWorldPackSummaries, worldPack, worldPackSource, resetWorldPackCache } =
  await import("../src/lib/worlds/index.ts");
const {
  installWorldPack,
  removeWorldPack,
  pickRegistryUrl,
  DEFAULT_WORLD_REGISTRY_URL,
  REGISTRY_DISABLED,
} = await import("../src/lib/worlds/install.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

// A minimal but valid manifest. The schema's defaults fill the rest.
function manifest(overrides = {}) {
  return {
    id: "test_world",
    name: "Test World",
    blurb: "A world used only by this test suite.",
    inspiredBy: "Nothing at all.",
    franchise: "Test",
    baseGenre: "high_fantasy",
    theme: "A world used only by this test suite",
    ...overrides,
  };
}

await test("a valid manifest installs, loads, and removes", async () => {
  const result = await installWorldPack(manifest());
  assert.ok(result.ok, `install failed: ${result.ok ? "" : result.error}`);
  assert.equal(result.replaced, false);
  assert.ok(fs.existsSync(path.join(scratch, "test_world.json")));

  assert.equal(worldPack("test_world")?.name, "Test World");
  assert.equal(worldPackSource("test_world"), "installed");
  assert.ok(listWorldPackSummaries().some((entry) => entry.id === "test_world"));

  const removed = await removeWorldPack("test_world");
  assert.ok(removed.ok, "remove failed");
  assert.equal(worldPack("test_world"), null);
  assert.ok(!fs.existsSync(path.join(scratch, "test_world.json")));
});

await test("reinstalling the same id reports that it replaced something", async () => {
  await installWorldPack(manifest());
  const second = await installWorldPack(manifest({ name: "Test World II", version: "2.0.0" }));
  assert.ok(second.ok);
  assert.equal(second.replaced, true);
  assert.equal(worldPack("test_world")?.name, "Test World II");
  // The cache must have been dropped, or the old build would still be served.
  assert.equal(worldPack("test_world")?.version, "2.0.0");
  await removeWorldPack("test_world");
});

await test("an invalid manifest is refused and writes nothing", async () => {
  const before = fs.readdirSync(scratch);
  for (const bad of [
    null,
    {},
    manifest({ id: "" }),
    manifest({ id: "UPPERCASE" }),
    manifest({ baseGenre: "not_a_genre" }),
    manifest({ name: "" }),
  ]) {
    const result = await installWorldPack(bad);
    assert.ok(!result.ok, `${JSON.stringify(bad)} should not have installed`);
    assert.equal(result.status, 400);
  }
  assert.deepEqual(fs.readdirSync(scratch), before, "a refused install still touched the disk");
});

await test("a traversal id cannot escape the installed directory", () => {
  // The schema already rejects these, but installedPackPath is the last line
  // of defence and the one whose failure would be an arbitrary file write.
  for (const evil of [
    "../escape",
    "../../etc/passwd",
    "a/b",
    "a\\b",
    ".hidden",
    "..",
    "",
    "with space",
    "UPPER",
    "ab",
  ]) {
    assert.equal(installedPackPath(evil), null, `${JSON.stringify(evil)} produced a path`);
  }
  const good = installedPackPath("test_world");
  assert.ok(good);
  assert.equal(path.dirname(good), path.resolve(scratch));
  assert.equal(path.basename(good), "test_world.json");
});

await test("a manifest whose id disagrees with its filename is not loaded", () => {
  // The loader reads by filename but trusts the id for lookups, so a mismatch
  // would make a pack unresolvable or, worse, resolvable under a name its file
  // does not carry.
  fs.writeFileSync(
    path.join(scratch, "claims_one_thing.json"),
    JSON.stringify(manifest({ id: "actually_another" })),
  );
  resetWorldPackCache();
  assert.equal(worldPack("actually_another"), null);
  assert.equal(worldPack("claims_one_thing"), null);
  fs.unlinkSync(path.join(scratch, "claims_one_thing.json"));
  resetWorldPackCache();
});

await test("a corrupt file is skipped instead of breaking every other pack", async () => {
  fs.writeFileSync(path.join(scratch, "broken.json"), "{ not json");
  await installWorldPack(manifest());
  assert.equal(worldPack("test_world")?.name, "Test World", "one bad file took the loader down");
  fs.unlinkSync(path.join(scratch, "broken.json"));
  await removeWorldPack("test_world");
});

await test("bundled packs load, are marked bundled, and cannot be removed", async () => {
  const bundled = listWorldPackSummaries().filter((entry) => entry.source === "bundled");
  assert.ok(bundled.length > 0, "no bundled packs were discovered");
  // Anything shipped in the repo is MIT and therefore an original work.
  for (const entry of bundled) {
    assert.equal(entry.rightsHolder, "", `${entry.id}: a bundled pack named a rights holder`);
  }
  const result = await removeWorldPack(bundled[0].id);
  assert.ok(!result.ok);
  assert.equal(result.status, 400);
  assert.match(result.error, /cannot be removed/);
});

await test("an installed pack shadows a bundled one with the same id", async () => {
  const bundled = listWorldPackSummaries().find((entry) => entry.source === "bundled");
  assert.ok(bundled);
  const result = await installWorldPack(manifest({ id: bundled.id, name: "My Own Build" }));
  assert.ok(result.ok);
  assert.equal(result.replaced, true);
  assert.equal(worldPack(bundled.id)?.name, "My Own Build");
  assert.equal(worldPackSource(bundled.id), "installed");

  // Removing the override falls back to the bundled copy rather than leaving
  // a hole where a campaign's world used to be.
  await removeWorldPack(bundled.id);
  assert.equal(worldPack(bundled.id)?.name, bundled.name);
  assert.equal(worldPackSource(bundled.id), "bundled");
});

await test("removing something that is not installed is a 404", async () => {
  const result = await removeWorldPack("no_such_world");
  assert.ok(!result.ok);
  assert.equal(result.status, 404);
});

await test("the registry route reports installed packs on every path", () => {
  // Regression: the handler used to build `installed` only after a successful
  // registry fetch, so a server with no registry configured (the default)
  // showed an empty Installed list in the plugin browser even with packs on
  // disk. What is on disk does not depend on a remote index.
  const source = fs.readFileSync(
    new URL("../src/app/api/worlds/registry/route.ts", import.meta.url),
    "utf8",
  );
  const returns = source.match(/return Response\.json\(\{[^}]*\}\)/gs) ?? [];
  assert.ok(returns.length >= 3, "expected the unconfigured, failed and success paths");
  for (const body of returns) {
    assert.match(body, /installed/, `a response path omits installed: ${body}`);
  }
  // And it must be resolved before the early return rather than inlined once.
  assert.ok(
    source.indexOf("const installed = listWorldPackSummaries()") <
      source.indexOf("if (!url)"),
    "installed is resolved after the unconfigured early return",
  );
});

await test("a registry index only accepts https download URLs", () => {
  const entry = {
    id: "test_world",
    name: "Test World",
    blurb: "b",
    inspiredBy: "i",
    franchise: "Test",
    baseGenre: "high_fantasy",
  };
  assert.ok(
    registryIndexSchema.safeParse({
      packs: [{ ...entry, downloadUrl: "https://example.invalid/test_world.json" }],
    }).success,
  );
  for (const url of [
    "http://example.invalid/test_world.json",
    "file:///etc/passwd",
    "ftp://example.invalid/x.json",
    "not a url",
  ]) {
    assert.ok(
      !registryIndexSchema.safeParse({ packs: [{ ...entry, downloadUrl: url }] }).success,
      `${url} was accepted as a download URL`,
    );
  }
});

await test("plugin metadata defaults so an older manifest still parses", () => {
  const parsed = worldPackSchema.parse(manifest());
  assert.equal(parsed.version, "1.0.0");
  assert.equal(parsed.author, "");
  assert.equal(parsed.rightsHolder, "");
  assert.equal(parsed.homepage, "");
});

await test("the registry URL falls through admin, then env, then the built-in default", () => {
  assert.equal(pickRegistryUrl("https://admin.invalid/i.json", "https://env.invalid/i.json"),
    "https://admin.invalid/i.json");
  assert.equal(pickRegistryUrl("", "https://env.invalid/i.json"), "https://env.invalid/i.json");
  assert.equal(pickRegistryUrl(undefined, undefined), DEFAULT_WORLD_REGISTRY_URL);
  assert.equal(pickRegistryUrl("", ""), DEFAULT_WORLD_REGISTRY_URL);
  // Whitespace is not a configuration choice; it has to fall through rather
  // than be fetched as a URL.
  assert.equal(pickRegistryUrl("   ", "  "), DEFAULT_WORLD_REGISTRY_URL);

  // Blank means "next source", so turning the registry off needs a word of its
  // own, at whichever layer the operator reaches for.
  assert.equal(pickRegistryUrl(REGISTRY_DISABLED, "https://env.invalid/i.json"), "");
  assert.equal(pickRegistryUrl("", REGISTRY_DISABLED), "");
  assert.equal(pickRegistryUrl("OFF", ""), "");
});

await test("the built-in registry URL is one the installer would accept", () => {
  // It is fetched by the same code path as any operator-supplied registry, so
  // shipping a default that the schema rejects would be a dead browser on a
  // fresh install.
  const parsed = registryIndexSchema.safeParse({
    packs: [
      {
        id: "test_world",
        name: "Test World",
        blurb: "b",
        inspiredBy: "i",
        franchise: "Test",
        baseGenre: "high_fantasy",
        downloadUrl: DEFAULT_WORLD_REGISTRY_URL,
      },
    ],
  });
  assert.ok(parsed.success, "the default registry URL fails the schema the installer uses");
});

await test("both world routes resolve the registry through the one helper", () => {
  // Browsing and installing used to repeat the precedence expression, so a
  // registry could be listed from one source and downloaded from another.
  for (const route of ["registry", "install"]) {
    const source = fs.readFileSync(
      new URL(`../src/app/api/worlds/${route}/route.ts`, import.meta.url),
      "utf8",
    );
    assert.match(source, /pickRegistryUrl\(/, `${route} route does not use pickRegistryUrl`);
    assert.ok(
      !/worldRegistryUrl\s*\|\|/.test(source),
      `${route} route still inlines the precedence expression`,
    );
  }
});

await test("a published index.json in the installed directory is not read as a pack", () => {
  // build-world-registry.mjs writes index.json beside the manifests, and the
  // documented workflow publishes straight out of the folder the server
  // installs into. Without the skip this warned on every cold load.
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    fs.writeFileSync(
      path.join(scratch, "index.json"),
      JSON.stringify({ packs: [{ id: "test_world", downloadUrl: "https://example.invalid/x.json" }] }),
    );
    resetWorldPackCache();
    const summaries = listWorldPackSummaries();
    assert.ok(!summaries.some((entry) => entry.id === "index"), "index.json loaded as a pack");
    assert.equal(worldPack("index"), null);
    assert.deepEqual(warnings, [], `index.json warned: ${warnings.join(" | ")}`);
  } finally {
    console.warn = realWarn;
    fs.unlinkSync(path.join(scratch, "index.json"));
    resetWorldPackCache();
  }
});

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`test-world-install: ${passed} passed`);
