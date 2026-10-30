// The correction ledger (issue #460, src/lib/db/turn-ledger.ts): every fix
// a table makes to state an AI turn set writes exactly one turn_corrections
// row, in the fix's own transaction, from undo, revert-turn, a sheet edit,
// an enemy's hit points, the turn order, a narration edit, a reroll, a
// retry, an overruled ruling and a rewind (one row per AI turn it deletes,
// written before the delete). Nothing is written at a table a person runs,
// and no row holds story text or a name.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createDmTurn, getDmTurn, saveDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { insertSheetAudit, listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const messages = await import("../src/lib/db/messages.ts");
const ledger = await import("../src/lib/db/turn-ledger.ts");
const { insertDispute } = await import("../src/lib/db/disputes.ts");
const { ensureOpenChapter } = await import("../src/lib/db/chapters.ts");
const { captureBoundarySnapshot } = await import("../src/lib/db/snapshots.ts");
const { keepOriginalTake } = await import("../src/lib/dm/message-edit-logic.ts");
const { orderEntryId } = await import("../src/lib/db/encounters.ts");

let failed = 0;
async function test(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rows = (campaignId) => ledger.listTurnCorrections(campaignId);

function call(route, method, params, body) {
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return route[method](new Request("http://localhost/api/test", init), { params: Promise.resolve(params) });
}

// Every string the tables could leak: the narration, the reasons, the names.
const storyText = [];
function story(text) {
  storyText.push(text);
  return text;
}

// A change the AI made on a turn of its own, as a tool's audit row records it.
function aiChange(world, sheet, patch, { kind = "apply_damage", turn } = {}) {
  const owning = turn ?? createDmTurn(world.campaignId, [], "ai");
  const before = world.sheet(sheet.id);
  const entry = insertSheetAudit({
    campaignId: world.campaignId,
    characterId: sheet.id,
    turnId: owning.id,
    kind,
    delta: patch,
    reason: story("The goblin's rusty blade bites deep"),
    seq: campaigns.allocateSeq(world.campaignId),
    before,
    patch,
  });
  world.patch(sheet.id, patch);
  return { turn: owning, entry };
}

function dmLine(world, turnId, text) {
  return messages.insertCampaignMessage({
    campaignId: world.campaignId,
    seq: campaigns.allocateSeq(world.campaignId),
    authorType: "dm",
    content: story(text),
    ...(turnId ? { dmTurnId: turnId } : {}),
  });
}

// ---- the AI table ----

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
world.signIn(world.owner);
const hero = world.addHero({ name: story("Kara Brightwater"), class: "fighter", level: 3 });
story(world.owner.username);
const undoRoute = await world.route("campaigns/[campaignId]/audit/[entryId]/undo");
const revertRoute = await world.route("campaigns/[campaignId]/audit/revert-turn");
const sheetRoute = await world.route("campaigns/[campaignId]/sheets/[sheetId]");
const editRoute = await world.route("campaigns/[campaignId]/messages/[messageId]/edit");
const disputeRoute = await world.route("campaigns/[campaignId]/disputes/[disputeId]");
const reasonRoute = await world.route("campaigns/[campaignId]/corrections");
const loreRoute = await world.route("campaigns/[campaignId]/lore-check");

await test("an undo of the AI's change writes one direct row naming the audit row and the tool", async () => {
  const before = rows(world.campaignId).length;
  const { turn, entry } = aiChange(world, hero, { currentHp: 4 });
  const response = await call(undoRoute, "POST", { campaignId: world.campaignId, entryId: entry.id }, {});
  assert.equal(response.status, 200);
  const answer = await response.json();
  const after = rows(world.campaignId);
  assert.equal(after.length, before + 1, "exactly one row");
  const row = after.at(-1);
  assert.deepEqual(
    { kind: row.kind, attribution: row.attribution, turnId: row.turnId, auditId: row.auditId, tool: row.tool, userId: row.userId, reason: row.reason },
    { kind: "sheet_undo", attribution: "direct", turnId: turn.id, auditId: entry.id, tool: "apply_damage", userId: world.owner.id, reason: null },
  );
  assert.deepEqual(answer.corrections, [row.id], "the answer names the row for the reason chip");
});

await test("revert-turn writes one row per AI change it reverts", async () => {
  const turn = createDmTurn(world.campaignId, [], "ai");
  aiChange(world, hero, { currentHp: 7 }, { turn });
  aiChange(world, hero, { gold: 3 }, { turn, kind: "modify_gold" });
  const before = rows(world.campaignId).length;
  const response = await call(revertRoute, "POST", { campaignId: world.campaignId }, { turnId: turn.id, confirm: true });
  assert.equal(response.status, 200);
  const answer = await response.json();
  const added = rows(world.campaignId).slice(before);
  assert.equal(added.length, 2);
  assert.ok(added.every((row) => row.kind === "turn_revert" && row.turnId === turn.id && row.attribution === "direct"));
  assert.deepEqual(new Set(added.map((row) => row.tool)), new Set(["apply_damage", "modify_gold"]));
  assert.equal(answer.corrections.length, 2);
});

// Issue #622: diseases and poisons on the clock once filed every change
// under the made-up turn "clock", so "Revert this turn" on one of them undid
// the whole campaign's. Only a turn this table played is reverted.
await test("revert-turn refuses a turn this table never played: the made-up \"clock\", an unknown id, another table's turn", async () => {
  aiChange(world, hero, { currentHp: 6 }, { turn: { id: "clock" } });
  aiChange(world, hero, { gold: 4 }, { turn: { id: "clock" }, kind: "modify_gold" });
  const elsewhere = campaigns.createCampaign(world.owner.id, {
    title: "Elsewhere",
    description: "",
    theme: "high-fantasy",
    maxPlayers: 4,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: {},
  });
  const foreign = createDmTurn(elsewhere.id, [], "ai");
  const before = rows(world.campaignId).length;
  for (const turnId of ["clock", "no-such-turn", foreign.id]) {
    const response = await call(revertRoute, "POST", { campaignId: world.campaignId }, { turnId, confirm: true });
    assert.equal(response.status, 400, `${turnId}: ${await response.clone().text()}`);
  }
  assert.equal(world.sheet(hero.id).currentHp, 6, "a made-up turn was reverted");
  assert.equal(world.sheet(hero.id).gold, 4, "a made-up turn was reverted");
  assert.equal(rows(world.campaignId).length, before);
});

// Issue #622: the die a roll spends is written down in the hands that threw
// it. Every spend once read as the GM's, a player's own roll included.
await test("a die spent on a player's own roll is the player's, and its undo is nobody's AI fix; one the AI's turn spends is the AI's", async () => {
  const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
  const rollsRoute = await world.route("campaigns/[campaignId]/rolls");
  const spentRow = () => listRecentAudit(world.campaignId, 10).filter((row) => row.kind === "use_resource").at(-1);
  world.patch(hero.id, { conditions: ["bardic inspiration (d6)"], conditionMeta: {} });
  world.signIn(world.owner);
  const rolled = await call(rollsRoute, "POST", { campaignId: world.campaignId }, { kind: "ability_check", ability: "str", characterId: hero.id });
  assert.ok(rolled.status < 300, await rolled.clone().text());
  const own = spentRow();
  assert.ok(own, "the spent die was not written down");
  assert.deepEqual({ actor: own.actor, turnId: own.turnId }, { actor: "player", turnId: null });
  const before = rows(world.campaignId).length;
  const undone = await call(undoRoute, "POST", { campaignId: world.campaignId, entryId: own.id }, {});
  assert.equal(undone.status, 200, await undone.clone().text());
  assert.equal(rows(world.campaignId).length, before, "a player's own spend, undone, was counted as fixing the AI");

  world.patch(hero.id, { conditions: ["bardic inspiration (d6)"], conditionMeta: {} });
  const turn = createDmTurn(world.campaignId, [], "ai");
  const asked = await invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, {
    name: "request_roll",
    args: { characterId: hero.id, kind: "ability_check", ability: "str", reason: "the stuck door" },
  });
  assert.equal(asked.ok, true, asked.error);
  const ai = spentRow();
  assert.notEqual(ai.id, own.id, "the AI's roll spent no die");
  assert.deepEqual({ actor: ai.actor, turnId: ai.turnId }, { actor: "dm", turnId: turn.id });
  const fixed = await call(undoRoute, "POST", { campaignId: world.campaignId, entryId: ai.id }, {});
  assert.equal(fixed.status, 200, await fixed.clone().text());
  assert.equal(rows(world.campaignId).length, before + 1, "the AI's spend, undone, is one fix of the AI's");
});

