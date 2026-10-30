// Issue 548 through the engine: a made-up world's rooms and approaches fold
// into the place they are part of, a new place lands where the DM says it
// lies, the region map draws places of their own only, and the DM files or
// lifts an area from the Map tab. Each test names the behaviour it holds.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { aiEngine, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-region-map-places");
const world = await openWorld();
const ai = await aiEngine(world);
const { getLocationByName, listLocations } = await import("../src/lib/db/locations.ts");
const { overworldView } = await import("../src/lib/db/overworld.ts");
const { listEventsSince } = await import("../src/lib/events.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { placeTree } = await import("../src/lib/overworld/places.ts");
const { lexicalMatch, signalFromToolCall } = await import("../src/lib/dm/waypoint-logic.ts");
const overworldRoute = await import(new URL("../src/app/api/campaigns/[campaignId]/overworld/route.ts", import.meta.url).href);
const { regionPlaces } = await import(new URL("../src/app/campaigns/[campaignId]/regionPlaces.ts", import.meta.url).href);
// The dots the region map draws, from the same view the panel loads.
const drawnPlaces = () => regionPlaces(overworldView(world.campaignId, false).locations);

const quiet = { visionClear: false };
const named = (name) => getLocationByName(world.campaignId, name);
const anchorOf = (name) => overworldView(world.campaignId, true).locations.find((place) => place.name === name)?.anchor ?? null;
const lastSeq = () => Math.max(0, ...listEventsSince(world.campaignId, 0, 100_000).map((event) => event.seq));
const announced = (since) =>
  listEventsSince(world.campaignId, since, 100_000)
    .filter((event) => event.type === "location_updated")
    .map((event) => event.payload.location.name);
// Open plains under the whole map. A campaign's terrain is rolled from a
// random seed, so now and then a lake lay where "a day north" points and the
// place was moved round it, short of a day; these tests are about where the
// DM said a place lies, not about lakes.
const { getOverworld, replaceOverworldTerrain } = await import("../src/lib/db/overworld.ts");
const ground = getOverworld(world.campaignId);
replaceOverworldTerrain(world.campaignId, { terrain: "p".repeat(ground.width * ground.height), width: ground.width, height: ground.height, paths: [] });
const hero = world.addHero({ class: "fighter" });
const player = world.addHero({ class: "rogue" });

async function patch(user, body) {
  globalThis.__odmTestToken = mintSession(user).token;
  const response = await overworldRoute.PATCH(
    new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

await test("A room named with partOf files under its vault, which is made on the spot and announced; the region map draws the vault and not the room", async () => {
  const opened = await ai.invoke("move_party", { ...quiet, name: "Thornhollow", layoutDescription: "A village green ringed by cottages." });
  assert.equal(opened.ok, true, opened.error);
  overworldView(world.campaignId, true);
  const since = lastSeq();
  const moved = await ai.invoke("move_party", {
    ...quiet,
    name: "Hollowroot Vault Entrance Passage",
    layoutDescription: "A root-choked stair down into the dark.",
    partOf: "Hollowroot Vault",
    direction: "north",
    distance: "a day",
  });
  assert.equal(moved.ok, true, moved.error);
  const room = named("Hollowroot Vault Entrance Passage");
  const vault = named("Hollowroot Vault");
  assert.equal(room.parentName, "Hollowroot Vault");
  assert.ok(vault, "the vault was made");
  assert.equal(vault.isCurrent, false, "the party stands in the room, not the vault");
  assert.ok(announced(since).includes("Hollowroot Vault"), "the new vault was announced to the table");
  assert.equal(anchorOf("Hollowroot Vault Entrance Passage"), null, "the room has no dot of its own");
  const village = anchorOf("Thornhollow");
  const dot = anchorOf("Hollowroot Vault");
  assert.ok(dot && village, "both places of their own are on the map");
  assert.ok(dot.y < village.y - 6, `a day north of the village: village ${JSON.stringify(village)}, vault ${JSON.stringify(dot)}`);
});

await test("A second room of the same vault files under it whatever its case, and moves nothing on the map", async () => {
  const before = anchorOf("Hollowroot Vault");
  const moved = await ai.invoke("move_party", { ...quiet, name: "Inner Sanctum", partOf: "hollowroot vault", direction: "south", distance: "nearby" });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(named("Inner Sanctum").parentName, "Hollowroot Vault", "stored under the vault's own spelling");
  assert.deepEqual(anchorOf("Hollowroot Vault"), before, "a move between two rooms of one place does not move the place");
});

await test("A new place left out of partOf files under a place whose whole name its own opens with, and keeps no dot", async () => {
  await ai.invoke("move_party", { ...quiet, name: "Hollowroot Vault Root Gallery" });
  const gallery = named("Hollowroot Vault Root Gallery");
  assert.equal(gallery.parentName, "Hollowroot Vault", "written down when the place was made");
  const tree = placeTree(listLocations(world.campaignId));
  assert.equal(tree.parentOf.get(gallery.id), named("Hollowroot Vault").id);
  assert.equal(anchorOf("Hollowroot Vault Root Gallery"), null);
  const vaultDot = drawnPlaces().find((place) => place.name === "Hollowroot Vault");
  assert.deepEqual([...vaultDot.parts].sort(), ["Entrance Passage", "Inner Sanctum", "Root Gallery"], "the vault holds its three rooms by their short names");
  assert.equal(vaultDot.isCurrent, true, "the party in a room is the party at the vault");
});

await test("A new place of its own lands the way and as far as the DM said, from where the party set out", async () => {
  await ai.invoke("move_party", { ...quiet, name: "Thornhollow" });
  const village = anchorOf("Thornhollow");
  const moved = await ai.invoke("move_party", { ...quiet, name: "Briarwatch Tower", direction: "East", distance: "half_a_day" });
  assert.equal(moved.ok, true, moved.error);
  const tower = anchorOf("Briarwatch Tower");
  assert.ok(tower.x > village.x + 3, `east of the village: ${JSON.stringify(village)} -> ${JSON.stringify(tower)}`);
  assert.ok(Math.abs(tower.y - village.y) <= 4, `and roughly level with it: ${JSON.stringify(tower)}`);
});

await test("Without a direction, a new place lands near where the party set out, not near whichever of its routes is listed first", async () => {
  const tower = anchorOf("Briarwatch Tower");
  await ai.invoke("move_party", { ...quiet, name: "Old Mill", connections: ["Hollowroot Vault"] });
  const mill = anchorOf("Old Mill");
  const fromTower = Math.max(Math.abs(mill.x - tower.x), Math.abs(mill.y - tower.y));
  assert.ok(fromTower <= 9, `the mill is ${fromTower} tiles from the tower the party walked from`);
});

await test("A partOf that would make a loop is reported and the move still stands", async () => {
  const moved = await ai.invoke("move_party", { ...quiet, name: "Hollowroot Vault", partOf: "Inner Sanctum" });
  assert.equal(moved.ok, true, moved.error);
  assert.match(moved.result.note, /partOf was not applied: Inner Sanctum is already part of Hollowroot Vault/);
  assert.equal(named("Hollowroot Vault").isCurrent, true);
  assert.equal(named("Hollowroot Vault").parentName, null);
});

await test("move_party to where the party already stands, with partOf, files that place, and the place it names takes over its dot", async () => {
  await ai.invoke("move_party", { ...quiet, name: "Old Mill" });
  const millDot = anchorOf("Old Mill");
  const updated = await ai.invoke("move_party", { ...quiet, name: "Old Mill", partOf: "Millbrook" });
  assert.equal(updated.ok, true, updated.error);
  assert.equal(named("Old Mill").parentName, "Millbrook");
  assert.deepEqual(anchorOf("Millbrook"), millDot, "the hamlet stands where its mill stood");
  // The mill keeps its old spot on record, so lifting it out puts it back,
  // but the map draws the hamlet alone there.
  const drawn = drawnPlaces();
  assert.ok(drawn.some((place) => place.name === "Millbrook" && place.parts.includes("Old Mill")));
  assert.ok(!drawn.some((place) => place.name === "Old Mill"));
});

await test("A partOf naming the place the party set out from, for a place half a day or more away, is a region and not a room: the place stands on its own", async () => {
  await ai.invoke("move_party", { ...quiet, name: "Old Mill" });
  const moved = await ai.invoke("move_party", { ...quiet, name: "Ashford", partOf: "Millbrook", direction: "west", distance: "a day" });
  assert.equal(moved.ok, true, moved.error);
  assert.match(moved.result.note, /partOf was not applied: the party set out from Millbrook, and a place a day away is a place of its own/);
  assert.equal(named("Ashford").parentName, "");
  const mill = anchorOf("Millbrook");
  const ford = anchorOf("Ashford");
  assert.ok(ford && ford.x < mill.x - 6, `a day west of Millbrook: ${JSON.stringify(mill)} -> ${JSON.stringify(ford)}`);
});

await test("partOf does not tick a step by itself: entering any room of the vault is not reaching its inner sanctum", () => {
  const signal = signalFromToolCall("move_party", JSON.stringify({ name: "Hollowroot Vault Entrance Passage", partOf: "Hollowroot Vault" }));
  assert.deepEqual(signal, { kind: "place", names: ["Hollowroot Vault Entrance Passage"] });
  assert.equal(lexicalMatch("Reach the inner sanctum of Hollowroot Vault", signal.names[0], "english"), false);
});

await test("A new place given a direction and no partOf is a place of its own, even when its name opens with where the party set out", async () => {
  await ai.invoke("move_party", { ...quiet, name: "Thornhollow" });
  const village = anchorOf("Thornhollow");
  const moved = await ai.invoke("move_party", { ...quiet, name: "Thornhollow Watchtower", direction: "north", distance: "a day" });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(named("Thornhollow Watchtower").parentName, "", "the model said where it lies");
  const tower = anchorOf("Thornhollow Watchtower");
  assert.ok(tower && tower.y < village.y - 6, `a day north of the village: ${JSON.stringify(village)} -> ${JSON.stringify(tower)}`);
  assert.ok(drawnPlaces().some((place) => place.name === "Thornhollow Watchtower"), "it has a dot of its own");
});

await test("The DM files an area under a bigger place from the Map tab, lifts it out again, and is refused a loop; a player is refused outright", async () => {
  const tower = named("Briarwatch Tower");
  const since = lastSeq();
  const filed = await patch(world.owner.id, { parent: { locationId: tower.id, parentName: "Thornhollow" } });
  assert.equal(filed.status, 200, JSON.stringify(filed.body));
  assert.equal(named("Briarwatch Tower").parentName, "Thornhollow");
  assert.equal(filed.body.locations.find((place) => place.id === tower.id).parentName, "Thornhollow");
  assert.ok(announced(since).includes("Briarwatch Tower"), "the area list hears it");
  const lifted = await patch(world.owner.id, { parent: { locationId: tower.id, parentName: "" } });
  assert.equal(lifted.status, 200);
  assert.equal(named("Briarwatch Tower").parentName, "", "said to stand on its own");
  const vault = named("Hollowroot Vault");
  const loop = await patch(world.owner.id, { parent: { locationId: vault.id, parentName: "Inner Sanctum" } });
  assert.equal(loop.status, 400);
  const self = await patch(world.owner.id, { parent: { locationId: vault.id, parentName: "hollowroot vault" } });
  assert.equal(self.status, 400);
  const nowhere = await patch(world.owner.id, { parent: { locationId: vault.id, parentName: "Nowhere Keep" } });
  assert.equal(nowhere.status, 400);
  const refused = await patch(player.userId, { parent: { locationId: tower.id, parentName: "Thornhollow" } });
  assert.equal(refused.status, 403);
  assert.equal(named("Briarwatch Tower").parentName, "");
});

await test("The DM's own filing stands: the model's partOf does not overturn a place the DM called a place of its own", async () => {
  await ai.invoke("move_party", { ...quiet, name: "Thornhollow" });
  const moved = await ai.invoke("move_party", { ...quiet, name: "Briarwatch Tower", partOf: "Thornhollow" });
  assert.equal(moved.ok, true, moved.error);
  assert.match(moved.result.note, /partOf was not applied: Briarwatch Tower is already a place of its own/);
  assert.equal(named("Briarwatch Tower").parentName, "");
});

await test("An upgraded campaign's places are filed once by their names, unless a namesake's dot stands far from the place", async () => {
  const { insertKnownLocation } = await import("../src/lib/db/locations.ts");
  const { setOverworldAnchor } = await import("../src/lib/db/overworld.ts");
  const { getDatabase } = await import("../src/lib/db/core.ts");
  const { fileSubAreasByName } = await import("../src/lib/db/place-parents-backfill.ts");
  for (const name of ["Saltmarsh", "Saltmarsh Docks", "Saltmarsh Lighthouse"]) {
    insertKnownLocation({ campaignId: world.campaignId, name });
  }
  overworldView(world.campaignId, true);
  setOverworldAnchor(world.campaignId, named("Saltmarsh").id, { x: 70, y: 50 });
  setOverworldAnchor(world.campaignId, named("Saltmarsh Docks").id, { x: 73, y: 52 });
  setOverworldAnchor(world.campaignId, named("Saltmarsh Lighthouse").id, { x: 90, y: 20 });
  // What an old database holds: nobody had said.
  getDatabase().prepare(`UPDATE locations SET parent_name = NULL WHERE campaign_id = ? AND name LIKE 'Saltmarsh%'`).run(world.campaignId);
  fileSubAreasByName(getDatabase(), world.campaignId);
  assert.equal(named("Saltmarsh Docks").parentName, "Saltmarsh");
  assert.equal(named("Saltmarsh Lighthouse").parentName, null, "twenty tiles off, a place of its own");
  assert.equal(named("Hollowroot Vault Entrance Passage").parentName, "Hollowroot Vault", "a place already filed is left as it was");
});

await test("Renaming a place keeps its parts under it, those it held by name too, and tells the table", async () => {
  const vault = named("Hollowroot Vault");
  const since = lastSeq();
  const renamed = await patch(world.owner.id, { rename: { locationId: vault.id, name: "Hollowroot Deepvault" } });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(named("Hollowroot Vault Entrance Passage").parentName, "Hollowroot Deepvault");
  assert.equal(named("Inner Sanctum").parentName, "Hollowroot Deepvault");
  assert.equal(named("Hollowroot Vault Root Gallery").parentName, "Hollowroot Deepvault", "the part filed by its name follows the rename too");
  const told = announced(since);
  for (const name of ["Hollowroot Deepvault", "Inner Sanctum", "Hollowroot Vault Root Gallery"]) {
    assert.ok(told.includes(name), `${name} was announced: ${told.join(", ")}`);
  }
});

await test("GAME STATE says which place the party's area is part of, and move_party offers partOf, direction and distance", async () => {
  await ai.invoke("move_party", { ...quiet, name: "Inner Sanctum" });
  const model = await fakeModel();
  try {
    await model.pointAt(world);
    model.script([reply({ text: "The sanctum is silent." })]);
    await model.turn(world, "I look around.", hero.id);
    const sent = JSON.stringify(model.requests[0]?.messages ?? []);
    assert.ok(sent.includes("Current location: Inner Sanctum (part of Hollowroot Deepvault)"), "GAME STATE names the vault");
    assert.ok(!sent.includes("names that place in move_party's partOf"), "a place already filed needs no reminder");
    const tools = model.requests[0]?.tools ?? [];
    const move = tools.find((tool) => tool.function?.name === "move_party");
    if (move) {
      const properties = move.function.parameters.properties;
      assert.ok(properties.partOf && properties.direction && properties.distance, "move_party carries the new arguments once there is a place");
      assert.ok(properties.direction.enum.includes("northeast") && properties.distance.enum.includes("half a day"));
    }
  } finally {
    model.close();
  }
});

finish();
