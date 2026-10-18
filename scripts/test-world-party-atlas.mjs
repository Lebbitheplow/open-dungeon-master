// The party's Atlas (the plan's M3 item 4, held for M4): a map is the DM's
// alone until a reviewed step shows it, and the editor's saves may hide a
// map but never show one. On a shown map, pins and regions show unless
// hidden. A player's answer carries labels and positions only: never notes,
// what a pin stands for, a Region binding, a hidden pin or region, or a link
// to a map still hidden. A pin's label is its own name, else a place's name,
// else the title of lore that player may open, else nothing.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-party-atlas");
const { createWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { insertLoreEntry } = await import("../src/lib/db/lore.ts");

const world = await openWorld();
const { campaignId, owner } = world;
const player = world.addUser("player");
world.addHero();
world.addHero({ user: player });

const route = (name) => world.route(name).catch(() => ({}));
const routes = {
  party: await route("campaigns/[campaignId]/world/atlas/party"),
  world: await route("campaigns/[campaignId]/world"),
};
const ctx = { params: Promise.resolve({ campaignId }) };
const send = (method, body) => new Request(`http://local/api/campaigns/${campaignId}/x`, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function call(handler, method, body) {
  const response = await handler(send(method, body), ctx);
  return { status: response.status, body: await response.json() };
}

// The coast: a named pin, a pin on a place with no name of its own, a pin on
// a Cast member, a pin on table lore and one on DM-only lore, a hidden pin
// that opens the smugglers' cave, and a pin that opens the shown harbour.
const harbour = createWorldEntity(campaignId, { typeId: "t_location", name: "Gullhaven" }).entity;
const villain = createWorldEntity(campaignId, { typeId: "t_character", name: "Mother Brine" }).entity;
const tableLore = insertLoreEntry({ campaignId, category: "history", title: "The Drowned Bell", body: "It rings at low tide.", tags: [], visibility: "table" });
const dmLore = insertLoreEntry({ campaignId, category: "history", title: "The Brine Pact", body: "The mayor sold the town.", tags: [], visibility: "dm" });
const SECRET = "The cave holds the mayor's ledger";
{
  const doc = getWorldDoc(campaignId);
  doc.maps.push({ id: "m_coast", name: "The coast", image: "", parentPinId: "", regions: [
    { id: "r_marsh", name: "The marsh", points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.2, y: 0.3 }], color: "#7da868", ref: harbour.ref, notes: SECRET },
    { id: "r_wreck", name: "The wreck field", points: [{ x: 0.6, y: 0.6 }, { x: 0.8, y: 0.6 }, { x: 0.7, y: 0.8 }], color: "#c9a84c", ref: "", notes: "", hidden: true },
  ] });
  doc.maps.push({ id: "m_harbour", name: "The harbour", image: "", parentPinId: "p_harbour", regions: [], party: "shown" });
  doc.maps.push({ id: "m_cave", name: "The smugglers' cave", image: "", parentPinId: "p_cave", regions: [] });
  doc.pins.push({ id: "p_named", mapId: "m_coast", x: 0.1, y: 0.2, name: "Old lighthouse", ref: "", linkedMapId: "", notes: SECRET });
  doc.pins.push({ id: "p_harbour", mapId: "m_coast", x: 0.3, y: 0.4, name: "", ref: harbour.ref, linkedMapId: "m_harbour", notes: "" });
  doc.pins.push({ id: "p_villain", mapId: "m_coast", x: 0.5, y: 0.5, name: "", ref: villain.ref, linkedMapId: "", notes: "" });
  doc.pins.push({ id: "p_bell", mapId: "m_coast", x: 0.6, y: 0.2, name: "", ref: `lore:${tableLore.id}`, linkedMapId: "", notes: "" });
  doc.pins.push({ id: "p_pact", mapId: "m_coast", x: 0.7, y: 0.3, name: "", ref: `lore:${dmLore.id}`, linkedMapId: "", notes: "" });
  doc.pins.push({ id: "p_cave", mapId: "m_coast", x: 0.9, y: 0.9, name: "Smugglers' cave", ref: "", linkedMapId: "m_cave", notes: SECRET, hidden: true });
  doc.pins.push({ id: "p_jump", mapId: "m_coast", x: 0.8, y: 0.1, name: "Down to the cave", ref: "", linkedMapId: "m_cave", notes: "" });
  saveWorldDoc(campaignId, doc);
}
const coast = () => getWorldDoc(campaignId).maps.find((atlas) => atlas.id === "m_coast");

