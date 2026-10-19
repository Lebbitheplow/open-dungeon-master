// Audit finding WF-20, the server half: deleting from the Atlas answers with
// what the delete touches before anything goes, and once applied with a
// token that puts back exactly what went (a map's frame and Region role, its
// pins and their Region bindings, the pins elsewhere that opened it, and the
// maps drawn inside its pins), whatever a client sends. A token works once,
// for its own campaign. A map's frame changes only through its own reviewed
// step: with `carry` the pins and region corners keep their spots on the
// picture, and a bound place on the Region follows its pin.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-atlas-edit");
const { createWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { getOverworld, setOverworldAnchor } = await import("../src/lib/db/overworld.ts");
const { surfaceToPicture, frameOf } = await import("../src/lib/worldforge/atlas-frame.ts");
const { mapTree } = await import("../src/lib/worldforge/tree.ts");

const world = await openWorld();
const { campaignId, owner } = world;
const player = world.addUser("player");
world.addHero();
world.addHero({ user: player });

const route = (name) => world.route(name).catch(() => ({}));
const routes = {
  remove: await route("campaigns/[campaignId]/world/atlas/delete"),
  restore: await route("campaigns/[campaignId]/world/atlas/restore"),
  frame: await route("campaigns/[campaignId]/world/atlas/frame"),
  backdrop: await route("campaigns/[campaignId]/world/region/backdrop"),
  places: await route("campaigns/[campaignId]/world/region/places"),
  world: await route("campaigns/[campaignId]/world"),
};
const ctxFor = (id) => ({ params: Promise.resolve({ campaignId: id }) });
const send = (method, body) => new Request(`http://local/api/campaigns/${campaignId}/x`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function call(handler, body, id = campaignId) {
  const response = await handler(send("POST", body), ctxFor(id));
  return { status: response.status, body: await response.json() };
}

function png(width, height) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = zlib.deflateSync(Buffer.alloc((width * 3 + 1) * height));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", rows), chunk("IEND", Buffer.alloc(0))]);
}
const uploads = path.join(process.cwd(), "public", "uploads");
fs.mkdirSync(uploads, { recursive: true });
function upload(name, width, height) {
  fs.writeFileSync(path.join(uploads, `${name}.png`), png(width, height));
  return `/uploads/${name}.png`;
}

// The coast (a 2:1 picture in the workshop's 16:10 box) with two places
// pinned on it; Gullhaven's pin opens a harbour map drawn inside it; the
// river map has a pin that jumps to the coast.
const harbour = createWorldEntity(campaignId, { typeId: "t_location", name: "Gullhaven" }).entity;
const fort = createWorldEntity(campaignId, { typeId: "t_location", name: "Fort Reed" }).entity;
const coastArt = upload("edit-coast-art", 800, 400);
{
  const doc = getWorldDoc(campaignId);
  doc.maps.push({ id: "m_coast", name: "The coast", image: coastArt, parentPinId: "", regions: [{ id: "r_marsh", name: "The marsh", points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.2, y: 0.3 }], color: "#7da868", ref: "", notes: "" }, { id: "r_dunes", name: "The dunes", points: [{ x: 0.6, y: 0.6 }, { x: 0.8, y: 0.6 }, { x: 0.7, y: 0.8 }], color: "#c9a84c", ref: "", notes: "" }] });
  doc.maps.push({ id: "m_harbour", name: "The harbour", image: "", parentPinId: "p_gull", regions: [] });
  doc.maps.push({ id: "m_river", name: "The river", image: "", parentPinId: "", regions: [] });
  doc.pins.push({ id: "p_gull", mapId: "m_coast", x: 0.1, y: 0.5, name: "Gullhaven", ref: harbour.ref, linkedMapId: "m_harbour", notes: "" });
  doc.pins.push({ id: "p_fort", mapId: "m_coast", x: 0.9, y: 0.25, name: "Fort Reed", ref: fort.ref, linkedMapId: "", notes: "" });
  doc.pins.push({ id: "p_jump", mapId: "m_river", x: 0.5, y: 0.5, name: "To the coast", ref: "", linkedMapId: "m_coast", notes: "" });
  saveWorldDoc(campaignId, doc);
}
setOverworldAnchor(campaignId, harbour.id, { x: 2, y: 3 });
setOverworldAnchor(campaignId, fort.id, { x: 4, y: 5 });
const anchors = () => ({ ...getOverworld(campaignId).anchors });
const doc = () => getWorldDoc(campaignId);
const coast = () => doc().maps.find((atlas) => atlas.id === "m_coast");

