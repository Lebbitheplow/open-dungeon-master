// Who may change what, asked of the real routes.
//
// One human-run table seats everybody a permission can turn on: the DM (who
// owns the table), an assistant DM, the party lead, two ordinary players, a
// member who has not made a character, a stranger with an account and no
// seat, and nobody at all. Every route that can change rules state is then
// called as each of them, and a refusal is only counted when the stored
// sheets, fight and settings are byte for byte what they were.
//
// The rules held:
//   the engine is the DM's: a player cannot invoke an adjudication, correct
//   another player's sheet, undo an audited change, rewind a chapter, end a
//   fight or seat a companion;
//   a player's own routes reach their own sheet and no other;
//   a DM seat is handed out by the DM or the owner, never by a deputy.
//
// ODM's own rules pinned here (src/lib/dm/viewer.ts): at an AI table the
// party lead holds story authority and there is no DM seat, so the console
// is closed to everyone; once a person runs the table the lead is a player.
// Everything held here is a refusal or something a DM seat may do. What a
// player can still write to their own sheet is a finding, never a rule of
// the table, and is recorded in test-enforce-patch-fields.mjs.
import assert from "node:assert/strict";
import { call, seats, signOut } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-permissions");
const world = await openWorld({ gameSettings: { inventoryApprovals: true } });
const campaigns = await import("../src/lib/db/campaigns.ts");
const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");
const { listOpenItemProposals, insertItemProposal } = await import("../src/lib/db/item-proposals.ts");
const { ensureOpenChapter } = await import("../src/lib/db/chapters.ts");
const { captureBoundarySnapshot } = await import("../src/lib/db/snapshots.ts");

const who = await seats(world);
const campaignId = world.campaignId;
const params = { campaignId };
const ROLES = ["dm", "assistant", "lead", "player", "bare", "stranger", "nobody"];

const route = {
  sheet: await world.route("campaigns/[campaignId]/sheet"),
  sheets: await world.route("campaigns/[campaignId]/sheets/[sheetId]"),
  usage: await world.route("campaigns/[campaignId]/sheet/usage"),
  spells: await world.route("campaigns/[campaignId]/sheet/spells"),
  swap: await world.route("campaigns/[campaignId]/sheet/switch"),
  sync: await world.route("campaigns/[campaignId]/sheet/sync"),
  invoke: await world.route("campaigns/[campaignId]/dm/invoke"),
  encounter: await world.route("campaigns/[campaignId]/encounter"),
  endTurn: await world.route("campaigns/[campaignId]/encounter/end-turn"),
  undo: await world.route("campaigns/[campaignId]/audit/[entryId]/undo"),
  revert: await world.route("campaigns/[campaignId]/audit/revert-turn"),
  rollback: await world.route("campaigns/[campaignId]/chapters/rollback"),
  companionCreate: await world.route("campaigns/[campaignId]/companions/create"),
  companion: await world.route("campaigns/[campaignId]/companions/[characterId]"),
  proposal: await world.route("campaigns/[campaignId]/item-proposals/[proposalId]"),
  proposals: await world.route("campaigns/[campaignId]/item-proposals"),
  seat: await world.route("campaigns/[campaignId]/dm/seat"),
  lead: await world.route("campaigns/[campaignId]/lead"),
  campaign: await world.route("campaigns/[campaignId]"),
};

function as(role) {
  if (role === "nobody") {
    signOut();
  } else {
    world.signIn(who[role]);
  }
}

// Everything a refused request must leave alone.
const state = () =>
  JSON.stringify({
    sheets: world.sheets().map((sheet) => Object.fromEntries(Object.entries(sheet).filter(([key]) => key !== "updatedAt"))),
    encounter: world.encounter(),
    enemies: world.enemies(),
    settings: world.campaign().gameSettings,
    seats: campaigns.campaignSeats(world.campaign()),
    status: world.campaign().status,
  });

// Calls `attempt` as each role named. A role in `allowed` must get through
// (`reset` then puts back what it changed); every other role must be refused
// with the status its seat earns, leaving the state untouched.
const OUTSIDE = ["lead", "player", "bare", "stranger", "nobody"];
async function matrix(label, allowed, attempt, { reset, refusal = {}, roles = ROLES } = {}) {
  for (const role of roles) {
    const before = state();
    as(role);
    const response = await attempt(role);
    const where = `${label} as ${role}: ${response.status} ${JSON.stringify(response.json).slice(0, 160)}`;
    if (allowed.includes(role)) {
      assert.ok(response.status >= 200 && response.status < 300, where);
      await reset?.(role);
      continue;
    }
    const expected =
      refusal[role] ?? (role === "nobody" ? 401 : role === "stranger" ? 404 : 403);
    assert.equal(response.status, expected, where);
    assert.equal(state(), before, `${label} as ${role} changed state`);
  }
}

