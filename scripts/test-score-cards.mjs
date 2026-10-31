// The card scorer's own suite (issue 570): the reading of a stored turn
// (src/lib/dm/card-score-logic.ts), the mismatch diagnosis it rests on
// (intent-logic.ts callMismatch), and the fixed scenarios
// (scripts/lib/card-scenarios.mjs), each staged here so a card the Hand
// stops dealing, or the engine starts refusing, fails before a live run
// spends a model on it. A few scenarios are then played whole against a
// scripted model, so the verdicts the live scorer prints are the ones the
// turn loop earns.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { SCENARIOS, scenarioById } from "./lib/card-scenarios.mjs";
import { StageError, playScenario, stageScenario, summarize } from "./lib/card-score.mjs";

const { test, finish } = suite("test-score-cards");
const { scoreCard, scoredCalls, modelCallsIn, tallyScores } = await import("../src/lib/dm/card-score-logic.ts");
const { callMismatch, intentCorrection, DIRECT_CALL_ID_PREFIX } = await import("../src/lib/dm/intent-logic.ts");

// enforce-world is imported for its side effect (the scratch database); the
// scenarios open their own worlds.
void openWorld;

// ---- the pure reading ------------------------------------------------------

const fireBolt = (characterId, targetId) => ({
  intent: { card: "spell", spell: "Fire Bolt", slotLevel: null, targetKind: "enemy", targetId, targetName: "Goblin 1" },
  characterId,
  name: "Iris",
  resolution: "attack",
});

const assistant = (calls, content = "") => ({
  role: "assistant",
  content,
  tool_calls: calls.map(([id, name, args]) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } })),
});
const answered = (id, result) => ({ role: "tool", tool_call_id: id, content: JSON.stringify(result) });

await test("callMismatch names how a call fell short: the tool, a slot for a rolled spell, a retry, the actor, the target, the spell.", () => {
  const card = fireBolt("iris", "g1");
  assert.equal(callMismatch(card, { name: "move_token", args: {}, result: null }), "tool");
  assert.equal(callMismatch(card, { name: "use_spell_slot", args: { characterId: "iris", spell: "Fire Bolt" }, result: { ok: true } }), "slot");
  assert.equal(callMismatch(card, { name: "pc_attack", args: { characterId: "iris", targetEnemyId: "g1", spell: "Fire Bolt" }, result: { error: "x", retry: true } }), "retry");
  assert.equal(callMismatch(card, { name: "pc_attack", args: { characterId: "kara", targetEnemyId: "g1", spell: "Fire Bolt" }, result: null }), "actor");
  assert.equal(callMismatch(card, { name: "pc_attack", args: { characterId: "iris", targetEnemyId: "g2", spell: "Fire Bolt" }, result: null }), "target");
  assert.equal(callMismatch(card, { name: "pc_attack", args: { characterId: "iris", targetEnemyId: "g1", spell: "Ray of Frost" }, result: null }), "spell");
  assert.equal(callMismatch(card, { name: "pc_attack", args: { characterId: "iris", targetEnemyId: "g1", spell: "Fire Bolt" }, result: { ok: true } }), null);
  // A buff spell's slot does cast it: cast_buff sends it there itself.
  const bless = { intent: { card: "spell", spell: "Bless", slotLevel: 1 }, characterId: "sefa", name: "Sefa", resolution: "buff" };
  assert.equal(callMismatch(bless, { name: "use_spell_slot", args: { characterId: "sefa", spell: "Bless" }, result: { ok: true } }), null);
});

await test("A turn whose model called the right tool scores resolved by the model, with one model call counted per assistant message.", () => {
  const conversation = [
    { role: "system", content: "..." },
    { role: "user", content: "I cast Fire Bolt at Goblin 1." },
    assistant([["c1", "pc_attack", { characterId: "iris", targetEnemyId: "g1", spell: "Fire Bolt" }]]),
    answered("c1", { hit: true, damage: 7 }),
    assistant([], "The bolt strikes."),
  ];
  const score = scoreCard(fireBolt("iris", "g1"), conversation);
  assert.deepEqual(
    { verdict: score.verdict, path: score.path, modelCalls: score.modelCalls, corrected: score.corrected },
    { verdict: "resolved", path: "model", modelCalls: 2, corrected: false },
  );
  assert.deepEqual(score.calls, ["pc_attack"]);
});

