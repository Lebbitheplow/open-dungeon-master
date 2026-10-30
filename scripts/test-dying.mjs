// Dropping to 0 in a fight and being brought back, in the order a table
// plays it: a goblin's hit on the DM's turn puts Kara down, the pointer
// reaching her rolls her death save and passes her by, her player is told
// it is not her turn, Bram's player heals her through the actions route and
// the DM turn it wakes, and on her next turn she rolls nothing and acts.
//
// The rules have their own suite (test-enforce-death.mjs drives
// src/lib/dm/death.ts one tool call at a time, with the pointer walked by
// hand). None ran them through the doors a table uses, in sequence, so
// nothing checked that the save is rolled at the right moment of a real
// round, that the track a heal clears stays cleared, and that the turn
// comes back to the healed character as a playable one.
//
// An SRD goblin (scimitar +4 for 1d6+2), the scripted fake model
// (scripts/lib/enforce-narrator.mjs), every die forced.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, DUMMY } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-dying");

const GOBLIN = {
  ...DUMMY,
  ac: 15,
  maxHp: 7,
  dexMod: 2,
  attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", type: "slashing" }],
  cr: 0.25,
  xp: 50,
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
};

const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { dmQueueDepth } = await import("../src/lib/dm/queue.ts");
const { getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");

async function settle(campaignId, ms = 30_000) {
  const end = Date.now() + ms;
  while (dmQueueDepth(campaignId) > 0) {
    if (Date.now() > end) {
      throw new Error("the DM queue never ran dry");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// One move through the actions route, as the composer sends it.
async function act(world, userId, content) {
  const route = await world.route("campaigns/[campaignId]/actions");
  world.signIn({ id: userId });
  const response = await route.POST(
    new Request("http://test/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  const json = await response.json().catch(() => ({}));
  await settle(world.campaignId);
  return { status: response.status, json };
}

await test("Dropped by a goblin, Kara rolls her death save as her turn comes round and is passed by; Bram's heal clears the track, and her next turn rolls nothing and is hers to play", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const model = await fakeModel();
  model.pointAt(world);
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 1, abilities: { str: 16, dex: 10, con: 14, wis: 10 } });
  const bram = world.addHero({ ...caster("cleric", "wis", ["Cure Wounds"], [], 1), name: "Bram" });
  const karaUser = world.sheet(kara.id).userId;
  const bramUser = world.sheet(bram.id).userId;
  const maxHp = world.sheet(kara.id).maxHp;
  world.patch(kara.id, { currentHp: 4 });

  // Kara, then Bram, then the goblin.
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [kara.id]: 19, [bram.id]: 15 }, enemyFace: 1 });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { ac: 15, maxHp: 7, currentHp: 7, stats: GOBLIN });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 5, 6);
  kit.place(goblin.id, 6, 5);

  const turnName = () => {
    const encounter = world.encounter();
    return encounter?.orderReady ? encounter.order[encounter.turnIndex]?.name ?? null : null;
  };
  const deathSaves = () => listRecentRolls(world.campaignId, 200).filter((roll) => /death save/.test(roll.detail ?? ""));
  const conditions = () => (world.sheet(kara.id).conditions ?? []).map((entry) => (typeof entry === "string" ? entry : entry.name).toLowerCase());

  assert.equal(turnName(), "Kara");
  assert.equal(kit.endTurn(karaUser), true, "Kara's End Turn was refused");
  assert.equal(turnName(), "Bram");
  assert.equal(kit.endTurn(bramUser), true, "Bram's End Turn was refused");
  assert.deepEqual(world.encounter().legendary.due ?? [], [goblin.id], "the goblin is not due");

  // The goblin's turn: a hit for 8 against Kara's 4. Four over is short of
  // her maximum, so she is dying, not dead. The pointer then reaches her,
  // and the server rolls her death save (a 12, a success) and passes her.
  world.dice(18, 6, 12);
  model.script([
    reply({ calls: [call("enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id })] }),
    reply({ text: "The goblin's scimitar opens Kara's side, and she drops." }),
  ]);
  await startDmTurn(world.campaignId);
  assert.equal(world.clearDice(), 0, "a forced die went unrolled on the goblin's turn");
  assert.equal(world.sheet(kara.id).currentHp, 0);
  assert.ok(conditions().includes("unconscious"), `Kara is not unconscious: ${conditions().join(", ")}`);
  assert.equal(world.sheet(kara.id).deathSaves?.dead, false, "four damage over 0 killed a hero with more hit points than that");
  assert.equal(deathSaves().length, 1, "her turn came round without a death save");
  assert.equal(world.sheet(kara.id).deathSaves?.successes, 1, "a 12 is a success");
  assert.equal(turnName(), "Bram", "the pointer stopped on a dying character");

  // Kara's player tries to act: it is Bram's turn.
  const refused = await act(world, karaUser, "I try to stand.");
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /Bram's turn/);

  // Bram's player heals her, and the DM turn resolves it: Cure Wounds, the
  // server's 1d8 on a 5 plus Bram's Wisdom of +4.
  world.dice(5);
  model.script([
    reply({ calls: [call("heal", { characterId: kara.id, spell: "Cure Wounds", casterId: bram.id, level: 1 })] }),
    reply({ text: "Bram's hand glows on Kara's wound, and her eyes open." }),
  ]);
  const healed = await act(world, bramUser, "I cast Cure Wounds on Kara.");
  assert.equal(healed.status, 202, JSON.stringify(healed.json));
  assert.equal(world.clearDice(), 0, "the healing dice went unrolled");
  assert.equal(world.sheet(kara.id).currentHp, 9);
  assert.ok(world.sheet(kara.id).currentHp <= maxHp);
  assert.ok(!conditions().includes("unconscious"), "healing left Kara unconscious");
  const track = world.sheet(kara.id).deathSaves;
  assert.ok(!track || (track.successes === 0 && track.failures === 0), `the heal left a death save track: ${JSON.stringify(track)}`);

  // Bram ends his turn; the goblin misses; the turn comes back to Kara with
  // no death save, and her move is taken. Healed from 0 she is still prone,
  // so the goblin, beside her, swings with advantage: both d20s are forced.
  assert.equal(kit.endTurn(bramUser), true);
  world.dice(2, 2);
  model.script([
    reply({ calls: [call("enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id })] }),
    reply({ text: "The goblin's swing goes wide." }),
  ]);
  await startDmTurn(world.campaignId);
  assert.equal(world.clearDice(), 0, "a forced die went unrolled on the goblin's second turn");
  assert.equal(turnName(), "Kara", "the turn did not come back to the healed hero");
  assert.equal(deathSaves().length, 1, "a healed hero rolled a death save");

  model.script([reply({ text: "Kara gets her feet under her. What do you do?" })]);
  const back = await act(world, karaUser, "I get up and raise my shield.");
  assert.equal(back.status, 202, JSON.stringify(back.json));

  model.close();
  world.close();
});

// Issue #622: the save the pointer rolls as the DM's turn hands the round
// on was written with no turn, so "Revert this turn" took back the blow that
// dropped Kara and left her death save standing.
await test("The death save the pointer rolls on the GM's turn is filed under that turn, and reverting the turn takes it back with the blow", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const model = await fakeModel();
  model.pointAt(world);
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 1, abilities: { str: 16, dex: 10, con: 14, wis: 10 } });
  const bram = world.addHero({ name: "Bram", class: "fighter", level: 1 });
  const karaUser = world.sheet(kara.id).userId;
  const bramUser = world.sheet(bram.id).userId;
  world.patch(kara.id, { currentHp: 4 });
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [kara.id]: 19, [bram.id]: 15 }, enemyFace: 1 });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { ac: 15, maxHp: 7, currentHp: 7, stats: GOBLIN });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 5, 6);
  kit.place(goblin.id, 6, 5);
  assert.equal(kit.endTurn(karaUser), true);
  assert.equal(kit.endTurn(bramUser), true);

  world.dice(18, 6, 12);
  model.script([
    reply({ calls: [call("enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id })] }),
    reply({ text: "The goblin's scimitar opens Kara's side, and she drops." }),
  ]);
  await startDmTurn(world.campaignId);
  assert.equal(world.clearDice(), 0, "a forced die went unrolled on the goblin's turn");
  assert.equal(world.sheet(kara.id).deathSaves?.successes, 1, "the pointer rolled no save");

  const turnId = getLatestDmTurnId(world.campaignId);
  const saves = listRecentAudit(world.campaignId, 50).filter((row) => row.kind === "death_state" && row.characterId === kara.id);
  assert.ok(saves.some((row) => row.reason === "automatic death save"), JSON.stringify(saves.map((row) => row.reason)));
  assert.deepEqual(saves.map((row) => row.turnId), saves.map(() => turnId), "a death save of the goblin's turn is not the goblin's turn's");

  const revert = await world.route("campaigns/[campaignId]/audit/revert-turn");
  world.signIn(world.owner);
  const response = await revert.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(world.sheet(kara.id).currentHp, 4, "the blow stayed");
  assert.equal(world.sheet(kara.id).deathSaves, null, "the death save stayed");

  model.close();
  world.close();
});

// Issue #622: what the pointer wrote to a sheet as the GM's turn handed the
// round on (a turn starting, the round wrapping) went straight to the sheet,
// so that turn's revert left it standing.
await test("Reverting the GM turn that moved the pointer puts back what the move wrote: Survivor's healing, a hold that lasted until the turn began, a round off a timed condition", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const model = await fakeModel();
  model.pointAt(world);
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 1, abilities: { str: 16, dex: 10, con: 14, wis: 10 } });
  const bram = world.addHero({
    name: "Bram",
    class: "fighter",
    subclass: "Champion",
    level: 18,
    abilities: { str: 16, dex: 10, con: 14, wis: 10 },
    features: [{ name: "Survivor", source: "class", classId: "fighter" }],
  });
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [kara.id]: 19, [bram.id]: 15 }, enemyFace: 1 });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { ac: 15, maxHp: 7, currentHp: 7, stats: GOBLIN });
  kit.place(kara.id, 5, 5);
  kit.place(bram.id, 5, 6);
  kit.place(goblin.id, 6, 5);

  // Bram at a quarter of his hit points, dodging until his next turn, and
  // blessed for ten of his own turns.
  const low = Math.floor(world.sheet(bram.id).maxHp / 4);
  world.patch(bram.id, {
    currentHp: low,
    conditions: ["dodging", "blessed"],
    conditionMeta: { dodging: { untilTurnOf: bram.id, source: bram.id }, blessed: { rounds: 10, source: bram.id } },
  });
  const before = world.sheet(bram.id);

  // Kara's player is done; the GM's turn hands the round on to Bram.
  world.say("player", "I hold my ground and end my turn.", world.sheet(kara.id));
  model.script([
    reply({ calls: [call("end_turn", { characterId: kara.id })] }),
    reply({ text: "Kara settles her stance. Bram, the goblin is yours." }),
  ]);
  await startDmTurn(world.campaignId);
  const at = world.encounter();
  assert.equal(at.order[at.turnIndex]?.name, "Bram", "the GM's turn did not hand the round on");
  const moved = world.sheet(bram.id);
  assert.ok(moved.currentHp > low, "Survivor did not heal Bram as his turn began");
  assert.ok(!moved.conditions.includes("dodging"), "the dodge outlasted the start of Bram's turn");
  assert.equal(moved.conditionMeta.blessed?.rounds, 9, "his turn did not count the blessing down");

  const turnId = getLatestDmTurnId(world.campaignId);
  const revert = await world.route("campaigns/[campaignId]/audit/revert-turn");
  world.signIn(world.owner);
  const response = await revert.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ turnId, confirm: true }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const back = world.sheet(bram.id);
  assert.equal(back.currentHp, before.currentHp, "Survivor's healing stayed");
  assert.deepEqual(back.conditions, before.conditions, "the dodge stayed ended");
  assert.deepEqual(back.conditionMeta, before.conditionMeta, "the blessing stayed counted down");

  model.close();
  world.close();
});

finish();
