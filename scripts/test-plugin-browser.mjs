// The plugin browser: its filter, its link to the guide, and the thumbnails a
// registry may list (fetched and checked by the server, written by
// world-pack-art.mjs, listed by build-world-registry.mjs).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { registryIndexSchema } = await import("../src/lib/worlds/types.ts");
const { filterPlugins, genresOf, isFiltering, isFanWork, NO_PLUGIN_FILTER } = await import(
  "../src/lib/worlds/plugin-filter.ts"
);
const { MAX_THUMBNAIL_BYTES, registryThumbnail, rememberRegistryListing, sniffImage, withThumbnailPaths } =
  await import("../src/lib/worlds/registry-thumbnails.ts");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "odm-plugin-browser-"));

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

// A valid 1x1 WebP, the smallest picture the pack schema accepts.
const PIXEL_WEBP = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function entry(overrides = {}) {
  return {
    id: "test_world",
    name: "Test World",
    blurb: "A world used only by this test suite.",
    version: "1.0.0",
    author: "",
    homepage: "",
    inspiredBy: "Nothing at all.",
    rightsHolder: "",
    franchise: "Test",
    edition: "",
    editionOrder: 0,
    baseGenre: "high_fantasy",
    downloadUrl: "https://example.invalid/test_world.json",
    ...overrides,
  };
}