// ---- the engine ----

await test("only a DM seat invokes the engine", async () => {
  const hp = () => world.sheet(who.sheet.id).currentHp;
  const full = hp();
  await matrix(
    "dm/invoke apply_damage",
    ["dm", "assistant"],
    () =>
      call(route.invoke, "POST", {
        name: "apply_damage",
        args: { characterId: who.sheet.id, amount: 5, reason: "test" },
      }, params),
    { reset: () => world.patch(who.sheet.id, { currentHp: full }) },
  );
  assert.equal(hp(), full);
  // A player healing themselves, or awarding themselves XP and gold.
  for (const [name, args] of [
    ["heal", { characterId: who.sheet.id, amount: 10 }],
    ["award_xp", { characterIds: [who.sheet.id], amount: 5000 }],
    ["modify_gold", { characterId: who.sheet.id, delta: 500 }],
    ["grant_item", { characterId: who.sheet.id, name: "Vorpal Sword" }],
    ["update_sheet", { characterId: who.sheet.id, level: 2, reason: "because" }],
    ["take_rest", { kind: "long" }],
  ]) {
    await matrix(`dm/invoke ${name}`, [], () => call(route.invoke, "POST", { name, args }, params), {
      roles: OUTSIDE,
    });
  }
  await matrix("dm/invoke catalog", ["dm", "assistant"], () => call(route.invoke, "GET", undefined, params));
});

await test("at an AI table nobody holds the console, the lead included", async () => {
  const table = await openWorld();
  const hero = table.addHero({ name: "Solo" });
  table.signIn(table.owner);
  const refused = await call(
    route.invoke,
    "POST",
    { name: "heal", args: { characterId: hero.id, amount: 5 } },
    { campaignId: table.campaignId },
  );
  assert.equal(refused.status, 403);
  assert.equal((await call(route.invoke, "GET", undefined, { campaignId: table.campaignId })).status, 403);
});

await test("the engine does not run before the adventure starts", async () => {
  campaigns.setCampaignStatus(campaignId, "lobby");
  as("dm");
  const before = state();
  const early = await call(
    route.invoke,
    "POST",
    { name: "apply_damage", args: { characterId: who.sheet.id, amount: 5 } },
    params,
  );
  campaigns.setCampaignStatus(campaignId, "active");
  assert.equal(early.status, 400);
  assert.equal(state().replace('"status":"active"', '"status":"lobby"'), before);
});

// ---- sheets ----

await test("another player's sheet is corrected by a DM seat and nobody else", async () => {
  const target = { campaignId, sheetId: who.otherSheet.id };
  const gold = world.sheet(who.otherSheet.id).gold;
  await matrix(
    "sheets/[sheetId] PATCH",
    ["dm", "assistant"],
    () => call(route.sheets, "PATCH", { gold: gold + 100, reason: "test" }, target),
    { reset: () => world.patch(who.otherSheet.id, { gold }) },
  );
  // Their own sheet, through the DM's door: still the DM's door.
  as("player");
  const own = await call(route.sheets, "PATCH", { gold: 999 }, { campaignId, sheetId: who.sheet.id });
  assert.equal(own.status, 403);
  assert.equal(world.sheet(who.sheet.id).gold, 0);
});

await test("a sheet from another table is not reachable through this one", async () => {
  const elsewhere = await openWorld();
  const foreign = elsewhere.addHero({ name: "Foreigner" });
  as("dm");
  const response = await call(route.sheets, "PATCH", { gold: 50 }, { campaignId, sheetId: foreign.id });
  assert.equal(response.status, 404);
  assert.equal(elsewhere.sheet(foreign.id).gold, 0);
});

