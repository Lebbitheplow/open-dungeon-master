// A refused structured-scene attempt must not roll dice, spend a held effect,
// or move the scene clock. Exercise the same engine path the DM console uses.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const world = await openWorld();
const { getSceneTracker } = await import("../src/lib/db/scene-tracker.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const first = world.addHero({ name: "Brann" });
const second = world.addHero({ name: "Mira" });
const outsider = world.addHero({ name: "Tarn" });
const tracker = () => getSceneTracker(world.campaignId);
const rolls = () => listRecentRolls(world.campaignId).length;
const hold = (id) => world.patch(id, { conditions: ["bardic inspiration (d8)"], conditionMeta: {} });
const held = (id) => world.sheet(id).conditions.includes("bardic inspiration (d8)");

async function refused(id, expected) {
  hold(id);
  const before = structuredClone(tracker());
  const rollCount = rolls();
  world.diceLog();
  world.dice(20, 8);
  const result = await world.invoke("scene_check", { characterId: id, ability: "wis", dc: 10 });
  assert.equal(result.ok, false, "attempt should be refused");
  assert.match(result.error, expected);
  assert.deepEqual(tracker(), before, "refusal must not move the clock");
  assert.equal(rolls(), rollCount, "refusal must not store a roll");
  assert.deepEqual(world.diceLog(), [], "refusal must not roll dice");
  assert.equal(world.clearDice(), 2, "refusal must leave both queued dice unused");
  assert.equal(held(id), true, "refusal must not spend held inspiration");
}

try {
  const stranger = await world.invoke("start_scene", { kind: "chase", title: "Down the alley", characterIds: [first.id, "Nobody"] });
  assert.equal(stranger.ok, false, "a participant no sheet answers to is refused");
  assert.equal(tracker(), null);
  // A participant named rather than given by id is stored by id, so their
  // checks count.
  const started = await world.invoke("start_scene", {
    kind: "chase",
    title: "Down the alley",
    successesNeeded: 3,
    failuresAllowed: 3,
    characterIds: [first.id, "Mira"],
  });
  assert.equal(started.ok, true, started.error);
  assert.deepEqual(tracker().characterIds, [first.id, second.id]);
  // The model is offered the skill ids the sheet knows, as request_roll is.
  const { sceneTools } = await import("../src/lib/dm/scene-tools.ts");
  const { SRD_SKILLS } = await import("../src/lib/srd/index.ts");
  const sceneCheck = sceneTools.find((tool) => tool.function.name === "scene_check").function;
  assert.deepEqual(sceneCheck.parameters.properties.skill.enum, SRD_SKILLS.map((skill) => skill.id));

  await refused(outsider.id, /participant/i);

  world.dice(20);
  const firstCheck = await world.invoke("scene_check", { characterId: first.id, ability: "wis", dc: 10 });
  assert.equal(firstCheck.ok, true, firstCheck.error);
  world.clearDice();
  assert.equal(tracker().successes, 1);
  await refused(first.id, /round/i);

  world.dice(20);
  const secondCheck = await world.invoke("scene_check", { characterId: second.id, ability: "wis", dc: 10, endRound: true });
  assert.equal(secondCheck.ok, true, secondCheck.error);
  world.clearDice();
  assert.equal(tracker().round, 2);

  world.dice(20, 8);
  const nextRound = await world.invoke("scene_check", { characterId: first.id, ability: "wis", dc: 10 });
  assert.equal(nextRound.ok, true, nextRound.error);
  world.clearDice();
  assert.equal(tracker().status, "won");
  await refused(second.id, /structured scene is running/i);
  console.log("scene-check-participation: handler and state checks passed");
} finally {
  world.close();
}
