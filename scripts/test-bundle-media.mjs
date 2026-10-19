// One picture list for a bundle (the plan's portable media manifest, WF-05,
// and the duplicate #404 named): a picture several records share lands as
// one file on import, whether the bundle carried it inline in each record
// (every bundle this build writes) or once in a shared list that the records
// name ("media:<hash>", which this build reads ahead of writing it). A list
// that is malformed, a picture that does not match its name, or a name the
// list does not carry refuses the bundle before anything is written.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-bundle-media");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { packMedia, mediaId } = await import("../src/lib/workshop/bundle-media.ts");
const { sha256Hex } = await import("../src/lib/sha256.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { worldView, createWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { getOverworld, setOverworldBackdrop } = await import("../src/lib/db/overworld.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");

const world = await openWorld();
const owner = { id: world.owner.id };
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const uploads = path.join(process.cwd(), "public", "uploads");
fs.mkdirSync(uploads, { recursive: true });
const upload = (name) => {
  fs.writeFileSync(path.join(uploads, name), TINY_PNG);
  return `/uploads/${name}`;
};
const files = () => new Set(fs.readdirSync(uploads));

// One picture as the coast's Atlas art, the Region's backdrop and the
// harbour's illustration.
const shop = createWorkshop(owner.id, { title: "One coast, one picture" }).id;
const art = upload(`media-coast-${Date.now()}.png`);
const place = createWorldEntity(shop, { typeId: "t_location", name: "Gullhaven", text: "A harbour.", portrait: art });
assert.ok(place.entity, place.error);
const doc = getWorldDoc(shop);
doc.maps.push({ id: "m_coast", name: "The coast", image: art, parentPinId: "", regions: [], role: "region" });
saveWorldDoc(shop, doc);
setOverworldBackdrop(shop, art);
const out = exportWorkshopBundle(shop, { name: "One coast", blurb: "A coast.", inspiredBy: "Original work" });
assert.ok(out.bundle, out.error);
const inline = JSON.stringify(out.bundle);

// What an import landed: the three places the picture is used.
function landed(workshopId) {
  const view = worldView(workshopId);
  return {
    atlas: view.doc.maps.find((atlas) => atlas.name === "The coast")?.image ?? "",
    region: getOverworld(workshopId).backdropPath,
    place: view.entities.find((entity) => entity.name === "Gullhaven")?.portrait ?? "",
  };
}

await test("A picture's name is the SHA-256 of its data URL, worked out without node:crypto so the browser and the apps read the same names.", () => {
  const { createHash, randomBytes } = crypto;
  const samples = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "héllo ✓ 龍", `data:image/png;base64,${randomBytes(300_000).toString("base64")}`];
  for (const text of samples) {
    assert.equal(sha256Hex(text), createHash("sha256").update(text).digest("hex"), `${text.length} characters`);
  }
  assert.equal(mediaId(samples[6]), createHash("sha256").update(samples[6]).digest("hex").slice(0, 32));
  assert.doesNotMatch(fs.readFileSync(new URL("../src/lib/workshop/bundle-media.ts", import.meta.url), "utf8"), /from "node:/);
});

await test("A bundle this build writes still carries each picture inline, so an older build can open it.", () => {
  assert.equal(out.bundle.media, undefined);
  assert.equal(inline.includes("media:"), false);
  assert.ok((inline.match(/data:image\/png;base64,/g) ?? []).length >= 3, "the shared picture rides in each record that uses it");
});

await test("Imported, a picture three records share lands as one file that all three name.", () => {
  const before = files();
  const read = readBundle(inline);
  assert.ok(!("error" in read), read.error);
  const result = importWorkshopBundle(owner.id, read.bundle);
  assert.ok(result.workshopId, result.error);
  const at = landed(result.workshopId);
  assert.ok(at.atlas, "the Atlas map lost its picture");
  assert.equal(at.region, at.atlas, "the Region's backdrop is a second file");
  assert.equal(at.place, at.atlas, "the place's illustration is a second file");
  const added = [...files()].filter((name) => !before.has(name));
  assert.deepEqual(added, [path.basename(at.atlas)], `the import wrote ${added.length} files`);
});

await test("The same bundle with a shared picture list reads to the same bundle, carries the picture once, and imports the same way.", () => {
  const packed = packMedia(out.bundle);
  const text = JSON.stringify(packed);
  assert.equal(Object.keys(packed.media).length, 1, "the list holds the picture once");
  assert.equal((text.match(/data:image\/png;base64,/g) ?? []).length, 1);
  assert.ok(text.length < inline.length, "the shared list makes the bundle smaller");
  const fromList = readBundle(text);
  const fromInline = readBundle(inline);
  assert.ok(!("error" in fromList), fromList.error);
  assert.deepEqual(fromList.bundle, fromInline.bundle, "a bundle read from its list differs from the inline one");
  const before = files();
  const result = importWorkshopBundle(owner.id, fromList.bundle);
  const at = landed(result.workshopId);
  assert.equal(at.region, at.atlas);
  assert.equal(at.place, at.atlas);
  assert.equal([...files()].filter((name) => !before.has(name)).length, 1);
});

await test("A malformed list, a picture that does not match its name, or a name the list lacks refuses the bundle.", () => {
  const packed = packMedia(out.bundle);
  const [id, url] = Object.entries(packed.media)[0];
  const refused = (bundle) => {
    const read = readBundle(JSON.stringify(bundle));
    assert.ok("error" in read, "a bad list was accepted");
    return read.error;
  };
  assert.match(refused({ ...packed, media: "pictures" }), /picture list is malformed/);
  assert.match(refused({ ...packed, media: { [id]: "data:text/plain;base64,aGk=" } }), /malformed/);
  const other = `data:image/png;base64,${TINY_PNG.toString("base64")}AAAA`;
  assert.match(refused({ ...packed, media: { [id]: other } }), /does not match its name/);
  assert.match(refused({ ...packed, media: {} }), new RegExp(`does not carry \\(${id}\\)`));
  assert.equal(mediaId(url), id);
  const many = Object.fromEntries(Array.from({ length: 2_001 }, (_, index) => [index.toString(16).padStart(32, "0"), url]));
  assert.match(refused({ ...packed, media: many }), /2000 at most/);
});

finish();
