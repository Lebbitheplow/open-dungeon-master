// Coordinate actions (issue 254): a plan staged by several players and
// resolved as one DM beat. Nothing reaches the DM until every player's
// character is ready or passed, a player with two characters readies each,
// a companion never holds the plan up, the plan resolves once however many
// readies land, the lead can resolve it early or set it aside, a fight or a
// lapse sets it aside with what did not happen said, and a character in the
// plan cannot post a move around it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fakeModel, settleQueue } from "./lib/enforce-narrator.mjs";
import { fitSequence, joinPrevious, moveEarlier, moveLater, moveTo, normalizeSequence, ownStep } from "../src/lib/dm/plan-order.ts";
import {
  coordinationBlock,
  frozenEntries,
  humansSettled,
  lapsed,
  orderKey,
  orderPlan,
  placeWords,
  resolvedNote,
  sequenceOf,
  setAsideNote,
  stagePlan,
  stageRequest,
  unconfirmedOrder,
  withSequence,
} from "../src/lib/dm/coordination-logic.ts";

const { test, finish } = suite("test-coordination");

const entry = (overrides) => ({ name: "X", userId: "u1", companion: false, text: "", state: "waiting", requestedBy: null, updatedAt: "2026-10-11T00:00:00.000Z", ...overrides });
const phaseOf = (entries) => ({ id: "p", campaignId: "c", status: "drafting", openedBy: "u1", prompt: "", entries, createdAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z", resolvedSeq: null, outcome: "" });

await test("The rules: a player stages only their own characters, ready needs words, companions never gate.", () => {
  const phase = phaseOf([
    entry({ characterId: "a", name: "Tavi", userId: "u1" }),
    entry({ characterId: "b", name: "Brann", userId: "u2" }),
    entry({ characterId: "m", name: "Mara", userId: null, companion: true }),
  ]);
  assert.match(stagePlan(phase, { characterId: "b", userId: "u1", text: "x", state: "ready" }, "t").error, /Only Brann's player/);
  assert.match(stagePlan(phase, { characterId: "a", userId: "u1", text: "  ", state: "ready" }, "t").error, /before marking it ready/);
  assert.match(stagePlan(phase, { characterId: "m", userId: "u1", text: "x", state: "ready" }, "t").error, /AI companion/);
  const tavi = stagePlan(phase, { characterId: "a", userId: "u1", text: "While Brann talks, I slip past.", state: "ready" }, "t").phase;
  assert.equal(humansSettled(tavi), false);
  const both = stagePlan(tavi, { characterId: "b", userId: "u2", state: "pass" }, "t").phase;
  assert.equal(humansSettled(both), true, "a companion with no request does not hold the plan");
  const asked = stageRequest(both, { characterId: "m", text: "cover the exit", requestedBy: "kaleb" }, "t").phase;
  const block = coordinationBlock(asked, (id) => (id === "u1" ? "kaleb" : "dana"));
  assert.match(block, /Tavi \(kaleb\): While Brann talks, I slip past\./);
  assert.match(block, /Passed .*Brann/);
  assert.match(block, /Mara \(AI companion.*asked by kaleb to cover the exit/);
  assert.match(block, /ONE scene beat/);
  assert.equal(frozenEntries(phaseOf([entry({ characterId: "a", state: "drafting" })]))[0].state, "pass", "an unsettled player passes when resolved");
  assert.equal(lapsed({ status: "drafting", updatedAt: "2026-10-11T00:00:00.000Z" }, Date.parse("2026-10-11T03:00:00.000Z")), true);
  assert.match(setAsideNote(asked, "fight"), /A fight began.*none of it was carried out.*Tavi: While Brann talks/);
});

// Issue 292: the order a plan's characters act in.
await test("Order moves: earlier, later, together and apart, a drop, and picks that change.", () => {
  const seq = [["a"], ["b", "c"], ["d"]];
  assert.deepEqual(moveEarlier(seq, "d"), [["a"], ["d"], ["b", "c"]], "alone, the step swaps with the one above");
  assert.deepEqual(moveEarlier(seq, "c"), [["a"], ["c"], ["b"], ["d"]], "sharing, it takes a step of its own just before");
  assert.deepEqual(moveLater(seq, "b"), [["a"], ["c"], ["b"], ["d"]]);
  assert.deepEqual(moveLater(seq, "d"), seq, "the last step goes no later");
  assert.deepEqual(moveEarlier(seq, "a"), seq, "the first step goes no earlier");
  assert.deepEqual(joinPrevious(seq, "d"), [["a"], ["b", "c", "d"]]);
  assert.deepEqual(ownStep(seq, "b"), [["a"], ["c"], ["b"], ["d"]]);
  assert.deepEqual(moveTo(seq, "a", { step: 2, join: true }), [["b", "c"], ["d", "a"]], "dropped onto a step, it joins it");
  assert.deepEqual(moveTo(seq, "d", { step: 0, join: false }), [["d"], ["a"], ["b", "c"]], "dropped on a gap, it takes a step there");
  assert.deepEqual(fitSequence([["a"], ["b", "c"]], ["c", "a", "e"]), [["a"], ["c"], ["e"]], "a dropped pick leaves, a new one goes last");
  assert.deepEqual(normalizeSequence([["a"], [], ["b"]], ["a", "b"]), [["a"], ["b"]]);
  assert.equal(normalizeSequence([["a"]], ["a", "b"]), null, "a character left out");
  assert.equal(normalizeSequence([["a"], ["a", "b"]], ["a", "b"]), null, "a character twice");
  assert.equal(normalizeSequence([["a"], ["z"]], ["a"]), null, "a character not in the plan");
});

await test("An ordered plan: the steps every seat reads, the DM's block step by step, a reorder after Ready taken back.", () => {
  const plan = phaseOf([
    entry({ characterId: "t", name: "Tavi", userId: "u1" }),
    entry({ characterId: "n", name: "Nysa", userId: "u2" }),
    entry({ characterId: "b", name: "Brann", userId: "u3" }),
    entry({ characterId: "m", name: "Mara", userId: null, companion: true }),
  ]);
  assert.equal(sequenceOf(plan), null, "no order: everyone at once");
  const ordered = { ...plan, entries: withSequence(plan.entries, [["n"], ["t", "b"], ["m"]]) };
  assert.deepEqual(sequenceOf(ordered), [["n"], ["t", "b"], ["m"]]);
  assert.deepEqual(ordered.entries.map((item) => item.name), ["Nysa", "Tavi", "Brann", "Mara"], "the entries are kept in the plan's order");
  assert.equal(placeWords(ordered, "t"), "step 2 of 3, after Nysa, at the same time as Brann");
  assert.equal(placeWords(ordered, "n"), "step 1 of 3, first");

  let staged = stagePlan(ordered, { characterId: "n", userId: "u2", text: "I knock the guard's lantern over.", state: "ready", orderSeen: orderKey(ordered) }, "t").phase;
  staged = stagePlan(staged, { characterId: "t", userId: "u1", text: "In the dark, I slip through the gate.", state: "ready" }, "t").phase;
  staged = stagePlan(staged, { characterId: "b", userId: "u3", state: "pass" }, "t").phase;
  const block = coordinationBlock(staged, (id) => ({ u1: "kaleb", u2: "dana", u3: "rob" })[id]);
  assert.match(block, /COORDINATED ACTIONS IN ORDER/);
  assert.match(block, /Step 1 \(first\):\n- Nysa \(dana\): I knock the guard's lantern over\./);
  assert.match(block, /Step 2 \(after step 1, at the same time\):\n- Tavi \(kaleb\): In the dark, I slip through the gate\.\n- Brann: PASSED/);
  assert.match(block, /Step 3 \(after step 2\):\n- Mara \(AI companion\): may support the plan at this step/);
  assert.match(block, /never carry out a later step that depended on it as though it had worked/);
  assert.ok(block.indexOf("Nysa (dana)") < block.indexOf("Tavi (kaleb)"), "the DM reads the steps in order");
  assert.match(resolvedNote(staged), /The party acts in order: 1\. Nysa; 2\. Tavi and Brann together; 3\. Mara\./);
  assert.match(setAsideNote(staged, "cancelled"), /step 1, Nysa: I knock/);

  // The lead puts Tavi first: Nysa, Ready, now acts after someone, and Tavi
  // alone; both are asked again. A Ready sent for the old order is refused.
  const reordered = orderPlan(staged, [["t"], ["n"], ["b"], ["m"]], "t2").phase;
  assert.deepEqual(unconfirmedOrder(reordered), ["Tavi", "Nysa"]);
  assert.equal(reordered.entries.find((item) => item.name === "Nysa").state, "drafting");
  assert.equal(reordered.entries.find((item) => item.name === "Nysa").text, "I knock the guard's lantern over.", "the words are kept");
  assert.equal(reordered.entries.find((item) => item.name === "Brann").state, "pass", "a pass stands");
  assert.equal(humansSettled(reordered), false, "the plan cannot resolve on the old Ready");
  assert.match(stagePlan(reordered, { characterId: "n", userId: "u2", state: "ready", orderSeen: orderKey(staged) }, "t3").error, /just changed the order/);
  const confirmed = stagePlan(reordered, { characterId: "n", userId: "u2", state: "ready", orderSeen: orderKey(reordered) }, "t3").phase;
  assert.deepEqual(unconfirmedOrder(confirmed), ["Tavi"]);

  // A change that leaves a character's place alone leaves its Ready alone.
  const swapLater = orderPlan(confirmed, [["t"], ["n"], ["m"], ["b"]], "t4").phase;
  assert.equal(swapLater.entries.find((item) => item.name === "Nysa").state, "ready", "Nysa still acts after Tavi alone");
  // Clearing the order is a change too, and an unordered plan reads as before.
  const cleared = orderPlan(confirmed, null, "t5").phase;
  assert.equal(sequenceOf(cleared), null);
  assert.equal(cleared.entries.every((item) => item.step === undefined), true);
  assert.equal(cleared.entries.find((item) => item.name === "Nysa").orderChanged, true);
  assert.match(orderPlan(confirmed, [["t"], ["n"]], "t6").error, /each character in the plan once/);
});

const world = await openWorld();
// Each resolve queues a real DM turn; a scripted model answers it, so none
// reaches the default endpoint (issue 414).
const model = await fakeModel();
model.pointAt(world);
const route = await world.route("campaigns/[campaignId]/coordination");
const actions = await world.route("campaigns/[campaignId]/actions");
const { countMessages, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { coordinationForPrompt, currentCoordination } = await import("../src/lib/dm/coordination.ts");

const tavi = world.addHero({ name: "Tavi", class: "rogue", level: 3 });
const brann = world.addHero({ name: "Brann", class: "fighter", level: 3 });
// A second character for Brann's player, and an AI companion.
const pip = world.addHero({ name: "Pip", class: "bard", level: 3, user: { id: brann.userId } });
const mara = world.addHero({ name: "Mara", class: "cleric", level: 3 });
getDatabase().prepare(`UPDATE character_sheets SET is_companion = 1 WHERE id = ?`).run(mara.id);

const userById = (id) => ({ id, username: id === world.owner.id ? world.owner.username : "dana" });
async function post(user, body) {
  world.signIn(user);
  const response = await route.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}
async function act(user, characterId, content, kind = "do") {
  world.signIn(user);
  const response = await actions.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, characterId, content }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

await test("Only whoever steers the story opens a plan; the whole party joins when none are named.", async () => {
  const refused = await post(userById(brann.userId), { action: "open" });
  assert.equal(refused.status, 403);
  const opened = await post(world.owner, { action: "open", prompt: "Getting past the gate guard" });
  assert.equal(opened.status, 200, opened.json.error);
  assert.deepEqual(opened.json.phase.entries.map((entry) => entry.name).sort(), ["Brann", "Mara", "Pip", "Tavi"]);
  assert.equal(opened.json.phase.entries.find((entry) => entry.name === "Mara").companion, true);
  assert.equal((await post(world.owner, { action: "open" })).status, 409, "one plan at a time");
});

await test("A character in the plan cannot post a move around it; table talk is free.", async () => {
  const held = await act(world.owner, tavi.id, "I run for the gate.");
  assert.equal(held.status, 409);
  assert.equal(held.json.coordinating, true);
  assert.equal((await act(world.owner, tavi.id, "brb, coffee", "ooc")).status, 202);
});

await test("Nothing reaches the DM until every player's character is ready; drafts can change.", async () => {
  const before = countMessages(world.campaignId);
  let staged = await post(world.owner, { action: "plan", characterId: tavi.id, text: "While Brann distracts the guard, I slip past to the gate.", state: "ready" });
  assert.equal(staged.status, 200, staged.json.error);
  staged = await post(world.owner, { action: "plan", characterId: tavi.id, state: "drafting" });
  assert.equal(staged.json.phase.entries.find((entry) => entry.characterId === tavi.id).state, "drafting", "Change reopens it");
  staged = await post(world.owner, { action: "plan", characterId: tavi.id, text: "While Brann distracts the guard, I slip past to the side door.", state: "ready" });
  staged = await post(userById(brann.userId), { action: "plan", characterId: brann.id, text: "I tell the guard a long story about my cousin's goat.", state: "ready" });
  assert.equal(staged.json.phase.status, "drafting", "Pip's player has not readied Pip yet");
  assert.equal(countMessages(world.campaignId), before, "nothing posted while the plan drafts");
  staged = await post(world.owner, { action: "request", characterId: mara.id, text: "watch the road behind us" });
  assert.equal(staged.json.phase.status, "drafting", "the companion request did not resolve the plan");
  const resolved = await post(userById(brann.userId), { action: "plan", characterId: pip.id, state: "pass" });
  assert.equal(resolved.json.phase.status, "resolved");
  assert.equal(currentCoordination(world.campaignId), null);
  const posted = listRecentMessages(world.campaignId, 5);
  assert.ok(posted.some((message) => message.characterId === tavi.id && /side door/.test(message.content)), "Tavi's final draft was not posted");
  assert.ok(posted.some((message) => message.characterId === brann.id && /goat/.test(message.content)));
  assert.ok(!posted.some((message) => message.characterId === pip.id), "a pass posts nothing");
  assert.ok(posted.some((message) => message.authorType === "system" && /acts together/.test(message.content) && /asked Mara to watch the road behind us/.test(message.content)));
  const block = coordinationForPrompt(world.campaignId);
  assert.match(block, /Tavi .*side door/);
  assert.match(block, /Mara \(AI companion/);
  assert.match(block, /Passed .*Pip/);
});

await test("The plan resolves once: a late ready and a lead's resolve replay nothing.", async () => {
  const count = countMessages(world.campaignId);
  const late = await post(world.owner, { action: "plan", characterId: tavi.id, text: "again", state: "ready" });
  assert.equal(late.status, 409);
  assert.equal((await post(world.owner, { action: "resolve" })).status, 409);
  assert.equal(countMessages(world.campaignId), count);
});

await test("Once the DM narrates past it, the plan leaves the prompt.", async () => {
  world.say("dm", "The guard laughs at the goat story as Tavi slips through the side door.");
  assert.equal(coordinationForPrompt(world.campaignId), null);
});

await test("The lead resolves early with the missing passed, or sets the plan aside.", async () => {
  await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id] });
  await post(world.owner, { action: "plan", characterId: tavi.id, text: "I check the lock.", state: "ready" });
  const early = await post(world.owner, { action: "resolve" });
  assert.equal(early.json.phase.status, "resolved");
  assert.match(coordinationForPrompt(world.campaignId), /Passed .*Brann/);
  world.say("dm", "The lock is old.");
  await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id] });
  await post(world.owner, { action: "plan", characterId: tavi.id, text: "I wait.", state: "ready" });
  const cancelled = await post(world.owner, { action: "cancel" });
  assert.equal(cancelled.json.phase.status, "cancelled");
  assert.match(listRecentMessages(world.campaignId, 1)[0].content, /set the party's coordinated plan aside/);
  assert.equal((await act(world.owner, tavi.id, "I walk on.")).status, 202, "the table plays on as before");
});

await test("The lead sets the order at the start: every seat reads it, a reload keeps it, and the lines post in it.", async () => {
  world.say("dm", "The gate is quiet.");
  const refused = await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id], sequence: [[brann.id]] });
  assert.equal(refused.status, 400, "an order that leaves a character out");
  const opened = await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id, mara.id], sequence: [[brann.id], [tavi.id, mara.id]] });
  assert.equal(opened.status, 200, opened.json.error);
  assert.deepEqual(opened.json.phase.entries.map((item) => [item.name, item.step]), [["Brann", 1], ["Tavi", 2], ["Mara", 2]]);
  // What a reload or a seat joining late reads is the same order.
  const fresh = await route.GET(new Request("http://test/"), { params: Promise.resolve({ campaignId: world.campaignId }) });
  assert.deepEqual((await fresh.json()).phase.entries.map((item) => [item.name, item.step]), [["Brann", 1], ["Tavi", 2], ["Mara", 2]]);
  assert.equal((await post(userById(brann.userId), { action: "order", sequence: null })).status, 403, "only the lead sets the order");

  // Tavi readies first; the order stays Brann's step then Tavi's, never the
  // order the players readied in.
  const before = countMessages(world.campaignId);
  await post(world.owner, { action: "plan", characterId: tavi.id, text: "I slip through the gate once the guard turns.", state: "ready" });
  const done = await post(userById(brann.userId), { action: "plan", characterId: brann.id, text: "I ask the guard about the road north.", state: "ready" });
  assert.equal(done.json.phase.status, "resolved");
  const posted = listRecentMessages(world.campaignId, countMessages(world.campaignId) - before);
  const brannAt = posted.findIndex((message) => message.characterId === brann.id);
  const taviAt = posted.findIndex((message) => message.characterId === tavi.id);
  assert.ok(brannAt >= 0 && taviAt > brannAt, "Brann's line, step 1, posts before Tavi's");
  assert.ok(posted.some((message) => message.authorType === "system" && /acts in order: 1\. Brann; 2\. Tavi and Mara together/.test(message.content)));
  const block = coordinationForPrompt(world.campaignId);
  assert.match(block, /Step 1 \(first\):\n- Brann .*road north/);
  assert.match(block, /Step 2 \(after step 1, at the same time\):\n- Tavi .*guard turns/);
  world.say("dm", "The guard points north as Tavi slips by.");
});