await test("The engine's own direct call scores resolved by the engine and is not a model call.", () => {
  const id = `${DIRECT_CALL_ID_PREFIX}abc123`;
  const conversation = [
    assistant([[id, "pc_attack", { characterId: "kara", targetEnemyId: "g1", weapon: "Longsword" }]]),
    answered(id, { hit: false }),
    assistant([], "Kara's blade glances off."),
  ];
  const card = { intent: { card: "attack", weapon: "Longsword", targetKind: "enemy", targetId: "g1", targetName: "Goblin 1" }, characterId: "kara", name: "Kara", resolution: null };
  const score = scoreCard(card, conversation);
  assert.equal(score.verdict, "resolved");
  assert.equal(score.path, "engine");
  assert.equal(score.modelCalls, 1);
  assert.equal(modelCallsIn(conversation), 1);
  assert.equal(scoredCalls(conversation)[0].direct, true);
  // With the turn's own counter: two passes of the loop, one the engine's.
  assert.equal(modelCallsIn(conversation, 2), 1);
  assert.equal(scoreCard(card, conversation, { callIndex: 2 }).modelCalls, 1);
});

await test("A card the model resolved only after the corrective message scores by the correction path; the slot it spent first is the near miss.", () => {
  const conversation = [
    assistant([["c1", "use_spell_slot", { characterId: "iris", spell: "Fire Bolt" }]]),
    answered("c1", { ok: true }),
    { role: "user", content: intentCorrection(fireBolt("iris", "g1").intent, "iris", "Iris", "attack") },
    assistant([["c2", "pc_attack", { characterId: "iris", targetEnemyId: "g1", spell: "Fire Bolt" }]]),
    answered("c2", { hit: true, damage: 9 }),
    assistant([], "Flame."),
  ];
  const score = scoreCard(fireBolt("iris", "g1"), conversation);
  assert.equal(score.verdict, "resolved");
  assert.equal(score.path, "correction");
  assert.equal(score.corrected, true);
  assert.deepEqual(score.calls, ["use_spell_slot", "pc_attack"]);
});

await test("A card nothing carried out scores missed, with the ways the card's own tools fell short and none for other tools.", () => {
  const conversation = [
    assistant([
      ["c1", "pc_attack", { characterId: "iris", targetEnemyId: "g2", spell: "Fire Bolt" }],
      ["c2", "move_token", { refId: "iris" }],
    ]),
    answered("c1", { hit: true }),
    answered("c2", { ok: true }),
    assistant([], "The bolt flies at the wrong goblin."),
  ];
  const score = scoreCard(fireBolt("iris", "g1"), conversation);
  assert.equal(score.verdict, "missed");
  assert.equal(score.path, "none");
  assert.deepEqual(score.near, ["target"]);
  assert.deepEqual(scoreCard(fireBolt("iris", "g1"), [assistant([], "Prose only.")]).near, []);
});

await test("A rules refusal from the right call scores refused: the engine answered, and the refusal is what the table hears.", () => {
  const conversation = [
    assistant([["c1", "pc_attack", { characterId: "iris", targetEnemyId: "g1", spell: "Fire Bolt" }]]),
    answered("c1", { error: "Goblin 1 is out of reach.", refused: "rules" }),
  ];
  assert.equal(scoreCard(fireBolt("iris", "g1"), conversation).verdict, "refused");
  assert.deepEqual(tallyScores([{ verdict: "refused", path: "model" }, { verdict: "missed", path: "none" }]), {
    verdict: { resolved: 0, refused: 1, missed: 1 },
    path: { engine: 0, model: 1, correction: 0, none: 1 },
  });
});

// ---- every scenario stages ---------------------------------------------------
// The Hand deals the card, enabled; the engine accepts it before the post;
// the sentence and the intent are the Hand's own. A scenario that stops
// staging is a change to the Hand or the rules that the scorer must know of.

const ids = new Set();
for (const scenario of SCENARIOS) {
  await test(`scenario ${scenario.id} stages: the Hand deals "${scenario.card}" and the engine accepts it`, async () => {
    assert.ok(!ids.has(scenario.id), `the id ${scenario.id} is used twice`);
    ids.add(scenario.id);
    const staged = await stageScenario(scenario);
    assert.ok(staged.sentence.length > 5, staged.sentence);
    assert.equal(staged.intent.card, staged.card.intent.card);
    staged.world.close();
  });
}

await test("A scenario the Hand cannot deal is a StageError that names the card and what the Hand holds, not a model failure.", async () => {
  await assert.rejects(
    () => stageScenario({ id: "probe-no-such-card", group: "spell", actor: "wizard", card: "Wish", place: "ranged", aim: "enemy" }),
    (error) => error instanceof StageError && /dealt no "Wish"/.test(error.message) && /Fire Bolt/.test(error.message),
  );
});

// ---- whole plays against a scripted model ------------------------------------
// The fake model cannot see the ids a staging mints, so its calls name the
// character and the enemy by the names the table sees, which the tools
// accept (resolveSheetRef, resolveEnemyRef) and callMismatch matches
// (refMatches, by name as well as by id).

const model = await fakeModel();
const backend = { label: "scripted", pointAt: (world) => model.pointAt(world) };
const toolCalls = (request) => request.messages.flatMap((message) => (message.role === "assistant" && Array.isArray(message.tool_calls) ? message.tool_calls : []));