await test("a sheet edit is tied to the newest AI change that wrote the same field, and only once", async () => {
  const { turn, entry } = aiChange(world, hero, { currentHp: 2 });
  const before = rows(world.campaignId).length;
  const response = await call(sheetRoute, "PATCH", { campaignId: world.campaignId, sheetId: hero.id }, { currentHp: 9, reason: story("The goblin missed, the dice said so") });
  assert.equal(response.status, 200, await response.clone().text());
  const added = rows(world.campaignId).slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual(
    { kind: added[0].kind, attribution: added[0].attribution, turnId: added[0].turnId, auditId: added[0].auditId, tool: added[0].tool },
    { kind: "sheet_edit", attribution: "direct", turnId: turn.id, auditId: entry.id, tool: "apply_damage" },
  );
  // The same field again: its newest change is now the lead's own edit.
  const again = await call(sheetRoute, "PATCH", { campaignId: world.campaignId, sheetId: hero.id }, { currentHp: 8 });
  assert.equal(again.status, 200);
  assert.equal((await again.json()).corrections, undefined);
  assert.equal(rows(world.campaignId).length, before + 1, "a person's own change corrected is nobody's fix");
});

await test("a sheet edit of two fields: a person's newer change to one does not hide the AI's change to the other", async () => {
  const { turn, entry } = aiChange(world, hero, { gold: 5 }, { kind: "modify_gold" });
  // A person's own change to another field, newer than the AI's.
  const first = await call(sheetRoute, "PATCH", { campaignId: world.campaignId, sheetId: hero.id }, { currentHp: 6 });
  assert.equal(first.status, 200, await first.clone().text());
  const before = rows(world.campaignId).length;
  const response = await call(sheetRoute, "PATCH", { campaignId: world.campaignId, sheetId: hero.id }, { currentHp: 5, gold: 9 });
  assert.equal(response.status, 200, await response.clone().text());
  const added = rows(world.campaignId).slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual(
    { kind: added[0].kind, turnId: added[0].turnId, auditId: added[0].auditId, tool: added[0].tool },
    { kind: "sheet_edit", turnId: turn.id, auditId: entry.id, tool: "modify_gold" },
  );
});