await test("the player routes reach the caller's own sheet and no other", async () => {
  const mine = () => world.sheet(who.sheet.id);
  const theirs = JSON.stringify(world.sheet(who.otherSheet.id));
  as("player");
  const noted = await call(route.sheet, "PATCH", { notes: "mine" }, params);
  assert.equal(noted.status, 200);
  assert.equal(mine().notes, "mine");
  // Naming somebody else's sheet is refused: sheetId is for companions only.
  const aimed = await call(route.sheet, "PATCH", { sheetId: who.otherSheet.id, notes: "theirs" }, params);
  assert.equal(aimed.status, 404);
  // The usage route answers on the caller's own sheet: here a refusal naming
  // it, since a player spends hit dice only at a short rest.
  const usage = await call(route.usage, "POST", { sheetId: who.otherSheet.id, hitDiceSpent: 1 }, params);
  assert.equal(usage.status, 409);
  assert.ok(usage.json.error.includes(mine().name), usage.json.error);
  const spell = await call(
    route.spells,
    "POST",
    { action: "prepare", spell: "Bless", sheetId: who.otherSheet.id },
    params,
  );
  assert.equal(spell.status, 403, "a fighter's own sheet answers: it casts nothing");
  assert.equal(JSON.stringify(world.sheet(who.otherSheet.id)), theirs);
  world.patch(who.sheet.id, { notes: "", hitDice: { ...mine().hitDice, spent: 0 } });
});

await test("a seat with no character has no sheet to change", async () => {
  for (const role of ["bare", "dm", "stranger", "nobody"]) {
    const before = state();
    as(role);
    const expected = role === "nobody" ? 401 : 404;
    assert.equal((await call(route.sheet, "PATCH", { notes: "x" }, params)).status, expected, role);
    assert.equal((await call(route.usage, "POST", { hitDiceSpent: 0 }, params)).status, expected, role);
    assert.equal((await call(route.sync, "POST", undefined, params)).status, expected, role);
    assert.equal(
      (await call(route.spells, "POST", { action: "prepare", spell: "Bless" }, params)).status,
      expected,
      role,
    );
    assert.equal(state(), before, role);
  }
});

await test("switching characters is closed at a table that plays one each", async () => {
  for (const role of ["player", "lead", "dm"]) {
    as(role);
    const response = await call(route.swap, "POST", { characterId: who.otherSheet.id }, params);
    assert.equal(response.status, 400, role);
  }
  campaigns.updateGameSettings(campaignId, { multiCharacter: "one_active" });
  as("player");
  const stolen = await call(route.swap, "POST", { characterId: who.otherSheet.id }, params);
  assert.equal(stolen.status, 404);
  assert.equal((await call(route.swap, "POST", { characterId: who.sheet.id }, params)).status, 200);
  campaigns.updateGameSettings(campaignId, { multiCharacter: "off" });
  campaigns.setMemberActiveCharacter(campaignId, who.player.id, "");
});

// ---- undo and rewind ----

await test("an audited change is undone by a DM seat, and only once", async () => {
  as("dm");
  const hurt = await call(route.invoke, "POST", {
    name: "apply_damage",
    args: { characterId: who.sheet.id, amount: 9, reason: "a trap" },
  }, params);
  assert.equal(hurt.status, 200, JSON.stringify(hurt.json));
  const full = world.sheet(who.sheet.id).maxHp;
  assert.equal(world.sheet(who.sheet.id).currentHp, full - 9);
  const entry = listRecentAudit(campaignId, 5).find((row) => row.kind === "apply_damage");
  assert.ok(entry, "the damage was audited");
  const target = { campaignId, entryId: entry.id };

  // The wounded player, their lead and everyone without a seat are refused.
  await matrix("audit undo", [], () => call(route.undo, "POST", { confirm: true }, target), {
    roles: OUTSIDE,
  });
  assert.equal(world.sheet(who.sheet.id).currentHp, full - 9);
  await matrix(
    "audit revert-turn",
    [],
    () => call(route.revert, "POST", { turnId: entry.turnId, confirm: true }, params),
    { roles: OUTSIDE },
  );
  assert.equal(world.sheet(who.sheet.id).currentHp, full - 9);

  as("assistant");
  const undone = await call(route.undo, "POST", { confirm: true }, target);
  assert.equal(undone.status, 200, JSON.stringify(undone.json));
  assert.equal(world.sheet(who.sheet.id).currentHp, full);
  as("dm");
  const again = await call(route.undo, "POST", { confirm: true }, target);
  assert.equal(again.status, 400);
  // An entry from another table is not this table's to undo.
  const elsewhere = await openWorld();
  const foreign = elsewhere.addHero();
  await elsewhere.invoke("apply_damage", { characterId: foreign.id, amount: 3, reason: "x" });
  const theirs = listRecentAudit(elsewhere.campaignId, 5)[0];
  const crossed = await call(route.undo, "POST", { confirm: true }, { campaignId, entryId: theirs.id });
  assert.equal(crossed.status, 404);
  assert.equal(elsewhere.sheet(foreign.id).currentHp, foreign.currentHp - 3);
});

