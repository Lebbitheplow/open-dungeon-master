// Narrator quality (issue #460): one turn_quality row per AI turn where it
// ends, the guard's outcome returned rather than only logged, the clean rule
// worked out at report time (src/lib/narrator-quality.ts), Admin's card and
// export with every id hashed and no names, and the tester report bundle
// (#515) carrying a table's rows only for the party lead or a DM.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call as toolCall, failure, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createDmTurn, getDmTurn, saveDmTurn, failStaleRunningTurns } = await import("../src/lib/db/dm-turns.ts");
const ledger = await import("../src/lib/db/turn-ledger.ts");
const quality = await import("../src/lib/narrator-quality.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const messages = await import("../src/lib/db/messages.ts");
const { haltDmTurn, haltUnbuiltTurn } = await import("../src/lib/dm/turn-halt.ts");
const { enforceEngineBoundary } = await import("../src/lib/dm/narration-guard.ts");
const { normalizeCreatureName } = await import("../src/lib/dm/engine-boundary.ts");
const { ensureOpenChapter } = await import("../src/lib/db/chapters.ts");
const { captureBoundarySnapshot } = await import("../src/lib/db/snapshots.ts");
const { performRollback } = await import("../src/lib/dm/rollback.ts");
const { buildReportBundle, chosenParts } = await import("../src/lib/report-bundle.ts");

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
const row = (turnId) => ledger.listTurnQuality().find((entry) => entry.turnId === turnId);
function post(route, params, body, method = "POST") {
  const init = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return route[method](new Request("http://localhost/api/test?export=1", init), { params: Promise.resolve(params) });
}

const storyText = [];
const story = (text) => {
  storyText.push(text);
  return text;
};

// ---- the clean rule, on plain rows ----

const base = {
  turnId: "t1",
  campaignId: "c1",
  dmMode: "ai",
  backendClass: "local",
  backend: "custom",
  model: "m",
  status: "done",
  modelCalls: 2,
  toolCalls: 1,
  refusedInvalid: 0,
  refusedRules: 0,
  refusedLimit: 0,
  guard: "quiet",
  guardKinds: [],
  durationMs: 10,
  rolledBack: false,
  createdAt: "2026-10-24T00:00:00.000Z",
};
const fix = (overrides = {}) => ({ turnId: "t1", kind: "sheet_undo", attribution: "direct", tool: "apply_damage", reason: null, userId: "u1", createdAt: "2026-10-24T00:01:00.000Z", ...overrides });

await test("a turn is clean only when it finished, nothing was refused, the guard was quiet and nobody fixed it", () => {
  assert.equal(quality.isClean(base, []), true);
  assert.equal(quality.isClean({ ...base, guard: "none" }, []), true, "nothing to read is clean");
  assert.equal(quality.isClean({ ...base, status: "failed" }, []), false);
  assert.equal(quality.isClean({ ...base, refusedInvalid: 1 }, []), false);
  assert.equal(quality.isClean({ ...base, refusedRules: 1 }, []), false);
  assert.equal(quality.isClean({ ...base, refusedLimit: 1 }, []), false, "a cap hit");
  for (const guard of ["rewritten", "kept_short", "kept_unresolved", "call_failed", "unread", "off"]) {
    assert.equal(quality.isClean({ ...base, guard }, []), false, `guard ${guard}`);
  }
  assert.equal(quality.isClean(base, [fix()]), false, "corrected");
  assert.equal(quality.isClean(base, [fix({ reason: "changed_mind" })]), true, "changed my mind never counts");
  assert.equal(quality.isClean(base, [fix({ kind: "rollback" })]), true, "a rewind is counted apart by default");
  assert.equal(quality.isClean({ ...base, rolledBack: true }, []), true);
  assert.equal(quality.isClean(base, [fix({ kind: "rollback" })], { countRollback: true }), false, "unless the rule says so");
});

await test("rates are per backend class and DM mode, never pooled, with the tools most corrected", () => {
  const rows = [
    base,
    { ...base, turnId: "t2" },
    { ...base, turnId: "t3", backendClass: "agent" },
    { ...base, turnId: "t4", dmMode: "steered", guard: "unread" },
    { ...base, turnId: "t5", rolledBack: true },
  ];
  const fixes = [
    fix({ turnId: "t1", tool: "apply_damage" }),
    fix({ turnId: "t1", tool: "apply_damage", kind: "sheet_edit" }),
    fix({ turnId: "t2", tool: "set_condition", reason: "changed_mind" }),
    fix({ turnId: "t5", kind: "rollback", tool: null }),
  ];
  const groups = quality.summarizeQuality(rows, fixes);
  assert.deepEqual(groups.map((group) => `${group.backendClass}:${group.dmMode}`), ["local:ai", "agent:ai", "local:steered"]);
  const [local] = groups;
  assert.equal(local.turns, 3);
  assert.equal(local.clean, 2, "t2's only fix was a change of mind; t5's rewind is counted apart");
  assert.equal(local.corrected, 1);
  assert.equal(local.changedMind, 1);
  assert.equal(local.rolledBack, 1);
  assert.deepEqual(local.tools, [{ tool: "apply_damage", corrections: 2 }]);
  assert.equal(groups[2].unchecked, 1);
  assert.equal(groups[2].clean, 0);
  assert.equal(quality.summarizeQuality([{ ...base, dmMode: "human" }], [])[0].correctionsCounted, false);
});

await test("hashed ids are stable and name nothing", () => {
  assert.equal(quality.hashId("abc"), quality.hashId("abc"));
  assert.notEqual(quality.hashId("abc"), quality.hashId("abd"));
  assert.match(quality.hashId("abc"), /^[0-9a-f]{16}$/);
  const [turn] = quality.exportedTurns([base], [fix()]);
  assert.equal(turn.turn, quality.hashId("t1"));
  assert.equal(turn.corrections[0].by, quality.hashId("u1"));
  assert.ok(!JSON.stringify(turn).includes('"t1"') && !JSON.stringify(turn).includes('"u1"'));
  assert.equal(turn.clean, false);
});

// ---- rows where turns end ----

const world = await openWorld({ campaign: { title: story("The Drowned Lantern") }, gameSettings: { ttsEnabled: false } });
world.signIn(world.owner);
story(world.owner.username);
const kara = world.addHero({ name: story("Kara Brightwater"), class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
const model = await fakeModel();
model.pointAt(world);

await test("a finished turn writes one row: backend, class, model, counts, and a quiet guard", async () => {
  model.script([reply({ text: story("The lantern gutters as the tide comes in under the door.") })]);
  model.claims([]);
  const message = await model.turn(world, story("I light the lantern."), kara.id);
  assert.ok(message?.dmTurnId);
  const entry = row(message.dmTurnId);
  assert.ok(entry, "the turn has a quality row");
  assert.deepEqual(
    { status: entry.status, dmMode: entry.dmMode, backendClass: entry.backendClass, backend: entry.backend, model: entry.model, guard: entry.guard },
    { status: "done", dmMode: "ai", backendClass: "local", backend: "custom", model: "fake", guard: "quiet" },
  );
  assert.ok(entry.modelCalls >= 1);
  assert.equal(quality.isClean(entry, []), true);
});

await test("a refused tool call is counted by its kind", async () => {
  model.script([
    reply({ calls: [toolCall("apply_damage", { characterId: "nobody-here", amount: "1d4", reason: "x" })] }),
    reply({ text: story("Nothing comes of it, and the water keeps rising.") }),
  ]);
  model.claims([]);
  const message = await model.turn(world, story("I wait."), kara.id);
  const entry = row(message.dmTurnId);
  assert.equal(entry.toolCalls, 1);
  assert.equal(entry.refusedInvalid + entry.refusedRules, 1, JSON.stringify(entry));
  assert.equal(quality.isClean(entry, []), false);
});

await test("a reader that fails is 'unread', not quiet", async () => {
  model.script([reply({ text: story("Kara's light finds a ledge above the waterline.") })]);
  model.claims(["not a list", "not a list", "not a list"]);
  const message = await model.turn(world, story("I look for high ground."), kara.id);
  assert.equal(row(message.dmTurnId).guard, "unread");
});

await test("with the outcome check off the guard says 'off'", async () => {
  const off = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
  const hero = off.addHero({ name: story("Bram Ashford") });
  model.pointAt(off);
  model.script([reply({ text: story("Bram waits by the gate as the rain eases.") })]);
  model.claims([]);
  const message = await model.turn(off, story("I wait at the gate."), hero.id);
  assert.equal(row(message.dmTurnId).guard, "off");
  model.pointAt(world);
});

await test("a halted turn and a swept stale turn end failed; a person's turn writes nothing", async () => {
  const halted = createDmTurn(world.campaignId, [{ role: "user", content: "x" }], "ai");
  haltDmTurn(world.campaignId, halted, "the backend fell over.");
  assert.equal(row(halted.id).status, "failed");
  const stale = createDmTurn(world.campaignId, [{ role: "user", content: "x" }], "ai");
  getDatabase().prepare(`UPDATE dm_turns SET updated_at = ? WHERE id = ?`).run("2020-01-01T00:00:00.000Z", stale.id);
  failStaleRunningTurns(world.campaignId);
  assert.equal(getDmTurn(stale.id).status, "failed");
  assert.equal(row(stale.id).status, "failed");
  assert.equal(row(stale.id).guard, "none");
  const person = createDmTurn(world.campaignId, [], "human_dm");
  person.status = "done";
  saveDmTurn(person);
  assert.equal(row(person.id), undefined);
  const running = createDmTurn(world.campaignId, [], "ai");
  saveDmTurn(running);
  assert.equal(row(running.id), undefined, "a turn still running has no row yet");
});

await test("a turn that never had a prompt stays failed when Retry closes it to start over", () => {
  const unbuilt = haltUnbuiltTurn(world.campaignId, "the backend could not be reached.");
  assert.equal(row(unbuilt.id).status, "failed");
  // What Retry does with such a row (src/lib/dm/retry-turn.ts): closed as
  // done so it is not retried twice, while a new turn makes its own row.
  const closed = getDmTurn(unbuilt.id);
  closed.status = "done";
  saveDmTurn(closed);
  assert.equal(getDmTurn(unbuilt.id).status, "done");
  assert.equal(row(unbuilt.id).status, "failed", "the model never ran on it");
});

await test("a turn whose row a rewind deleted while it ended writes no quality row", () => {
  const gone = createDmTurn(world.campaignId, [{ role: "user", content: "x" }], "ai");
  getDatabase().prepare(`DELETE FROM dm_turns WHERE id = ?`).run(gone.id);
  gone.status = "done";
  saveDmTurn(gone);
  assert.equal(row(gone.id), undefined);
});

await test("a later save without a guard keeps the outcome stored", () => {
  const turn = createDmTurn(world.campaignId, [], "ai");
  turn.status = "done";
  turn.guard = { outcome: "rewritten", kinds: ["hit"] };
  saveDmTurn(turn);
  const again = getDmTurn(turn.id);
  saveDmTurn(again);
  assert.equal(row(turn.id).guard, "rewritten");
  assert.deepEqual(row(turn.id).guardKinds, ["hit"]);
});

// ---- the guard's outcome, returned ----

await test("the guard returns what it did: rewritten, kept short, unresolved, or the call failed", async () => {
  const fightWorld = await openWorld({ gameSettings: { ttsEnabled: false } });
  const fighter = fightWorld.addHero({ name: "Kara", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1 }] });
  const kit = await combatKit(fightWorld);
  model.pointAt(fightWorld);
  await kit.fight(1, { heroFaces: { [fighter.id]: 19 } });
  const [enemy] = fightWorld.enemies();
  kit.place(fighter.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const args = { characterId: fighter.id, targetEnemyId: enemy.id, weapon: "Longsword" };
  const swing = await kit.swing(fighter.id, enemy.id, [2], args);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.hit, false);
  const conversation = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "[Kara | attempt] I swing at the goblin." },
    { role: "assistant", content: "", tool_calls: [{ id: "call-0", type: "function", function: { name: "pc_attack", arguments: JSON.stringify(args) } }] },
    { role: "tool", tool_call_id: "call-0", content: JSON.stringify(swing.result) },
  ];
  const quote = "Kara's blade bites into the goblin";
  const narration = `${quote}, and it staggers back against the wall of the flooded cellar while the lantern swings.`;
  const hit = { kind: "hit", target: normalizeCreatureName("Goblin 1", "english"), quote };
  const long = "Kara's blade whistles past the goblin, who ducks under the swing and backs towards the flooded stair, snarling, as the lantern light shakes across the water.";
  const guarded = async (rewrite, readings) => {
    const turn = createDmTurn(fightWorld.campaignId, conversation, "ai");
    turn.narrationParts = [narration];
    model.script([rewrite]);
    model.claims(readings);
    return (await enforceEngineBoundary(fightWorld.campaign(), turn, fightWorld.sheets(), new Map())).guard;
  };
  assert.deepEqual(await guarded(reply({ text: long }), [[hit], []]), { outcome: "rewritten", kinds: ["hit"] });
  assert.deepEqual(await guarded(reply({ text: "Understood." }), [[hit]]), { outcome: "kept_short", kinds: ["hit"] });
  assert.equal((await guarded(failure(500), [[hit]])).outcome, "call_failed");
  const still = { ...hit, quote: "Kara's blade whistles past the goblin" };
  assert.equal((await guarded(reply({ text: long }), [[hit], [{ ...still, kind: "hit" }]])).outcome, "kept_unresolved");
  await kit.endFight();
  model.pointAt(world);
});

