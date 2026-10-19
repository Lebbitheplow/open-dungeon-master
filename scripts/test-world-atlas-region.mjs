// The bridge between WorldForge's Atlas and the playable Region map (audit
// finding WF-09). A map used as the Region's backdrop shows its own
// uploaded picture there and is recorded as the map over the Region. A pin
// on it places its place on the Region through the map's frame, so a
// picture of any shape stays aligned; once bound, the pin and the place's
// marker move together from either side, and every move says where things
// stood before. A pin nobody bound moves nothing. Players reach none of it,
// and a WorldForge file's import follows the same rules.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-atlas-region");
const { createWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { getOverworld, setOverworldAnchor } = await import("../src/lib/db/overworld.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { applyWorldImport } = await import("../src/lib/db/world-forge-io.ts");

const world = await openWorld();
const { campaignId, owner } = world;
const player = world.addUser("player");
world.addHero();
world.addHero({ user: player });

// A route that is missing fails the tests that call it, not the file.
const route = (name) => world.route(name).catch(() => ({}));
const routes = {
  world: await route("campaigns/[campaignId]/world"),
  region: await route("campaigns/[campaignId]/world/region"),
  backdrop: await route("campaigns/[campaignId]/world/region/backdrop"),
  places: await route("campaigns/[campaignId]/world/region/places"),
  overworld: await route("campaigns/[campaignId]/overworld"),
};
const ctx = { params: Promise.resolve({ campaignId }) };
const send = (method, body, query = "") =>
  new Request(`http://local/api/campaigns/${campaignId}/x${query}`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function call(handler, method, body, query) {
  const response = await handler(send(method, body, query), ctx);
  return { status: response.status, body: await response.json() };
}

// A real PNG of the given size: a header honest about its shape, and rows
// of nothing.
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
const uploadCount = () => fs.readdirSync(uploads).length;

// Two places, an Atlas map of the whole coast with a picture twice as wide
// as it is tall (the workshop shows it cropped into a 16:10 box), a tall
// map of the river for later, and pins.
const harbour = createWorldEntity(campaignId, { typeId: "t_location", name: "Gullhaven" }).entity;
const fort = createWorldEntity(campaignId, { typeId: "t_location", name: "Fort Reed" }).entity;
const mill = createWorldEntity(campaignId, { typeId: "t_location", name: "The Mill" }).entity;
const coastArt = upload("coast-art", 800, 400);
const riverArt = upload("river-art", 200, 400);
{
  const doc = getWorldDoc(campaignId);
  doc.maps.push({ id: "m_coast", name: "The coast", image: coastArt, parentPinId: "", regions: [] });
  doc.maps.push({ id: "m_river", name: "The river", image: riverArt, parentPinId: "", regions: [] });
  doc.pins.push({ id: "p_gull", mapId: "m_coast", x: 0.1, y: 0.5, name: "Gullhaven", ref: harbour.ref, linkedMapId: "", notes: "" });
  doc.pins.push({ id: "p_fort", mapId: "m_coast", x: 0.9, y: 0.25, name: "Fort Reed", ref: fort.ref, linkedMapId: "", notes: "" });
  doc.pins.push({ id: "p_mill", mapId: "m_river", x: 0.5, y: 0.9, name: "The Mill", ref: mill.ref, linkedMapId: "", notes: "" });
  saveWorldDoc(campaignId, doc);
}
const anchorOf = (place) => getOverworld(campaignId).anchors[place.id];
const pinOf = (id) => getWorldDoc(campaignId).pins.find((pin) => pin.id === id);
// Every place has a Region marker before any of this, placed by the Region
// itself.
setOverworldAnchor(campaignId, harbour.id, { x: 2, y: 3 });
setOverworldAnchor(campaignId, fort.id, { x: 4, y: 5 });
setOverworldAnchor(campaignId, mill.id, { x: 6, y: 7 });

await test("A player gets 403 from every new Region route, and nothing changes.", async () => {
  world.signIn(player);
  const terrain = getOverworld(campaignId).terrain;
  for (const [handler, method, body] of [
    [routes.region.GET, "GET"],
    [routes.backdrop.POST, "POST", { mapId: "m_coast", apply: true }],
    [routes.backdrop.DELETE, "DELETE"],
    [routes.places.POST, "POST", { apply: true }],
    [routes.places.DELETE, "DELETE", {}],
  ]) {
    assert.equal((await call(handler, method, body)).status, 403, `${method} answered a player`);
  }
  assert.equal(getOverworld(campaignId).backdropPath, "");
  assert.equal(getOverworld(campaignId).terrain, terrain);
  assert.equal(getWorldDoc(campaignId).maps.some((atlas) => atlas.role), false);
});

await test("Placing a pin before any map stands over the Region is refused and says what to do first.", async () => {
  world.signIn(owner);
  const refused = await call(routes.places.POST, "POST", { pinIds: ["p_gull"], apply: true });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Use one as the Region backdrop first/);
  assert.deepEqual(anchorOf(harbour), { x: 2, y: 3 });
});

await test("Using an Atlas map as the Region backdrop shows the review first, then reuses the same uploaded picture and records the link; the ground is left as it was.", async () => {
  world.signIn(owner);
  const files = uploadCount();
  const terrain = getOverworld(campaignId).terrain;
  const review = await call(routes.backdrop.POST, "POST", { mapId: "m_coast" });
  assert.equal(review.status, 200);
  assert.equal(review.body.applied, false);
  assert.deepEqual(review.body.before, { backdropPath: "", mapId: null });
  assert.deepEqual(review.body.after, { backdropPath: coastArt, mapId: "m_coast" });
  assert.equal(review.body.frame.image, 2, "the picture's shape was measured from the file");
  assert.match(review.body.notes.join(" "), /never read from a picture/);
  assert.equal(getOverworld(campaignId).backdropPath, "", "the review changed the Region");

  const applied = await call(routes.backdrop.POST, "POST", { mapId: "m_coast", apply: true });
  assert.equal(applied.body.applied, true);
  const region = getOverworld(campaignId);
  assert.equal(region.backdropPath, coastArt, "the Region shows the map's own file");
  assert.equal(uploadCount(), files, "a copy of the picture was written");
  assert.equal(region.terrain, terrain, "the ground was changed from the picture");
  const coast = getWorldDoc(campaignId).maps.find((atlas) => atlas.id === "m_coast");
  assert.equal(coast.role, "region");
  assert.deepEqual(coast.frame, { surface: 1.6, image: 2, fit: "cover" });
  assert.deepEqual([anchorOf(harbour), anchorOf(fort)], [{ x: 2, y: 3 }, { x: 4, y: 5 }], "linking the map moved a place");

  const status = await call(routes.region.GET, "GET");
  assert.equal(status.body.map.id, "m_coast");
  assert.equal(status.body.backdropIsMap, true);
  assert.deepEqual(status.body.pins, [], "a pin was bound without being placed");
});

await test("Placing a location answers with its marker now and where it would go, through the map's frame; applying it moves the marker and binds the pin.", async () => {
  world.signIn(owner);
  const { width, height } = getOverworld(campaignId);
  // The 2:1 picture is cropped to the 16:10 box: 0.1 across the box is
  // 0.5 - 0.4 * (1.6 / 2) = 0.18 across the picture, so cell 17 of 96. A
  // reading that ignored the crop would say cell 9.
  const expected = { x: Math.floor(0.18 * width), y: Math.floor(0.5 * height) };
  assert.deepEqual(expected, { x: 17, y: 36 });
  const review = await call(routes.places.POST, "POST", { pinIds: ["p_gull"] });
  assert.equal(review.status, 200);
  assert.equal(review.body.applied, false);
  assert.deepEqual(review.body.placements.map((entry) => [entry.pinId, entry.before, entry.after]), [["p_gull", { x: 2, y: 3 }, expected]]);
  assert.deepEqual(anchorOf(harbour), { x: 2, y: 3 }, "the review moved the place");
  assert.equal(pinOf("p_gull").regionLink, undefined, "the review bound the pin");

  const applied = await call(routes.places.POST, "POST", { pinIds: ["p_gull", "p_mill"], apply: true });
  assert.equal(applied.body.applied, true);
  assert.deepEqual(anchorOf(harbour), expected);
  assert.equal(pinOf("p_gull").regionLink, harbour.ref);
  assert.deepEqual(applied.body.skipped, [{ pinId: "p_mill", reason: "It is not on The coast, the map over the Region." }]);
  assert.deepEqual(anchorOf(mill), { x: 6, y: 7 });

  const status = await call(routes.region.GET, "GET");
  assert.deepEqual(status.body.pins.map((entry) => [entry.pinId, entry.inStep]), [["p_gull", true]]);
});

await test("Moving a bound pin in the Atlas moves its place's Region marker and reports where the marker stood; the editor cannot drop the binding.", async () => {
  world.signIn(owner);
  const before = anchorOf(harbour);
  // What the Atlas sends: the whole pins slice, rows written as the editor
  // knows them (without the binding).
  const pins = getWorldDoc(campaignId).pins.map((row) => {
    const pin = { ...row };
    delete pin.regionLink;
    return pin.id === "p_gull" ? { ...pin, x: 0.5, y: 0.25 } : pin;
  });
  const saved = await call(routes.world.PATCH, "PATCH", { pins });
  assert.equal(saved.status, 200);
  const after = { x: 48, y: 18 };
  assert.deepEqual(anchorOf(harbour), after);
  assert.deepEqual(saved.body.region, [{ pinId: "p_gull", pin: "Gullhaven", locationId: harbour.id, name: "Gullhaven", before, after, onPicture: true }]);
  assert.equal(pinOf("p_gull").regionLink, harbour.ref, "a save from the editor dropped the binding");
  // The old spot is enough to put it back.
  const undone = await call(routes.overworld.PATCH, "PATCH", { anchor: { locationId: harbour.id, ...before } });
  assert.deepEqual(anchorOf(harbour), before);
  assert.equal(undone.body.atlas[0].pinId, "p_gull");
});

await test("Moving a bound place's Region marker moves its pin to the same point of the picture and reports where the pin stood.", async () => {
  world.signIn(owner);
  const before = { x: pinOf("p_gull").x, y: pinOf("p_gull").y };
  const moved = await call(routes.overworld.PATCH, "PATCH", { anchor: { locationId: harbour.id, x: 60, y: 9 } });
  assert.equal(moved.status, 200);
  const [move] = moved.body.atlas;
  assert.deepEqual([move.pinId, move.before], ["p_gull", before]);
  const pin = pinOf("p_gull");
  assert.deepEqual({ x: pin.x, y: pin.y }, move.after);
  // Cell 60's middle is 60.5 / 96 across the picture, which the 16:10 box
  // shows from 0.1 to 0.9: (60.5 / 96 - 0.5) / 0.8 + 0.5 across the box.
  assert.ok(Math.abs(pin.x - ((60.5 / 96 - 0.5) / 0.8 + 0.5)) < 1e-4, `the pin went to ${pin.x}`);
  const status = await call(routes.region.GET, "GET");
  assert.deepEqual(status.body.pins[0].anchor, { x: 60, y: 9 });
  assert.equal(status.body.pins[0].inStep, true);
});

await test("A pin nobody bound moves nothing, from either side, even on the map over the Region.", async () => {
  world.signIn(owner);
  const before = anchorOf(fort);
  // One save moves both pins on the map: only the bound one's place moves.
  const pins = getWorldDoc(campaignId).pins.map((pin) =>
    pin.id === "p_fort" ? { ...pin, x: 0.2, y: 0.8 } : pin.id === "p_gull" ? { ...pin, x: 0.5, y: 0.5 } : pin,
  );
  const saved = await call(routes.world.PATCH, "PATCH", { pins });
  assert.deepEqual((saved.body.region ?? []).map((entry) => entry.pinId), ["p_gull"]);
  assert.deepEqual(anchorOf(fort), before);
  const pinBefore = pinOf("p_fort");
  assert.equal(pinBefore.regionLink, undefined);
  const dragged = await call(routes.overworld.PATCH, "PATCH", { anchor: { locationId: fort.id, x: 30, y: 30 } });
  assert.equal(dragged.body.atlas, undefined);
  assert.deepEqual(pinOf("p_fort"), pinBefore);
  const status = await call(routes.region.GET, "GET");
  assert.deepEqual((status.body.pins ?? []).map((entry) => entry.pinId), ["p_gull"], "a pin was bound because it names a place");
});

await test("A pin pointed at another place loses its binding rather than moving the new place.", async () => {
  world.signIn(owner);
  assert.equal(pinOf("p_gull").regionLink, harbour.ref);
  const fortSpot = anchorOf(fort);
  const pins = getWorldDoc(campaignId).pins.map((pin) => (pin.id === "p_gull" ? { ...pin, ref: fort.ref, x: 0.7, y: 0.7 } : pin));
  const saved = await call(routes.world.PATCH, "PATCH", { pins });
  assert.equal(saved.body.region, undefined);
  assert.deepEqual(anchorOf(fort), fortSpot);
  assert.equal(pinOf("p_gull").regionLink, undefined);
});

await test("A map with a tall picture keeps its pins and places aligned through its own frame.", async () => {
  world.signIn(owner);
  const switched = await call(routes.backdrop.POST, "POST", { mapId: "m_river", apply: true });
  assert.equal(switched.body.before.mapId, "m_coast");
  assert.equal(getOverworld(campaignId).backdropPath, riverArt);
  const maps = getWorldDoc(campaignId).maps;
  assert.equal(maps.find((atlas) => atlas.id === "m_coast").role, undefined, "two maps stand over the Region");
  assert.equal(maps.find((atlas) => atlas.id === "m_river").frame.image, 0.5);
  // The 1:2 picture cropped into the 16:10 box shows only the middle
  // 0.5 / 1.6 of its height: 0.9 down the box is 0.5 + 0.4 * 0.3125 =
  // 0.625 down the picture, cell 45 of 72.
  await call(routes.places.POST, "POST", { pinIds: ["p_mill"], apply: true });
  assert.deepEqual(anchorOf(mill), { x: 48, y: 45 });
  // And back: a marker dragged anywhere the box shows brings the pin to a
  // spot whose cell is the marker's.
  const dragged = await call(routes.overworld.PATCH, "PATCH", { anchor: { locationId: mill.id, x: 10, y: 40 } });
  assert.equal(dragged.body.atlas[0].onSurface, true);
  const pin = pinOf("p_mill");
  const review = await call(routes.places.POST, "POST", { pinIds: ["p_mill"] });
  assert.deepEqual(review.body.placements[0].after, { x: 10, y: 40 }, `the pin at ${pin.x}, ${pin.y} reads as another cell`);
});

await test("Releasing a pin, and taking the map off the Region, move nothing.", async () => {
  world.signIn(owner);
  const millSpot = anchorOf(mill);
  const released = await call(routes.places.DELETE, "DELETE", { pinIds: ["p_mill"] });
  assert.deepEqual(released.body.released, [{ pinId: "p_mill", pin: "The Mill" }]);
  assert.equal(pinOf("p_mill").regionLink, undefined);
  assert.deepEqual(anchorOf(mill), millSpot);
  const unlinked = await call(routes.backdrop.DELETE, "DELETE", undefined, "?clear=1");
  assert.equal(unlinked.body.map.id, "m_river");
  assert.equal(getOverworld(campaignId).backdropPath, "");
  assert.equal(getWorldDoc(campaignId).maps.some((atlas) => atlas.role), false);
  assert.deepEqual(anchorOf(mill), millSpot);
});

await test("A WorldForge file's import still places the places it makes, through the same bridge: its top map stands over the undressed Region, as its picture.", () => {
  const raw = JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8"));
  const root = raw.maps.find((atlas) => !atlas.parentPinId) ?? raw.maps[0];
  raw.media = { ...(raw.media ?? {}), mapBackgrounds: { ...(raw.media?.mapBackgrounds ?? {}), [root.id]: `data:image/png;base64,${png(400, 100).toString("base64")}` } };
  const read = readBundle(JSON.stringify(raw));
  assert.ok(read.worldForge, "the file was not read as WorldForge's");
  const { workshopId } = importWorkshopBundle(owner.id, read.bundle);
  const result = applyWorldImport(workshopId, { id: owner.id }, read.worldForge);
  assert.ok(!("error" in result), result.error);
  const doc = getWorldDoc(workshopId);
  const top = doc.maps.find((atlas) => atlas.role === "region");
  assert.ok(top, "no map stands over the Region");
  assert.ok(top.image, "the map's picture did not come in");
  // WorldForge places pins on the picture itself.
  assert.deepEqual(top.frame, { surface: 4, image: 4, fit: "cover" });
  const region = getOverworld(workshopId);
  assert.equal(region.backdropPath, top.image);
  const pin = doc.pins.find((entry) => entry.id === "p1");
  assert.equal(pin.regionLink, pin.ref, "the pin of a place the import made was not bound");
  const placeId = pin.ref.slice("location:".length);
  assert.deepEqual(region.anchors[placeId], { x: Math.floor(pin.x * region.width), y: Math.floor(pin.y * region.height) });
  assert.match(result.notes.join(" "), /now stands over the Region map as its picture/);
  // The same file again: the map and the binding are the workshop's own,
  // not a disagreement with the file.
  const again = applyWorldImport(workshopId, { id: owner.id }, readBundle(JSON.stringify(raw)).worldForge);
  assert.deepEqual(again.conflicts.filter((line) => /role|frame|regionLink/.test(line)), []);
  const after = getWorldDoc(workshopId);
  assert.equal(after.pins.find((entry) => entry.id === "p1").regionLink, pin.ref);
  assert.equal(after.maps.find((atlas) => atlas.id === top.id).role, "region");
});

finish();