await test("A reorder after Ready: the player is told, the lead cannot resolve over them, and their new Ready resolves it.", async () => {
  await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id] });
  const staged = await post(userById(brann.userId), { action: "plan", characterId: brann.id, text: "I climb the wall.", state: "ready" });
  assert.equal(staged.json.phase.entries.find((item) => item.characterId === brann.id).state, "ready");
  const ordered = await post(world.owner, { action: "order", sequence: [[tavi.id], [brann.id]] });
  assert.equal(ordered.status, 200, ordered.json.error);
  const brannEntry = ordered.json.phase.entries.find((item) => item.characterId === brann.id);
  assert.equal(brannEntry.state, "drafting");
  assert.equal(brannEntry.orderChanged, true);
  const early = await post(world.owner, { action: "resolve" });
  assert.equal(early.status, 409);
  assert.match(early.json.error, /order changed after Brann was ready/);
  await post(world.owner, { action: "plan", characterId: tavi.id, text: "I hold the rope.", state: "ready" });
  assert.equal(currentCoordination(world.campaignId).status, "drafting", "Brann's new Ready is still owed");
  const stale = await post(userById(brann.userId), { action: "plan", characterId: brann.id, state: "ready", orderSeen: JSON.stringify(null) });
  assert.equal(stale.status, 400, "a Ready sent for the plan with no order");
  const again = await post(userById(brann.userId), { action: "plan", characterId: brann.id, state: "ready", orderSeen: JSON.stringify([[tavi.id], [brann.id]]) });
  assert.equal(again.json.phase.status, "resolved");
  assert.match(coordinationForPrompt(world.campaignId), /Step 1 \(first\):\n- Tavi .*rope\.\nStep 2 \(after step 1\):\n- Brann .*climb the wall/);
  world.say("dm", "Brann climbs as Tavi holds the rope.");
});

await test("A fight that begins sets an unresolved plan aside, saying what did not happen.", async () => {
  await post(world.owner, { action: "open", characterIds: [tavi.id, brann.id] });
  await post(world.owner, { action: "plan", characterId: tavi.id, text: "I pick the lock.", state: "ready" });
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  assert.equal(currentCoordination(world.campaignId), null);
  assert.match(listRecentMessages(world.campaignId, 3).map((message) => message.content).join(" "), /A fight began.*Tavi: I pick the lock/);
  assert.equal((await post(world.owner, { action: "open" })).status, 409, "no plan while initiative runs");
});

await test("Each resolve's DM turn went to the scripted model and ended before the file did.", async () => {
  await settleQueue(world.campaignId);
  assert.ok(model.requests.length > 0, "the resolves' turns reached the fake model");
});

model.close();
world.close();
finish();
