// A companion worth travelling with is worth keeping (a player's report: the
// builder saved her characters, but the companion she made lived only in
// that story, and starting over meant building him again).
//
//   a companion built at the table is kept in its builder's characters and
//   tied to that entry; one brought from the library, or opened from it with
//   "Change first", stays tied to its entry, and a table seats it once; a
//   companion the GM wrote in is kept with "Save to my characters" (whoever
//   runs the story, lasting companions only), its voice riding as the
//   backstory; a later save, or the campaign's end, writes its progress back.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-companion-library");

// A table of its own for each door below: a table holds two lasting
// companions, and the doors refuse a third before anything else.
async function freshTable() {
  const table = await openWorld({ gameSettings: { companions: "full" } });
  table.addHero({ name: "Lead" });
  const seat = table.addUser("player");
  table.addHero({ user: seat, name: "Player Hero" });
  return { table, seat };
}
const { table: world } = await freshTable();
const characters = await import("../src/lib/db/characters.ts");
const { finalizeNewCompanion } = await import("../src/lib/dm/companion-tools.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");

// Line endings as git wrote them: a Windows checkout reads CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// Every sheet here carries a portrait: one without asks the image backend to
// paint it, and a suite has no business on somebody's GPU queue.
const built = (name, extra = {}) => ({ ...LEGAL_FIGHTER, name, portrait: PORTRAIT, ...extra });

async function call(name, method, user, body, params = {}, table = world) {
  const route = await table.route(name);
  table.signIn(user);
  const response = await route[method](
    new Request("http://test/", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: table.campaignId, ...params }) },
  );
  return { status: response.status, json: await response.json() };
}

const CREATE = "campaigns/[campaignId]/companions/create";
const KEEP = "campaigns/[campaignId]/companions/[characterId]/keep";
const companionsOf = (userId) => characters.listCharactersForUser(userId, "companion");
const seated = (name, table = world) => table.sheets().find((sheet) => sheet.isCompanion && sheet.name === name);