await test("a chapter is rewound by a DM seat and nobody else", async () => {
  ensureOpenChapter(campaignId);
  captureBoundarySnapshot(campaignId, 1, campaigns.latestSeq(campaignId));
  await matrix(
    "chapters/rollback",
    [],
    () => call(route.rollback, "POST", { chapterIndex: 1, confirm: true }, params),
    { roles: OUTSIDE },
  );
  // A DM seat is shown what the rewind costs before it is confirmed.
  as("assistant");
  const asked = await call(route.rollback, "POST", { chapterIndex: 1 }, params);
  assert.equal(asked.status, 409);
  assert.ok(Array.isArray(asked.json.warnings));
});

// ---- the fight ----

await test("a fight is ended by a DM seat, and a turn by the player whose turn it is", async () => {
  await world.beginFight([{ monster: "goblin", count: 1 }], {
    heroFaces: { [who.sheet.id]: 20, [who.otherSheet.id]: 10, [who.leadSheet.id]: 5 },
  });
  const order = world.encounter().order;
  assert.equal(order[0].characterId, who.sheet.id);
  const turn = () => world.encounter().turnIndex;

  for (const role of ["other", "lead", "bare", "dm", "stranger", "nobody"]) {
    const before = state();
    if (role === "other") {
      world.signIn(who.other);
    } else {
      as(role);
    }
    const response = await call(route.endTurn, "POST", undefined, params);
    const expected = role === "nobody" ? 401 : role === "stranger" ? 404 : 409;
    assert.equal(response.status, expected, role);
    assert.equal(state(), before, role);
  }
  as("player");
  assert.equal(turn(), 0);
  assert.equal((await call(route.endTurn, "POST", undefined, params)).status, 200);
  assert.equal(turn(), 1);
  // Done once: the turn is somebody else's now.
  assert.equal((await call(route.endTurn, "POST", undefined, params)).status, 409);
  assert.equal(turn(), 1);

  await matrix("encounter DELETE", [], () => call(route.encounter, "DELETE", undefined, params), {
    roles: OUTSIDE,
  });
  assert.ok(world.encounter(), "the fight outlived every refused request");
  as("dm");
  assert.equal((await call(route.encounter, "DELETE", undefined, params)).status, 200);
  assert.equal(world.encounter(), null);
});

await test("a player reads the fight without the enemy's numbers", async () => {
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  as("player");
  const seen = await call(route.encounter, "GET", undefined, params);
  assert.equal(seen.status, 200);
  const [enemy] = seen.json.encounter.enemies;
  for (const key of ["currentHp", "maxHp", "ac", "stats"]) {
    assert.equal(enemy[key], undefined, `a player was sent the enemy's ${key}`);
  }
  as("dm");
  const ruled = await call(route.encounter, "GET", undefined, params);
  assert.equal(typeof ruled.json.encounter.enemies[0].currentHp, "number");
  assert.equal((await call(route.encounter, "DELETE", undefined, params)).status, 200);
});

// ---- companions and offers ----

await test("a companion joins and leaves at a DM seat's word", async () => {
  const sheet = {
    name: "Brakka", race: "human", class: "fighter", abilities: world.sheet(who.sheet.id).abilities,
    maxHp: 12, ac: 14, hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: world.sheet(who.sheet.id).proficiencies,
    portrait: { url: "/uploads/enforce.png" },
  };
  await matrix("companions/create", [], () => call(route.companionCreate, "POST", { sheet }, params), {
    roles: OUTSIDE,
  });
  as("assistant");
  const made = await call(route.companionCreate, "POST", { sheet }, params);
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const companion = world.sheets().find((entry) => entry.isCompanion);
  assert.ok(companion);
  // The level is the party's, whatever the posted sheet claims.
  assert.equal(companion.level, 1);
  const target = { campaignId, characterId: companion.id };
  await matrix("companions DELETE", [], () => call(route.companion, "DELETE", undefined, target), {
    roles: OUTSIDE,
  });
  as("dm");
  assert.equal((await call(route.companion, "DELETE", undefined, target)).status, 200);
  assert.equal(world.sheets().some((entry) => entry.isCompanion), false);
  // A player's own character is not a companion to be sent away.
  as("dm");
  const wrong = await call(route.companion, "DELETE", undefined, { campaignId, characterId: who.sheet.id });
  assert.equal(wrong.status, 400);
  assert.ok(world.sheet(who.sheet.id));
});