// ---- a rewind keeps the rows ----

await test("a rewind marks its turns' rows rolled back and they stay", async () => {
  const table = await openWorld({ gameSettings: { ttsEnabled: false } });
  messages.insertCampaignMessage({ campaignId: table.campaignId, seq: campaigns.allocateSeq(table.campaignId), authorType: "dm", content: "The road begins." });
  ensureOpenChapter(table.campaignId);
  captureBoundarySnapshot(table.campaignId, 1, campaigns.latestSeq(table.campaignId));
  await sleep(5);
  const turn = createDmTurn(table.campaignId, [], "ai");
  turn.status = "done";
  saveDmTurn(turn);
  assert.equal(row(turn.id).rolledBack, false);
  const result = await performRollback(table.campaignId, 1, table.owner.id);
  assert.equal(result.ok, true, result.error);
  assert.equal(getDmTurn(turn.id), null);
  assert.equal(row(turn.id).rolledBack, true);
});

// ---- the report bundle (#515) ----

await test("the report bundle carries the table's rows, hashed, for the lead and never for a player", async () => {
  const route = await world.route("campaigns/[campaignId]/report-bundle");
  world.signIn(world.owner);
  const lead = await (await post(route, { campaignId: world.campaignId }, { parts: { turnTimings: true } })).json();
  assert.ok(Array.isArray(lead.narratorQuality) && lead.narratorQuality.length > 0, "the lead's bundle carries narrator quality");
  const raw = ledger.recentTurnQuality(world.campaignId, 50).map((entry) => entry.turnId);
  const text = JSON.stringify(lead.narratorQuality);
  for (const id of raw) {
    assert.ok(!text.includes(id), "a raw turn id reached the bundle's narrator quality");
  }
  assert.ok(lead.narratorQuality.every((entry) => /^[0-9a-f]{16}$/.test(entry.turn)));
  for (const words of storyText) {
    assert.ok(!text.includes(words), `the bundle's narrator quality holds "${words}"`);
  }
  assert.match(lead.readable.join("\n"), /Narrator quality for \d+ turns/);
  // Not ticked: not carried.
  const unticked = await (await post(route, { campaignId: world.campaignId }, { parts: { turnTimings: false } })).json();
  assert.equal(unticked.narratorQuality, undefined);
  // A player who is neither the lead nor a DM.
  const other = world.addHero({ name: story("Odo Vell") });
  world.signIn({ id: other.userId });
  const player = await (await post(route, { campaignId: world.campaignId }, { parts: { turnTimings: true } })).json();
  assert.equal(player.narratorQuality, undefined);
  world.signIn(world.owner);
});

