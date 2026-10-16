// A place's illustration travels inside a workshop bundle. WorldForge keeps
// a place's picture in its document rather than the place's row, and only
// the atlas's pictures used to be inlined: on another server the bundle
// pointed at a file that was not there. Audit finding WF-05. The check
// deletes the source files before opening the bundle, as another server
// would see it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-bundle-pictures");
const { readBundle, bundleImageCount } = await import("../src/lib/workshop/bundle.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { worldView, createWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");

const world = await openWorld();
const owner = { id: world.owner.id };
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const uploads = path.join(process.cwd(), "public", "uploads");
const upload = (name) => {
  fs.mkdirSync(uploads, { recursive: true });
  fs.writeFileSync(path.join(uploads, name), TINY_PNG);
  return `/uploads/${name}`;
};
const bytesAt = (url) => fs.readFileSync(path.join(process.cwd(), "public", url));

const shop = createWorkshop(owner.id, { title: "Pictures that travel" }).id;
const placePicture = upload(`wf05-place-${Date.now()}.png`);
const mapPicture = upload(`wf05-map-${Date.now()}.png`);
const place = createWorldEntity(shop, { typeId: "t_location", name: "Gullhaven", text: "A harbour.", portrait: placePicture });
assert.ok(place.entity, place.error);
assert.equal(place.entity.portrait, placePicture, "the place took its picture");
const doc = getWorldDoc(shop);
doc.maps.push({ id: "m_coast", name: "The coast", image: mapPicture, parentPinId: "", regions: [] });
saveWorldDoc(shop, doc);

const out = exportWorkshopBundle(shop, { name: "Pictures that travel", blurb: "A coast in pictures.", inspiredBy: "Original work" });
assert.ok(out.bundle, out.error);
const text = JSON.stringify(out.bundle);

await test("The bundle carries the place's picture as bytes, not as this server's path.", () => {
  assert.ok(!text.includes(placePicture), "the bundle names the source server's file");
  assert.equal(Object.keys(out.bundle.world.entryImages).length, 1);
  assert.match(Object.values(out.bundle.world.entryImages)[0], /^data:image\/png;base64,/);
  assert.ok(bundleImageCount(out.bundle) >= 2, "the warning before opening counts the world's pictures");
});

await test("Opened with the source files gone, the place and the map keep their pictures.", () => {
  fs.rmSync(path.join(process.cwd(), "public", placePicture));
  fs.rmSync(path.join(process.cwd(), "public", mapPicture));
  const read = readBundle(text);
  assert.ok(!("error" in read), read.error);
  const { workshopId } = importWorkshopBundle(owner.id, read.bundle);
  const view = worldView(workshopId);
  const copy = view.entities.find((entity) => entity.name === "Gullhaven");
  assert.ok(copy.portrait, "the place lost its picture");
  assert.notEqual(copy.portrait, placePicture);
  assert.deepEqual(bytesAt(copy.portrait), TINY_PNG);
  const atlas = view.doc.maps.find((entry) => entry.name === "The coast");
  assert.ok(atlas.image && atlas.image !== mapPicture);
  assert.deepEqual(bytesAt(atlas.image), TINY_PNG);
});

await test("A bundle from before entry pictures travelled opens with no dangling path.", () => {
  const old = JSON.parse(text);
  delete old.world.entryImages;
  const ref = Object.keys(old.world.doc.entries).find((key) => key.startsWith("location:"));
  old.world.doc.entries[ref].image = "/uploads/not-on-this-server.png";
  const read = readBundle(JSON.stringify(old));
  assert.ok(!("error" in read), read.error);
  const { workshopId } = importWorkshopBundle(owner.id, read.bundle);
  const copy = worldView(workshopId).entities.find((entity) => entity.name === "Gullhaven");
  assert.equal(copy.portrait, "", "the place points at another server's file");
});

world.close();
finish();
