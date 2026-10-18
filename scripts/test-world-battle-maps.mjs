// A place's battle maps and encounters (M4 of the WorldForge plan, item 3).
// A place, or the pin that stands for it, makes a blank battle map named for
// it or links one the library has, and the same for a prepared encounter.
// The links are typed bindings like a creature's stat block (WF-17): a
// reference to a row of this same table, never a copy, refused when the
// row is another table's, moved to the copies when the world travels into a
// campaign or a bundle, and kept through a WorldForge file's reimport. No
// step here makes a location, and a map's ground says what was drawn on it:
// a picture is never walls or light.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-battle-maps");
const { createWorldEntity, updateWorldEntity, worldView, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { entriesBoundTo } = await import("../src/lib/db/world-bindings.ts");
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { getEncounterTemplate, deleteEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { getPreparedMap, listPreparedMaps } = await import("../src/lib/db/prepared-maps.ts");
const { createLibraryMap } = await import("../src/lib/dm/map-library.ts");
const { listLocations } = await import("../src/lib/db/locations.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { runContentImport, planContentImport } = await import("../src/lib/db/content-import.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { importWorldForge, exportWorldForge } = await import("../src/lib/db/world-forge-io.ts");

const world = await openWorld();
const { campaignId, owner } = world;
const player = world.addUser("player");
world.addHero();
world.addHero({ user: player });
const stranger = world.addUser("stranger");

const rat = createHomebrewMonster(owner.id, draftFromCr("Dock Rat", 1), "Fat on spilled ale.");
const tavern = createWorldEntity(campaignId, { typeId: "t_location", name: "The Rusty Anchor", text: "A taproom over the harbour." }).entity;
const legend = createWorldEntity(campaignId, { typeId: "t_other", name: "The Drowned Bell" }).entity;
const entity = (id, ref) => worldView(id).entities.find((entry) => entry.ref === ref);
const places = () => listLocations(campaignId).length;

const battleMaps = await world.route("campaigns/[campaignId]/world/entities/[ref]/battle-maps");
const bindingsRoute = await world.route("campaigns/[campaignId]/world/bindings");
async function make(body, { as = owner, ref = tavern.ref, id = campaignId } = {}) {
  world.signIn({ id: as.id });
  const response = await battleMaps.POST(
    new Request("http://local/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: id, ref: encodeURIComponent(ref) }) },
  );
  return { status: response.status, body: await response.json() };
}

// The Atlas the acceptance names: a harbour map with a pin on the tavern,
// and the tavern's own map nested inside that pin.
{
  const doc = getWorldDoc(campaignId);
  doc.maps.push({ id: "m_harbour", name: "Saltmarch Harbour", image: "", parentPinId: "", regions: [] });
  doc.maps.push({ id: "m_taproom", name: "The Anchor's taproom", image: "", parentPinId: "p_anchor", regions: [] });
  doc.pins.push({ id: "p_anchor", mapId: "m_harbour", x: 0.4, y: 0.6, name: "", ref: tavern.ref, linkedMapId: "m_taproom", notes: "" });
  saveWorldDoc(campaignId, doc);
}
const placesAtStart = places();
let mapId = "";
let fightId = "";

await test("A player gets 403 from the place's battle-map route, and nothing is made.", async () => {
  const maps = listPreparedMaps(campaignId).length;
  assert.equal((await make({ make: "map" }, { as: player })).status, 403);
  assert.equal((await make({ make: "encounter", monster: `homebrew:${rat.id}` }, { as: player })).status, 403);
  assert.equal(listPreparedMaps(campaignId).length, maps);
  assert.deepEqual(entity(campaignId, tavern.ref).entry.bindings, []);
});

await test("A place makes its battle map: a blank map named for it in the library, linked, and no second place.", async () => {
  const made = await make({ make: "map" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  mapId = made.body.made.id;
  const map = getPreparedMap(campaignId, mapId);
  assert.equal(map.name, "The Rusty Anchor");
  assert.equal(map.backdrop, null, "the map took a picture it was never given");
  assert.deepEqual(entity(campaignId, tavern.ref).entry.bindings, [{ kind: "map", ref: mapId }]);
  assert.equal(places(), placesAtStart, "making a battle map made a place");
});

await test("A map's ground says what is drawn on it: nothing yet, a picture only, then walls and light.", () => {
  const record = () => entity(campaignId, tavern.ref).bound.find((bound) => bound.kind === "map");
  assert.deepEqual(record().geometry, { walls: false, lights: 0, picture: false }, "a blank map's rim counted as walls");
  assert.match(record().detail, /no walls or light drawn yet/);
  assert.equal(record().ownId, mapId);
  getDatabase().prepare(`UPDATE prepared_maps SET backdrop_path = ? WHERE id = ?`).run("/uploads/anchor-art.png", mapId);
  assert.equal(record().geometry.picture, true);
  assert.match(record().detail, /a picture only: no walls or light drawn yet/);
  const map = getPreparedMap(campaignId, mapId);
  const tiles = map.terrain.split("");
  tiles[3 * map.width + 4] = "#";
  getDatabase().prepare(`UPDATE prepared_maps SET terrain = ?, lights_json = ? WHERE id = ?`).run(tiles.join(""), JSON.stringify([{ x: 5, y: 5, radius: 4 }]), mapId);
  assert.deepEqual(record().geometry, { walls: true, lights: 1, picture: true });
  assert.match(record().detail, /walls drawn, 1 light/);
});

await test("A place makes an encounter with its first foe, on one of its own battle maps, and nothing on another's.", async () => {
  const elsewhere = createLibraryMap(getCampaignById(campaignId), { name: "Somewhere else", blank: "ground" }).map;
  const refused = await make({ make: "encounter", monster: `homebrew:${rat.id}`, mapId: elsewhere.id });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /not one of this place's/);
  assert.equal((await make({ make: "encounter", monster: "Nothing That Exists" })).status, 400);
  const made = await make({ make: "encounter", monster: `homebrew:${rat.id}`, mapId });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  fightId = made.body.made.id;
  const template = getEncounterTemplate(fightId);
  assert.equal(template.name, "The Rusty Anchor");
  assert.equal(template.map.mapId, mapId);
  assert.deepEqual(template.enemies, [{ monster: "Dock Rat", count: 1 }]);
  const record = entity(campaignId, tavern.ref).bound.find((bound) => bound.kind === "encounter");
  assert.equal(record.found, true);
  assert.equal(record.mapId, mapId);
  assert.match(record.detail, /1 foe, on The Rusty Anchor/);
  assert.equal(places(), placesAtStart);
});

await test("The nested tavern map reaches its place's battle map and encounter through its pin, with no duplicate place.", () => {
  const { doc, entities } = worldView(campaignId);
  const nested = doc.maps.find((atlas) => atlas.id === "m_taproom");
  const pin = doc.pins.find((entry) => entry.id === nested.parentPinId);
  const place = entities.find((entry) => entry.ref === pin.ref);
  assert.equal(place.ref, tavern.ref);
  assert.deepEqual(place.bound.filter((record) => record.found).map((record) => [record.kind, record.ownId]), [["map", mapId], ["encounter", fightId]]);
  assert.equal(entities.filter((entry) => entry.shelf === "location" && entry.name === "The Rusty Anchor").length, 1);
});

await test("Only a place takes a battle map, and only one of this table's.", () => {
  const notPlace = updateWorldEntity(campaignId, legend.ref, { bindings: [{ kind: "map", ref: mapId }] });
  assert.equal(notPlace.status, 400);
  assert.match(notPlace.error, /Only a place has battle maps/);
  const elsewhere = createWorkshop(stranger.id, { title: "Another table" }).id;
  const theirs = createLibraryMap(getCampaignById(elsewhere), { name: "Their cellar", blank: "rock" }).map;
  const foreign = updateWorldEntity(campaignId, tavern.ref, { bindings: [...entity(campaignId, tavern.ref).entry.bindings, { kind: "map", ref: theirs.id }] });
  assert.equal(foreign.status, 400);
  assert.match(foreign.error, /not one of this table's prepared maps/);
  // Written straight into the stored document, past every route: a lore
  // entry's map link is dropped at its next save.
  const doc = getWorldDoc(campaignId);
  doc.entries[legend.ref] = { ...doc.entries[legend.ref], bindings: [{ kind: "map", ref: mapId }] };
  saveWorldDoc(campaignId, doc);
  updateWorldEntity(campaignId, legend.ref, { notes: "rung at low tide" });
  assert.deepEqual(entity(campaignId, legend.ref).entry.bindings, []);
});

await test("Link existing: another of this table's maps joins the place's, and the map's own tool names the place.", async () => {
  const cellar = createLibraryMap(getCampaignById(campaignId), { name: "The Anchor's cellar", blank: "rock" }).map;
  const linked = updateWorldEntity(campaignId, tavern.ref, { bindings: [...entity(campaignId, tavern.ref).entry.bindings, { kind: "map", ref: cellar.id }] });
  assert.ok(linked.entity, linked.error);
  assert.deepEqual(entriesBoundTo(campaignId, getWorldDoc(campaignId), "map", cellar.id).map((entry) => entry.name), ["The Rusty Anchor"]);
  world.signIn({ id: owner.id });
  const listed = await bindingsRoute.GET(new Request(`http://local/?kind=encounter&ref=${fightId}`), { params: Promise.resolve({ campaignId }) });
  assert.deepEqual((await listed.json()).entries.map((entry) => entry.ref), [tavern.ref]);
  const given = await bindingsRoute.POST(new Request("http://local/", { method: "POST", body: JSON.stringify({ kind: "map", ref: cellar.id }) }), { params: Promise.resolve({ campaignId }) });
  assert.equal(given.status, 400, "a map was given a lore entry of its own");
});

await test("A deleted encounter reads as gone, and the place still saves with it listed.", () => {
  const spare = createLibraryMap(getCampaignById(campaignId), { name: "Spare", blank: "ground" }).map;
  const doc = getWorldDoc(campaignId);
  const before = doc.entries[tavern.ref].bindings;
  updateWorldEntity(campaignId, tavern.ref, { bindings: [...before, { kind: "map", ref: spare.id }] });
  getDatabase().prepare(`DELETE FROM prepared_maps WHERE id = ?`).run(spare.id);
  const gone = entity(campaignId, tavern.ref).bound.find((record) => record.ref === spare.id);
  assert.equal(gone.found, false);
  const saved = updateWorldEntity(campaignId, tavern.ref, { notes: "still here" });
  assert.ok(saved.entity, saved.error);
  updateWorldEntity(campaignId, tavern.ref, { bindings: before });
});

await test("Copied into a campaign with its maps and fights, a place links to the copies; without them, the planner says so.", () => {
  const source = createWorkshop(owner.id, { title: "Harbour prep" }).id;
  const anchor = createWorldEntity(source, { typeId: "t_location", name: "The Anchor" }).entity;
  const map = createLibraryMap(getCampaignById(source), { name: "Anchor floor", blank: "ground" }).map;
  updateWorldEntity(source, anchor.ref, { bindings: [{ kind: "map", ref: map.id }] });
  const fight = getDatabase().prepare(`INSERT INTO encounter_templates (id, campaign_id, name, enemies_json, battlefield, map_json, notes, created_by_user_id, created_at, updated_at) VALUES ('fight-1', ?, 'Brawl', '[{"monster":"Dock Rat","count":2}]', '', ?, '', ?, datetime('now'), datetime('now'))`);
  fight.run(source, JSON.stringify({ mapId: map.id }), owner.id);
  updateWorldEntity(source, anchor.ref, { bindings: [{ kind: "map", ref: map.id }, { kind: "encounter", ref: "fight-1" }] });

  const bare = createWorkshop(owner.id, { title: "Without maps" }).id;
  const plan = planContentImport(source, bare, ["locations", "world"]);
  assert.ok(plan.warnings.some((warning) => /link to 1 battle map/.test(warning.message)), JSON.stringify(plan.warnings));
  assert.ok(plan.warnings.some((warning) => /link to 1 prepared encounter/.test(warning.message)), JSON.stringify(plan.warnings));
  const thin = runContentImport({ sourceId: source, campaignId: bare, selection: ["locations", "world"], houseRulesMode: "replace" });
  assert.ok(!("error" in thin), thin.error);
  assert.equal(thin.unbound >= 2, true, "the links that stayed behind were not counted");
  const landedBare = worldView(bare).entities.find((entry) => entry.name === "The Anchor");
  assert.deepEqual(landedBare.entry.bindings, [], "a link still points at the workshop's own rows");

  const full = createWorkshop(owner.id, { title: "With maps" }).id;
  const outcome = runContentImport({ sourceId: source, campaignId: full, selection: ["locations", "maps", "encounters", "world"], houseRulesMode: "replace" });
  assert.ok(!("error" in outcome), outcome.error);
  const landed = worldView(full).entities.find((entry) => entry.name === "The Anchor");
  assert.deepEqual(landed.bound.map((record) => [record.kind, record.name, record.found]), [["map", "Anchor floor", true], ["encounter", "Brawl", true]]);
  assert.ok(landed.bound.every((record) => record.ref !== map.id && record.ref !== "fight-1"), "a link points at the workshop's own row");
  assert.equal(landed.bound[1].mapId, landed.bound[0].ref, "the fight's map and the place's map are two different copies");
  assert.equal(worldView(full).entities.filter((entry) => entry.shelf === "location").length, 1);
});

await test("A bundle carries a place's battle map and encounter by their place in it, and lands them on the arrived copies.", () => {
  const shop = createWorkshop(owner.id, { title: "Bundled harbour" }).id;
  const anchor = createWorldEntity(shop, { typeId: "t_location", name: "The Bundled Anchor" }).entity;
  const madeMap = createLibraryMap(getCampaignById(shop), { name: "Bundled floor", blank: "ground" }).map;
  getDatabase()
    .prepare(`INSERT INTO encounter_templates (id, campaign_id, name, enemies_json, battlefield, map_json, notes, created_by_user_id, created_at, updated_at) VALUES ('fight-b', ?, 'Bundled brawl', '[{"monster":"Goblin","count":1}]', '', ?, '', ?, datetime('now'), datetime('now'))`)
    .run(shop, JSON.stringify({ mapId: madeMap.id }), owner.id);
  updateWorldEntity(shop, anchor.ref, { bindings: [{ kind: "map", ref: madeMap.id }, { kind: "encounter", ref: "fight-b" }] });
  const out = exportWorkshopBundle(shop, { name: "Bundled harbour", blurb: "A tavern and its fight.", inspiredBy: "Original work", shelf: "used" });
  assert.ok(out.bundle, out.error);
  const text = JSON.stringify(out.bundle.world);
  assert.ok(!text.includes(madeMap.id) && !text.includes("fight-b"), "the bundle names this server's ids");
  assert.ok(text.includes("@map:#") && text.includes("@encounter:#"));
  const read = readBundle(JSON.stringify(out.bundle));
  assert.ok(!("error" in read), read.error);
  const { workshopId } = importWorkshopBundle(stranger.id, read.bundle);
  const landed = worldView(workshopId).entities.find((entry) => entry.name === "The Bundled Anchor");
  assert.deepEqual(landed.bound.map((record) => [record.kind, record.name, record.found]), [["map", "Bundled floor", true], ["encounter", "Bundled brawl", true]]);
  assert.equal(landed.bound[1].mapId, landed.bound[0].ref);
});

await test("A WorldForge file brought in again keeps the place's battle maps and encounters, and the file never names them.", () => {
  const before = entity(campaignId, tavern.ref).entry.bindings;
  const file = exportWorldForge(campaignId);
  assert.ok(!JSON.stringify(file).includes(mapId), "a WorldForge file named a battle map's id");
  const again = importWorldForge(campaignId, { id: owner.id }, file);
  assert.ok(!("error" in again), again.error);
  assert.deepEqual(entity(campaignId, tavern.ref).entry.bindings, before);
  assert.equal(places(), placesAtStart, "a reimport made a second tavern");
});

await test("Unlinking leaves the map and the fight in their tools.", () => {
  updateWorldEntity(campaignId, tavern.ref, { bindings: [] });
  assert.ok(getPreparedMap(campaignId, mapId));
  assert.ok(getEncounterTemplate(fightId));
  deleteEncounterTemplate(fightId);
});

world.close();
finish();
