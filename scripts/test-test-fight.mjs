// Issue 553: a workshop's prepared fight could not be deployed ("No party
// characters to fight."), because a workshop is prep with no party in it.
// Test fight plays it on a table of its own (src/lib/workshop/test-fight.ts),
// seated with the stand-in party the workshop is built for or with
// characters its author picks. Everything here goes through the routes the
// Workshop's sheet calls, and is read back from the rows they wrote.
//
// The same sweep found four more Workshop controls that assumed a table
// (a map put on the table, a map shown to the party, the party placed on
// the region map, a faction's standing with the party): each route now says
// why a workshop cannot, and a map shown to a party no longer travels in a
// copy.

import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-test-fight");
const world = await openWorld({ status: "lobby" });
const campaigns = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { createCharacter, getCharacter } = await import("../src/lib/db/characters.ts");
const { listSheets, patchSheet } = await import("../src/lib/db/sheets.ts");
const { getActiveEncounter, listEnemies } = await import("../src/lib/db/encounters.ts");
const { getBattleMapForEncounter } = await import("../src/lib/db/battle-maps.ts");
const { listNpcs, createNpcFromDraft } = await import("../src/lib/db/npcs.ts");
const { blankDraft } = await import("../src/lib/npcs/forge.ts");
const { createLibraryMap } = await import("../src/lib/dm/map-library.ts");
const { insertFaction } = await import("../src/lib/db/factions.ts");
const { getWorldDoc, saveWorldDoc } = await import("../src/lib/db/world-forge.ts");
const { copyWorldDoc } = await import("../src/lib/db/world-forge-io.ts");
const { testFightsOf } = await import("../src/lib/db/test-fights.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const route = {
  test: await world.route("workshops/[workshopId]/test-fight"),
  workshop: await world.route("workshops/[workshopId]"),
  deploy: await world.route("campaigns/[campaignId]/dm/encounter-templates/[templateId]/deploy"),
  table: await world.route("campaigns/[campaignId]"),
  map: await world.route("campaigns/[campaignId]/dm/maps/[mapId]"),
  atlas: await world.route("campaigns/[campaignId]/world/atlas/party"),
  overworld: await world.route("campaigns/[campaignId]/overworld"),
  faction: await world.route("campaigns/[campaignId]/factions/[factionId]"),
};

async function call(mod, method, body, params) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

const author = world.owner;
world.signIn(author);

