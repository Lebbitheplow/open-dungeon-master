// Campaign creation and configuration, through the routes a table's clients
// call. A campaign is the frame every rule sits in, so the frame is checked
// first: a starting level is 1 to 20 and a party 1 to 8; a table nobody
// configured runs the plain SRD 5.1 rules (every variant off, standard
// rests, the server's dice); a setting the schema does not know is never
// stored; only whoever runs the story changes the rules of the table; a full
// table, a started one and an ended one each refuse a newcomer; a player
// fields one character unless the table allows more; and a library character
// enters at the TABLE's level, giving back the ability score improvements,
// hit dice, slots and spells the lower level has not earned.
//
// ODM's own rules pinned here: game settings may change mid campaign and mid
// fight (settings/route.ts says so); whoever holds story authority edits them
// (the lead at an AI table, the DM once a person runs it); a DM seat holds no
// party slot (db/campaigns.ts countPartySlots).
import assert from "node:assert/strict";
import { call, posted, signOut } from "./lib/enforce-campaign.mjs";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-campaign-config");
const world = await openWorld({ status: "lobby" });
const campaigns = await import("../src/lib/db/campaigns.ts");
const { createCharacter } = await import("../src/lib/db/characters.ts");
const { getSheetForUser, listSheetsForUser } = await import("../src/lib/db/sheets.ts");

const campaignsRoute = await world.route("campaigns");
const campaignRoute = await world.route("campaigns/[campaignId]");
const settingsRoute = await world.route("campaigns/[campaignId]/settings");
const joinRoute = await world.route("campaigns/join");
const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
const switchRoute = await world.route("campaigns/[campaignId]/sheet/switch");

// A fresh table of the owner's, made through the route.
async function newTable(body = {}) {
  world.signIn(world.owner);
  const created = await call(campaignsRoute, "POST", { title: "Table", ...body });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.campaign;
}

async function seat(user, campaign) {
  world.signIn(user);
  return call(joinRoute, "POST", { inviteCode: campaign.inviteCode });
}

// ---- creation ----

