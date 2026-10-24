// A DM's own pregens shared with the table (option B: the DM ticks which).
// A pregen is a library character the DM files under a workshop
// (src/app/api/workshops/[workshopId]/pregens/route.ts). Ticked "Offer to
// players", it is listed in the hero chooser of a table made from that
// workshop (GET /api/campaigns/:id/pregens), its confirm sheet checks it
// (POST /sheet/preview), and a player takes a seat with a copy at the
// table's level (POST /sheet/offered). One player per pregen per table.
// Every one of those checks is the server's (src/lib/db/pregen-offers.ts):
// the tick, the table's link to the workshop and the claim.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation, LEGAL_FIGHTER } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-offered-pregens");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { recordOrigin } = await import("../src/lib/db/content-origins.ts");
const { owedChoices } = await import("../src/lib/srd/owed-choices.ts");

// A table whose DM wrote a workshop with one pregen in it, a level 1
// fighter, and a second player beside the first.
async function openTable({ link = true, level = 4, gameSettings } = {}) {
  const table = await openCreation({ campaign: { startingLevel: level }, ...(gameSettings ? { gameSettings } : {}) });
  const { world, campaignId } = table;
  const dm = world.owner;
  const workshop = createWorkshop(dm.id, { title: "The Sunken Keep" });
  // The table was made from the workshop: its prep was imported, and each
  // copied row names the workshop it came from (content-origins.ts).
  if (link) {
    recordOrigin(campaignId, "npcs", "npc-copy", workshop.id, "npc-original");
  }
  const pregen = table.characters.createCharacter(dm.id, 1, { ...LEGAL_FIGHTER, name: "Thessaly" }, "pc", workshop.id);
  const second = world.addUser("second");
  const joined = campaigns.joinByInviteCode(second.id, world.campaign().inviteCode);
  assert.ok(!("error" in joined), JSON.stringify(joined));
  const route = {
    roster: await world.route("workshops/[workshopId]/pregens"),
    list: await world.route("campaigns/[campaignId]/pregens"),
    preview: await world.route("campaigns/[campaignId]/sheet/preview"),
    offered: await world.route("campaigns/[campaignId]/sheet/offered"),
  };
  async function as(user, mod, method, body, params = { campaignId }) {
    world.signIn(user);
    return table.call(mod, method, body, params);
  }
  const offer = (offered, user = dm) =>
    as(user, route.roster, "PATCH", { characterId: pregen.id, offered }, { workshopId: workshop.id });
  const list = async (user) => (await as(user, route.list, "GET")).json.pregens;
  const preview = (user, body = {}) => as(user, route.preview, "POST", { offeredPregenId: pregen.id, ...body });
  const take = (user, body = {}) => as(user, route.offered, "POST", { id: pregen.id, ...body });
  return { ...table, dm, second, workshop, pregen, route, as, offer, list, preview, take };
}

await test("an unticked pregen is invisible to the players: not listed, not previewed, not seated.", async () => {
  const table = await openTable();
  assert.deepEqual(await table.list(table.player), []);
  assert.equal((await table.preview(table.player)).status, 404);
  assert.equal((await table.take(table.player)).status, 404);
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id), null);
  table.world.close();
});

await test("the DM ticks Offer to players on the workshop's roster, and unticks it again.", async () => {
  const table = await openTable();
  const ticked = await table.offer(true);
  assert.equal(ticked.status, 200, JSON.stringify(ticked.json));
  assert.equal(ticked.json.pregens.find((entry) => entry.id === table.pregen.id).offered, true);
  assert.deepEqual((await table.list(table.player)).map((entry) => [entry.name, entry.taken]), [["Thessaly", null]]);
  // Nobody but the workshop's owner can tick it.
  assert.equal((await table.offer(false, table.player)).status, 404);
  const unticked = await table.offer(false);
  assert.equal(unticked.json.pregens[0].offered, false);
  assert.deepEqual(await table.list(table.player), []);
  // Taken off the roster, a pregen is no longer offered either.
  await table.offer(true);
  table.world.signIn(table.dm);
  await table.call(table.route.roster, "DELETE", { characterId: table.pregen.id }, { workshopId: table.workshop.id });
  await table.call(table.route.roster, "POST", { characterId: table.pregen.id }, { workshopId: table.workshop.id });
  assert.equal(table.characters.getCharacter(table.pregen.id).offered, false, "a pregen filed again came back ticked");
  table.world.close();
});