await test("undoing a person's own change writes nothing", async () => {
  const lead = getDatabase()
    .prepare(`SELECT id FROM sheet_audit WHERE campaign_id = ? AND kind = 'lead_edit' AND reverted_at IS NULL ORDER BY seq DESC LIMIT 1`)
    .get(world.campaignId);
  const before = rows(world.campaignId).length;
  const response = await call(undoRoute, "POST", { campaignId: world.campaignId, entryId: lead.id }, { confirm: true });
  assert.equal(response.status, 200);
  assert.equal(rows(world.campaignId).length, before);
});

await test("a narration edit keeps the narrator's take beside the person's and writes one row", async () => {
  const turn = createDmTurn(world.campaignId, [], "ai");
  const original = "The bridge groans as Kara steps onto it, and the river roars below.";
  const message = dmLine(world, turn.id, original);
  const before = rows(world.campaignId).length;
  const edited = story("The bridge holds as Kara steps onto it.");
  const response = await call(editRoute, "POST", { campaignId: world.campaignId, messageId: message.id }, { content: edited });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = (await response.json()).message;
  assert.deepEqual(saved.variants, [original, edited], "the narrator's wording is kept as a take");
  assert.equal(saved.variantIndex, 1);
  assert.equal(saved.editedTake, 1);
  assert.equal(saved.content, edited);
  // A second edit rewrites the person's take, never the narrator's.
  const second = story("The bridge holds, barely, as Kara steps onto it.");
  const again = await call(editRoute, "POST", { campaignId: world.campaignId, messageId: message.id }, { content: second });
  const againBody = await again.json();
  const twice = againBody.message;
  assert.deepEqual(twice.variants, [original, second]);
  const added = rows(world.campaignId).slice(before);
  assert.equal(added.length, 1, "the second edit rewrites the person's own take, which is not another fix to the AI");
  assert.ok(added.every((row) => row.kind === "narration_edit" && row.messageId === message.id && row.turnId === turn.id));
  assert.equal(againBody.corrections, undefined, "no reason chips for rewording one's own take");
});

