// WorldForge (Smoebo's world-building app) lives inside the workshop. A
// world written in it opens as a workshop with nothing flattened: its
// characters, places and factions become the Cast, places and factions the
// table plays with, every other entry a lore entry, and what those rows have
// no column for (types and fields, links that can be hidden or false,
// calendars and events, secrets and who knows them, folders, the atlas)
// lives in the workshop's WorldForge document. It goes back out as a file
// WorldForge opens, travels into a campaign with the records, and reaches
// the AI DM. The fixture is an original world in WorldForge's format.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-workshop-worldforge");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { isWorldForgeExport } = await import("../src/lib/worldforge/format.ts");
const { sortEvents } = await import("../src/lib/worldforge/time.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { applyWorldImport, exportWorldForge, importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity, updateWorldEntity, deleteWorldEntity, patchWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { runContentImport } = await import("../src/lib/db/content-import.ts");
const { worldForPrompt } = await import("../src/lib/dm/world-prompt.ts");
const { getOverworld } = await import("../src/lib/db/overworld.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const raw = fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8");
const world = await openWorld();
const db = getDatabase();
const rows = (sql, ...args) => db.prepare(sql).all(...args);
const owner = { id: world.owner.id };

// Exactly what POST /api/workshops/import does with a WorldForge file.
function openAsWorkshop(text) {
  const read = readBundle(text);
  assert.ok(!("error" in read), read.error);
  assert.ok(read.worldForge, "the file was not read as WorldForge's");
  const { workshopId } = importWorkshopBundle(owner.id, read.bundle);
  const result = applyWorldImport(workshopId, owner, read.worldForge);
  assert.ok(!("error" in result), result.error);
  return { workshopId, result };
}

const { workshopId, result: first } = openAsWorkshop(raw);
const view = () => worldView(workshopId);
const entity = (name) => view().entities.find((entry) => entry.name === name);

await test("The export is recognised, and its world opens as a new workshop named for it.", () => {
  assert.equal(isWorldForgeExport(JSON.parse(raw)), true);
  assert.equal(isWorldForgeExport({ kind: "odm.workshop", version: 1, entities: [], worldName: "x" }), false);
  const [row] = rows(`SELECT title, description FROM campaigns WHERE id = ?`, workshopId);
  assert.equal(row.title, "The Saltmarch");
  assert.match(row.description, /sea wall's codes/);
  assert.equal(first.created, 7);
  assert.deepEqual(first.skipped, []);
});

await test("Every entry is a record the table plays with: Characters are the Cast, Locations places, Factions factions, the rest lore.", () => {
  const shelf = (name) => entity(name)?.shelf;
  assert.equal(shelf("Ivo Brannock"), "npc");
  assert.equal(shelf("Gullhaven"), "location");
  assert.equal(shelf("The Saltcoats"), "faction");
  assert.equal(shelf("The Brine Horn"), "lore");
  const [npc] = rows(`SELECT * FROM npcs WHERE campaign_id = ? AND name = ?`, workshopId, "Ivo Brannock");
  assert.deepEqual(JSON.parse(npc.aliases_json), ["the Tidewarden"]);
  assert.equal(npc.trait, "Keeper of the sea wall at Gullhaven, patient as the tide.");
  assert.ok(npc.portrait_url.startsWith("/uploads/"), "Ivo's portrait was dropped");
  const [horn] = rows(`SELECT category, visibility FROM lore_entries WHERE campaign_id = ? AND title = ?`, workshopId, "The Brine Horn");
  assert.equal(horn.category, "magic");
  assert.equal(horn.visibility, "party");
  const [lantern] = rows(`SELECT visibility FROM lore_entries WHERE campaign_id = ? AND title = ?`, workshopId, "The Grey Lantern");
  assert.equal(lantern.visibility, "dm", "an entry that is not canon was shown to players");
  assert.equal(entity("The Grey Lantern").entry.canon, "alternate");
});

await test("Types and their fields merge with the workshop's: Born lands on the Character type's own Born, Real Name arrives author-only.", () => {
  const { doc } = view();
  const character = doc.types.find((type) => type.name === "Character");
  const born = character.fields.find((field) => field.name === "Born");
  const realName = character.fields.find((field) => field.name === "Real Name");
  assert.equal(realName?.authorOnly, true);
  const ivo = entity("Ivo Brannock");
  assert.deepEqual(ivo.entry.fields[born.id], { calendarId: "cal_tide", yearNum: 61, year: "" });
  assert.equal(ivo.entry.fields[realName.id], "Hollowmere");
  assert.equal(entity("Gullhaven").entry.fields[doc.types.find((type) => type.name === "Location").fields.find((field) => field.name === "Population").id], 900);
  assert.equal(doc.types.filter((type) => type.name === "Character").length, 1, "the Character type was doubled");
});

await test("Links keep their words, their veracity, their direction and their rank; hidden truths stay in WorldForge, out of every player-visible row.", () => {
  const { doc } = view();
  const ivo = entity("Ivo Brannock").ref;
  const mira = entity("Mira Fenn").ref;
  const fears = doc.links.find((link) => link.from === ivo && link.to === mira && link.label === "fears");
  assert.equal(fears?.veracity, "hidden");
  assert.equal(fears?.oneway, true);
  assert.ok(doc.links.some((link) => link.from === ivo && link.label === "member of" && link.to === entity("The Saltcoats").ref));
  assert.equal(doc.links.length, 6);
  assert.equal(entity("Ivo Brannock").entry.hiddenTruth, "Ivo sold the sluice codes to the smugglers.");
  for (const table of ["npcs", "lore_entries", "locations", "factions"]) {
    assert.doesNotMatch(JSON.stringify(rows(`SELECT * FROM ${table} WHERE campaign_id = ?`, workshopId)), /sold the sluice codes|Hollowmere/, `${table} carries a hidden truth`);
  }
});

await test("Calendars, events in calendar order, folders, secrets with who knows them, stubs.", () => {
  const { doc } = view();
  assert.equal(doc.calendars[0].abbrev, "RT");
  assert.deepEqual(sortEvents(doc.events, doc.calendars).map((event) => event.title), ["The Wall Is Raised", "The Wall Breaks"]);
  assert.deepEqual(doc.events.find((event) => event.id === "ev2").refs, [entity("Gullhaven").ref]);
  assert.equal(entity("Ivo Brannock").entry.folderId, "cat_town");
  const [secret] = doc.secrets;
  assert.equal(secret.subject, entity("Ivo Brannock").ref);
  assert.deepEqual(secret.knownBy, [entity("Ivo Brannock").ref]);
  assert.equal(secret.partyKnows, false);
  assert.equal(doc.stubs[0].name, "Who built the wall?");
});

await test("The atlas keeps its map and pins, bound to the places; the pinned places stand there on the region map.", () => {
  const { doc } = view();
  assert.equal(doc.maps[0].name, "The Saltmarch");
  assert.equal(doc.pins.find((pin) => pin.id === "p1").ref, entity("Gullhaven").ref);
  const region = getOverworld(workshopId);
  const anchor = region.anchors[entity("Gullhaven").id];
  assert.equal(anchor.x, Math.round(0.25 * (region.width - 1)));
});

await test("Scenes become storyboard cards in each story's order, the first leading to the next.", () => {
  const beats = rows(`SELECT id, title, edges_json, links_json FROM workshop_beats WHERE campaign_id = ? ORDER BY x`, workshopId);
  assert.deepEqual(beats.map((beat) => beat.title), ["The Missing Codes", "Into the Fen"]);
  assert.deepEqual(JSON.parse(beats[0].edges_json), [beats[1].id]);
  assert.equal(JSON.parse(beats[0].links_json).npcId, entity("Ivo Brannock").id);
});

await test("Opening the same file into the same workshop again updates it rather than doubling anything.", () => {
  const again = importWorldForge(workshopId, owner, JSON.parse(raw));
  assert.equal(again.created, 0);
  assert.equal(again.updated, 7);
  assert.equal(view().entities.length, 7);
  assert.equal(view().doc.links.length, 6);
  assert.equal(rows(`SELECT COUNT(*) AS n FROM workshop_beats WHERE campaign_id = ?`, workshopId)[0].n, 2);
});

await test("The workshop goes back out as a WorldForge file that opens again whole, with no settings in it.", () => {
  const file = exportWorldForge(workshopId);
  assert.equal(file.version, 4);
  assert.equal(isWorldForgeExport(file), true);
  assert.equal("settings" in file, false);
  assert.ok(file.media.entityImages.e_ivo?.startsWith("data:image/"), "Ivo's portrait did not travel under his WorldForge id");
  const { workshopId: copy } = openAsWorkshop(JSON.stringify(file));
  const names = (id) => worldView(id).entities.map((entry) => entry.name).sort();
  assert.deepEqual(names(copy), names(workshopId));
  const again = worldView(copy).doc;
  assert.equal(again.links.length, 6);
  assert.equal(again.events.length, 2);
  assert.equal(again.secrets[0].knownBy.length, 1);
  assert.ok(again.links.some((link) => link.veracity === "hidden" && link.oneway));
});

await test("A workshop bundle shared with another DM carries its WorldForge, refs and all.", () => {
  const out = exportWorkshopBundle(workshopId, { name: "The Saltmarch", blurb: "A drowned coast.", inspiredBy: "Original work" });
  assert.ok(!("error" in out), out.error);
  const read = readBundle(JSON.stringify(out.bundle));
  assert.ok(!("error" in read), read.error);
  const { workshopId: shared } = importWorkshopBundle(owner.id, read.bundle);
  const { doc, entities } = worldView(shared);
  const ivo = entities.find((entry) => entry.name === "Ivo Brannock");
  assert.equal(ivo.entry.hiddenTruth, "Ivo sold the sluice codes to the smugglers.");
  assert.equal(doc.links.length, 6);
  assert.ok(doc.links.some((link) => link.from === ivo.ref && link.label === "fears" && link.veracity === "hidden"));
  assert.equal(doc.secrets[0].subject, ivo.ref);
  assert.equal(doc.pins.find((pin) => pin.id === "p1").ref, entities.find((entry) => entry.name === "Gullhaven").ref);
});

await test("Entries are made and edited in WorldForge as the records they are; a pick must be one of its options.", () => {
  const { doc } = view();
  const deity = doc.types.find((type) => type.name === "Deity");
  const made = createWorldEntity(workshopId, { typeId: deity.id, name: "The Tidemother", text: "Goddess of the drowned." });
  assert.ok(made.entity, made.error);
  const [lore] = rows(`SELECT category, body FROM lore_entries WHERE id = ?`, made.entity.id);
  assert.equal(lore.category, "religion");
  const alignment = deity.fields.find((field) => field.name === "Alignment");
  const refused = updateWorldEntity(workshopId, made.entity.ref, { fields: { [alignment.id]: "very good" } });
  assert.equal(refused.entity.entry.fields[alignment.id], undefined);
  const kept = updateWorldEntity(workshopId, made.entity.ref, { fields: { [alignment.id]: "neutral good" } });
  assert.equal(kept.entity.entry.fields[alignment.id], "neutral good");
  const renamed = updateWorldEntity(workshopId, entity("Mira Fenn").ref, { name: "Mira Fennick", tagline: "The apprentice." });
  assert.equal(rows(`SELECT name, trait FROM npcs WHERE id = ?`, renamed.entity.id)[0].trait, "The apprentice.");
  assert.equal(createWorldEntity(workshopId, { typeId: "t_character", name: "Ivo Brannock" }).status, 409);
});

await test("Deleting an entry deletes the record and every link, pin and knower that pointed at it.", () => {
  const fen = entity("The Drowned Fen");
  patchWorldDoc(workshopId, { pins: view().doc.pins });
  assert.ok(deleteWorldEntity(workshopId, fen.ref));
  const { doc } = view();
  assert.equal(rows(`SELECT COUNT(*) AS n FROM locations WHERE id = ?`, fen.id)[0].n, 0);
  assert.ok(!doc.links.some((link) => link.from === fen.ref || link.to === fen.ref));
  assert.equal(doc.pins.find((pin) => pin.id === "p2").ref, "");
});

await test("A campaign made from the workshop gets its WorldForge, every ref rewritten to the campaign's own copies.", () => {
  const outcome = runContentImport({ sourceId: workshopId, campaignId: world.campaignId, selection: ["npcs", "locations", "lore", "world"], houseRulesMode: "replace" });
  assert.ok(!("error" in outcome), outcome.error);
  const here = worldView(world.campaignId);
  const ivo = here.entities.find((entry) => entry.name === "Ivo Brannock");
  assert.ok(ivo && ivo.id !== entity("Ivo Brannock").id, "Ivo did not travel as a copy");
  assert.equal(ivo.entry.hiddenTruth, "Ivo sold the sluice codes to the smugglers.");
  assert.ok(here.doc.links.some((link) => link.from === ivo.ref && link.label === "fears"));
  assert.equal(here.doc.secrets[0].subject, ivo.ref);
});

await test("The AI DM is told the hidden truths, ties and secrets, marked as its own and never to be stated outright.", () => {
  const { npcNotes, block } = worldForPrompt(world.campaignId);
  assert.match(npcNotes.get("Ivo Brannock"), /secretly: Ivo sold the sluice codes/);
  assert.match(npcNotes.get("Ivo Brannock"), /fears Mira Fenn(ick)? \(hidden\)/);
  assert.match(npcNotes.get("Ivo Brannock"), /knows: Ivo is the leak/);
  assert.match(block, /never state them outright/);
  assert.match(block, /Secret: Ivo is the leak \(about Ivo Brannock\)/);
  updateWorldEntity(world.campaignId, worldView(world.campaignId).entities.find((entry) => entry.name === "Ivo Brannock").ref, {});
  const doc = worldView(world.campaignId).doc;
  patchWorldDoc(world.campaignId, { secrets: doc.secrets.map((secret) => ({ ...secret, partyKnows: true })) });
  assert.doesNotMatch(worldForPrompt(world.campaignId).block, /Ivo is the leak/, "a secret the party learned is still offered as a secret");
});

await test("The export's settings, an image service's API key among them, are never stored.", () => {
  for (const table of ["npcs", "lore_entries", "locations", "factions", "workshop_beats", "campaigns", "world_forge"]) {
    assert.doesNotMatch(JSON.stringify(rows(`SELECT * FROM ${table}`)), /sk-test-never-store-this|example\.invalid/, `${table} stored the export's settings`);
  }
});

await test("An oversized or malformed export is cut to the limits or refused, never trusted.", () => {
  const big = JSON.parse(raw);
  big.entities[0].name = "x".repeat(5_000);
  big.entities[0].summary = "y".repeat(50_000);
  big.entities[0].links.push({ targetId: "e_mira", label: "z".repeat(500), veracity: "<script>" });
  big.entities.push({ id: "", name: "nameless" }, { name: "no id" }, "not an object");
  const { workshopId: cut } = openAsWorkshop(JSON.stringify(big));
  const { doc, entities } = worldView(cut);
  assert.ok(entities.every((entry) => entry.name.length <= 80));
  assert.ok(entities.every((entry) => entry.entry.article.length <= 12_000));
  assert.ok(doc.links.every((link) => link.label.length <= 60 && ["known", "hidden", "believed"].includes(link.veracity)));
  assert.equal(entities.length, 7);
  assert.ok("error" in readBundle(JSON.stringify({ worldName: 4, entities: "x", version: 4 })));
});

finish();