await test("A player gets 403 from the delete, restore and frame steps, and nothing changes.", async () => {
  world.signIn(player);
  const before = JSON.stringify(doc());
  assert.equal((await call(routes.remove.POST, { target: { kind: "map", mapId: "m_coast" }, apply: true })).status, 403);
  assert.equal((await call(routes.restore.POST, { undo: "anything" })).status, 403);
  assert.equal((await call(routes.frame.POST, { mapId: "m_coast", fit: "contain", surface: 2, apply: true })).status, 403);
  assert.equal(JSON.stringify(doc()), before);
});

// The coast stands over the Region and both its pins are bound.
world.signIn(owner);
assert.equal((await call(routes.backdrop.POST, { mapId: "m_coast", apply: true })).status, 200);
assert.equal((await call(routes.places.POST, { apply: true })).status, 200);
const bound = anchors();

await test("A map's delete review names its pins, the pins elsewhere that open it, the maps drawn inside its pins and its bound pins, and deletes nothing.", async () => {
  const before = JSON.stringify(doc());
  const review = await call(routes.remove.POST, { target: { kind: "map", mapId: "m_coast" } });
  assert.equal(review.status, 200);
  assert.equal(review.body.applied, false);
  assert.equal(review.body.undo, undefined);
  assert.equal(review.body.impact.pins, 2);
  assert.deepEqual(review.body.impact.openers, ["To the coast"]);
  assert.deepEqual(review.body.impact.nested, ["The harbour"]);
  assert.equal(review.body.impact.bound, 2);
  assert.equal(review.body.impact.overRegion, true);
  assert.match(review.body.notes.join(" "), /Region keeps its picture/);
  assert.equal(JSON.stringify(doc()), before);
});

await test("Deleting the map over the Region and undoing it puts back its frame, its role, its regions, its bound pins, the pin that opened it and the map nested in its pin; no place moves at any point.", async () => {
  const frame = coast().frame;
  assert.ok(frame && frame.image === 2, "the backdrop step measured the picture");
  const done = await call(routes.remove.POST, { target: { kind: "map", mapId: "m_coast" }, apply: true });
  assert.equal(done.status, 200);
  assert.ok(done.body.undo, "a token to undo with");
  assert.equal(coast(), undefined);
  assert.equal(doc().pins.some((pin) => pin.mapId === "m_coast"), false);
  assert.equal(doc().pins.find((pin) => pin.id === "p_jump").linkedMapId, "");
  assert.equal(mapTree(doc().maps, doc().pins).find((entry) => entry.map.id === "m_harbour").depth, 0, "the harbour moved to the top");
  assert.deepEqual(anchors(), bound);

  const back = await call(routes.restore.POST, { undo: done.body.undo });
  assert.equal(back.status, 200);
  assert.deepEqual(back.body.skipped, []);
  assert.equal(coast().role, "region");
  assert.deepEqual(coast().frame, frame);
  assert.deepEqual(coast().regions.map((region) => region.id), ["r_marsh", "r_dunes"]);
  assert.equal(doc().pins.find((pin) => pin.id === "p_gull").regionLink, harbour.ref);
  assert.equal(doc().pins.find((pin) => pin.id === "p_fort").regionLink, fort.ref);
  assert.equal(doc().pins.find((pin) => pin.id === "p_jump").linkedMapId, "m_coast");
  assert.equal(mapTree(doc().maps, doc().pins).find((entry) => entry.map.id === "m_harbour").depth, 1, "the harbour is inside Gullhaven's pin again");
  assert.deepEqual(anchors(), bound);
});

await test("A token works once, and only for its own campaign.", async () => {
  const done = await call(routes.remove.POST, { target: { kind: "pin", pinId: "p_jump" }, apply: true });
  const other = await call(routes.restore.POST, { undo: done.body.undo }, "someone-else");
  assert.ok(other.status === 403 || other.status === 410 || other.status === 404, `another campaign's undo answered ${other.status}`);
  assert.equal(doc().pins.some((pin) => pin.id === "p_jump"), false);
  assert.equal((await call(routes.restore.POST, { undo: done.body.undo })).status, 200);
  assert.equal((await call(routes.restore.POST, { undo: done.body.undo })).status, 410);
  assert.equal(doc().pins.filter((pin) => pin.id === "p_jump").length, 1);
  assert.equal((await call(routes.restore.POST, { undo: "made-up" })).status, 410);
});

await test("A region comes back at its own place in the list.", async () => {
  const done = await call(routes.remove.POST, { target: { kind: "region", mapId: "m_coast", regionId: "r_marsh" }, apply: true });
  assert.deepEqual(coast().regions.map((region) => region.id), ["r_dunes"]);
  await call(routes.restore.POST, { undo: done.body.undo });
  assert.deepEqual(coast().regions.map((region) => region.id), ["r_marsh", "r_dunes"]);
});