await test("A map is the DM's alone until shown: a player's Atlas holds only maps already shown, and the editor's save cannot show one.", async () => {
  world.signIn(player);
  const seen = await call(routes.party.GET, "GET");
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.maps.map((atlas) => atlas.id), ["m_harbour"]);
  world.signIn(owner);
  const doc = getWorldDoc(campaignId);
  await routes.world.PATCH(new Request("http://local/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ maps: doc.maps.map((atlas) => (atlas.id === "m_coast" ? { ...atlas, party: "shown" } : atlas)) }) }), ctx);
  assert.equal(coast().party, undefined, "a plain save showed a map");
});

await test("A player gets 403 from showing and hiding, and nothing changes.", async () => {
  world.signIn(player);
  assert.equal((await call(routes.party.POST, "POST", { mapId: "m_coast", apply: true })).status, 403);
  assert.equal((await call(routes.party.DELETE, "DELETE", { mapId: "m_harbour" })).status, 403);
  assert.equal(coast().party, undefined);
  assert.equal(getWorldDoc(campaignId).maps.find((atlas) => atlas.id === "m_harbour").party, "shown");
});

await test("The review shows the map exactly as a player would see it, what stays hidden, and changes nothing.", async () => {
  world.signIn(owner);
  const review = await call(routes.party.POST, "POST", { mapId: "m_coast" });
  assert.equal(review.status, 200);
  assert.equal(review.body.applied, false);
  assert.equal(coast().party, undefined);
  const labels = Object.fromEntries(review.body.seen.pins.map((pin) => [pin.id, pin.label]));
  assert.deepEqual(labels, { p_named: "Old lighthouse", p_harbour: "Gullhaven", p_villain: "", p_bell: "The Drowned Bell", p_pact: "", p_jump: "Down to the cave" });
  assert.equal(review.body.hiddenPins, 1);
  assert.equal(review.body.hiddenRegions, 1);
  assert.equal(review.body.unlabelled, 2);
  assert.deepEqual(review.body.seen.regions.map((region) => region.name), ["The marsh"]);
  assert.equal(JSON.stringify(review.body.seen).includes(SECRET), false, "the review's player view carried a note");
});

await test("Once shown, a player's answer has labels and positions only: no notes, no refs, nothing hidden, no link to a hidden map.", async () => {
  world.signIn(owner);
  const done = await call(routes.party.POST, "POST", { mapId: "m_coast", apply: true });
  assert.equal(done.body.applied, true);
  assert.equal(coast().party, "shown");
  world.signIn(player);
  const seen = await call(routes.party.GET, "GET");
  const text = JSON.stringify(seen.body);
  for (const leak of [SECRET, villain.ref, harbour.ref, "Mother Brine", "The Brine Pact", "Smugglers' cave", "The wreck field", "notes", "regionLink", "ref\""]) {
    assert.equal(text.includes(leak), false, `the player's Atlas carried ${leak}`);
  }
  const map = seen.body.maps.find((atlas) => atlas.id === "m_coast");
  assert.ok(map, "the coast is on the player's Atlas");
  assert.equal(map.pins.find((pin) => pin.id === "p_harbour").opens, "m_harbour", "a pin opens a shown map");
  assert.equal(map.pins.find((pin) => pin.id === "p_jump").opens, null, "a pin never opens a hidden map");
  assert.equal(seen.body.maps.find((atlas) => atlas.id === "m_harbour").parentPinId, "p_harbour");
  assert.deepEqual(Object.keys(map.pins[0]).sort(), ["id", "label", "opens", "x", "y"]);
  assert.deepEqual(Object.keys(map.regions[0]).sort(), ["color", "id", "name", "points"]);
});

await test("Lore written for one player by name labels that player's pin only; the DM reads the party's view, not their own.", async () => {
  const forPlayer = insertLoreEntry({ campaignId, category: "history", title: "Your father's grave", body: "Under the dunes.", tags: [], visibility: "table", audience: [player.id] });
  const doc = getWorldDoc(campaignId);
  doc.pins.push({ id: "p_grave", mapId: "m_coast", x: 0.4, y: 0.8, name: "", ref: `lore:${forPlayer.id}`, linkedMapId: "", notes: "" });
  saveWorldDoc(campaignId, doc);
  world.signIn(player);
  const mine = (await call(routes.party.GET, "GET")).body.maps.find((atlas) => atlas.id === "m_coast");
  assert.equal(mine.pins.find((pin) => pin.id === "p_grave").label, "Your father's grave");
  world.signIn(owner);
  const lead = (await call(routes.party.GET, "GET")).body.maps.find((atlas) => atlas.id === "m_coast");
  assert.equal(lead.pins.find((pin) => pin.id === "p_grave").label, "", "the DM's view of the party's Atlas named lore for one player");
  assert.equal(lead.pins.find((pin) => pin.id === "p_cave"), undefined, "the DM's view of the party's Atlas showed a hidden pin");
});

await test("Hiding a pin through the editor's save takes it off the party's Atlas, and hiding the map takes the map off.", async () => {
  world.signIn(owner);
  const doc = getWorldDoc(campaignId);
  await routes.world.PATCH(new Request("http://local/x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pins: doc.pins.map((pin) => (pin.id === "p_named" ? { ...pin, hidden: true } : pin)) }) }), ctx);
  world.signIn(player);
  let map = (await call(routes.party.GET, "GET")).body.maps.find((atlas) => atlas.id === "m_coast");
  assert.equal(map.pins.some((pin) => pin.id === "p_named"), false);
  world.signIn(owner);
  const hidden = await call(routes.party.DELETE, "DELETE", { mapId: "m_coast" });
  assert.equal(hidden.body.hidden, true);
  world.signIn(player);
  map = (await call(routes.party.GET, "GET")).body.maps.find((atlas) => atlas.id === "m_coast");
  assert.equal(map, undefined);
  assert.equal(coast().regions[0].notes, SECRET, "hiding touched nothing else");
});

finish();