await test("an offer is answered by the player it was made to, or a DM seat", async () => {
  const offer = () =>
    insertItemProposal({
      campaignId,
      turnId: null,
      characterId: who.sheet.id,
      userId: who.player.id,
      toolName: "modify_gold",
      argsJson: JSON.stringify({ characterId: who.sheet.id, delta: 25, reason: "a purse" }),
      summary: "25 gold",
      reason: "a purse",
      seq: campaigns.allocateSeq(campaignId),
    });
  let open = offer();
  for (const role of ["lead", "bare", "stranger", "nobody"]) {
    as(role);
    const response = await call(route.proposal, "POST", { action: "approve" }, { campaignId, proposalId: open.id });
    assert.equal(response.status, role === "nobody" ? 401 : role === "stranger" ? 404 : 403, role);
    assert.equal(world.sheet(who.sheet.id).gold, 0, role);
  }
  world.signIn(who.other);
  assert.equal(
    (await call(route.proposal, "POST", { action: "approve" }, { campaignId, proposalId: open.id })).status,
    403,
  );
  as("player");
  const taken = await call(route.proposal, "POST", { action: "approve" }, { campaignId, proposalId: open.id });
  assert.equal(taken.status, 200, JSON.stringify(taken.json));
  assert.equal(world.sheet(who.sheet.id).gold, 25);
  // Answered once: a second approval pays nothing.
  const twice = await call(route.proposal, "POST", { action: "approve" }, { campaignId, proposalId: open.id });
  assert.equal(twice.status, 400);
  assert.equal(world.sheet(who.sheet.id).gold, 25);
  open = offer();
  as("player");
  assert.equal(
    (await call(route.proposal, "POST", { action: "decline" }, { campaignId, proposalId: open.id })).status,
    200,
  );
  assert.equal(world.sheet(who.sheet.id).gold, 25);
  assert.equal(listOpenItemProposals(campaignId).length, 0);
  world.patch(who.sheet.id, { gold: 0 });
});

// ---- the seats themselves ----

await test("the DM seats are handed out by the DM or the owner, never by a deputy", async () => {
  await matrix(
    "dm/seat POST",
    ["dm"],
    () => call(route.seat, "POST", { seat: "assistant", userId: who.assistant.id }, params),
  );
  for (const role of ["assistant", "lead", "player"]) {
    as(role);
    const grab = await call(route.seat, "POST", { seat: "dm", userId: who[role].id }, params);
    assert.equal(grab.status, 403, role);
  }
  as("dm");
  const outsider = await call(route.seat, "POST", { seat: "assistant", userId: who.stranger.id }, params);
  assert.equal(outsider.status, 400);
  const empty = await call(route.seat, "POST", { seat: "dm", userId: null }, params);
  assert.equal(empty.status, 400);
  assert.equal(world.campaign().dmUserId, who.dm.id);
  assert.equal(world.campaign().assistantDmUserId, who.assistant.id);
});

await test("the lead is passed on by the lead or the owner, to a member", async () => {
  for (const role of ["player", "assistant", "bare", "stranger", "nobody"]) {
    as(role);
    const response = await call(route.lead, "POST", { userId: who.player.id }, params);
    assert.equal(response.status, role === "nobody" ? 401 : role === "stranger" ? 404 : 403, role);
    assert.equal(world.campaign().leadUserId, who.lead.id, role);
  }
  as("lead");
  assert.equal((await call(route.lead, "POST", { userId: who.stranger.id }, params)).status, 400);
  assert.equal((await call(route.lead, "POST", { userId: who.player.id }, params)).status, 200);
  assert.equal(world.campaign().leadUserId, who.player.id);
  as("dm");
  assert.equal((await call(route.lead, "POST", { userId: who.lead.id }, params)).status, 200);
  assert.equal(world.campaign().leadUserId, who.lead.id);
});

await test("the table is started, ended and deleted by its owner", async () => {
  for (const role of ["assistant", "lead", "player", "bare"]) {
    as(role);
    assert.equal((await call(route.campaign, "PATCH", { status: "ended" }, params)).status, 403, role);
    assert.equal((await call(route.campaign, "DELETE", undefined, params)).status, 403, role);
  }
  as("stranger");
  assert.equal((await call(route.campaign, "DELETE", undefined, params)).status, 404);
  signOut();
  assert.equal((await call(route.campaign, "DELETE", undefined, params)).status, 401);
  assert.equal(world.campaign().status, "active");
  assert.equal(world.sheets().length, 3);
});

world.close();
finish();