await test("a companion on the roster cannot be offered: the DM plays it.", async () => {
  const table = await openTable();
  const ally = table.characters.createCharacter(table.dm.id, 1, { ...LEGAL_FIGHTER, name: "Ward" }, "companion", table.workshop.id);
  table.world.signIn(table.dm);
  const refused = await table.call(table.route.roster, "PATCH", { characterId: ally.id, offered: true }, { workshopId: table.workshop.id });
  assert.equal(refused.status, 400);
  table.world.close();
});

await test("a ticked pregen of a workshop this table was not made from is not offered here.", async () => {
  const table = await openTable({ link: false });
  await table.offer(true);
  assert.deepEqual(await table.list(table.player), []);
  assert.equal((await table.take(table.player)).status, 404);
  table.world.close();
});

await test("a player previews the pregen at the table's level and takes the seat with a copy; the DM's pregen is unchanged.", async () => {
  const table = await openTable();
  await table.offer(true);
  const preview = await table.preview(table.player);
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.preview.ok, true, preview.json.preview.problems.join("; "));
  assert.ok(preview.json.preview.changes.some((line) => /from level 1 to 4/.test(line)), preview.json.preview.changes.join("; "));
  // What a level 4 table owes a level 1 fighter can be picked on the sheet.
  assert.equal(preview.json.preview.picks.asi, 1);

  const taken = await table.take(table.player, { picks: { subclasses: { fighter: "Champion" } } });
  assert.equal(taken.status, 201, JSON.stringify(taken.json));
  const sheet = table.sheets.getSheetForUser(table.campaignId, table.player.id);
  assert.equal(sheet.name, "Thessaly");
  assert.equal(sheet.level, 4);
  assert.equal(sheet.subclass, "Champion");
  assert.ok(owedChoices(sheet).some((line) => /Ability Score Improvement/.test(line)), "the unpicked improvement is not owed");
  // The copy is the player's own, in their library; the DM's stays theirs.
  const copy = table.characters.getCharacter(sheet.libraryCharacterId);
  assert.equal(copy.userId, table.player.id);
  assert.notEqual(copy.id, table.pregen.id);
  assert.equal(copy.workshopId, "");
  const original = table.characters.getCharacter(table.pregen.id);
  assert.equal(original.userId, table.dm.id);
  assert.equal(original.level, 1);
  assert.equal(original.sheet.subclass, "");

  // The player sees it as theirs; the next player sees it taken.
  assert.equal((await table.list(table.player))[0].taken, "mine");
  const theirs = await table.list(table.second);
  assert.equal(theirs[0].taken, "other");
  assert.ok(theirs[0].takenBy, "who holds it is not said");
  const second = await table.preview(table.second);
  assert.equal(second.json.preview.ok, false);
  assert.ok(second.json.preview.problems.some((line) => /already taken/.test(line)), second.json.preview.problems.join("; "));
  const refused = await table.take(table.second);
  assert.equal(refused.status, 409);
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.second.id), null);

  // The first player gives the seat up in the lobby: the pregen is free again.
  table.world.signIn(table.player);
  const sheetRoute = await table.world.route("campaigns/[campaignId]/sheet");
  assert.equal((await table.call(sheetRoute, "DELETE", undefined, { campaignId: table.campaignId })).status, 200);
  assert.equal((await table.list(table.second))[0].taken, null);
  const now = await table.take(table.second);
  assert.equal(now.status, 201, JSON.stringify(now.json));
  table.world.close();
});

await test("a lobby edit stores the copy's sheet under a new id, and the pregen stays the player's.", async () => {
  const table = await openTable();
  await table.offer(true);
  assert.equal((await table.take(table.player)).status, 201);
  const seated = table.sheets.getSheetForUser(table.campaignId, table.player.id);
  const copy = table.characters.getCharacter(seated.libraryCharacterId);
  assert.equal(copy.pregenOriginId, table.pregen.id, "the copy does not name its pregen");

  const sheetRoute = await table.world.route("campaigns/[campaignId]/sheet");
  const edited = await table.as(table.player, sheetRoute, "PUT", { editLibraryCharacterId: copy.id, sheet: copy.sheet });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const after = table.sheets.getSheetForUser(table.campaignId, table.player.id);
  assert.notEqual(after.id, seated.id, "the edit kept the sheet id, so this test proves nothing");
  assert.equal(after.libraryCharacterId, copy.id);
  assert.equal((await table.list(table.second))[0].taken, "other", "the edit freed the pregen");
  assert.equal((await table.take(table.second)).status, 409);
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.second.id), null);
  table.world.close();
});

