// A player fielding several characters: which one the dice, the hit dice,
// the library save, the between-adventures lines, a ready-made hero and an
// action reach (src/lib/character-seat.ts), and that the floor keeps its own
// words when the fight refuses a player (PR #191 follow-ups).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const world = await openWorld({ gameSettings: { multiCharacter: "all_active", mapsEnabled: true } });
const campaigns = await import("../src/lib/db/campaigns.ts");
const sheets = await import("../src/lib/db/sheets.ts");
const { listRecentMessages } = await import("../src/lib/db/messages.ts");
const { actingSheetFor, ownSheetFor, seatAddedSheet, currentPcId } = await import("../src/lib/character-seat.ts");

const a1 = world.addHero({ name: "A1", class: "fighter" });
const a2 = world.addHero({ name: "A2", class: "fighter", user: world.owner });
const b1 = world.addHero({ name: "B1", class: "fighter" });
const params = { params: Promise.resolve({ campaignId: world.campaignId }) };
const post = (body) => new Request("http://localhost/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (query = "") => new Request(`http://localhost/api/test${query}`);
const json = (response) => response.clone().json();
world.signIn(world.owner);

// Outside a fight the selected character acts; a named sibling is reached;
// a stranger's sheet is refused rather than answered on the caller's own.
campaigns.setMemberActiveCharacter(world.campaignId, a1.userId, a2.id);
assert.equal(actingSheetFor(world.campaignId, a1.userId).id, a2.id);
assert.equal(ownSheetFor(world.campaignId, a1.userId, a1.id).id, a1.id);
assert.equal(ownSheetFor(world.campaignId, a1.userId, b1.id), null);
assert.equal(actingSheetFor(world.campaignId, a1.userId, b1.id), null);

const rolls = await world.route("campaigns/[campaignId]/rolls");
let rolled = await rolls.POST(post({ kind: "ability_check", ability: "str" }), params);
assert.equal(rolled.status, 201, JSON.stringify(await json(rolled)));
assert.equal((await json(rolled)).roll.characterId, a2.id, "unnamed, the selected character rolls");
rolled = await rolls.POST(post({ kind: "ability_check", ability: "str", characterId: a1.id }), params);
assert.equal((await json(rolled)).roll.characterId, a1.id, "the sheet on screen rolls when named");
assert.equal((await rolls.POST(post({ kind: "ability_check", ability: "str", characterId: b1.id }), params)).status, 404);
console.log("ok: the dice belong to the named own sheet, else the selected one; a stranger's sheet is refused");

const hitDice = await world.route("campaigns/[campaignId]/sheet/hit-dice");
assert.equal((await hitDice.POST(post({ dice: 1, characterId: b1.id }), params)).status, 404);
const notResting = await hitDice.POST(post({ dice: 1, characterId: a1.id }), params);
assert.equal(notResting.status, 409);
assert.match((await json(notResting)).error, /A1 is not resting now/, "the named sibling's hit dice, not the selected character's");
assert.deepEqual(await json(await hitDice.GET(get(`?characterId=${a1.id}`), params)), { open: false });
assert.deepEqual(await json(await hitDice.GET(get(`?characterId=${b1.id}`), params)), { open: false });
console.log("ok: hit dice are spent from the sheet on screen");

// Save to library names the card's sheet: a linked third character beside
// the selected, unlinked A2.
const characters = await import("../src/lib/db/characters.ts");
const { heroInput } = await import("./lib/enforce-world.mjs");
const library = characters.createCharacter(a1.userId, 1, heroInput({ name: "Linked" }));
const linked = characters.instantiateIntoCampaign(library.id, world.campaignId, a1.userId, 1);
assert.ok(!("error" in linked), JSON.stringify(linked));
world.patch(linked.id, { notes: "Linked progress" });
const sync = await world.route("campaigns/[campaignId]/sheet/sync");
const saved = await sync.POST(post({ characterId: linked.id }), params);
assert.equal(saved.status, 200, JSON.stringify(await json(saved)));
assert.equal((await json(saved)).character.sheet.notes, "Linked progress", "the card's own sheet is saved, not the selected one");
assert.equal((await sync.POST(post({ characterId: b1.id }), params)).status, 404);
const unnamed = await sync.POST(new Request("http://localhost/api/test", { method: "POST" }), params);
assert.equal(unnamed.status, 400, "an older client with no name is answered on the selected sheet, which has no library link");
console.log("ok: Save to library saves the card's own sheet");

const between = await world.route("campaigns/[campaignId]/sheet/between");
assert.equal((await between.GET(get(`?characterId=${a1.id}`), params)).status, 200);
assert.deepEqual(await json(await between.GET(get(`?characterId=${b1.id}`), params)), { lines: [] });

// A ready-made hero takes a seat beside the characters already here, and
// takes the player's seat as a built character would.
const pregen = await world.route("campaigns/[campaignId]/sheet/pregen");
const seated = await pregen.POST(post({ id: "brakk" }), params);
assert.equal(seated.status, 201, JSON.stringify(await json(seated)));
const brakk = (await json(seated)).sheet;
assert.equal(brakk.userId, a1.userId);
assert.equal(sheets.getSheetForUser(world.campaignId, a1.userId).id, brakk.id, "the hero just added is the one in play");
assert.equal(sheets.listSheetsForUser(world.campaignId, a1.userId).length, 4);
campaigns.setMemberActiveCharacter(world.campaignId, a1.userId, a2.id);
console.log("ok: a pregen joins a several-characters table beside the first and takes the seat");

// A fight, judged by a human so no model is called. A2 stays selected while
// A1's turn comes up: the dice and an unnamed action are A1's.
const dm = world.addUser("dm");
campaigns.setCampaignStatus(world.campaignId, "lobby");
assert.ok(!("error" in campaigns.joinByInviteCode(dm.id, world.campaign().inviteCode)));
campaigns.setCampaignStatus(world.campaignId, "active");
campaigns.setDmMode(world.campaignId, "human", dm.id);
world.say("dm", "Goblins!");
await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [a1.id]: 20, [a2.id]: 15, [b1.id]: 10, [brakk.id]: 5, [linked.id]: 3 } });
const fight = world.encounter();
assert.equal(currentPcId(fight), a1.id);
assert.equal(actingSheetFor(world.campaignId, a1.userId).id, a1.id, "on A1's turn the acting character is A1 though A2 is selected");
rolled = await rolls.POST(post({ kind: "ability_check", ability: "str" }), params);
assert.equal((await json(rolled)).roll.characterId, a1.id);

