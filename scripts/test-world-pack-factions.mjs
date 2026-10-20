// M5 item 4 of the WorldForge plan (audit finding WF-18): a workshop's
// world pack takes the workshop's own factions, with their members and
// seat as far as a pack line goes, and each entry's account as its summary;
// and the author is told, entry by entry, everything the pack leaves out
// before it is published. Real database: a faction made through WorldForge
// reaches Plugin Pull, the pack the Publish tab installs, and the narrator's
// "Factions of this world" line, and the omission report names each kind it
// leaves with its exact entry.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-pack-factions");
const { createWorldEntity, getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { setNpcPlace } = await import("../src/lib/db/npcs.ts");
const { insertLoreEntry } = await import("../src/lib/db/lore.ts");
const { insertBeat } = await import("../src/lib/db/workshop-beats.ts");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { insertRollTable } = await import("../src/lib/db/roll-tables.ts");
const { createLibraryMap } = await import("../src/lib/dm/map-library.ts");
const { createHomebrewMonster } = await import("../src/lib/bestiary/homebrew-monsters.ts");
const { draftFromCr } = await import("../src/lib/bestiary/monster-draft.ts");
const { exportWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { compileToPack, notInDraft } = await import("../src/lib/workshop/to-pack.ts");
const { getPackDraft, savePackDraft } = await import("../src/lib/db/world-pack-drafts.ts");
const { worldPackSchema } = await import("../src/lib/worlds/types.ts");
const { packWorldHints } = await import("../src/lib/worlds/preset.ts");
const { resetWorldPackCache } = await import("../src/lib/worlds/index.ts");

const world = await openWorld();
const { owner } = world;
const player = world.addUser("player");
getDatabase().prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(owner.id);

const id = createWorkshop(owner.id, { title: "Saltmarch" }).id;
const made = (sent) => {
  const outcome = createWorldEntity(id, sent);
  assert.ok(outcome.entity, JSON.stringify(outcome));
  return outcome.entity;
};

// ---- the world ----

// A native faction, made the way WorldForge makes one: its row's line, a
// longer article, a goal-free entry and a place it is based in.
const wardens = made({
  typeId: "t_faction",
  name: "The Tide Wardens",
  tagline: "Lamp-keepers who decide which ships the harbour lets in.",
  article: "The Tide Wardens began as a guild of lamp-keepers. Now they hold the harbour chain and the toll books, and nobody sails in without their leave.",
});
const harbour = made({
  typeId: "t_location",
  name: "Saltmarch Harbour",
  text: "Arrival: gulls, tar, and a chain across the water.",
  article: "Saltmarch Harbour is a walled anchorage at the mouth of the Grey. The chain across it is raised at dusk.",
  fields: { f_population: 1200 },
});
const mira = made({ typeId: "t_character", name: "Mira Fenn", tagline: "Keeper of the north lamp." });
const tobb = made({ typeId: "t_character", name: "Old Tobb", tagline: "Rows the chain boat.", hiddenTruth: "He has been selling the chain's timings." });
// One member by the Factions tool's own column, one by a World link.
setNpcPlace(mira.ref.slice("npc:".length), { factionId: wardens.ref.slice("faction:".length) });
// A lore entry whose body is its account, with an older article beside it.
const bell = made({ typeId: "t_other", name: "The Drowned Bell", text: "A bell under the harbour that rings before a storm." });
// What a pack must not publish: a DM-only lore entry, and a draft faction.
insertLoreEntry({ campaignId: id, category: "history", title: "The Warden's bargain", body: "The Wardens sold the old king's fleet.", tags: [], visibility: "dm" });
made({ typeId: "t_faction", name: "The Gull Court", tagline: "Not settled yet.", canon: "draft" });

{
  const doc = getWorldDoc(id);
  doc.entries[bell.ref] = { ...doc.entries[bell.ref], article: "An older telling the import left." };
  doc.entries[tobb.ref] = { ...doc.entries[tobb.ref], notes: "Maybe a traitor in act two." };
  doc.links.push(
    { id: "l_home", from: wardens.ref, to: harbour.ref, label: "located in", veracity: "known", oneway: false, rank: "" },
    { id: "l_tobb", from: tobb.ref, to: wardens.ref, label: "member of", veracity: "known", oneway: false, rank: "Oarsman" },
    { id: "l_feud", from: mira.ref, to: tobb.ref, label: "rival of", veracity: "known", oneway: false, rank: "" },
  );
  doc.maps.push({ id: "m_harbour", name: "Saltmarch from the cliffs", image: "", parentPinId: "", regions: [] });
  doc.pins.push({ id: "p_chain", mapId: "m_harbour", x: 0.5, y: 0.5, name: "", ref: harbour.ref, linkedMapId: "", notes: "" });
  doc.calendars.push({ id: "c_tide", name: "Tide Reckoning", abbrev: "TR", epochOffset: 0, notes: "" });
  doc.events.push({ id: "e_chain", title: "The chain is forged", body: "", era: "", when: { calendarId: "c_tide", yearNum: 12, year: "12" }, refs: [harbour.ref], canon: "canon" });
  doc.secrets.push({ id: "s_tolls", title: "The toll books are forged", subject: wardens.ref, notes: "", knownBy: [], partyKnows: false });
  saveWorldDoc(id, doc);
}

// The scenario around it.
const workshop = getCampaignById(id);
const cellar = createLibraryMap(workshop, { name: "The chain-house cellar", blank: "rock" }).map;
insertEncounterTemplate({ campaignId: id, name: "Smugglers at the chain", enemies: [{ monster: "bandit", count: 3 }], battlefield: "", map: { mapId: cellar.id, scene: null, seed: null, theme: null, ambient: null, width: null, height: null }, notes: "", createdByUserId: owner.id });
insertRollTable({ campaignId: id, name: "What the tide brings in", entries: [{ min: 1, max: 6, text: "A barrel." }], createdByUserId: owner.id });
const drowner = createHomebrewMonster(owner.id, draftFromCr("Harbour Drowner", 2), "It waits under the chain.");
made({ typeId: "t_other", name: "The drowner legend", text: "Sailors say something waits under the chain.", bindings: [{ kind: "monster", ref: `homebrew:${drowner.id}` }] });
insertBeat(id, { kind: "hook", title: "A lamp goes dark", body: "The north lamp is out and Mira is missing.", links: {}, edges: [], x: 0, y: 0 });
insertBeat(id, { kind: "event", title: "The chain breaks", body: "", links: {}, edges: [], x: 0, y: 0 });

const compiled = () => {
  const exported = exportWorkshopBundle(id, { name: "Saltmarch", blurb: "A harbour town.", inspiredBy: "My own." });
  assert.ok(!("error" in exported), exported.error);
  return compileToPack(exported.bundle);
};
const omission = (report, key) => report.omissions.find((entry) => entry.key === key);

const pull = await world.route("workshops/[workshopId]/plugin/pull");
const exportRoute = await world.route("workshops/[workshopId]/plugin/export");
const sharePack = await world.route("campaigns/[campaignId]/dm/bundle/pack");
async function call(route, method, { as = owner, body } = {}) {
  world.signIn({ id: as.id });
  const response = await route[method](
    new Request("http://local/", { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }),
    { params: Promise.resolve({ workshopId: id, campaignId: id }) },
  );
  return { status: response.status, body: await response.json() };
}

// ---- the compile ----

await test("A native WorldForge faction compiles into the pack, with its seat and both of its members in the line.", () => {
  const { draft } = compiled();
  const faction = draft.factions.find((entry) => entry.name === "The Tide Wardens");
  assert.ok(faction, `no native faction in ${JSON.stringify(draft.factions)}`);
  assert.match(faction.blurb, /^Lamp-keepers who decide which ships the harbour lets in\./, "the row's own line is the summary");
  assert.match(faction.blurb, /Based in Saltmarch Harbour\./);
  assert.match(faction.blurb, /Members: Mira Fenn and Old Tobb\./, "a member by the column and one by a link");
  assert.ok(faction.blurb.length <= 200);
  assert.ok(worldPackSchema.safeParse(draft).success, "the compiled draft is a pack today's schema reads");
});

await test("Each summary is the entry's account: a place's article, a lore entry's body, cut where a sentence ends.", () => {
  const { draft } = compiled();
  const place = draft.locations.find((entry) => entry.name === "Saltmarch Harbour");
  assert.equal(place.blurb, "Saltmarch Harbour is a walled anchorage at the mouth of the Grey. The chain across it is raised at dusk.");
  const term = draft.glossary.find((entry) => entry.term === "The Drowned Bell");
  assert.equal(term.meaning, "A bell under the harbour that rings before a storm.", "the body, not the older article");
});

await test("A members list too long for the line is cut short and counted, and the summary keeps its room.", async () => {
  const many = createWorkshop(owner.id, { title: "Crowded" }).id;
  const guild = createWorldEntity(many, { typeId: "t_faction", name: "The Long Guild", tagline: "A guild with a great many members, all of whom insist on being named in full." }).entity;
  for (let index = 0; index < 12; index += 1) {
    const npc = createWorldEntity(many, { typeId: "t_character", name: `Member Number ${index + 1}` }).entity;
    setNpcPlace(npc.ref.slice("npc:".length), { factionId: guild.ref.slice("faction:".length) });
  }
  const exported = exportWorkshopBundle(many, { name: "Crowded", blurb: "b", inspiredBy: "me" });
  const report = compileToPack(exported.bundle);
  const line = report.draft.factions[0].blurb;
  assert.ok(line.length <= 200, `${line.length}: ${line}`);
  assert.match(line, /^A guild with a great many members, all of whom insist on being named in full\. Members: .+ and \d+ more\.$/);
  const named = Number(/and (\d+) more/.exec(line)[1]);
  assert.ok(named > 0 && named < 12);
});

await test("A DM-only lore entry and a draft faction stay out of the pack, and are named as kept back.", () => {
  const report = compiled();
  assert.ok(!report.draft.factions.some((entry) => entry.name === "The Gull Court"));
  assert.ok(!report.draft.glossary.some((entry) => entry.term === "The Warden's bargain"));
  assert.deepEqual(omission(report, "held").assets.sort(), ["The Gull Court (draft)", "The Warden's bargain (DM only)"]);
});

await test("The omission report names every kind the pack leaves out, each with its exact entry.", () => {
  const report = compiled();
  const expect = {
    atlas: ["Saltmarch from the cliffs (1 pin)"],
    timeline: ["Calendar: Tide Reckoning", "Event: The chain is forged"],
    secrets: ["Secret: The toll books are forged (about The Tide Wardens)", "Old Tobb: its hidden truth"],
    storyboard: ["The chain breaks (event)"],
    fields: ["Saltmarch Harbour: Population"],
    links: ["Mira Fenn rival of Old Tobb"],
    notes: ["Old Tobb"],
    encounters: ["Smugglers at the chain"],
    maps: ["The chain-house cellar"],
    tables: ["What the tide brings in"],
    monsters: ["Harbour Drowner"],
    bindings: ["The drowner legend: its stat block"],
  };
  for (const [key, assets] of Object.entries(expect)) {
    const found = omission(report, key);
    assert.ok(found, `nothing reported for ${key}: ${report.omissions.map((entry) => entry.key).join(", ")}`);
    for (const asset of assets) {
      assert.ok(found.assets.includes(asset), `${key} does not name "${asset}": ${JSON.stringify(found.assets)}`);
    }
    assert.ok(found.reason.trim(), `${key} says why`);
    assert.ok(["world", "scenario"].includes(found.group));
  }
  // What the compile folded into the faction's line is not reported as left.
  const links = omission(report, "links").assets;
  assert.ok(!links.some((line) => /located in|member of/.test(line)), `carried links reported as left: ${JSON.stringify(links)}`);
  // The hook card became a hook, so it is not a left-out card.
  assert.ok(!omission(report, "storyboard").assets.some((line) => line.startsWith("A lamp goes dark")));
  assert.ok(report.draft.hooks.some((hook) => hook.startsWith("A lamp goes dark")));
});

// ---- Plugin Pull, Publish, and the setting at the table ----

await test("A player gets 403 or 404 from the pull, both ways, and the draft is left as it was.", async () => {
  const before = JSON.stringify(getPackDraft(id).draft);
  for (const method of ["GET", "POST"]) {
    const answer = await call(pull, method, { as: player });
    assert.ok([403, 404].includes(answer.status), `${method}: ${answer.status}`);
  }
  assert.equal(JSON.stringify(getPackDraft(id).draft), before);
});

await test("Before a pull, the Publish tab's list names the native faction as not in the draft, and changes nothing.", async () => {
  const answer = await call(pull, "GET");
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const missing = answer.body.omissions.find((entry) => entry.key === "not-pulled");
  assert.ok(missing?.assets.includes("Faction: The Tide Wardens"), JSON.stringify(missing));
  assert.ok(answer.body.omissions.some((entry) => entry.key === "atlas"));
  assert.deepEqual(getPackDraft(id).draft.factions, [], "a GET pulls nothing");
});

await test("Plugin Pull brings the native faction into the draft, and the list no longer names it.", async () => {
  const answer = await call(pull, "POST");
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const faction = answer.body.draft.factions.find((entry) => entry.name === "The Tide Wardens");
  assert.ok(faction, JSON.stringify(answer.body.draft.factions));
  assert.match(faction.blurb, /Members: Mira Fenn and Old Tobb\./);
  assert.ok(!answer.body.omissions.some((entry) => entry.key === "not-pulled"), "everything the compile carries is in the draft");
  assert.ok(answer.body.omissions.some((entry) => entry.key === "encounters"), "the scenario is still named as left behind");
  // Taking it out again names it again, worked out against the draft held.
  const without = { ...answer.body.draft, factions: answer.body.draft.factions.filter((entry) => entry.name !== "The Tide Wardens") };
  assert.deepEqual(notInDraft(answer.body.pulled, without)?.assets, ["Faction: The Tide Wardens"]);
});

await test("The pulled faction reaches the installed pack and the narrator's setting lines.", async () => {
  const draft = { ...getPackDraft(id).draft, name: "Saltmarch Test", blurb: "A harbour town.", inspiredBy: "My own.", theme: "A harbour under a chain" };
  savePackDraft(id, draft);
  const answer = await call(exportRoute, "POST", { body: { install: true } });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  resetWorldPackCache();
  const hints = packWorldHints({ genre: draft.baseGenre, worldPack: answer.body.installed.id });
  assert.match(hints, /Factions of this world: [^\n]*The Tide Wardens \(Lamp-keepers who decide which ships the harbour lets in\.[^\n]*Members: Mira Fenn and Old Tobb\.\)/, hints);
});

await test("An older bundle with factions only in lore still compiles them, and a native faction of the same name wins.", () => {
  const exported = exportWorkshopBundle(id, { name: "Saltmarch", blurb: "b", inspiredBy: "me" }).bundle;
  const older = { ...exported, factions: [], world: null, lore: [...exported.lore, { category: "factions", title: "The Ropewalkers", body: "They own every rope in town.", tags: [], visibility: "party", pinned: false, style: "plain", image: "" }] };
  assert.ok(compileToPack(older).draft.factions.some((entry) => entry.name === "The Ropewalkers"));
  const twice = { ...exported, lore: [...exported.lore, { category: "factions", title: "The Tide Wardens", body: "A lore copy.", tags: [], visibility: "party", pinned: false, style: "plain", image: "" }] };
  const wardensLines = compileToPack(twice).draft.factions.filter((entry) => entry.name === "The Tide Wardens");
  assert.equal(wardensLines.length, 1);
  assert.match(wardensLines[0].blurb, /^Lamp-keepers/);
});

await test("The Share tool's pack draft carries the native faction and the same list, with the reskin note once.", async () => {
  const answer = await call(sharePack, "POST", { body: { manifest: { name: "Saltmarch", blurb: "A harbour town.", inspiredBy: "My own." } } });
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  assert.ok(answer.body.draft.factions.some((entry) => entry.name === "The Tide Wardens"));
  assert.ok(answer.body.notes.some((note) => /reskin/.test(note)));
  assert.deepEqual(answer.body.omissions.find((entry) => entry.key === "atlas")?.assets, ["Saltmarch from the cliffs (1 pin)"]);
  assert.ok(!answer.body.omissions.some((entry) => entry.key === "not-pulled"), "a compile on its own has no draft to compare with");
});

finish();