await test("accepting a lore check's rewrite keeps the narrator's take and writes one row, like an edit", async () => {
  const turn = createDmTurn(world.campaignId, [], "ai");
  const original = "The tower of Velm stands on the eastern shore.";
  const message = dmLine(world, turn.id, original);
  const before = rows(world.campaignId).length;
  const rewrite = story("The tower of Velm stands on the western shore.");
  const response = await call(loreRoute, "POST", { campaignId: world.campaignId }, { action: "accept", messageId: message.id, content: rewrite });
  assert.equal(response.status, 200, await response.clone().text());
  const answer = await response.json();
  assert.deepEqual(answer.message.variants, [original, rewrite], "the narrator's wording is kept as a take");
  assert.equal(answer.message.content, rewrite);
  assert.equal(answer.message.editedTake, 1);
  const added = rows(world.campaignId).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, "narration_edit");
  assert.equal(added[0].messageId, message.id);
  assert.deepEqual(answer.corrections, [added[0].id], "the answer offers the reason chips");
});

await test("keepOriginalTake: rerolled takes stay, and the person's take is one of its own", () => {
  assert.deepEqual(keepOriginalTake(["a"], undefined, "e"), { variants: ["a", "e"], index: 1, editedTake: 1 });
  assert.deepEqual(keepOriginalTake(["a", "b"], undefined, "e"), { variants: ["a", "b", "e"], index: 2, editedTake: 2 });
  assert.deepEqual(keepOriginalTake(["a", "b", "e"], 2, "f"), { variants: ["a", "b", "f"], index: 2, editedTake: 2 });
  assert.deepEqual(keepOriginalTake(["a", "b"], 7, "e"), { variants: ["a", "b", "e"], index: 2, editedTake: 2 }, "a stale index is not trusted");
});

await test("an overruled ruling writes one row on the narrating turn; an upheld one writes none", async () => {
  const turn = createDmTurn(world.campaignId, [], "ai");
  const message = dmLine(world, turn.id, "The goblin's spear finds the gap in Kara's mail.");
  const player = world.addUser("objector");
  const raise = () =>
    insertDispute({ campaignId: world.campaignId, messageId: message.id, raisedByUserId: player.id, reason: story("that was a miss on a 7"), seq: campaigns.allocateSeq(world.campaignId) });
  const before = rows(world.campaignId).length;
  const kept = raise();
  const upheld = await call(disputeRoute, "POST", { campaignId: world.campaignId, disputeId: kept.id }, { action: "uphold" });
  assert.equal(upheld.status, 200, await upheld.clone().text());
  assert.equal(rows(world.campaignId).length, before, "the ruling stood: nothing was corrected");
  const wrong = raise();
  const overruled = await call(disputeRoute, "POST", { campaignId: world.campaignId, disputeId: wrong.id }, { action: "overrule" });
  assert.equal(overruled.status, 200);
  const added = rows(world.campaignId).slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual(
    { kind: added[0].kind, turnId: added[0].turnId, messageId: added[0].messageId, userId: added[0].userId },
    { kind: "dispute_overruled", turnId: turn.id, messageId: message.id, userId: world.owner.id },
  );
  assert.deepEqual((await overruled.json()).corrections, [added[0].id]);
});

await test("the reason chip: one tap by whoever made the fix, a known chip only", async () => {
  const [row] = rows(world.campaignId);
  const tap = (reason) => call(reasonRoute, "POST", { campaignId: world.campaignId }, { ids: [row.id], reason });
  assert.equal((await tap("not_a_chip")).status, 400);
  assert.equal((await (await tap("wrong_number")).json()).changed, 1);
  assert.equal(rows(world.campaignId)[0].reason, "wrong_number");
  // Someone else at the table cannot label another's fix.
  const other = world.addHero({ name: story("Bram Ashford") });
  world.signIn({ id: other.userId });
  assert.equal((await (await tap("story")).json()).changed, 0);
  world.signIn(world.owner);
  assert.equal(rows(world.campaignId)[0].reason, "wrong_number");
});

