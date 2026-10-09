// A world written in WorldForge (Smoebo's world-building app) opens as a
// workshop: its JSON export goes through the ordinary bundle import
// (src/lib/workshop/worldforge.ts turns it into a bundle first), and every
// part lands where a DM looks for it. The fixture is an original world in
// WorldForge's export format, written for this test.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-workshop-worldforge");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { isWorldForgeExport } = await import("../src/lib/workshop/worldforge.ts");
const { importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const raw = fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8");
const world = await openWorld();
const db = getDatabase();
const rows = (sql, ...args) => db.prepare(sql).all(...args);

const read = readBundle(raw);
assert.ok(!("error" in read), read.error);
const { bundle } = read;
const { workshopId } = importWorkshopBundle(world.owner.id, bundle);
assert.ok(workshopId, "no workshop was made");

await test("The export is recognised as WorldForge's, and a bundle is not mistaken for one.", () => {
  assert.equal(isWorldForgeExport(JSON.parse(raw)), true);
  assert.equal(isWorldForgeExport({ kind: "odm.workshop", version: 1, entities: [], worldName: "x" }), false);
  assert.equal(bundle.manifest.name, "The Saltmarch");
  assert.match(bundle.premise, /sea wall's codes/);
});

await test("Characters become the Cast, with their aliases, their home, how they stand with each other, and their portrait.", () => {
  const cast = rows(`SELECT * FROM npcs WHERE campaign_id = ? ORDER BY name`, workshopId);
  assert.deepEqual(cast.map((npc) => npc.name), ["Ivo Brannock", "Mira Fenn"]);
  const ivo = cast[0];
  assert.deepEqual(JSON.parse(ivo.aliases_json), ["the Tidewarden"]);
  assert.equal(ivo.location, "Gullhaven");
  const relation = JSON.parse(ivo.relations_json).find((entry) => entry.npcName === "Mira Fenn");
  assert.equal(relation?.note, "mentor of");
  assert.equal(relation?.score, 2);
  assert.match(ivo.trait, /Born: 61 RT/);
  assert.ok(ivo.portrait_url, "Ivo's portrait was dropped");
  assert.equal(cast[1].portrait_url ?? "", "", "a portrait that is not a picture was kept");
});

await test("Factions keep their members, from the links on either side.", () => {
  const [guild] = rows(`SELECT * FROM factions WHERE campaign_id = ?`, workshopId);
  assert.equal(guild.name, "The Saltcoats");
  const members = rows(`SELECT name FROM npcs WHERE campaign_id = ? AND faction_id = ?`, workshopId, guild.id).map((npc) => npc.name);
  assert.deepEqual(members, ["Ivo Brannock"]);
});

await test("Locations become places with their notes, fields and pins, and the pinned ones stand on the region map.", () => {
  const places = rows(`SELECT * FROM locations WHERE campaign_id = ? ORDER BY name`, workshopId);
  assert.deepEqual(places.map((place) => place.name), ["Gullhaven", "The Drowned Fen"]);
  assert.match(places[0].layout_description, /Population: 900/);
  assert.match(places[0].layout_description, /only harbour for forty miles/);
  const [region] = rows(`SELECT anchors_json FROM overworld_maps WHERE campaign_id = ?`, workshopId);
  assert.ok(region, "no region map");
  assert.equal(Object.keys(JSON.parse(region.anchors_json)).length, 2);
});

await test("What only the author knew stays DM-only: hidden truths, author-only fields, hidden links, secrets, non-canon entries, open stubs.", () => {
  const lore = rows(`SELECT title, body, visibility, category FROM lore_entries WHERE campaign_id = ?`, workshopId);
  const entry = (title) => lore.find((row) => row.title === title);
  const truth = entry("The truth about Ivo Brannock");
  assert.equal(truth?.visibility, "dm");
  assert.match(truth.body, /sold the sluice codes/);
  assert.match(truth.body, /Real Name: Hollowmere/);
  assert.match(truth.body, /Ivo Brannock fears Mira Fenn/);
  assert.equal(entry("Ivo is the leak")?.visibility, "dm");
  assert.equal(entry("The Grey Lantern")?.visibility, "dm");
  assert.equal(entry("The Brine Horn")?.visibility, "party");
  assert.equal(entry("The Brine Horn")?.category, "magic");
  assert.equal(entry("Open questions from WorldForge")?.visibility, "dm");
  // Nothing the author kept private leaks into what players read.
  for (const row of lore.filter((item) => item.visibility === "party")) {
    assert.doesNotMatch(row.body, /Hollowmere|sold the sluice codes/, `${row.title} leaks a secret`);
  }
});

await test("Events become history, and one chronology runs in calendar order.", () => {
  const [chronology] = rows(`SELECT body FROM lore_entries WHERE campaign_id = ? AND title = ?`, workshopId, "Chronology of The Saltmarch");
  assert.ok(chronology);
  assert.ok(chronology.body.indexOf("Raised") < chronology.body.indexOf("Breaks"), "the chronology is out of order");
});

await test("Scenes become storyboard cards in each story's order, linked to their point of view and place.", () => {
  const beats = rows(`SELECT title FROM workshop_beats WHERE campaign_id = ? ORDER BY rowid`, workshopId).map((beat) => beat.title);
  assert.deepEqual(beats.slice(0, 2), ["The Missing Codes", "Into the Fen"]);
});

await test("The export's settings, an image service's API key among them, are never stored.", () => {
  for (const table of ["npcs", "lore_entries", "locations", "factions", "workshop_beats", "campaigns"]) {
    const dump = JSON.stringify(rows(`SELECT * FROM ${table}`));
    assert.doesNotMatch(dump, /sk-test-never-store-this|example\.invalid/, `${table} stored the export's settings`);
  }
});

await test("An oversized or malformed export is cut to the bundle's limits or refused, never trusted.", () => {
  const big = JSON.parse(raw);
  big.entities[0].name = "x".repeat(5_000);
  big.entities[0].summary = "y".repeat(50_000);
  big.entities.push({ id: "", name: "nameless" }, { name: "no id" }, "not an object");
  const cut = readBundle(JSON.stringify(big));
  assert.ok(!("error" in cut), cut.error);
  assert.ok(cut.bundle.npcs.every((npc) => npc.name.length <= 120 && npc.trait.length <= 500));
  assert.equal(readBundle(JSON.stringify({ worldName: 4, entities: "x", version: 4 })).error !== undefined, true);
});

finish();