await test("An attack card is resolved by the engine before the model: one model call, path engine.", async () => {
  model.script([reply({ text: "Kara's longsword bites." })]);
  const result = await playScenario(scenarioById("attack-longsword"), { backend, seed: 11 });
  assert.equal(result.error, null, result.error ?? "");
  assert.equal(result.score.verdict, "resolved", JSON.stringify(result.score));
  assert.equal(result.score.path, "engine");
  assert.equal(result.score.modelCalls, 1);
  assert.equal(model.requests.length, 1);
  assert.equal(toolCalls(model.requests[0])[0].function.name, "pc_attack");
});

await test("A Dodge card takes the engine path too.", async () => {
  model.script([reply({ text: "Kara raises her shield." })]);
  const result = await playScenario(scenarioById("basic-dodge"), { backend, seed: 12 });
  assert.equal(result.score.verdict, "resolved", JSON.stringify(result.score));
  assert.equal(result.score.path, "engine");
});

// The engine resolves every complete card itself (intent-logic.ts
// directCardCall), so the model's own path is measured on a card it cannot
// take: Web laid on a square picked on the board.

await test("A laid area the model answers with a spell tool, for the caster, scores resolved by the model.", async () => {
  model.script([
    reply({ calls: [call("cast_at_enemy", { characterId: "Iris", targetEnemyId: "Goblin 1", spell: "Web", level: 2, atX: 11, atY: 5 })] }),
    reply({ text: "Sticky strands fill the ravine." }),
  ]);
  const result = await playScenario(scenarioById("spell-web-area"), { backend, seed: 13 });
  assert.equal(result.error, null, result.error ?? "");
  assert.equal(result.score.verdict, "resolved", JSON.stringify(result.score));
  assert.equal(result.score.path, "model");
  assert.equal(result.score.corrected, false);
});

await test("A laid area cast as another spell, and still not after the correction, scores missed with the spell as the near miss.", async () => {
  model.script([
    reply({ calls: [call("cast_at_enemy", { characterId: "Iris", targetEnemyId: "Goblin 1", spell: "Hold Person", level: 2 })] }),
    reply({ text: "The goblin freezes." }),
    reply({ text: "Silence." }),
  ]);
  const result = await playScenario(scenarioById("spell-web-area"), { backend, seed: 14 });
  assert.equal(result.score.verdict, "missed", JSON.stringify(result.score));
  assert.equal(result.score.corrected, true, "the turn sent the corrective message");
  assert.ok(result.score.near.includes("spell"), result.score.near.join(","));
});

await test("A laid area the model answers by spending the slot and narrating, then casts when corrected, scores resolved by the correction path.", async () => {
  // The correction goes out when a reply would end the turn with the card
  // unanswered: the slot alone, then prose, is that reply.
  model.script([
    reply({ calls: [call("use_spell_slot", { characterId: "Iris", spell: "Web", level: 2 })] }),
    reply({ text: "Iris spends the slot and the web spreads." }),
    reply({ calls: [call("cast_at_enemy", { characterId: "Iris", targetEnemyId: "Goblin 1", spell: "Web", level: 2, atX: 11, atY: 5 })] }),
    reply({ text: "Strands bind the goblin." }),
  ]);
  const result = await playScenario(scenarioById("spell-web-area"), { backend, seed: 15 });
  assert.equal(result.score.verdict, "resolved", JSON.stringify(result.score));
  assert.equal(result.score.path, "correction");
  assert.ok(result.score.near.length === 0, "a resolved card keeps no near miss");
});

await test("A laid area the model only narrates scores missed with no near miss, and the summary counts it by group.", async () => {
  model.script([reply({ text: "A web fills the ravine, or so Iris says." }), reply({ text: "Strands glisten." })]);
  const result = await playScenario(scenarioById("spell-web-area"), { backend, seed: 16 });
  assert.equal(result.score.verdict, "missed", JSON.stringify(result.score));
  assert.deepEqual(result.score.near, []);
  const summary = await summarize([result]);
  assert.equal(summary.verdict.missed, 1);
  assert.equal(summary.groups.spell.scenarios, 1);
  assert.equal(summary.narratedWhenMissed, result.narrated ? 1 : 0);
});

await test("A spell at one enemy and a healing spell on an ally are the engine's before any model call.", async () => {
  model.script([reply({ text: "The bolt lands." })]);
  const bolt = await playScenario(scenarioById("spell-fire-bolt"), { backend, seed: 17 });
  assert.equal(`${bolt.score.verdict}/${bolt.score.path}`, "resolved/engine", JSON.stringify(bolt.score));
  model.script([reply({ text: "The wound closes." })]);
  const cure = await playScenario(scenarioById("spell-cure-wounds-out-of-fight"), { backend, seed: 18 });
  assert.equal(`${cure.score.verdict}/${cure.score.path}`, "resolved/engine", JSON.stringify(cure.score));
});

model.close();
await finish();