await test("a row goes with its fix: a fix that fails takes its row with it", () => {
  const turn = createDmTurn(world.campaignId, [], "ai");
  const before = rows(world.campaignId).length;
  assert.throws(() =>
    getDatabase().transaction(() => {
      ledger.recordTurnCorrection({ campaignId: world.campaignId, turnId: turn.id, attribution: "direct", kind: "sheet_undo", userId: world.owner.id });
      throw new Error("the fix failed");
    })(),
  );
  assert.equal(rows(world.campaignId).length, before);
  // A turn a person ran, or a turn that is not there, is nobody's AI fix.
  const human = createDmTurn(world.campaignId, [], "human_dm");
  assert.equal(ledger.recordTurnCorrection({ campaignId: world.campaignId, turnId: human.id, attribution: "direct", kind: "sheet_undo", userId: world.owner.id }), null);
  assert.equal(ledger.recordTurnCorrection({ campaignId: world.campaignId, turnId: "no-such-turn", attribution: "direct", kind: "sheet_undo", userId: world.owner.id }), null);
  assert.equal(ledger.recordTurnCorrection({ campaignId: world.campaignId, turnId: null, attribution: "direct", kind: "sheet_undo", userId: world.owner.id }), null);
});

// ---- the fight at a steered table: inferred rows ----

const steered = await openWorld({ gameSettings: { dmMode: "steered", ttsEnabled: false } });
steered.signIn(steered.owner);
steered.addHero({ name: story("Tamsin Reed"), class: "fighter", level: 3 });
const hpRoute = await steered.route("campaigns/[campaignId]/dm/enemy-hp");
const orderRoute = await steered.route("campaigns/[campaignId]/dm/initiative");

await test("an enemy's hit points corrected at a steered table: inferred, on the fight's latest AI turn", async () => {
  const fight = await steered.beginFight([{ monster: "goblin", count: 2 }]);
  await sleep(5);
  const [goblin] = steered.enemies();
  const turn = createDmTurn(steered.campaignId, [
    { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "apply_damage", arguments: JSON.stringify({ enemyId: goblin.id, damage: "1d6" }) } }] },
    { role: "tool", tool_call_id: "c1", content: "{}" },
  ], "ai");
  assert.ok(fight);
  const before = rows(steered.campaignId).length;
  const response = await call(hpRoute, "POST", { campaignId: steered.campaignId }, { enemyId: goblin.id, currentHp: 3 });
  assert.equal(response.status, 200, await response.clone().text());
  const added = rows(steered.campaignId).slice(before);
  assert.equal(added.length, 1);
  assert.deepEqual(
    { kind: added[0].kind, attribution: added[0].attribution, turnId: added[0].turnId, tool: added[0].tool },
    { kind: "enemy_hp", attribution: "inferred", turnId: turn.id, tool: "apply_damage" },
  );
});

await test("a turn-order correction writes one inferred row; a delay is a choice, not a correction", async () => {
  const fight = steered.encounter();
  const before = rows(steered.campaignId).length;
  const entry = fight.order[fight.order.length - 1];
  const moved = await call(orderRoute, "POST", { campaignId: steered.campaignId }, { op: "move", id: orderEntryId(entry), direction: "up" });
  assert.equal(moved.status, 200, await moved.clone().text());
  const added = rows(steered.campaignId).slice(before);
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, "initiative");
  assert.equal(added[0].attribution, "inferred");
  const delayed = await call(orderRoute, "POST", { campaignId: steered.campaignId }, { op: "delay", id: orderEntryId(steered.encounter().order[0]) });
  assert.ok(delayed.status === 200 || delayed.status === 409, `delay answered ${delayed.status}`);
  assert.equal(rows(steered.campaignId).length, before + 1);
});

// ---- a table a person runs: nothing counts ----

const human = await openWorld({ gameSettings: { dmMode: "human", ttsEnabled: false } });
human.signIn(human.owner);
const humanHero = human.addHero({ name: story("Odo Vell"), class: "fighter", level: 3 });

await test("at a table a person runs, no fix is counted as the AI's", async () => {
  assert.equal(ledger.personRunsCampaign(human.campaignId), true, "the creator holds the DM seat");
  await human.beginFight([{ monster: "goblin", count: 1 }]);
  await sleep(5);
  createDmTurn(human.campaignId, [], "ai");
  const [goblin] = human.enemies();
  const hp = await call(await human.route("campaigns/[campaignId]/dm/enemy-hp"), "POST", { campaignId: human.campaignId }, { enemyId: goblin.id, currentHp: 2 });
  assert.equal(hp.status, 200, await hp.clone().text());
  assert.equal((await hp.json()).corrections, undefined);
  const { entry } = aiChange(human, humanHero, { currentHp: 5 });
  const undone = await call(await human.route("campaigns/[campaignId]/audit/[entryId]/undo"), "POST", { campaignId: human.campaignId, entryId: entry.id }, { confirm: true });
  assert.equal(undone.status, 200, await undone.clone().text());
  assert.equal(rows(human.campaignId).length, 0);
});