await test("the bundle itself drops the rows for a viewer who is not the lead or a DM", () => {
  const viewer = { isAdmin: false, atTable: true, leadOrDm: false, steersStory: false, storytellerSecrets: false };
  const sources = { setup: { version: "x", build: "x", commit: "", platform: "p", arch: "a", node: "n", deviceWorld: false, narrator: { backend: "b", model: "m" } }, narratorQuality: quality.exportedTurns([base], []) };
  const bundle = buildReportBundle({ sources, parts: new Set(["setup", "turnTimings"]), viewer, reporterUserId: "u", secrets: [] });
  assert.equal(bundle.narratorQuality, undefined);
  const leadViewer = { ...viewer, leadOrDm: true };
  const leads = buildReportBundle({ sources, parts: chosenParts({ turnTimings: true }, leadViewer), viewer: leadViewer, reporterUserId: "u", secrets: [] });
  assert.equal(leads.narratorQuality.length, 1);
});

// ---- Admin ----

await test("Admin's card and export: admins only, per group, every id hashed, no names or story", async () => {
  const route = await world.route("admin/narrator-quality");
  world.signIn(world.owner);
  const overview = await (await route.GET(new Request("http://localhost/api/admin/narrator-quality"))).json();
  assert.ok(overview.groups.some((group) => group.backendClass === "local" && group.dmMode === "ai"));
  assert.ok(overview.turns > 0);
  const file = await (await route.GET(new Request("http://localhost/api/admin/narrator-quality?export=1"))).json();
  assert.equal(file.kind, "odm-narrator-quality");
  assert.ok(file.turns.length > 0);
  const text = JSON.stringify(file);
  for (const entry of ledger.listTurnQuality()) {
    assert.ok(!text.includes(entry.turnId) && !text.includes(entry.campaignId), "a raw id reached the export");
  }
  for (const words of storyText) {
    assert.ok(!text.includes(words), `the export holds "${words}"`);
  }
  const other = world.addUser("not-admin");
  world.signIn(other);
  assert.equal((await route.GET(new Request("http://localhost/api/admin/narrator-quality"))).status, 403);
  world.signIn(world.owner);
});

await test("turn_quality holds counts and kinds, never text", () => {
  const columns = getDatabase().prepare(`PRAGMA table_info(turn_quality)`).all().map((column) => column.name);
  assert.deepEqual(columns, [
    "turn_id", "campaign_id", "actor", "dm_mode", "backend_class", "backend", "model", "status", "model_calls", "tool_calls",
    "refused_invalid", "refused_rules", "refused_limit", "guard", "guard_kinds", "duration_ms", "rolled_back", "created_at", "updated_at",
  ]);
  const all = JSON.stringify(getDatabase().prepare(`SELECT * FROM turn_quality`).all());
  for (const words of storyText) {
    assert.ok(!all.includes(words), `turn_quality holds "${words}"`);
  }
});

model.close();
if (failed) {
  throw new Error(`narrator quality: ${failed} test(s) failed`);
}
console.log("narrator quality: all tests passed");
