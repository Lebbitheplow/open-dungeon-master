import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const characters = await import("../src/lib/db/characters.ts");
const sheets = await import("../src/lib/db/sheets.ts");
const world = await openWorld({ gameSettings: { multiCharacter: "all_active" } });
const first = world.addHero({ name: "First", class: "fighter", level: 1 });
const input = { ...first, name: "Second", portrait: { id: "existing", name: "kept", type: "image/webp", url: "/uploads/existing.webp" } };
const library = characters.createCharacter(first.userId, 1, input);
const original = characters.instantiateIntoCampaign(library.id, world.campaignId, first.userId, 1);
assert.ok(!("error" in original), JSON.stringify(original));
world.patch(original.id, { currentHp: 1, notes: "progress must survive a retry" });
const again = characters.instantiateIntoCampaign(library.id, world.campaignId, first.userId, 1);
assert.equal(again.id, original.id);
assert.equal(again.currentHp, 1);
assert.equal(again.notes, "progress must survive a retry");
assert.equal(sheets.listSheetsForUser(world.campaignId, first.userId).length, 2);
console.log("ok: repeat joins keep the original sheet and its progress, without duplicating it");

const other = world.addUser("Other");
const denied = characters.instantiateIntoCampaign(library.id, world.campaignId, other.id, 1);
assert.ok("error" in denied);
console.log("ok: repeat detection does not bypass library ownership");

world.signIn({ id: first.userId });
const route = await world.route("campaigns/[campaignId]/sheet");
const response = await route.POST(new Request("http://localhost/api/sheet", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ libraryCharacterId: library.id }),
}), { params: Promise.resolve({ campaignId: world.campaignId }) });
assert.equal(response.status, 201);
assert.equal(sheets.getSheetForUser(world.campaignId, first.userId).id, original.id);
assert.equal(sheets.listSheetsForUser(world.campaignId, first.userId).length, 2);
console.log("ok: the join route selects the requested existing character");
const { updateGameSettings } = await import("../src/lib/db/campaigns.ts");
updateGameSettings(world.campaignId, { multiCharacter: "one_active" });
world.say("dm", "A goblin blocks the path.");
await world.beginFight([{ monster: "goblin", count: 1 }]);
const joinRequest = body => new Request("http://localhost/api/sheet", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const params = { params: Promise.resolve({ campaignId: world.campaignId }) };
const anotherLibrary = characters.createCharacter(first.userId, 1, { ...input, name: "Benched" });
const benched = await route.POST(joinRequest({ libraryCharacterId: anotherLibrary.id }), params);
assert.equal(benched.status, 201, JSON.stringify(await benched.clone().json()));
assert.equal(sheets.getSheetForUser(world.campaignId, first.userId).id, original.id, "the fielded character keeps the seat while the fight runs");
assert.equal(sheets.listSheetsForUser(world.campaignId, first.userId).length, 3);
assert.equal((await route.POST(joinRequest({ libraryCharacterId: library.id }), params)).status, 201);
assert.equal(sheets.getSheetForUser(world.campaignId, first.userId).id, original.id);
console.log("ok: at a one-active table a character added mid-fight waits on the bench; the fielded one can rejoin");
world.close();