// ---- a rewind: one row per AI turn, before the delete ----

await test("a rewind writes one row per AI turn it deletes, and the rows outlive the turns", async () => {
  const table = await openWorld({ gameSettings: { ttsEnabled: false } });
  table.signIn(table.owner);
  table.addHero({ name: story("Wren Holloway") });
  dmLine(table, null, "The road to Hollowmere begins at the old mill.");
  ensureOpenChapter(table.campaignId);
  captureBoundarySnapshot(table.campaignId, 1, campaigns.latestSeq(table.campaignId));
  await sleep(5);
  const gone = [createDmTurn(table.campaignId, [], "ai"), createDmTurn(table.campaignId, [], "ai")];
  createDmTurn(table.campaignId, [], "human_dm");
  const rollback = await table.route("campaigns/[campaignId]/chapters/rollback");
  const response = await call(rollback, "POST", { campaignId: table.campaignId }, { chapterIndex: 1, confirm: true });
  assert.equal(response.status, 200, await response.clone().text());
  const answer = await response.json();
  const recorded = rows(table.campaignId);
  assert.equal(recorded.length, 2, "one per AI turn; a person's turn is nobody's AI fix");
  assert.deepEqual(new Set(recorded.map((row) => row.turnId)), new Set(gone.map((turn) => turn.id)));
  assert.ok(recorded.every((row) => row.kind === "rollback" && row.userId === table.owner.id));
  // recordTurnCorrection only writes for a turn that exists, so these rows
  // were written before the delete took the turns.
  assert.ok(gone.every((turn) => getDmTurn(turn.id) === null), "the turns are gone");
  assert.equal(answer.corrections.length, 2);
  await settleQueue(table.campaignId);
});

// ---- a retry and a reroll, against a scripted model ----

await test("a retry of a halted AI turn writes one row", async () => {
  const table = await openWorld({ gameSettings: { ttsEnabled: false } });
  table.signIn(table.owner);
  const halted = createDmTurn(table.campaignId, [{ role: "system", content: "x" }, { role: "user", content: "go" }], "ai");
  halted.status = "failed";
  saveDmTurn(halted);
  const route = await table.route("campaigns/[campaignId]/dm-turn/retry");
  const response = await call(route, "POST", { campaignId: table.campaignId }, { turnId: halted.id });
  assert.equal(response.status, 200, await response.clone().text());
  const answer = await response.json();
  const recorded = rows(table.campaignId);
  assert.equal(recorded.length, 1);
  assert.deepEqual({ kind: recorded[0].kind, turnId: recorded[0].turnId }, { kind: "retry", turnId: halted.id });
  assert.deepEqual(answer.corrections, [recorded[0].id]);
  await settleQueue(table.campaignId);
  assert.equal(rows(table.campaignId).length, 1, "the retried turn's own run adds nothing");
});

await test("a reroll writes one row on the turn behind the narration", async () => {
  const table = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
  table.signIn(table.owner);
  const kara = table.addHero({ name: story("Kara Vey"), class: "fighter", level: 1 });
  const model = await fakeModel();
  try {
    model.pointAt(table);
    model.script([reply({ text: story("The ferryman coils wet rope on the quay.") })]);
    model.claims([]);
    const first = await model.turn(table, story("I walk down to the water."), kara.id);
    assert.ok(first?.dmTurnId, "the turn wrote its narration");
    model.script([reply({ text: story("Fog rolls off the river and the ferryman will not meet your eye.") })]);
    model.claims([]);
    const route = await table.route("campaigns/[campaignId]/messages/[messageId]/renarrate");
    const response = await call(route, "POST", { campaignId: table.campaignId, messageId: first.id }, { action: "reroll" });
    assert.equal(response.status, 200, await response.clone().text());
    const recorded = rows(table.campaignId);
    assert.equal(recorded.length, 1);
    assert.deepEqual(
      { kind: recorded[0].kind, turnId: recorded[0].turnId, messageId: recorded[0].messageId },
      { kind: "renarrate", turnId: first.dmTurnId, messageId: first.id },
    );
    // Browsing back to a take is not a fix.
    const select = await call(route, "POST", { campaignId: table.campaignId, messageId: first.id }, { action: "select", index: 0 });
    assert.equal(select.status, 200);
    assert.equal(rows(table.campaignId).length, 1);
  } finally {
    model.close();
  }
});