const actions = await world.route("campaigns/[campaignId]/actions");
campaigns.setFloor(world.campaignId, { mode: "initiative", encounterId: fight.id, userIds: [a1.userId], currentName: "A1", round: 1 });
let acted = await actions.POST(post({ content: "I swing.", kind: "do" }), params);
assert.equal(acted.status, 202, JSON.stringify(await json(acted)));
assert.equal(listRecentMessages(world.campaignId, 1)[0].characterId, a1.id, "an unnamed action on A1's turn is A1's");
acted = await actions.POST(post({ content: "I swing too.", kind: "do", characterId: a2.id }), params);
assert.equal(acted.status, 409);
assert.match((await json(acted)).error, /Wait for that character's turn/);
console.log("ok: in a fight the acting character follows the turn, and the wrong sibling is told so");

// The enemies' turns keep the hold's own words, and a floor the DM opened
// mid-fight lets the player act as whoever they have selected.
campaigns.setFloor(world.campaignId, { mode: "hold", next: { mode: "initiative", encounterId: fight.id, userIds: [b1.userId], currentName: "B1", round: 1 } });
acted = await actions.POST(post({ content: "I swing.", kind: "do" }), params);
assert.equal(acted.status, 409);
assert.match((await json(acted)).error, /enemies are taking their turns/);
campaigns.setFloor(world.campaignId, { mode: "open" });
acted = await actions.POST(post({ content: "Hold the line!", kind: "say" }), params);
assert.equal(acted.status, 202, JSON.stringify(await json(acted)));
assert.equal(listRecentMessages(world.campaignId, 1)[0].characterId, a2.id);
console.log("ok: the floor's refusals keep their words; an opened floor acts as the selected character");

// One character at a time while a fight runs: a character added now waits
// on the bench; the fielded one keeps the seat.
campaigns.updateGameSettings(world.campaignId, { multiCharacter: "one_active" });
assert.equal(seatAddedSheet(world.campaign(), a1.userId, a1.id), false);
assert.equal(sheets.getSheetForUser(world.campaignId, a1.userId).id, a2.id);
assert.equal(seatAddedSheet(world.campaign(), a1.userId, a2.id), true);
campaigns.updateGameSettings(world.campaignId, { multiCharacter: "all_active" });
assert.equal(seatAddedSheet(world.campaign(), a1.userId, a1.id), true, "every character fields, so the new one takes the seat");
assert.equal(sheets.getSheetForUser(world.campaignId, a1.userId).id, a1.id);
console.log("ok: a character added mid-fight at a one-active table waits on the bench");
world.close();