await test("a companion built at the table is kept in its builder's characters, tied to that entry", async () => {
  const before = companionsOf(world.owner.id).length;
  const made = await call(CREATE, "POST", world.owner, { sheet: built("Brannoc") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const kept = companionsOf(world.owner.id);
  assert.equal(kept.length, before + 1, "one new entry");
  const entry = kept.find((character) => character.name === "Brannoc");
  assert.equal(entry.role, "companion");
  assert.equal(seated("Brannoc").libraryCharacterId, entry.id);
});

await test("a library companion brought in is tied to its entry, and a table seats it once", async () => {
  const { table } = await freshTable();
  const wren = characters.createCharacter(table.owner.id, 1, built("Wren"), "companion");
  const first = await call(CREATE, "POST", table.owner, { libraryCharacterId: wren.id }, {}, table);
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(seated("Wren", table).libraryCharacterId, wren.id);
  const again = await call(CREATE, "POST", table.owner, { libraryCharacterId: wren.id }, {}, table);
  assert.equal(again.status, 409);
  assert.match(again.json.error, /Wren is already at this table/);
});

await test("Change first joins tied to the entry it was opened from, which stays as it was", async () => {
  const { table } = await freshTable();
  const tam = characters.createCharacter(table.owner.id, 1, built("Tam", { backstory: "A ferryman." }), "companion");
  const before = companionsOf(table.owner.id).length;
  const made = await call(CREATE, "POST", table.owner, {
    sheet: built("Tam", { backstory: "A ferryman who lost his boat." }),
    fromLibraryCharacterId: tam.id,
  }, {}, table);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(seated("Tam", table).libraryCharacterId, tam.id);
  assert.equal(companionsOf(table.owner.id).length, before, "no second entry");
  assert.equal(characters.getCharacter(tam.id).sheet.backstory, "A ferryman.");
});

await test("an entry that is not the caller's own companion is never the source", async () => {
  const { table, seat } = await freshTable();
  const theirs = characters.createCharacter(seat.id, 1, built("Osk"), "companion");
  const refused = await call(CREATE, "POST", table.owner, { sheet: built("Osk"), fromLibraryCharacterId: theirs.id }, {}, table);
  assert.equal(refused.status, 404);
  assert.equal(seated("Osk", table), undefined);
});

// One the GM wrote in, as add_companion makes it: the voice it is played
// from is its personality, and no library entry stands behind it. Its own
// table, with the room the doors above used up.
const { table: gmTable, seat: gmPlayer } = await freshTable();
const voice = "Dry wit, hums sea shanties, never sits with her back to a door.";
const { sheet: isolde } = finalizeNewCompanion(
  gmTable.campaign(),
  1,
  createSheetSchema.parse(built("Isolde", { gender: "Female", backstory: "" })),
  "party",
  voice,
);

await test("a companion the GM wrote in is kept with Save to my characters, voice and all", async () => {
  assert.equal(isolde.libraryCharacterId, null);
  const kept = await call(KEEP, "POST", gmTable.owner, {}, { characterId: isolde.id }, gmTable);
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.equal(kept.json.how, "kept");
  const entry = characters.getCharacter(kept.json.characterId);
  assert.equal(entry.userId, gmTable.owner.id);
  assert.equal(entry.role, "companion");
  assert.equal(entry.sheet.gender, "Female");
  assert.equal(entry.sheet.backstory, voice, "brought to a new table, she is played from the same voice");
  assert.equal(gmTable.sheet(isolde.id).libraryCharacterId, entry.id);
});

await test("a later save writes the companion's progress back to the entry it is kept as", async () => {
  gmTable.patch(isolde.id, { gold: 77 });
  const saved = await call(KEEP, "POST", gmTable.owner, {}, { characterId: isolde.id }, gmTable);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.how, "saved");
  assert.equal(characters.getCharacter(gmTable.sheet(isolde.id).libraryCharacterId).sheet.gold, 77);
});

await test("the campaign's end writes a kept companion's progress back, as it does a player's", async () => {
  gmTable.patch(isolde.id, { gold: 120 });
  assert.ok(characters.syncProgressToLibrary(isolde.id), "a companion's sheet syncs to the entry it is kept as");
  assert.equal(characters.getCharacter(gmTable.sheet(isolde.id).libraryCharacterId).sheet.gold, 120);
  assert.match(read("src/app/api/campaigns/[campaignId]/route.ts"), /if \(sheet\.libraryCharacterId\) \{\n\s+syncProgressToLibrary\(sheet\.id\);/);
});

await test("only whoever runs the story keeps a companion, and only a lasting one", async () => {
  const refused = await call(KEEP, "POST", gmPlayer, {}, { characterId: isolde.id }, gmTable);
  assert.equal(refused.status, 403);
  const { sheet: guest } = finalizeNewCompanion(gmTable.campaign(), 1, createSheetSchema.parse(built("Watchman")), "guest", "A tired soldier.");
  const scene = await call(KEEP, "POST", gmTable.owner, {}, { characterId: guest.id }, gmTable);
  assert.equal(scene.status, 400);
  assert.match(scene.json.error, /not a lasting companion/);
});

await test("a second keeper of a kept companion gets a copy of their own, and the sheet stays tied to the first", async () => {
  const lead = gmTable.addUser("lead");
  const stranger = characters.createCharacter(lead.id, 1, built("Mara"), "companion");
  const { keepCompanion } = await import("../src/lib/characters/keep-companion.ts");
  const sheetsDb = await import("../src/lib/db/sheets.ts");
  const { sheet: mara } = finalizeNewCompanion(gmTable.campaign(), 1, createSheetSchema.parse(built("Mara")), "party", "Quiet.", stranger.id);
  const copied = keepCompanion(sheetsDb.getSheetById(mara.id), gmTable.owner.id);
  assert.equal(copied.how, "copied");
  assert.notEqual(copied.character.id, stranger.id);
  assert.equal(gmTable.sheet(mara.id).libraryCharacterId, stranger.id);
});

await test("the card offers it to whoever runs the story, and a repaint reads the kept entry's look", () => {
  const panel = read("src/app/campaigns/[campaignId]/PartyPanel.tsx");
  assert.match(panel, /sheet\.isCompanion && steersStory && sheet\.companionKind === "party" && !sheet\.summon \? \(\n\s+<CompanionKeepButton/);
  const paint = read("src/app/api/campaigns/[campaignId]/companions/[characterId]/portrait/route.ts");
  assert.match(paint, /appearance: kept\?\.sheet\.appearance,\n\s+ancestry: kept\?\.sheet\.racialChoices\?\.ancestry,/);
  assert.match(read("src/app/campaigns/[campaignId]/CompanionBuilderDialog.tsx"), /fromLibraryCharacterId: tweaking\.id/);
});

finish();