// ---- what the ledger holds ----

await test("no row holds story text or a name: ids, kinds, tools and a chip only", () => {
  const columns = getDatabase().prepare(`PRAGMA table_info(turn_corrections)`).all().map((column) => column.name);
  assert.deepEqual(columns, ["id", "campaign_id", "turn_id", "attribution", "kind", "audit_id", "message_id", "tool", "reason", "user_id", "created_at"]);
  const all = JSON.stringify(getDatabase().prepare(`SELECT * FROM turn_corrections`).all());
  assert.ok(all.length > 2, "the suite recorded rows");
  for (const text of storyText) {
    assert.ok(!all.includes(text), `the ledger holds "${text}"`);
  }
});

await test("every writer records inside the fix's own transaction", () => {
  const root = path.join(import.meta.dirname, "..", "src");
  const writers = [
    "lib/sheet-undo.ts",
    "app/api/campaigns/[campaignId]/sheets/[sheetId]/route.ts",
    "lib/dm/narration-edit.ts",
    "app/api/campaigns/[campaignId]/disputes/[disputeId]/route.ts",
    "app/api/campaigns/[campaignId]/dm/enemy-hp/route.ts",
    "app/api/campaigns/[campaignId]/dm/initiative/route.ts",
    "lib/dm/renarrate.ts",
    "lib/dm/retry-turn.ts",
    "lib/dm/rollback.ts",
  ];
  for (const file of writers) {
    // Windows checkouts may carry CRLF.
    const text = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
    const at = text.search(/record(?:Turn|Fight|Rollback)Corrections?\(/);
    assert.ok(at > 0, `${file} records nothing`);
    const opened = text.lastIndexOf(".transaction(", at);
    assert.ok(opened >= 0, `${file} records outside a transaction`);
    assert.ok(!text.slice(opened, at).includes("})();"), `${file}'s transaction closes before the record`);
  }
});

await test("an erased account's fixes stay counted without the link to the person", () => {
  const before = ledger.listTurnCorrections();
  const theirs = before.filter((correction) => correction.userId === world.owner.id).length;
  assert.ok(theirs > 0);
  ledger.forgetCorrectionsBy(world.owner.id);
  const after = ledger.listTurnCorrections();
  assert.equal(after.length, before.length, "the counts stay");
  assert.equal(after.filter((correction) => correction.userId === world.owner.id).length, 0);
  assert.ok(fs.readFileSync(path.join(import.meta.dirname, "../src/lib/account-deletion.ts"), "utf8").includes("forgetCorrectionsBy(userId)"), "purgeAccount forgets them");
});

// Last: it closes and reopens the database.
await test("rows filed under the made-up turn \"clock\" are cleared of it once, as the database opens (issue #622)", async () => {
  const { closeDatabaseForRestore } = await import("../src/lib/db/core.ts");
  const { entry } = aiChange(world, hero, { currentHp: 5 }, { turn: { id: "clock" } });
  assert.equal(entry.turnId, "clock");
  // A database from before the fix: the pass has not run on it.
  getDatabase().prepare(`DELETE FROM app_settings WHERE key = 'audit_clock_turn_cleared'`).run();
  closeDatabaseForRestore();
  assert.equal(getDatabase().prepare(`SELECT turn_id FROM sheet_audit WHERE id = ?`).get(entry.id).turn_id, null);
  assert.equal(getDatabase().prepare(`SELECT COUNT(*) AS n FROM sheet_audit WHERE turn_id = 'clock'`).get().n, 0);
  assert.ok(getDatabase().prepare(`SELECT key FROM app_settings WHERE key = 'audit_clock_turn_cleared'`).get(), "the pass left no mark, so it runs on every start");
});

if (failed) {
  throw new Error(`correction ledger: ${failed} test(s) failed`);
}
console.log("correction ledger: all tests passed");