await test("one Thessaly per table: the copy seated again holds the pregen, and no copy or duplicate sits where another player holds it.", async () => {
  const table = await openTable();
  await table.offer(true);
  const sheetRoute = await table.world.route("campaigns/[campaignId]/sheet");
  const cloneRoute = await table.world.route("characters/[characterId]/clone");
  const seatCopy = (user, id, method = "POST") => table.as(user, sheetRoute, method, { libraryCharacterId: id });
  const giveUp = (user) => table.as(user, sheetRoute, "DELETE");

  assert.equal((await table.take(table.player)).status, 201);
  const copyId = table.sheets.getSheetForUser(table.campaignId, table.player.id).libraryCharacterId;
  // Given up in the lobby, the pregen is free; the copy seated again holds it again.
  assert.equal((await giveUp(table.player)).status, 200);
  assert.equal((await table.list(table.second))[0].taken, null);
  assert.equal((await seatCopy(table.player, copyId)).status, 201);
  assert.equal((await table.list(table.second))[0].taken, "other", "the copy seated again did not hold the pregen");
  assert.equal((await table.take(table.second)).status, 409);

  // Now the second player holds it: the first player's copy is refused, at
  // the join, the preview and a lobby switch alike, and so is a duplicate.
  assert.equal((await giveUp(table.player)).status, 200);
  assert.equal((await table.take(table.second)).status, 201);
  const refused = await seatCopy(table.player, copyId);
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.match(refused.json.error, /another player already plays at this table/);
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id), null, "the refused copy was seated");
  const preview = await table.as(table.player, table.route.preview, "POST", { libraryCharacterId: copyId });
  assert.equal(preview.json.preview.ok, false);
  assert.ok(preview.json.preview.problems.some((line) => /another player already plays/.test(line)), preview.json.preview.problems.join("; "));

  const duplicated = await table.as(table.player, cloneRoute, "POST", undefined, { characterId: copyId });
  assert.equal(duplicated.status, 201, JSON.stringify(duplicated.json));
  assert.equal(duplicated.json.character.pregenOriginId, table.pregen.id, "the duplicate forgot its pregen");
  assert.equal((await seatCopy(table.player, duplicated.json.character.id)).status, 409);

  const own = table.characters.createCharacter(table.player.id, 1, { ...LEGAL_FIGHTER, name: "Own Hero" });
  assert.equal((await seatCopy(table.player, own.id)).status, 201);
  const switched = await seatCopy(table.player, copyId, "PUT");
  assert.equal(switched.status, 409, JSON.stringify(switched.json));
  assert.equal(table.sheets.getSheetForUser(table.campaignId, table.player.id).libraryCharacterId, own.id, "the refused switch cost the player their hero");
  table.world.close();
});

await test("a player does not field two copies of one pregen at a table that allows several heroes.", async () => {
  const table = await openTable({ gameSettings: { multiCharacter: "one_active" } });
  await table.offer(true);
  assert.equal((await table.take(table.player)).status, 201);
  const copyId = table.sheets.getSheetForUser(table.campaignId, table.player.id).libraryCharacterId;
  const duplicate = table.characters.duplicateCharacter(table.player.id, copyId);
  const sheetRoute = await table.world.route("campaigns/[campaignId]/sheet");
  const refused = await table.as(table.player, sheetRoute, "POST", { libraryCharacterId: duplicate.id });
  assert.equal(refused.status, 409, JSON.stringify(refused.json));
  assert.match(refused.json.error, /You already play/);
  // The copy itself is picked again, not refused.
  assert.equal((await table.as(table.player, sheetRoute, "POST", { libraryCharacterId: copyId })).status, 201);
  table.world.close();
});

await test("the DM's own pregen is not offered to the DM through this door, and an unticked one stops seating.", async () => {
  const table = await openTable();
  await table.offer(true);
  assert.deepEqual(await table.list(table.dm), []);
  await table.offer(false);
  assert.equal((await table.take(table.player)).status, 404);
  table.world.close();
});

await test("a pregen whose owner does not run this table is not offered, ticked or not.", async () => {
  const table = await openTable();
  // A player's own workshop, linked to this table, with a ticked pregen.
  const workshop = createWorkshop(table.second.id, { title: "Someone else's" });
  recordOrigin(table.campaignId, "npcs", "npc-copy-2", workshop.id, "npc-original-2");
  const stray = table.characters.createCharacter(table.second.id, 1, { ...LEGAL_FIGHTER, name: "Stray" }, "pc", workshop.id);
  table.world.signIn(table.second);
  const ticked = await table.call(table.route.roster, "PATCH", { characterId: stray.id, offered: true }, { workshopId: workshop.id });
  assert.equal(ticked.status, 200, JSON.stringify(ticked.json));
  assert.deepEqual(await table.list(table.player), []);
  table.world.signIn(table.player);
  assert.equal((await table.call(table.route.offered, "POST", { id: stray.id }, { campaignId: table.campaignId })).status, 404);
  table.world.close();
});

finish();