await test("the plugin browser links to the guide for making a plugin, and to no Drive registry", () => {
  const panel = fs.readFileSync(new URL("../src/app/admin/AdminWorldsPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /https:\/\/opendungeonmaster\.com\/guide\/dm\/make-a-campaign-plugin\//);
  assert.match(panel, /rel="noopener noreferrer"/);
  for (const file of ["../src/lib/worlds/install.ts", "../src/app/admin/AdminWorldsPanel.tsx"]) {
    assert.ok(!/drive\.google\.com/.test(fs.readFileSync(new URL(file, import.meta.url), "utf8")), `${file} still names a Drive registry`);
  }
});

await test("a registry thumbnail is optional and https only", () => {
  assert.ok(registryIndexSchema.safeParse({ packs: [entry()] }).success);
  assert.ok(registryIndexSchema.safeParse({ packs: [entry({ thumbnail: "https://example.invalid/t.webp" })] }).success);
  for (const thumbnail of ["http://example.invalid/t.webp", "file:///etc/passwd", "data:image/webp;base64,AAAA", "not a url"]) {
    assert.ok(
      !registryIndexSchema.safeParse({ packs: [entry({ thumbnail })] }).success,
      `${thumbnail} was accepted as a thumbnail`,
    );
    assert.ok(
      !registryIndexSchema.safeParse({
        packs: [],
        bundles: [{ id: "a_bundle", name: "A", blurb: "b", downloadUrl: "https://example.invalid/a.json", thumbnail }],
      }).success,
      `${thumbnail} was accepted as a bundle thumbnail`,
    );
  }
});

await test("the filter searches what an entry shows, folding case and accents", () => {
  const list = [
    entry({ id: "guild_hunts", name: "The Hunter's Guild", franchise: "Monster Hunter", rightsHolder: "CAPCOM Co., Ltd." }),
    entry({ id: "saltmarch", name: "Saltmarch", blurb: "Salt, fog and old debts.", author: "Équipe ODM" }),
    entry({ id: "neon_rain", name: "Neon Rain", baseGenre: "cyberpunk", edition: "Second Era" }),
  ];
  const ids = (filter) => filterPlugins(list, { ...NO_PLUGIN_FILTER, ...filter }).map((item) => item.id);
  assert.deepEqual(ids({}), ["guild_hunts", "saltmarch", "neon_rain"]);
  assert.deepEqual(ids({ query: "monster" }), ["guild_hunts"]);
  assert.deepEqual(ids({ query: "  HUNTER   guild " }), ["guild_hunts"]);
  assert.deepEqual(ids({ query: "équipe" }), ["saltmarch"]);
  assert.deepEqual(ids({ query: "ÉQUIPE" }), ["saltmarch"]);
  assert.deepEqual(ids({ query: "fog debts" }), ["saltmarch"]);
  assert.deepEqual(ids({ query: "second era" }), ["neon_rain"]);
  assert.deepEqual(ids({ query: "nothing like this" }), []);
  assert.deepEqual(ids({ genre: "cyberpunk" }), ["neon_rain"]);
  assert.deepEqual(ids({ origin: "fan" }), ["guild_hunts"]);
  assert.deepEqual(ids({ origin: "original" }), ["saltmarch", "neon_rain"]);
  assert.deepEqual(ids({ origin: "original", genre: "high_fantasy", query: "salt" }), ["saltmarch"]);
  assert.ok(isFanWork(list[0]) && !isFanWork(list[1]));
  assert.ok(!isFanWork(entry({ rightsHolder: "   " })), "a blank rights holder made a fan work");
  assert.deepEqual(genresOf(list), ["cyberpunk", "high_fantasy"]);
  assert.ok(!isFiltering(NO_PLUGIN_FILTER));
  assert.ok(!isFiltering({ ...NO_PLUGIN_FILTER, query: "   " }));
  assert.ok(isFiltering({ ...NO_PLUGIN_FILTER, origin: "fan" }));
});

await test("only real PNG, JPEG and WebP bytes count as a picture", () => {
  assert.equal(sniffImage(PNG_HEAD), "image/png");
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(sniffImage(Buffer.from(PIXEL_WEBP, "base64")), "image/webp");
  assert.equal(sniffImage(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(sniffImage(Buffer.from("<html><script>alert(1)</script>")), null);
  assert.equal(sniffImage(Buffer.from("RIFF0000WAVE")), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

await test("the browser gets this server's thumbnail addresses, never the remote ones", () => {
  const listing = {
    packs: [entry({ thumbnail: "https://cdn.invalid/t.webp", version: "1.2.0 beta" }), entry({ id: "plain_world" })],
    bundles: [{ id: "hollow_crown", name: "H", blurb: "b", version: "2.0.0", author: "", inspiredBy: "", rightsHolder: "", downloadUrl: "https://x.invalid/h.json", thumbnail: "https://cdn.invalid/h.png" }],
  };
  const shown = withThumbnailPaths(listing);
  assert.equal(shown.packs[0].thumbnail, "/api/worlds/registry/thumbnail/pack/test_world?v=1.2.0%20beta");
  assert.equal(shown.packs[1].thumbnail, undefined);
  assert.equal(shown.bundles[0].thumbnail, "/api/worlds/registry/thumbnail/bundle/hollow_crown?v=2.0.0");
  assert.ok(!JSON.stringify(shown).includes("cdn.invalid"), "a remote address reached the browser");
  // The listing the server keeps for resolving still has the remote ones.
  assert.equal(listing.packs[0].thumbnail, "https://cdn.invalid/t.webp");
});

function resetThumbnailState() {
  delete globalThis.__odmRegistryListing;
  delete globalThis.__odmRegistryThumbnails;
}

await test("a thumbnail is fetched once through the listing, checked, and cached", async () => {
  resetThumbnailState();
  const realFetch = globalThis.fetch;
  const asked = [];
  const registryUrl = "https://registry.invalid/worlds/index.json";
  const index = {
    packs: [
      entry({ thumbnail: "https://registry.invalid/worlds/thumbnails/test_world.webp" }),
      entry({ id: "fake_picture", thumbnail: "https://registry.invalid/worlds/thumbnails/fake.webp" }),
      entry({ id: "huge_picture", thumbnail: "https://registry.invalid/worlds/thumbnails/huge.png" }),
      entry({ id: "no_picture" }),
    ],
    bundles: [],
  };
  const bodies = {
    [registryUrl]: () => new Response(JSON.stringify(index), { headers: { "content-type": "application/json" } }),
    "https://registry.invalid/worlds/thumbnails/test_world.webp": () =>
      new Response(Buffer.from(PIXEL_WEBP, "base64"), { headers: { "content-type": "text/html" } }),
    "https://registry.invalid/worlds/thumbnails/fake.webp": () =>
      new Response("<html>not a picture</html>", { headers: { "content-type": "image/webp" } }),
    "https://registry.invalid/worlds/thumbnails/huge.png": () =>
      new Response(Buffer.concat([PNG_HEAD, Buffer.alloc(MAX_THUMBNAIL_BYTES)]), { headers: { "content-type": "image/png" } }),
  };
  try {
    globalThis.fetch = async (url, init) => {
      asked.push(String(url));
      assert.equal(init?.redirect, "manual");
      const body = bodies[String(url)];
      return body ? body() : new Response("missing", { status: 404 });
    };
    const first = await registryThumbnail(registryUrl, "pack", "test_world");
    // The host called it text/html; the bytes say WebP, and the bytes win.
    assert.equal(first?.mime, "image/webp");
    assert.ok(first.bytes.length > 0);
    assert.deepEqual(asked, [registryUrl, "https://registry.invalid/worlds/thumbnails/test_world.webp"]);

    asked.length = 0;
    const again = await registryThumbnail(registryUrl, "pack", "test_world");
    assert.equal(again, first);
    assert.deepEqual(asked, [], "a cached thumbnail was fetched again");

    assert.equal(await registryThumbnail(registryUrl, "pack", "fake_picture"), null, "HTML served as a picture");
    assert.equal(await registryThumbnail(registryUrl, "pack", "huge_picture"), null, "an oversized picture was served");
    assert.equal(await registryThumbnail(registryUrl, "pack", "no_picture"), null);
    assert.equal(await registryThumbnail(registryUrl, "pack", "not_listed"), null);
    assert.equal(await registryThumbnail(registryUrl, "bundle", "test_world"), null, "a pack id resolved as a bundle");
    // One index fetch served every lookup above.
    assert.equal(asked.filter((url) => url === registryUrl).length, 0);
  } finally {
    globalThis.fetch = realFetch;
    resetThumbnailState();
  }
});

await test("a listing the browser just fetched resolves thumbnails without fetching the index again", async () => {
  resetThumbnailState();
  const realFetch = globalThis.fetch;
  const asked = [];
  try {
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      return new Response(Buffer.from(PIXEL_WEBP, "base64"));
    };
    rememberRegistryListing("https://seeded.invalid/index.json", {
      packs: [entry({ thumbnail: "https://seeded.invalid/t.webp" })],
      bundles: [],
    });
    assert.ok(await registryThumbnail("https://seeded.invalid/index.json", "pack", "test_world"));
    assert.deepEqual(asked, ["https://seeded.invalid/t.webp"]);
    // A different registry is never answered from another one's listing.
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      return new Response("nope", { status: 500 });
    };
    assert.equal(await registryThumbnail("https://other.invalid/index.json", "pack", "test_world"), null);
  } finally {
    globalThis.fetch = realFetch;
    resetThumbnailState();
  }
});

await test("a redirect to plain http is refused for a thumbnail as for a pack", async () => {
  resetThumbnailState();
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "http://192.168.1.1/x.webp" } });
    rememberRegistryListing("https://r.invalid/index.json", {
      packs: [entry({ thumbnail: "https://r.invalid/t.webp" })],
      bundles: [],
    });
    assert.equal(await registryThumbnail("https://r.invalid/index.json", "pack", "test_world"), null);
  } finally {
    globalThis.fetch = realFetch;
    resetThumbnailState();
  }
});

await test("the registry and thumbnail routes hand out local addresses and resolve through the listing", () => {
  const listing = fs.readFileSync(new URL("../src/app/api/worlds/registry/route.ts", import.meta.url), "utf8");
  assert.match(listing, /withThumbnailPaths\(/, "the registry route sends remote thumbnail URLs to the browser");
  const thumbnail = fs.readFileSync(
    new URL("../src/app/api/worlds/registry/thumbnail/[kind]/[id]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(thumbnail, /requireAdmin\(\)/);
  assert.match(thumbnail, /pickRegistryUrl\(/);
  assert.match(thumbnail, /registryThumbnail\(/);
  assert.ok(!/searchParams/.test(thumbnail), "the thumbnail route reads an address from the request");
});

function runScript(name, args) {
  return execFileSync(process.execPath, [path.join(scriptsDir, name), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writePack(dir, id, art = {}) {
  const pack = {
    id,
    name: id.replace(/_/g, " "),
    blurb: "A world used only by this test suite.",
    inspiredBy: "Nothing at all.",
    franchise: id,
    baseGenre: "high_fantasy",
    theme: "A world used only by this test suite",
    art,
  };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(pack));
}

await test("world-pack-art thumbnails writes a tile from the cover and leaves an existing one alone", () => {
  const dir = path.join(scratch, "tiles");
  fs.mkdirSync(dir, { recursive: true });
  writePack(dir, "with_cover", { cover: `data:image/webp;base64,${PIXEL_WEBP}` });
  writePack(dir, "without_cover");
  runScript("world-pack-art.mjs", ["thumbnails", dir]);
  const tile = path.join(dir, "thumbnails", "with_cover.webp");
  assert.ok(fs.existsSync(tile), "no tile was written");
  assert.equal(sniffImage(fs.readFileSync(tile)), "image/webp");
  assert.ok(!fs.existsSync(path.join(dir, "thumbnails", "without_cover.webp")), "a pack with no cover got a tile");

  fs.writeFileSync(tile, "kept");
  runScript("world-pack-art.mjs", ["thumbnails", dir]);
  assert.equal(fs.readFileSync(tile, "utf8"), "kept", "an existing tile was rewritten without --force");
  runScript("world-pack-art.mjs", ["thumbnails", dir, "--force"]);
  assert.equal(sniffImage(fs.readFileSync(tile)), "image/webp", "--force did not rewrite the tile");
});

await test("build-world-registry lists a thumbnail for each pack with a tile, in both forms", () => {
  const dir = path.join(scratch, "registry");
  fs.mkdirSync(path.join(dir, "thumbnails"), { recursive: true });
  writePack(dir, "tiled_world");
  writePack(dir, "plain_world");
  fs.writeFileSync(path.join(dir, "thumbnails", "tiled_world.webp"), Buffer.from(PIXEL_WEBP, "base64"));

  runScript("build-world-registry.mjs", [dir, "https://packs.invalid/worlds/"]);
  const byBase = registryIndexSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")));
  const tiled = byBase.packs.find((item) => item.id === "tiled_world");
  const plain = byBase.packs.find((item) => item.id === "plain_world");
  assert.equal(tiled.thumbnail, "https://packs.invalid/worlds/thumbnails/tiled_world.webp");
  assert.equal(tiled.downloadUrl, "https://packs.invalid/worlds/tiled_world.json");
  assert.equal(plain.thumbnail, undefined);

  const mapping = path.join(scratch, "urls.json");
  fs.writeFileSync(
    mapping,
    JSON.stringify({
      tiled_world: { downloadUrl: "https://files.invalid/a", thumbnail: "https://files.invalid/a.webp" },
      plain_world: "https://files.invalid/b",
    }),
  );
  runScript("build-world-registry.mjs", [dir, "--urls", mapping]);
  const byMap = registryIndexSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")));
  assert.deepEqual(
    byMap.packs.map((item) => [item.id, item.downloadUrl, item.thumbnail]),
    [
      ["plain_world", "https://files.invalid/b", undefined],
      ["tiled_world", "https://files.invalid/a", "https://files.invalid/a.webp"],
    ],
  );
});

removeTempDir(scratch);
console.log(`test-plugin-browser: ${passed} passed`);
