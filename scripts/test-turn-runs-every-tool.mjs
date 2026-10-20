// Every tool a DM turn offers the model is one the turn runs. The turn sorts
// a reply's calls into branches (src/lib/dm/turn.ts TURN_RUN_NAMES); a call
// in none of them, with narration beside it, was answered "ok" and never
// run. handle_item (issue #424) shipped that way: the DM was told a shield
// went on and nothing changed. The scripted-model check below drives that
// call through a real AI turn.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-turn-runs-every-tool");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const { dmTurnTools, TURN_RUN_NAMES } = await import("../src/lib/dm/turn.ts");

const names = (inFight) =>
  dmTurnTools(world.campaign(), inFight, true, false).map((tool) => tool.function?.name ?? tool.name);

await test("every tool offered out of a fight and in one is a call the turn runs", async () => {
  for (const inFight of [false, true]) {
    const missing = names(inFight).filter((name) => !TURN_RUN_NAMES.has(name));
    assert.deepEqual(missing, [], `${inFight ? "in a fight" : "out of a fight"}: offered but never run`);
  }
});

await test("a shield the AI DM straps on in a fight is on the sheet, and the action is spent", async () => {
  const kara = world.addHero({
    name: "Kara", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 44,
    equipment: [
      { name: "Chain Mail", qty: 1, equipped: true },
      { name: "Shield", qty: 1, equipped: false },
      { name: "Longsword", qty: 1, equipped: true },
    ],
  });
  await kit.fight(1, { heroFaces: { [kara.id]: 20 } });
  kit.place(kara.id, 2, 2);
  kit.giveTurn(kara.id);
  const model = await fakeModel();
  try {
    model.pointAt(world);
    model.script([
      reply({ text: "Kara reaches for the shield on her back.", calls: [call("handle_item", { characterId: kara.id, action: "equip", item: "Shield" })] }),
      reply({ text: "Kara straps the shield on." }),
    ]);
    await model.turn(world, "I strap my shield onto my left arm.", kara.id, kara.userId);
    const [answered] = model.requests.slice(1).flatMap((request) => model.results(request));
    assert.match(answered?.result?.applied ?? "", /puts on Shield/, JSON.stringify(answered));
    assert.equal(world.sheet(kara.id).equipment.find((item) => item.name === "Shield").equipped, true);
    assert.equal(world.encounter().turnBudget?.actionUsed, true);
  } finally {
    model.close();
  }
});

await test("a drop and a draw sent in one reply both land: the draw sees the hand the drop freed", async () => {
  await kit.endFight();
  const brann = world.addHero({
    name: "Brann", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 44,
    equipment: [
      { name: "Chain Mail", qty: 1, equipped: true },
      { name: "Shield", qty: 1, equipped: true },
      { name: "Longsword", qty: 1, equipped: true },
      { name: "Handaxe", qty: 1, equipped: false },
    ],
  });
  await kit.fight(1, { heroFaces: { [brann.id]: 20 } });
  kit.place(brann.id, 2, 2);
  kit.giveTurn(brann.id);
  const model = await fakeModel();
  try {
    model.pointAt(world);
    model.script([
      reply({
        text: "Brann lets the sword fall and reaches for the axe.",
        calls: [
          call("handle_item", { characterId: brann.id, action: "drop", item: "Longsword" }),
          call("handle_item", { characterId: brann.id, action: "equip", item: "Handaxe" }),
        ],
      }),
      reply({ text: "The axe is in his hand." }),
    ]);
    await model.turn(world, "I drop my longsword and draw my handaxe.", brann.id, brann.userId);
    const answers = model.requests.slice(1).flatMap((request) => model.results(request));
    assert.equal(answers.length, 2, JSON.stringify(answers));
    for (const answer of answers) assert.ok(answer.result?.applied, JSON.stringify(answer));
    const held = world.sheet(brann.id).equipment.filter((item) => item.equipped === true).map((item) => item.name);
    assert.deepEqual(held.sort(), ["Chain Mail", "Handaxe", "Shield"]);
  } finally {
    model.close();
  }
});

finish();
