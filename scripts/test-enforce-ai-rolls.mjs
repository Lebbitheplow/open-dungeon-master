// The AI DM's request_roll is the console's request_roll.
//
// The AI's turn loop (src/lib/dm/turn.ts) used to carry its own copy of the
// roll, beside the one a person reaches through the console
// (src/lib/dm/invoke-roll.ts), and the copy had drifted: it skipped the
// table's strictness and rolled for the dead. There is one function now, and
// the loop passes it the only two things that differ for a model: the tool
// call a parked roll answers, and the wording of a refusal.
//
// A whole AI turn needs a model, so what is staged here is the call the loop
// makes, with the argument the loop passes. That the loop makes that call,
// and rolls nothing itself, is read from its source.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-ai-rolls");
const { handleRequestRoll } = await import("../src/lib/dm/invoke-roll.ts");
const { createDmTurn, listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { setMemberRealDice } = await import("../src/lib/db/campaigns.ts");
const { heldRollUserIds } = await import("../src/lib/dice/held-rolls.ts");
const { listMembers } = await import("../src/lib/db/campaigns.ts");

// request_roll as the turn loop calls it for the model.
function modelRolls(world, args, toolCallId = "call_1") {
  const campaign = world.campaign();
  const turn = createDmTurn(world.campaignId, [], "ai");
  const sheets = world.sheets();
  const result = handleRequestRoll(
    campaign,
    turn,
    JSON.stringify(args),
    sheets,
    new Map(sheets.map((sheet) => [sheet.id, sheet])),
    heldRollUserIds(campaign.gameSettings.dicePolicy, listMembers(world.campaignId)),
    { toolCallId },
  );
  return { result, turn };
}

const rolls = (world) => listRecentRolls(world.campaignId, 100);

await test("the turn loop rolls through the shared request_roll and rolls nothing itself", () => {
  const source = fs.readFileSync(new URL("../src/lib/dm/turn.ts", import.meta.url), "utf8");
  assert.match(source, /handleRequestRoll\(/);
  assert.match(source, /toolCallId: rollCall\.id \?\? null/);
  for (const own of ["rollExpression(", "insertRoll(", "createPendingRoll(", "resolveRollExpression("]) {
    assert.ok(!source.includes(own), `turn.ts still calls ${own}`);
  }
});

await test("a named difficulty the model sends moves with the table's strictness; a number it sends is the number", async () => {
  for (const [strictness, dc] of [["lenient", 13], ["standard", 15], ["harsh", 17]]) {
    const world = await openWorld({ gameSettings: { gm: { strictness, tone: [] } } });
    const hero = world.addHero({ class: "fighter", abilities: { str: 14 } });
    world.dice(12);
    const named = modelRolls(world, {
      characterId: hero.id, kind: "ability_check", ability: "str", difficulty: "moderate", reason: "a door",
    }).result;
    assert.equal(world.clearDice(), 0);
    assert.equal(named.dc, dc, `${strictness}: ${JSON.stringify(named)}`);
    assert.equal(named.total, 12 + abilityMod(14));
    assert.equal(named.success, 12 + abilityMod(14) >= dc);
    world.dice(12);
    const exact = modelRolls(world, {
      characterId: hero.id, kind: "ability_check", ability: "str", dc: 15, reason: "a door",
    }).result;
    world.clearDice();
    assert.equal(exact.dc, 15, strictness);
  }
});

await test("the dead roll nothing for the model either", async () => {
  const world = await openWorld();
  const hero = world.addHero({ class: "fighter" });
  world.patch(hero.id, {
    currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  const before = rolls(world).length;
  for (const kind of ["ability_check", "saving_throw", "initiative"]) {
    world.dice(15);
    const { result } = modelRolls(world, { characterId: hero.id, kind, ability: "dex", dc: 10, reason: "x" });
    assert.equal(world.clearDice(), 1, `${kind}: a die was rolled for the dead`);
    assert.match(String(result.error), /is dead/, kind);
  }
  assert.equal(rolls(world).length, before);
});

await test("exhaustion and a condition reach the model's roll as they reach the console's", async () => {
  const world = await openWorld();
  const hero = world.addHero({ class: "fighter", abilities: { str: 14, dex: 12 } });
  world.patch(hero.id, { exhaustion: 1 });
  world.dice(17, 5);
  const tired = modelRolls(world, {
    characterId: hero.id, kind: "ability_check", ability: "str", dc: 10, reason: "a climb",
  }).result;
  assert.equal(world.clearDice(), 0, "disadvantage rolls the d20 twice");
  assert.equal(tired.total, 5 + abilityMod(14));
  const viaConsole = await (async () => {
    world.dice(17, 5);
    const out = await world.invoke("request_roll", {
      characterId: hero.id, kind: "ability_check", ability: "str", dc: 10, reason: "a climb",
    });
    world.clearDice();
    return out.result;
  })();
  assert.equal(viaConsole.total, tired.total);
  assert.equal(viaConsole.success, tired.success);

  // Paralysis fails a Dexterity save outright: no die, for either caller.
  world.patch(hero.id, { exhaustion: 0, conditions: ["paralyzed"] });
  const before = rolls(world).length;
  world.dice(20);
  const held = modelRolls(world, {
    characterId: hero.id, kind: "saving_throw", ability: "dex", dc: 10, reason: "a blast",
  }).result;
  assert.equal(world.clearDice(), 1, "a die was rolled");
  assert.equal(held.autoFailed, true, JSON.stringify(held));
  assert.equal(held.success, false);
  assert.equal(rolls(world).length, before);
});

await test("a roll parked for a player's own dice remembers the model's call, and rolls nothing", async () => {
  const world = await openWorld({ gameSettings: { dicePolicy: "real_allowed" } });
  const player = world.addUser("roller");
  const hero = world.addHero({ class: "fighter", user: player });
  setMemberRealDice(world.campaignId, player.id, true);
  const before = rolls(world).length;
  world.dice(15);
  const { result, turn } = modelRolls(world, {
    characterId: hero.id, kind: "ability_check", ability: "str", difficulty: "hard", reason: "a gate",
  }, "call_77");
  assert.equal(world.clearDice(), 1, "the server rolled a roll that was the player's");
  assert.equal(result.parked, true, JSON.stringify(result));
  assert.equal(rolls(world).length, before);
  const [pending] = listOpenPendingRolls(world.campaignId);
  assert.equal(pending.toolCallId, "call_77");
  assert.equal(pending.turnId, turn.id);
  assert.equal(pending.characterId, hero.id);
  assert.equal(pending.dc, 20);
});

await test("the model has no screen to roll behind: its rolls are the table's", async () => {
  const world = await openWorld();
  const hero = world.addHero({ class: "fighter" });
  for (const visibility of ["dm", "self", "blind"]) {
    world.dice(11);
    const { result } = modelRolls(world, {
      characterId: hero.id, kind: "ability_check", ability: "wis", dc: 10, reason: "a look", visibility,
    });
    world.clearDice();
    assert.equal(typeof result.total, "number", JSON.stringify(result));
    assert.equal(rolls(world).at(-1).visibility, "public", visibility);
  }
});

await test("in a fight the model's attack roll for a character is sent to pc_attack", async () => {
  const world = await openWorld();
  const hero = world.addHero({ class: "fighter" });
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  const before = rolls(world).length;
  world.dice(15);
  const { result } = modelRolls(world, {
    characterId: hero.id, kind: "attack", expression: "1d20+5", reason: "a swing",
  });
  assert.equal(world.clearDice(), 1);
  assert.match(String(result.error), /pc_attack/);
  assert.equal(rolls(world).length, before);
});

(await openWorld()).close();
finish();
