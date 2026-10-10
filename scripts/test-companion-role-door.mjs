// Issue 192: a library character filed as an ally the DM plays (role
// companion) is not a seat a player takes.
//
// Both player-character doors used to accept it: POST /sheet (join) and PUT
// /sheet (lobby switch and edit) copied it in under the human's id with no
// companion mark, so the AI DM never took its turns. Held here:
//
//   the join door refuses a companion id and names the companion path; the
//   lobby doors refuse it before the old sheet is deleted, so a refused
//   choice costs the player nothing; a player character still enters
//   through all three; the companion door (POST /companions/create) seats
//   the same library entry bot-owned and marked, for whoever runs the story
//   only; and a copy seated through the wrong door before the check is
//   handed to the DM (POST /companions/adopt) keeping its id and progress,
//   its player's seat moving to their next character and its initiative
//   slot answering to the bot, under the table's companion setting and cap.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-companion-role-door");

const settings = { multiCharacter: "all_active", companions: "full", maxCompanions: 2 };
const world = await openWorld({ gameSettings: settings });
const { createCharacter } = await import("../src/lib/db/characters.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const sheetsDb = await import("../src/lib/db/sheets.ts");
const { isCompanionUserId, getUserById } = await import("../src/lib/db/users.ts");

// Built through the schema, as /api/characters does, so the library row
// carries every default the stored door checks.
function libraryInput(name, klass = "fighter") {
  return createSheetSchema.parse({
    name,
    race: "human",
    class: klass,
    subclass: "",
    background: "soldier",
    alignment: "neutral",
    abilities: { str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
    maxHp: 12,
    ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: {
      saves: ["str", "con"],
      skills: ["athletics", "intimidation"],
      expertise: [],
      languages: ["Common"],
      tools: [],
      armor: ["light", "medium", "heavy", "shields"],
      weapons: ["simple", "martial"],
    },
  });
}

async function call(table, name, method, user, body) {
  const route = await table.route(name);
  table.signIn(user);
  const response = await route[method](
    new Request("http://test/", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ campaignId: table.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

const SHEET = "campaigns/[campaignId]/sheet";
const CREATE = "campaigns/[campaignId]/companions/create";
const ADOPT = "campaigns/[campaignId]/companions/adopt";

// The lead's hero first (the owner is the party lead), then a plain player.
const leadHero = world.addHero({ name: "Lead" });
const player = world.addUser("player");
const playerHero = world.addHero({ user: player, name: "Player Hero" });
const ally = createCharacter(player.id, 1, libraryInput("Wren"), "companion");
const spare = createCharacter(player.id, 1, libraryInput("Second Hero"), "pc");

await test("the join door refuses an ally the DM plays and names the companion path", async () => {
  const before = world.sheets().length;
  const { status, json } = await call(world, SHEET, "POST", player, { libraryCharacterId: ally.id });
  assert.equal(status, 400);
  assert.match(json.error, /ally the DM plays/);
  assert.match(json.error, /Build a companion/);
  assert.equal(world.sheets().length, before, "no sheet was made");
});

await test("a player character still enters through the join door", async () => {
  const { status, json } = await call(world, SHEET, "POST", player, { libraryCharacterId: spare.id });
  assert.equal(status, 201, json.error);
  assert.equal(json.sheet.userId, player.id);
  assert.equal(json.sheet.isCompanion, false);
  assert.equal(sheetsDb.listSheetsForUser(world.campaignId, player.id).length, 2);
});

await test("the companion door refuses a plain player and a player character", async () => {
  const asPlayer = await call(world, CREATE, "POST", player, { libraryCharacterId: ally.id });
  assert.equal(asPlayer.status, 403);
  // The lead's own library holds no entry filed as a companion under this id.
  const notTheirs = await call(world, CREATE, "POST", world.owner, { libraryCharacterId: ally.id });
  assert.equal(notTheirs.status, 404);
  const leadPc = createCharacter(world.owner.id, 1, libraryInput("Lead Spare"), "pc");
  const wrongRole = await call(world, CREATE, "POST", world.owner, { libraryCharacterId: leadPc.id });
  assert.equal(wrongRole.status, 404);
});

await test("the companion door seats the lead's library companion bot-owned and marked", async () => {
  const leadAlly = createCharacter(world.owner.id, 1, libraryInput("Tam", "rogue"), "companion");
  const { status, json } = await call(world, CREATE, "POST", world.owner, { libraryCharacterId: leadAlly.id });
  assert.equal(status, 201, json.error);
  const sheet = world.sheet(json.sheet.id);
  assert.equal(sheet.name, "Tam");
  assert.equal(sheet.isCompanion, true);
  assert.equal(sheet.companionKind, "party");
  assert.ok(isCompanionUserId(sheet.userId), `owner ${sheet.userId}`);
});

// A copy seated through the wrong door before the check: the player's id,
// no mark, the library's companion row behind it, and progress on it.
const misfiled = sheetsDb.createSheet(world.campaignId, player.id, 1, libraryInput("Wren"), ally.id);
world.patch(misfiled.id, { currentHp: 7, gold: 23 });

await test("the lead cannot hand a player's own character to the DM", async () => {
  const { status, json } = await call(world, ADOPT, "POST", world.owner, { sheetId: playerHero.id });
  assert.equal(status, 403);
  assert.match(json.error, /player's character/);
  assert.equal(world.sheet(playerHero.id).userId, player.id);
});

await test("a plain player cannot hand a character to the DM", async () => {
  const { status } = await call(world, ADOPT, "POST", player, { sheetId: misfiled.id });
  assert.equal(status, 403);
  assert.equal(world.sheet(misfiled.id).userId, player.id);
});

await test("the lead hands a misfiled copy to the DM: same sheet, same progress, a bot owner, the DM's turns", async () => {
  // The player is running the misfiled copy; mid-fight, it holds a slot.
  const { setMemberActiveCharacter } = await import("../src/lib/db/campaigns.ts");
  setMemberActiveCharacter(world.campaignId, player.id, misfiled.id);
  if (world.hasPack) {
    await world.beginFight([{ monster: "goblin", count: 1 }]);
    const slot = world.encounter().order.find((entry) => entry.kind === "pc" && entry.characterId === misfiled.id);
    assert.ok(slot, "the misfiled copy has an initiative slot");
    assert.equal(slot.userId, player.id);
  }
  const before = world.sheets().length;
  const { status, json } = await call(world, ADOPT, "POST", world.owner, { sheetId: misfiled.id });
  assert.equal(status, 200, json.error);
  const sheet = world.sheet(misfiled.id);
  assert.equal(sheet.id, misfiled.id, "the id is kept");
  assert.equal(sheet.isCompanion, true);
  assert.equal(sheet.companionKind, "party");
  assert.ok(isCompanionUserId(sheet.userId), `owner ${sheet.userId}`);
  assert.equal(sheet.currentHp, 7, "hit points as play left them");
  assert.equal(sheet.gold, 23, "gold as play left it");
  assert.equal(sheet.libraryCharacterId, ally.id, "the library link is kept");
  assert.equal(world.sheets().length, before, "no sheet was made or removed");
  assert.ok(getUserById(player.id), "the player's account is untouched");
  // The player runs the next of their own characters now.
  const running = sheetsDb.getSheetForUser(world.campaignId, player.id);
  assert.ok(running && running.id !== misfiled.id && !running.isCompanion, "the seat moved to one of their own");
  if (world.hasPack) {
    const slot = world.encounter().order.find((entry) => entry.kind === "pc" && entry.characterId === misfiled.id);
    assert.equal(slot.userId, sheet.userId, "the initiative slot answers to the bot");
    await world.invoke("end_encounter", { outcome: "victory" });
  }
});

await test("a companion already is one; the cap holds", async () => {
  const again = await call(world, ADOPT, "POST", world.owner, { sheetId: misfiled.id });
  assert.equal(again.status, 409);
  // Tam and Wren fill maxCompanions 2, so a second misfiled copy waits.
  const second = createCharacter(player.id, 1, libraryInput("Pip", "rogue"), "companion");
  const copy = sheetsDb.createSheet(world.campaignId, player.id, 1, libraryInput("Pip", "rogue"), second.id);
  const full = await call(world, ADOPT, "POST", world.owner, { sheetId: copy.id });
  assert.equal(full.status, 409);
  assert.match(full.json.error, /full number of companions/);
  assert.equal(world.sheet(copy.id).userId, player.id, "unchanged when refused");
});

await test("the snapshot marks a misfiled copy by its library role", async () => {
  const route = await world.route("campaigns/[campaignId]");
  world.signIn(world.owner);
  const response = await route.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  assert.equal(response.status, 200);
  const { sheets } = await response.json();
  const byId = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  assert.equal(byId.get(playerHero.id).libraryRole, undefined, "a sheet with no library row says nothing");
  assert.equal(byId.get(misfiled.id).libraryRole, "companion");
  const pip = sheets.find((sheet) => sheet.name === "Pip" && !sheet.isCompanion);
  assert.equal(pip.libraryRole, "companion", "the copy still waiting shows the repair");
});

// ---- the lobby doors ----

const lobby = await openWorld({ status: "lobby", gameSettings: settings });
lobby.addHero({ name: "Lobby Lead" });
const guest = lobby.addUser("guest");
const guestHero = lobby.addHero({ user: guest, name: "Guest Hero" });
const guestAlly = createCharacter(guest.id, 1, libraryInput("Lobby Wren"), "companion");
const guestSpare = createCharacter(guest.id, 1, libraryInput("Lobby Spare"), "pc");

await test("a lobby switch to an ally the DM plays is refused with the old sheet intact", async () => {
  const { status, json } = await call(lobby, SHEET, "PUT", guest, { libraryCharacterId: guestAlly.id });
  assert.equal(status, 400);
  assert.match(json.error, /ally the DM plays/);
  const kept = sheetsDb.getSheetForUser(lobby.campaignId, guest.id);
  assert.equal(kept?.id, guestHero.id, "the player still has the character they had");
});

await test("a lobby edit under an ally's library id is refused with the old sheet intact", async () => {
  const { status, json } = await call(lobby, SHEET, "PUT", guest, {
    editLibraryCharacterId: guestAlly.id,
    sheet: libraryInput("Lobby Wren"),
  });
  assert.equal(status, 400);
  assert.match(json.error, /ally the DM plays/);
  assert.equal(sheetsDb.getSheetForUser(lobby.campaignId, guest.id)?.id, guestHero.id);
});

await test("a lobby switch to a player character still replaces the sheet", async () => {
  const { status, json } = await call(lobby, SHEET, "PUT", guest, { libraryCharacterId: guestSpare.id });
  assert.equal(status, 200, json.error);
  const now = sheetsDb.getSheetForUser(lobby.campaignId, guest.id);
  assert.notEqual(now.id, guestHero.id);
  assert.equal(now.name, "Lobby Spare");
});

finish();