await test("A map restored after another map took the Region comes back without the role, and says so.", async () => {
  const done = await call(routes.remove.POST, { target: { kind: "map", mapId: "m_coast" }, apply: true });
  const river = doc();
  river.maps = river.maps.map((atlas) => (atlas.id === "m_river" ? { ...atlas, role: "region" } : atlas));
  saveWorldDoc(campaignId, river);
  const back = await call(routes.restore.POST, { undo: done.body.undo });
  assert.equal(coast().role, undefined);
  assert.match(back.body.skipped.join(" "), /another map now stands over the Region/);
  // Put the coast back over the Region for the frame tests.
  const tidy = doc();
  tidy.maps = tidy.maps.map((atlas) => {
    const { role, ...rest } = atlas;
    void role;
    return atlas.id === "m_coast" ? { ...rest, role: "region" } : rest;
  });
  saveWorldDoc(campaignId, tidy);
});

await test("The editor's own save cannot write a map's frame; the frame step reviews first, and with carry every pin and corner keeps its spot on the picture.", async () => {
  const before = coast().frame;
  await routes.world.PATCH(new Request("http://local/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ maps: doc().maps.map((atlas) => (atlas.id === "m_coast" ? { ...atlas, frame: { surface: 3, image: 2, fit: "contain" } } : atlas)) }) }), ctxFor(campaignId));
  assert.deepEqual(coast().frame, before, "a plain save changed the frame");

  const onPicture = (frame, at) => surfaceToPicture(frame, at);
  const old = frameOf(coast());
  const pinsBefore = doc().pins.filter((pin) => pin.mapId === "m_coast");
  const cornersBefore = coast().regions[0].points;
  const snapshot = JSON.stringify(doc());
  const review = await call(routes.frame.POST, { mapId: "m_coast", fit: "cover", surface: "picture" });
  assert.equal(review.status, 200);
  assert.equal(review.body.applied, false);
  assert.ok(review.body.moved > 0, "pins move in the box to stay on the picture");
  assert.equal(review.body.after.surface, 2);
  assert.equal(JSON.stringify(doc()), snapshot, "the review wrote nothing");

  const applied = await call(routes.frame.POST, { mapId: "m_coast", fit: "cover", surface: "picture", apply: true });
  assert.equal(applied.body.applied, true);
  const now = frameOf(coast());
  assert.equal(now.surface, 2);
  for (const pin of pinsBefore) {
    const after = doc().pins.find((entry) => entry.id === pin.id);
    const a = onPicture(old, pin);
    const b = onPicture(now, after);
    assert.ok(Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3, `${pin.name} moved on the picture`);
    assert.equal(after.regionLink, pin.regionLink, "the binding survived");
  }
  coast().regions[0].points.forEach((point, index) => {
    const a = onPicture(old, cornersBefore[index]);
    const b = onPicture(now, point);
    assert.ok(Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3, `corner ${index + 1} moved on the picture`);
  });
  // The pins stayed on the same spots of the same picture, so their places
  // on the Region did not move.
  assert.deepEqual(applied.body.placements, []);
  assert.deepEqual(anchors(), bound);
});

await test("Without carry the pins keep their places in the box, and a bound place follows its pin to the square under it.", async () => {
  const pinsBefore = doc().pins.filter((pin) => pin.mapId === "m_coast").map((pin) => ({ id: pin.id, x: pin.x, y: pin.y }));
  const review = await call(routes.frame.POST, { mapId: "m_coast", fit: "contain", surface: 1, carry: false });
  assert.match(review.body.notes.join(" "), /keep their places in the box/);
  const applied = await call(routes.frame.POST, { mapId: "m_coast", fit: "contain", surface: 1, carry: false, apply: true });
  for (const pin of pinsBefore) {
    const after = doc().pins.find((entry) => entry.id === pin.id);
    assert.equal(after.x, pin.x);
    assert.equal(after.y, pin.y);
  }
  assert.deepEqual(applied.body.placements, review.body.placements, "the review said what the change did");
  for (const placement of applied.body.placements) assert.deepEqual(anchors()[placement.locationId], placement.after);
});

await test("The picture's own shape needs an uploaded picture, and a frame needs a fit and a sane shape.", async () => {
  const none = await call(routes.frame.POST, { mapId: "m_river", fit: "cover", surface: "picture" });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /no uploaded picture/);
  assert.equal((await call(routes.frame.POST, { mapId: "m_river", fit: "stretch", surface: 1 })).status, 400);
  assert.equal((await call(routes.frame.POST, { mapId: "m_river", fit: "cover", surface: 50 })).status, 400);
  assert.equal((await call(routes.frame.POST, { mapId: "m_nowhere", fit: "cover", surface: 1 })).status, 404);
});

finish();