await test("a campaign outside the bounds is refused", async () => {
  world.signIn(world.owner);
  const refused = [
    { startingLevel: 0 },
    { startingLevel: 21 },
    { startingLevel: 1.5 },
    { startingLevel: "5" },
    { maxPlayers: 0 },
    { maxPlayers: 9 },
    { difficulty: "impossible" },
    { title: "" },
    { gameSettings: { variantRules: { flanking: "yes" } } },
    { gameSettings: { variantRules: { restVariant: "epic" } } },
    { gameSettings: { dicePolicy: "loaded" } },
    { gameSettings: { multiCharacter: "many" } },
    { gameSettings: { gm: { strictness: "cruel" } } },
    { gameSettings: { maxCompanions: 5 } },
  ];
  for (const body of refused) {
    const response = await call(campaignsRoute, "POST", { title: "Table", ...body });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

await test("the bounds themselves are accepted", async () => {
  for (const body of [
    { startingLevel: 1, maxPlayers: 1, difficulty: "easy" },
    { startingLevel: 20, maxPlayers: 8, difficulty: "deadly" },
  ]) {
    const campaign = await newTable(body);
    assert.equal(campaign.startingLevel, body.startingLevel);
    assert.equal(campaign.maxPlayers, body.maxPlayers);
    assert.equal(campaign.difficulty, body.difficulty);
    assert.equal(campaign.status, "lobby");
  }
});

await test("a table nobody configured runs the plain SRD rules", async () => {
  const campaign = await newTable();
  assert.equal(campaign.startingLevel, 1);
  assert.equal(campaign.difficulty, "normal");
  const stored = campaigns.getCampaignById(campaign.id).gameSettings;
  assert.deepEqual(stored.variantRules, {
    flanking: false,
    criticalFumbles: false,
    encumbrance: false,
    lingeringInjuries: false,
    powerfulCritical: false,
    criticalDamageMods: false,
    ammunition: false,
    // Food and water: a variant, off by default (the party is supplied).
    supplies: false,
    restVariant: "standard",
  });
  assert.equal(stored.dicePolicy, "digital_only");
  assert.equal(stored.multiCharacter, "off");
  assert.equal(stored.midGameJoinOpen, false);
  assert.equal(stored.gm.strictness, "standard");
  assert.equal(stored.multiclassingEnabled, true);
  assert.equal(stored.inventoryApprovals, false);
  assert.equal(stored.dmMode, "ai");
});

await test("a setting the schema does not know is never stored", async () => {
  const campaign = await newTable({
    bogusTop: 3,
    gameSettings: { bogusKey: 1, variantRules: { bogus: true, flanking: true } },
  });
  const row = JSON.stringify(campaigns.getCampaignById(campaign.id));
  assert.ok(!row.includes("bogus"), row);
  assert.equal(campaigns.getCampaignById(campaign.id).gameSettings.variantRules.flanking, true);

  const patched = await call(
    settingsRoute,
    "PATCH",
    { unknownRule: true, variantRules: { homebrewCrits: true, ammunition: true } },
    { campaignId: campaign.id },
  );
  assert.equal(patched.status, 200);
  const after = campaigns.getCampaignById(campaign.id).gameSettings;
  assert.ok(!JSON.stringify(after).includes("unknownRule"));
  assert.ok(!JSON.stringify(after).includes("homebrewCrits"));
  assert.deepEqual(after.variantRules, { ...campaign.gameSettings.variantRules, ammunition: true });
});

await test("a setting outside its values is refused and nothing changes", async () => {
  const campaign = await newTable({ gameSettings: { variantRules: { restVariant: "gritty" } } });
  for (const body of [
    { variantRules: { restVariant: "nope" } },
    { variantRules: { encumbrance: 1 } },
    { maxCompanions: 99 },
    { dicePolicy: "weighted" },
    { targetParty: { level: 21 } },
  ]) {
    const response = await call(settingsRoute, "PATCH", body, { campaignId: campaign.id });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(campaigns.getCampaignById(campaign.id).gameSettings, campaign.gameSettings);
});

// ---- who may change the rules of the table ----

await test("at an AI table the lead changes settings; a player, a stranger and nobody cannot", async () => {
  const campaign = await newTable();
  const player = world.addUser("player");
  const stranger = world.addUser("stranger");
  assert.equal((await seat(player, campaign)).status, 200);
  const params = { campaignId: campaign.id };
  const body = { variantRules: { powerfulCritical: true } };

  world.signIn(player);
  assert.equal((await call(settingsRoute, "PATCH", body, params)).status, 403);
  assert.equal((await call(campaignRoute, "PATCH", { startingLevel: 20 }, params)).status, 403);
  world.signIn(stranger);
  assert.equal((await call(settingsRoute, "PATCH", body, params)).status, 404);
  signOut();
  assert.equal((await call(settingsRoute, "PATCH", body, params)).status, 401);
  assert.equal((await call(campaignsRoute, "POST", { title: "Table" })).status, 401);
  const untouched = campaigns.getCampaignById(campaign.id);
  assert.equal(untouched.gameSettings.variantRules.powerfulCritical, false);
  assert.equal(untouched.startingLevel, 1);

  world.signIn(world.owner);
  assert.equal((await call(settingsRoute, "PATCH", body, params)).status, 200);
  assert.equal(campaigns.getCampaignById(campaign.id).gameSettings.variantRules.powerfulCritical, true);
});

await test("once a person runs the table the settings are the DM's, not the lead's", async () => {
  // ODM's rule (campaign-api.ts requireStoryAuthority): the lead steers an AI
  // and is a player again the moment a person holds the DM seat.
  const campaign = await newTable({ gameSettings: { dmMode: "human" } });
  assert.equal(campaigns.getCampaignById(campaign.id).dmUserId, world.owner.id);
  const lead = world.addUser("lead");
  const helper = world.addUser("helper");
  await seat(lead, campaign);
  await seat(helper, campaign);
  assert.ok(campaigns.setPartyLead(campaign.id, lead.id));
  assert.ok(campaigns.setAssistantDm(campaign.id, helper.id));
  const params = { campaignId: campaign.id };

  world.signIn(lead);
  const refused = await call(settingsRoute, "PATCH", { variantRules: { flanking: true } }, params);
  assert.equal(refused.status, 403);
  world.signIn(helper);
  const helped = await call(settingsRoute, "PATCH", { variantRules: { encumbrance: true } }, params);
  assert.equal(helped.status, 200);
  world.signIn(world.owner);
  const ruled = await call(settingsRoute, "PATCH", { variantRules: { ammunition: true } }, params);
  assert.equal(ruled.status, 200);
  assert.deepEqual(
    campaigns.getCampaignById(campaign.id).gameSettings.variantRules,
    { ...campaign.gameSettings.variantRules, encumbrance: true, ammunition: true },
  );
});

await test("campaign info keeps its bounds when edited, and an ended table is closed to edits", async () => {
  const campaign = await newTable();
  const params = { campaignId: campaign.id };
  for (const body of [{ startingLevel: 0 }, { startingLevel: 21 }, { maxPlayers: 9 }, { difficulty: "x" }]) {
    assert.equal((await call(campaignRoute, "PATCH", body, params)).status, 400, JSON.stringify(body));
  }
  assert.equal((await call(campaignRoute, "PATCH", { startingLevel: 5 }, params)).status, 200);
  assert.equal(campaigns.getCampaignById(campaign.id).startingLevel, 5);
  campaigns.setCampaignStatus(campaign.id, "ended");
  assert.equal((await call(campaignRoute, "PATCH", { startingLevel: 9 }, params)).status, 400);
  assert.equal(campaigns.getCampaignById(campaign.id).startingLevel, 5);
});

await test("a rule changed mid fight is the rule the next roll is made under", async () => {
  // ODM's rule: settings/route.ts allows the edit "in lobby and mid-campaign".
  const table = await openWorld({ gameSettings: { variantRules: { encumbrance: false } } });
  const hero = table.addHero({
    abilities: { str: 10 },
    equipment: [{ name: "Anvil", qty: 1, weight: 120 }],
  });
  await table.beginFight([{ monster: "goblin", count: 1 }]);
  table.signIn(table.owner);
  const changed = await call(
    settingsRoute,
    "PATCH",
    { variantRules: { encumbrance: true } },
    { campaignId: table.campaignId },
  );
  assert.equal(changed.status, 200);
  assert.ok(table.encounter(), "the fight is still running");
  table.dice(15, 4);
  const rolled = await table.invoke("request_roll", {
    characterId: hero.id,
    kind: "ability_check",
    ability: "str",
    reason: "lift",
  });
  assert.equal(rolled.ok, true, rolled.error);
  // 120 lb on STR 10 is over ten times Strength: disadvantage, the lower die.
  assert.equal(rolled.result.total, 4);
  assert.equal(table.clearDice(), 0);
});

// ---- the door ----

await test("a full table, a started one and an ended one each refuse a newcomer", async () => {
  const campaign = await newTable({ maxPlayers: 2 });
  const second = world.addUser("second");
  const third = world.addUser("third");
  assert.equal((await seat(second, campaign)).status, 200);
  const full = await seat(third, campaign);
  assert.equal(full.status, 400);
  assert.equal(campaigns.isCampaignMember(campaign.id, third.id), false);

  world.signIn(world.owner);
  const shrunk = await call(campaignRoute, "PATCH", { maxPlayers: 1 }, { campaignId: campaign.id });
  assert.equal(shrunk.status, 400);
  assert.equal(campaigns.getCampaignById(campaign.id).maxPlayers, 2);
  assert.equal((await call(campaignRoute, "PATCH", { maxPlayers: 4 }, { campaignId: campaign.id })).status, 200);

  campaigns.setCampaignStatus(campaign.id, "active");
  assert.equal((await seat(third, campaign)).status, 400);
  assert.equal(campaigns.isCampaignMember(campaign.id, third.id), false);

  world.signIn(world.owner);
  await call(settingsRoute, "PATCH", { midGameJoinOpen: true }, { campaignId: campaign.id });
  assert.equal((await seat(third, campaign)).status, 200);
  assert.equal(campaigns.isCampaignMember(campaign.id, third.id), true);

  campaigns.setCampaignStatus(campaign.id, "ended");
  const late = world.addUser("late");
  assert.equal((await seat(late, campaign)).status, 400);
  assert.equal(campaigns.isCampaignMember(campaign.id, late.id), false);
});

await test("a DM seat holds no party slot", async () => {
  const campaign = await newTable({ maxPlayers: 1, gameSettings: { dmMode: "human" } });
  const player = world.addUser("player");
  const extra = world.addUser("extra");
  assert.equal((await seat(player, campaign)).status, 200);
  assert.equal((await seat(extra, campaign)).status, 400);
});

// ---- sheets at the table's level ----

const WIZARD_TEN = heroInput({
  name: "Ysolde",
  class: "wizard",
  level: 10,
  maxHp: 62,
  abilities: { int: 20, con: 14 },
  asiChoices: [
    { mode: "plus2", ability: "int" },
    { mode: "plus2", ability: "int" },
  ],
  hitDice: { die: "d6", total: 10, spent: 0 },
  spellcasting: {
    ability: "int",
    slots: {
      1: { max: 4, used: 0 },
      2: { max: 3, used: 0 },
      3: { max: 3, used: 0 },
      4: { max: 3, used: 0 },
      5: { max: 2, used: 0 },
    },
    prepared: ["Magic Missile", "Shield", "Fireball", "Wall of Force", "Cone of Cold"],
    known: [],
    cantrips: ["Fire Bolt", "Light", "Mage Hand", "Prestidigitation", "Ray of Frost"],
    spellbook: ["Magic Missile", "Shield", "Fireball", "Wall of Force", "Cone of Cold"],
  },
  portrait: { url: "/uploads/enforce.png" },
});

await test("a level 10 library wizard enters a level 3 table as a level 3 wizard", async () => {
  const campaign = await newTable({ startingLevel: 3 });
  const player = world.addUser("player");
  const library = createCharacter(player.id, 10, WIZARD_TEN);
  await seat(player, campaign);
  const joined = await call(sheetRoute, "POST", { libraryCharacterId: library.id }, { campaignId: campaign.id });
  assert.equal(joined.status, 201, JSON.stringify(joined.json));
  const sheet = getSheetForUser(campaign.id, player.id);
  assert.equal(sheet.level, 3);
  assert.deepEqual(sheet.hitDice, { die: "d6", total: 3, spent: 0 });
  // SRD wizard table, level 3: four 1st level slots and two 2nd.
  assert.deepEqual(sheet.spellcasting.slots, { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } });
  // Both improvements were earned at 4 and 8, above the table.
  assert.equal(sheet.abilities.int, 16);
  assert.deepEqual(sheet.spellcasting.prepared, ["Magic Missile", "Shield"]);
  assert.equal(sheet.spellcasting.cantrips.length, 3);
  // d6 at first level, then 4 a level, CON +2 each: 8 + 6 + 6.
  assert.equal(sheet.maxHp, 20);
  assert.equal(sheet.currentHp, 20);
  assert.ok(!sheet.features.some((feature) => (feature.level ?? 1) > 3), "no feature above level 3");
});

await test("a level 1 library character enters a level 5 table at level 5", async () => {
  // ODM's rule (characters/adapt.ts): going up resizes level, hit dice, hit
  // points and slots; the improvements of the new levels are taken in play.
  const campaign = await newTable({ startingLevel: 5 });
  const player = world.addUser("player");
  const library = createCharacter(player.id, 1, posted({ class: "cleric", abilities: { wis: 16 },
    spellcasting: { ability: "wis", slots: { 1: { max: 2, used: 0 } }, prepared: ["Bless"], known: [], cantrips: [] } }));
  await seat(player, campaign);
  const joined = await call(sheetRoute, "POST", { libraryCharacterId: library.id }, { campaignId: campaign.id });
  assert.equal(joined.status, 201, JSON.stringify(joined.json));
  const sheet = getSheetForUser(campaign.id, player.id);
  assert.equal(sheet.level, 5);
  assert.equal(sheet.hitDice.total, 5);
  // SRD cleric table, level 5: 4 / 3 / 2.
  assert.deepEqual(
    Object.fromEntries(Object.entries(sheet.spellcasting.slots).map(([level, slot]) => [level, slot.max])),
    { 1: 4, 2: 3, 3: 2 },
  );
});

await test("a posted sheet plays at the table's level whatever level it names", async () => {
  const campaign = await newTable({ startingLevel: 3 });
  const player = world.addUser("player");
  await seat(player, campaign);
  const made = await call(
    sheetRoute,
    "POST",
    { ...posted({ name: "Climber" }), level: 20, xp: 355000, currentHp: 400,
      deathSaves: { successes: 3, failures: 0, stable: true, dead: false },
      resources: { action_surge: { max: 9, used: 0 } }, exhaustion: 0, conditions: ["invisible"] },
    { campaignId: campaign.id },
  );
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const sheet = getSheetForUser(campaign.id, player.id);
  assert.equal(sheet.level, 3);
  // The experience 3rd level takes (SRD 5.1), not the request's and not none.
  assert.equal(sheet.xp, 900);
  assert.equal(sheet.currentHp, sheet.maxHp);
  assert.deepEqual(sheet.conditions, []);
  assert.equal(sheet.deathSaves, null);
  assert.equal(sheet.resources.action_surge.max, 1);
});

// The numbers a posted sheet carries beside its level (hit dice, hit points,
// ability scores, gold) are test-enforce-creation-routes.mjs's.

// A sheet that starts above level 1 starts at 0 XP: test-enforce-xp.mjs
// records it as xp-starting-level-holds-none.

// ---- one character each ----

await test("a player fields one character at a table that plays one each", async () => {
  const campaign = await newTable();
  const player = world.addUser("player");
  await seat(player, campaign);
  const params = { campaignId: campaign.id };
  assert.equal((await call(sheetRoute, "POST", posted({ name: "First" }), params)).status, 201);
  const second = await call(sheetRoute, "POST", posted({ name: "Second" }), params);
  assert.equal(second.status, 409);
  const library = createCharacter(player.id, 1, posted({ name: "Third" }));
  const third = await call(sheetRoute, "POST", { libraryCharacterId: library.id }, params);
  assert.equal(third.status, 409);
  assert.equal(listSheetsForUser(campaign.id, player.id).length, 1);
});

await test(
  "With the several-characters setting on, a player may add a second character; the first stays the one in play until they switch.",
  async () => {
    const campaign = await newTable({ gameSettings: { multiCharacter: "one_active" } });
    const player = world.addUser("player");
    await seat(player, campaign);
    const params = { campaignId: campaign.id };
    assert.equal((await call(sheetRoute, "POST", posted({ name: "First" }), params)).status, 201);
    const second = await call(sheetRoute, "POST", posted({ name: "Second" }), params);
    assert.equal(second.status, 201);
    assert.equal(listSheetsForUser(campaign.id, player.id).length, 2);
    assert.equal(getSheetForUser(campaign.id, player.id).name, "First");

    // The library door opens the same way.
    const library = createCharacter(player.id, 1, posted({ name: "Third" }));
    const third = await call(sheetRoute, "POST", { libraryCharacterId: library.id }, params);
    assert.equal(third.status, 201, JSON.stringify(third.json));
    assert.deepEqual(
      listSheetsForUser(campaign.id, player.id).map((sheet) => sheet.name),
      ["First", "Second", "Third"],
    );
    assert.equal(getSheetForUser(campaign.id, player.id).name, "First");

    const switched = await call(switchRoute, "POST", { characterId: second.json.sheet.id }, params);
    assert.equal(switched.status, 200, JSON.stringify(switched.json));
    assert.equal(getSheetForUser(campaign.id, player.id).name, "Second");
  },
);

await test("a player cannot switch to a character that is somebody else's", async () => {
  const campaign = await newTable({ gameSettings: { multiCharacter: "one_active" } });
  const params = { campaignId: campaign.id };
  const player = world.addUser("player");
  await seat(player, campaign);
  assert.equal((await call(sheetRoute, "POST", posted({ name: "Mine" }), params)).status, 201);
  const other = world.addUser("other");
  await seat(other, campaign);
  const theirs = await call(sheetRoute, "POST", posted({ name: "Theirs" }), params);
  assert.equal(theirs.status, 201);
  world.signIn(player);
  const stolen = await call(switchRoute, "POST", { characterId: theirs.json.sheet.id }, params);
  assert.equal(stolen.status, 404);
  assert.equal(getSheetForUser(campaign.id, player.id).name, "Mine");
});

await test("a member with no seat at the table cannot make a sheet there", async () => {
  const campaign = await newTable();
  const stranger = world.addUser("stranger");
  world.signIn(stranger);
  const made = await call(sheetRoute, "POST", posted(), { campaignId: campaign.id });
  assert.equal(made.status, 404);
  assert.equal(listSheetsForUser(campaign.id, stranger.id).length, 0);
});

world.close();
finish();
