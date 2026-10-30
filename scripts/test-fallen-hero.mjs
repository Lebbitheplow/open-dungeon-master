// A player whose hero dies at a table that plays one character each. Every
// door that seats a hero refused them ("You already have a character in
// this campaign") because the dead sheet still counted, and changing a
// character is lobby-only, so once the adventure had started they could
// only watch. Now a player whose heroes have all fallen brings in a new one
// through the same doors a mid-game joiner uses, at the level the fallen
// hero reached; the fallen sheet stays on the record, and the GM is told
// whose place the newcomer takes (src/lib/characters/hero-door.ts).
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, PORTRAIT } from "./lib/enforce-creation.mjs";

const { test, finish } = suite("test-fallen-hero");
const { fallenHero, heroDoorOpen, heroJoinLevel } = await import("../src/lib/characters/fallen-logic.ts");
const sheets = await import("../src/lib/db/sheets.ts");
const messages = await import("../src/lib/db/messages.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const DEAD = { successes: 0, failures: 3, stable: false, dead: true };
const hero = (name, level, extra = {}) => ({ name, level, ...extra });

await test("the rule: only a player whose every hero has fallen gets past a one-character door.", () => {
  assert.equal(heroDoorOpen([], "off"), true, "a player with no sheet");
  assert.equal(heroDoorOpen([hero("Mira", 3)], "off"), false, "a living hero");
  assert.equal(heroDoorOpen([hero("Mira", 3, { deathSaves: DEAD })], "off"), true, "a fallen hero");
  assert.equal(heroDoorOpen([hero("Mira", 3, { deathSaves: DEAD }), hero("Tam", 2)], "off"), false, "one fallen, one alive");
  // A companion the player commands is the GM's to run: it neither keeps
  // the door shut for a fallen hero nor opens it for a player who has none.
  assert.equal(heroDoorOpen([hero("Mira", 3, { deathSaves: DEAD }), hero("Wolf", 2, { isCompanion: true })], "off"), true);
  assert.equal(heroDoorOpen([hero("Wolf", 2, { isCompanion: true })], "off"), false, "only a companion, as before");
  assert.equal(heroDoorOpen([hero("Mira", 3)], "one_active"), true, "a table of several characters each, as before");
  assert.equal(heroDoorOpen([hero("Mira", 3, { deathSaves: { ...DEAD, dead: false, stable: true } })], "off"), false, "stable is not fallen");
});

await test("the rule: a replacement joins at the level the highest fallen hero reached, never below the start.", () => {
  assert.equal(heroJoinLevel([], 3), 3);
  assert.equal(heroJoinLevel([hero("Mira", 7)], 3), 3, "a living hero changes nothing");
  assert.equal(heroJoinLevel([hero("Mira", 7, { deathSaves: DEAD }), hero("Tam", 5, { deathSaves: DEAD })], 3), 7);
  assert.equal(heroJoinLevel([hero("Mira", 2, { deathSaves: DEAD })], 4), 4, "the table's start is the floor");
  assert.equal(fallenHero([hero("Mira", 7, { deathSaves: DEAD }), hero("Tam", 5, { deathSaves: DEAD })])?.name, "Mira");
  assert.equal(fallenHero([hero("Wolf", 9, { isCompanion: true, deathSaves: DEAD })]), null, "a companion is never the player's fallen hero");
});

// A table in play that fields one character each, the player's level 5
// hero already dead on it.
async function fallenTable({ level = 5, startingLevel = 1 } = {}) {
  const world = await openWorld({ campaign: { startingLevel }, gameSettings: { multiCharacter: "off" } });
  const player = world.addUser("player");
  const fallen = world.addHero({ user: player, name: "Mira Vale", level });
  world.patch(fallen.id, { deathSaves: DEAD, currentHp: 0 });
  world.signIn(player);
  async function call(name, method, body) {
    const mod = await world.route(name);
    const request = new Request("http://test/", {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await mod[method](request, { params: Promise.resolve({ campaignId: world.campaignId }) });
    return { status: response.status, json: await response.json() };
  }
  const own = () => sheets.listSheetsForUser(world.campaignId, player.id);
  const note = () =>
    messages
      .listRecentMessages(world.campaignId, 20)
      .find((message) => message.authorType === "system" && message.content.startsWith("[New adventurer] "))?.content ?? "";
  return { world, player, fallen, call, own, note };
}

await test("GET /sheet tells the builder the level a fallen hero's replacement joins at.", async () => {
  const table = await fallenTable({ level: 5 });
  const answer = await table.call("campaigns/[campaignId]/sheet", "GET");
  assert.equal(answer.status, 200);
  assert.equal(answer.json.joinLevel, 5);
  assert.deepEqual(answer.json.fallen, { name: "Mira Vale", level: 5 });
  table.world.close();
});

await test("a ready-made hero takes the fallen hero's place at level 5, and the GM is told whose place it is.", async () => {
  const table = await fallenTable({ level: 5 });
  const seated = await table.call("campaigns/[campaignId]/sheet/pregen", "POST", { id: "kara" });
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  assert.equal(seated.json.sheet.level, 5);
  // The fallen sheet stays on the record; the new one is the one in play.
  assert.deepEqual(table.own().map((sheet) => sheet.name).sort(), ["Kara", "Mira Vale"].sort());
  assert.equal(sheets.getSheetForUser(table.world.campaignId, table.player.id)?.id, seated.json.sheet.id);
  assert.match(table.note(), /take the place of Mira Vale, who fell/);
  table.world.close();
});

await test("a hero from the library is adapted to the fallen hero's level.", async () => {
  const table = await fallenTable({ level: 4 });
  const made = await table.world.route("characters").then(async (mod) => {
    const response = await mod.POST(
      new Request("http://test/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: 1, sheet: { ...LEGAL_FIGHTER, name: "Oren Ash", portrait: PORTRAIT } }),
      }),
    );
    return { status: response.status, json: await response.json() };
  });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const seated = await table.call("campaigns/[campaignId]/sheet", "POST", { libraryCharacterId: made.json.character.id });
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  assert.equal(seated.json.sheet.level, 4);
  table.world.close();
});

await test("a hero the builder made seats for a player whose hero fell.", async () => {
  const table = await fallenTable({ level: 1 });
  const seated = await table.call("campaigns/[campaignId]/sheet", "POST", { ...LEGAL_FIGHTER, name: "Brann Holt", portrait: PORTRAIT });
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  assert.equal(sheets.getSheetForUser(table.world.campaignId, table.player.id)?.name, "Brann Holt");
  table.world.close();
});

await test("the confirm sheet offers the seat to a fallen hero's player, at the level they will play.", async () => {
  const table = await fallenTable({ level: 5 });
  const preview = await table.call("campaigns/[campaignId]/sheet/preview", "POST", { pregenId: "kara" });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.ok(!preview.json.preview.problems.includes("You already have a character in this campaign."), preview.json.preview.problems.join("; "));
  table.world.close();
});

await test("picking the fallen hero again from the library is refused, by the door and on the confirm sheet.", async () => {
  const table = await fallenTable({ level: 3 });
  const libraryId = table.fallen.libraryCharacterId
    ?? getDatabase().prepare("SELECT library_character_id AS id FROM character_sheets WHERE id = ?").get(table.fallen.id)?.id;
  if (!libraryId) {
    // addHero seats a sheet with no library row: link one so the pick exists.
    const { createCharacter } = await import("../src/lib/db/characters.ts");
    const character = createCharacter(table.player.id, 3, sheets.getSheetById(table.fallen.id));
    sheets.linkSheetToLibrary(table.fallen.id, character.id);
  }
  const linked = sheets.getSheetById(table.fallen.id).libraryCharacterId;
  const again = await table.call("campaigns/[campaignId]/sheet", "POST", { libraryCharacterId: linked });
  assert.equal(again.status, 409);
  assert.match(again.json.error, /Mira Vale fell at this table/);
  const preview = await table.call("campaigns/[campaignId]/sheet/preview", "POST", { libraryCharacterId: linked });
  assert.ok(preview.json.preview.problems.some((line) => /Mira Vale fell at this table/.test(line)), JSON.stringify(preview.json.preview.problems));
  table.world.close();
});

await test("a player whose hero lives is still refused a second one at a one-character table.", async () => {
  const table = await fallenTable({ level: 2 });
  table.world.patch(table.fallen.id, { deathSaves: null, currentHp: 10 });
  const refused = await table.call("campaigns/[campaignId]/sheet/pregen", "POST", { id: "kara" });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, "You already have a character in this campaign.");
  const built = await table.call("campaigns/[campaignId]/sheet", "POST", { ...LEGAL_FIGHTER, name: "Brann Holt", portrait: PORTRAIT });
  assert.equal(built.status, 409);
  const answer = await table.call("campaigns/[campaignId]/sheet", "GET");
  assert.equal(answer.json.fallen, null);
  assert.equal(answer.json.joinLevel, 1);
  table.world.close();
});

await test("a fallen hero raised after their replacement joined: the player picks which of the two plays on.", async () => {
  const table = await fallenTable({ level: 3 });
  const seated = await table.call("campaigns/[campaignId]/sheet/pregen", "POST", { id: "kara" });
  assert.equal(seated.status, 201, JSON.stringify(seated.json));
  // Before the raise: one living hero, nothing to switch to.
  const early = await table.call("campaigns/[campaignId]/sheet/switch", "POST", { characterId: table.fallen.id });
  assert.equal(early.status, 400);
  table.world.patch(table.fallen.id, { deathSaves: null, currentHp: 1 });
  const back = await table.call("campaigns/[campaignId]/sheet/switch", "POST", { characterId: table.fallen.id });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.equal(sheets.getSheetForUser(table.world.campaignId, table.player.id)?.id, table.fallen.id);
  table.world.close();
});

await test("at a table that fields one character at a time, a replacement takes a fallen hero's seat mid-fight.", async () => {
  const world = await openWorld({ campaign: { startingLevel: 1 }, gameSettings: { multiCharacter: "one_active" } });
  const player = world.addUser("player");
  const fallen = world.addHero({ user: player, name: "Mira Vale", level: 2 });
  world.addHero({ name: "Oren Dusk", level: 2 });
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  world.patch(fallen.id, { deathSaves: DEAD, currentHp: 0 });
  world.signIn(player);
  const mod = await world.route("campaigns/[campaignId]/sheet/pregen");
  const response = await mod.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "kara" }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(sheets.getSheetForUser(world.campaignId, player.id)?.id, body.sheet.id, "the replacement was benched behind the dead");
  world.close();
});

await test("a finished campaign seats no replacement.", async () => {
  const table = await fallenTable({ level: 2 });
  const { setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
  setCampaignStatus(table.world.campaignId, "ended");
  const refused = await table.call("campaigns/[campaignId]/sheet/pregen", "POST", { id: "kara" });
  assert.equal(refused.status, 409);
  table.world.close();
});

await test("the host says it lets a fallen hero's player back in, so the apps show the banner only where it works.", async () => {
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  const { hostOffers } = await import("../src/lib/use-capabilities.ts");
  assert.equal(SERVER_FEATURES.fallenHeroes, true);
  assert.equal(hostOffers({ features: {} }, "fallenHeroes"), false, "an older host hides it");
});

finish();