// The reporter's workshop: a party built for four at level 3, a cast member
// with a stat block, a cellar map, and a fight on it naming both a monster
// and the cast member.
function openWorkshop(title = "The Sunken Keep") {
  const workshop = createWorkshop(author.id, { title, targetParty: { size: 4, level: 3 } });
  const captain = createNpcFromDraft(workshop.id, { ...blankDraft(), name: "Captain Vel", statBlock: "bandit-captain" });
  const cellar = createLibraryMap(campaigns.getCampaignById(workshop.id), { name: "The cellar", blank: "ground" }).map;
  const fight = insertEncounterTemplate({
    campaignId: workshop.id,
    name: "Goblins in the cellar",
    enemies: [{ monster: "goblin", count: 2 }, { monster: "Captain Vel", count: 1 }],
    battlefield: "a low cellar",
    map: { mapId: cellar.id, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
    notes: "They guard the stair.",
    extras: {},
    createdByUserId: author.id,
  });
  const plain = (name, enemies) =>
    insertEncounterTemplate({
      campaignId: workshop.id,
      name,
      enemies,
      battlefield: "",
      map: { mapId: null, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
      notes: "",
      extras: {},
      createdByUserId: author.id,
    });
  const lone = plain("A lone goblin", [{ monster: "goblin", count: 1 }]);
  const empty = plain("Not written yet", []);
  return { workshop, captain, cellar, fight, lone, empty };
}

const keep = openWorkshop();
const at = { workshopId: keep.workshop.id };

await test("the workshop's own Deploy says where the fight is played instead of 'No party characters to fight.'", async () => {
  const out = await call(route.deploy, "POST", {}, { campaignId: keep.workshop.id, templateId: keep.fight.id });
  assert.equal(out.status, 409);
  assert.match(out.json.error, /no table to deploy to.*Test fight/);
  assert.equal(getActiveEncounter(keep.workshop.id), null);
});

await test("the sheet reads the stand-in party before anything is built, and that no test is open", async () => {
  const out = await call(route.test, "GET", undefined, at);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  assert.equal(out.json.ready, true, out.json.reason);
  assert.deepEqual(out.json.standIns, { size: 4, level: 3, classes: ["Fighter", "Cleric", "Rogue", "Wizard"] });
  assert.equal(out.json.open, null);
});

let first = "";
await test("Test fight with the stand-ins: a table of its own, in play, the party seated and the fight on its map", async () => {
  const out = await call(route.test, "POST", { templateId: keep.fight.id, party: { kind: "stand-ins" } }, at);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  first = out.json.campaignId;
  const table = campaigns.getCampaignById(first);
  assert.equal(table.kind, "playtest");
  assert.equal(table.status, "active");
  assert.equal(table.ownerUserId, author.id);
  assert.equal(table.gameSettings.dmMode, "ai");
  assert.equal(table.gameSettings.multiCharacter, "all_active");
  assert.equal(table.settings.autoImages, false);

  const heroes = listSheets(first);
  assert.equal(heroes.length, 4);
  assert.ok(heroes.every((sheet) => sheet.userId === author.id && sheet.level === 3), JSON.stringify(heroes.map((sheet) => [sheet.name, sheet.level])));
  assert.deepEqual(heroes.map((sheet) => sheet.class).sort(), ["cleric", "fighter", "rogue", "wizard"]);
  assert.equal(new Set(heroes.map((sheet) => sheet.name)).size, 4, "every stand-in has a name of their own");
  assert.ok(heroes.every((sheet) => !sheet.libraryCharacterId), "a stand-in is nobody's library character");

  const fight = getActiveEncounter(first);
  assert.ok(fight, "the fight is running");
  const enemies = listEnemies(fight.id);
  assert.equal(enemies.length, 3);
  assert.equal(enemies.filter((enemy) => /goblin/i.test(enemy.slug)).length, 2);
  // The cast member came along and fights as their own stat block.
  assert.ok(enemies.some((enemy) => enemy.displayName === "Captain Vel"), enemies.map((enemy) => enemy.displayName).join(", "));
  assert.deepEqual(listNpcs(first).map((npc) => npc.name), ["Captain Vel"]);
  // On the cellar it was drawn on, copied: the workshop's own map is untouched.
  const board = getBattleMapForEncounter(fight.id);
  assert.equal(board.width, keep.cellar.width);
  assert.equal(board.height, keep.cellar.height);
  assert.equal(getActiveEncounter(keep.workshop.id), null, "nothing was played in the workshop itself");
});

await test("the test table is nobody else's: no campaign list shows it, a code cannot join it, the table names its workshop", async () => {
  assert.ok(!campaigns.listCampaignsForUser(author.id).some((row) => row.id === first));
  const stranger = world.addUser("stranger");
  const joined = campaigns.joinByInviteCode(stranger.id, campaigns.getCampaignById(first).inviteCode);
  assert.ok("error" in joined, "a code cannot seat anyone at a test fight");
  // Nor at the workshop it came from.
  assert.ok("error" in campaigns.joinByInviteCode(stranger.id, campaigns.getCampaignById(keep.workshop.id).inviteCode));
  world.signIn(author);
  const snapshot = await call(route.table, "GET", undefined, { campaignId: first });
  assert.equal(snapshot.status, 200);
  assert.deepEqual(snapshot.json.testFight, { workshopId: keep.workshop.id, title: "The Sunken Keep" });
  const open = await call(route.test, "GET", undefined, at);
  assert.equal(open.json.open?.id, first);
});

const mine = createCharacter(author.id, 1, { ...LEGAL_FIGHTER, name: "Thessaly", portrait: PORTRAIT }, "pc");

await test("a fight the engine refuses for the party picked starts nothing, and leaves the open test as it was", async () => {
  const out = await call(route.test, "POST", { templateId: keep.fight.id, party: { kind: "characters", characterIds: [mine.id] } }, at);
  assert.equal(out.status, 409);
  assert.match(out.json.error, /would not start for that party: Too deadly/);
  assert.deepEqual(testFightsOf(keep.workshop.id, author.id).map((row) => row.id), [first]);
  assert.equal(getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE kind = 'playtest'`).get().n, 1);
});

await test("characters you pick fight as copies at their own level, and nothing the test does reaches the library", async () => {
  const out = await call(route.test, "POST", { templateId: keep.lone.id, party: { kind: "characters", characterIds: [mine.id] } }, at);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  // Starting the next test ended the one before it.
  assert.equal(campaigns.getCampaignById(first), null);
  assert.deepEqual(testFightsOf(keep.workshop.id, author.id).map((row) => row.id), [out.json.campaignId]);
  const [seat] = listSheets(out.json.campaignId);
  assert.equal(seat.name, "Thessaly");
  assert.equal(seat.level, 1);
  assert.equal(seat.libraryCharacterId ?? null, null);
  patchSheet(seat.id, { currentHp: 0 });
  const library = getCharacter(mine.id);
  assert.equal(library.sheet.currentHp ?? library.sheet.maxHp, library.sheet.maxHp);
});

await test("what a test fight refuses, before any table is made", async () => {
  const before = testFightsOf(keep.workshop.id, author.id).map((row) => row.id);
  const noRoster = await call(route.test, "POST", { templateId: keep.empty.id, party: { kind: "stand-ins" } }, at);
  assert.equal(noRoster.status, 409);
  assert.match(noRoster.json.error, /nobody in it yet/);
  const elsewhere = openWorkshop("Somewhere else");
  const foreign = await call(route.test, "POST", { templateId: elsewhere.fight.id, party: { kind: "stand-ins" } }, at);
  assert.equal(foreign.status, 404);
  const ally = createCharacter(author.id, 1, { ...LEGAL_FIGHTER, name: "Pip", portrait: PORTRAIT }, "companion");
  const companion = await call(route.test, "POST", { templateId: keep.fight.id, party: { kind: "characters", characterIds: [ally.id] } }, at);
  assert.equal(companion.status, 422);
  assert.match(companion.json.error, /ally the DM plays/);
  const stranger = world.addUser("stranger");
  const theirs = createCharacter(stranger.id, 1, { ...LEGAL_FIGHTER, name: "Not yours", portrait: PORTRAIT }, "pc");
  world.signIn(author);
  const borrowed = await call(route.test, "POST", { templateId: keep.fight.id, party: { kind: "characters", characterIds: [theirs.id] } }, at);
  assert.equal(borrowed.status, 422);
  const tooMany = await call(route.test, "POST", { templateId: keep.fight.id, party: { kind: "characters", characterIds: Array.from({ length: 9 }, (_, index) => `id-${index}`) } }, at);
  assert.equal(tooMany.status, 400);
  // The open test survived every refusal.
  assert.deepEqual(testFightsOf(keep.workshop.id, author.id).map((row) => row.id), before);
  // Only the workshop's owner reaches its test fights.
  world.signIn(stranger);
  assert.equal((await call(route.test, "GET", undefined, at)).status, 404);
  world.signIn(author);
});

await test("End the test deletes its table; deleting the workshop takes its tests with it", async () => {
  const ended = await call(route.test, "DELETE", undefined, at);
  assert.equal(ended.status, 200);
  assert.equal(ended.json.ended, 1);
  assert.deepEqual(testFightsOf(keep.workshop.id, author.id), []);
  const again = await call(route.test, "POST", { templateId: keep.fight.id, party: { kind: "stand-ins" } }, at);
  assert.equal(again.status, 200, JSON.stringify(again.json));
  const gone = await call(route.workshop, "DELETE", undefined, at);
  assert.equal(gone.status, 200);
  assert.equal(campaigns.getCampaignById(again.json.campaignId), null);
  assert.equal(getDatabase().prepare(`SELECT COUNT(*) AS n FROM campaigns WHERE kind = 'playtest'`).get().n, 0);
});

// ---- the rest of the sweep ----

const prep = openWorkshop("The Drowned Road");
const prepId = prep.workshop.id;

await test("a workshop's map cannot be put on a table it does not have", async () => {
  for (const action of ["deploy", "open-scene"]) {
    const out = await call(route.map, "POST", { do: action }, { campaignId: prepId, mapId: prep.cellar.id });
    assert.equal(out.status, 400, action);
    assert.match(out.json.error, /no table to put a map on/);
  }
});

await test("a workshop's Atlas map is not shown to a party it does not have, and a copy never arrives shown", async () => {
  const doc = getWorldDoc(prepId);
  doc.maps = [...doc.maps, { id: "atlas-1", name: "The coast", image: "", parentPinId: "", regions: [], party: "shown" }];
  saveWorldDoc(prepId, doc);
  const refused = await call(route.atlas, "POST", { mapId: "atlas-1", apply: true }, { campaignId: prepId });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /no party to show a map to/);
  // A map an older workshop marked shown reaches a campaign hidden: its
  // players see it after that table's own review.
  copyWorldDoc(prepId, world.campaignId, () => null);
  const copied = getWorldDoc(world.campaignId).maps.find((atlas) => atlas.name === "The coast");
  assert.ok(copied, "the map came along");
  assert.equal(copied.party, undefined);
});

await test("a workshop's region map places no party; clearing an old marker still works", async () => {
  const placed = await call(route.overworld, "PATCH", { partyXy: { x: 2, y: 2 } }, { campaignId: prepId });
  assert.equal(placed.status, 400);
  assert.match(placed.json.error, /no party to place/);
  const cleared = await call(route.overworld, "PATCH", { partyXy: null }, { campaignId: prepId });
  assert.notEqual(cleared.status, 400, JSON.stringify(cleared.json));
});

await test("a workshop's faction keeps its attitude, and refuses a standing no import would carry", async () => {
  const court = insertFaction(prepId, { name: "The Reed Court", blurb: "", goal: "", attitude: "neutral", power: 2, tags: [], portraitPath: "" });
  const standing = await call(route.faction, "PATCH", { standing: 2 }, { campaignId: prepId, factionId: court.id });
  assert.equal(standing.status, 400);
  assert.match(standing.json.error, /Set its attitude instead/);
  const attitude = await call(route.faction, "PATCH", { attitude: "hostile" }, { campaignId: prepId, factionId: court.id });
  assert.equal(attitude.status, 200, JSON.stringify(attitude.json));
  assert.equal(attitude.json.faction.attitude, "hostile");
});

world.close();
finish();
