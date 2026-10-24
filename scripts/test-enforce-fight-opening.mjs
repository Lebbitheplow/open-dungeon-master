// The opening of a fight, where the story and the engine used to part ways
// (issue 91): the narration landed "Hit! 8 damage." on a character before
// any fight existed, the sheet stayed at full hit points, the board opened
// with the enemy across the field from a blow struck at arm's length, and
// Ask the DM had neither the hit points nor the dice to answer from.
//   - a damage or healing figure in prose that no tool rolled this turn is
//     held back once and the model is sent to the tool that resolves it
//     (src/lib/dm/engine-boundary.ts unrolledFigure, over what the claims
//     reader found in the prose);
//   - a figure the turn's tools rolled, or one already on the table (a
//     table note, an earlier line), is left alone;
//   - start_encounter takes distanceFeet, and the board opens with the
//     nearest enemy that far from the party;
//   - Ask the DM reads the party's hit points and the recent dice as the
//     server holds them;
//   - the after-fight card counts the blow that ended the fight (it read
//     "0 dealt, 1 slain").
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine, call, fakeModel, reply } from "./lib/enforce-narrator.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-fight-opening");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const { normalizeCreatureName, resolveOutcomes, ruleClaims, unrolledBlow, unrolledFigure, unrolledDamagePrompt } = await import("../src/lib/dm/engine-boundary.ts");
const { THIS_MOMENT_HEADING } = await import("../src/lib/prompt-boundary.ts");
const { getBattleMapForEncounter, listTokens } = await import("../src/lib/db/battle-maps.ts");
const { runAsk } = await import("../src/lib/dm/ask.ts");

const alden = world.addHero({
  name: "Alden Veyr", class: "fighter", level: 1, maxHp: 10, abilities: { str: 16 }, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1 }],
});

const model = await fakeModel();
model.pointAt(world);

const BLAST = "The Resonance Weaver attacks Alden Veyr with Resonance Blast. Hit! 8 damage.";
const userLines = (request) => request.messages.filter((message) => message.role === "user").map((message) => message.content);

// ---- the matcher ----

// What the claims reader returns for the blast: one figure, stated as fact.
// Dice notation, speech and a hedge are no claim at all (the reader's job,
// measured against a real model), so they reach this check as nothing.
const EIGHT = { kind: "amount", value: 8, of: "damage", quote: "8 damage." };

await test("A damage figure no tool rolled is found; no claim, or a figure already on the table, is not.", () => {
  const input = [{ role: "system", content: "Alden Veyr HP 10/10, AC 8" }, { role: "user", content: "[Alden Veyr | attempt] I step into the chamber." }];
  assert.equal(unrolledFigure([EIGHT], input, "english"), "8 damage.");
  assert.equal(unrolledFigure([], input, "english"), null);
  const noted = [...input, { role: "user", content: "[Table note] The spikes deal 8 piercing damage to Alden Veyr." }];
  assert.equal(unrolledFigure([EIGHT], noted, "english"), null);
  // A chat model reads the game state's turn-to-turn part as a user message; its numbers are still no table note.
  const moment = [...input, { role: "user", content: `${THIS_MOMENT_HEADING}\nRecent rolls:\n- Alden Veyr: damage rolled 8\n\n=== END GAME STATE ===` }];
  assert.equal(unrolledFigure([EIGHT], moment, "english"), "8 damage.");
});

// In a fight, a hit or a miss on an enemy no tool touched this turn was
// resolved by the prose alone; one the turn did touch (an area's save, a
// swing) is the guard's to check against what it rolled.
await test("A blow on a live enemy no tool touched is found, numbered twins included; a touched one, or no fight, is not.", () => {
  const live = { enemies: [{ id: "e1", name: "Bandit 1", hp: 11, maxHp: 11, status: "alive" }, { id: "e2", name: "Bandit 2", hp: 11, maxHp: 11, status: "alive" }] };
  const target = normalizeCreatureName("Bandit 1", "english");
  const hit = { kind: "hit", target, quote: "your shortsword finds its mark in his ribs" };
  const untouched = resolveOutcomes([], live, "english");
  assert.equal(unrolledBlow([hit], untouched), hit.quote);
  assert.match(ruleClaims([hit], untouched)[0]?.detail ?? "", /no attack on Bandit 1 was rolled this turn/);
  // An area spell's row names the bandit: its save was rolled.
  const area = resolveOutcomes([{ name: "aoe_damage", arguments: "{}", result: { results: [{ target: "Bandit 1", hp: "4/11" }] } }], live, "english");
  assert.equal(unrolledBlow([hit], area), null);
  assert.deepEqual(ruleClaims([hit], area), []);
  assert.equal(unrolledBlow([hit], resolveOutcomes([], null, "english")), null, "no fight runs");
  // Bandit 1 and Bandit 2 key alike: with neither touched, a blow on either was unrolled.
  const swungAtTwo = resolveOutcomes([{ name: "pc_attack", arguments: "{}", result: { hit: true, target: "Bandit 2", targetHp: "5/11" } }], live, "english");
  assert.equal(unrolledBlow([hit], swungAtTwo), null, "a swing at Bandit 2 may be the one the prose means");
});

// ---- the turn loop ----

await test("An attack written in prose before any fight exists is held back: the model is sent to the tools, and the table never reads the blow that did not land.", async () => {
  const start = call("start_encounter", { enemies: [{ monster: "goblin", name: "Resonance Weaver" }] });
  model.script([
    reply({ text: BLAST }),
    reply({ calls: [start] }),
    reply({ text: "The Resonance Weaver unfolds from the dark, humming, ten feet from Alden." }),
  ]);
  model.claims([[EIGHT]]);
  const dm = await model.turn(world, "I step into the chamber.", alden.id, alden.userId);
  assert.ok(userLines(model.requests[1]).includes(unrolledDamagePrompt("8 damage.")), "the model was not sent back to the tools");
  assert.ok(dm, "the turn wrote no narration");
  assert.ok(!dm.content.includes("8 damage"), `the unrolled blow reached the table: ${dm.content}`);
  assert.equal(world.sheet(alden.id).currentHp, 10);
  assert.equal(world.enemies().length, 1, "no fight was started behind the correction");
});

await test("One correction, never a loop: a model that writes the blow again keeps its text.", async () => {
  await kit.endFight();
  model.script([reply({ text: BLAST }), reply({ text: BLAST })]);
  model.claims([[EIGHT], [EIGHT]]);
  const dm = await model.turn(world, "I look around.", alden.id, alden.userId);
  assert.equal(model.served(), 2);
  assert.ok(dm.content.includes("8 damage"));
});

await test("A call for initiative with no fight running starts the fight, whichever claim the reader made of it, and rolls nothing for a fight that does not exist.", async () => {
  await kit.endFight();
  const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
  const rolled = () => listRecentRolls(world.campaignId, 500).length;
  const before = rolled();
  const announce = "Steel rings as the cultists throw back their hoods. Roll initiative!";
  model.script([reply({ text: announce }), reply({ text: "The hooded figures melt back into the crowd." })]);
  model.claims([[{ kind: "roll_ask", character: "all", check: "initiative", quote: "Roll initiative!" }]]);
  const dm = await model.turn(world, "I push through the market crowd.", alden.id, alden.userId);
  assert.match(String(userLines(model.requests[1]).at(-1)), /start_encounter/, "the call for initiative was not sent back to start_encounter");
  assert.equal(rolled(), before, "initiative was rolled for a fight that did not exist");
  assert.ok(!dm.content.includes("Roll initiative"), dm.content);
});

await test("A figure the turn's own tool rolled is the truth and is narrated as it stands.", async () => {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [alden.id]: 20 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(alden.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const swing = call("pc_attack", { characterId: alden.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  model.script([reply({ calls: [swing] }), reply({ text: "Alden's longsword bites: 7 damage." })]);
  world.dice(15, 4);
  const dm = await model.turn(world, "I swing at it.", alden.id, alden.userId);
  world.clearDice();
  assert.equal(model.results(model.requests[1])[0].result.damage, 7);
  assert.equal(model.served(), 2, "a true figure cost a correction");
  assert.ok(dm.content.includes("7 damage"));
  await kit.endFight();
});

await test("A figure a table note already carries is not sent back: the server dealt it.", async () => {
  world.say("system", "The spikes deal 8 piercing damage to Alden Veyr.");
  model.script([reply({ text: "The spikes punch through Alden's boot: 8 damage." })]);
  model.claims([[EIGHT]]);
  const dm = await model.turn(world, "I pull my foot free.", alden.id, alden.userId);
  assert.equal(model.served(), 1);
  assert.ok(dm.content.includes("8 damage"));
});

// A fight begun mid-turn changes nothing the call after it needs when a
// player is up and no enemy is due: it narrates the opening and stops. A new
// tool list there made the server read the whole prompt again (93 seconds on
// 2026-10-23); enemies who win initiative still get enemy_attack at once.
await test("A fight begun mid-turn with the player up keeps the turn's tool list for the narration after it; enemies who act first get the fight's tools.", async () => {
  await kit.endFight();
  const names = (request) => (request.tools ?? []).map((tool) => tool.function?.name);
  const start = () => call("start_encounter", { enemies: [{ monster: "goblin", name: "Rafter Goblin" }] });
  // The goblin's initiative rolls at spawn, then Alden's: Alden goes first.
  world.dice(1, 20);
  model.script([reply({ calls: [start()] }), reply({ text: "A goblin drops from the rafters, blade out." })]);
  await model.turn(world, "I step into the barn.", alden.id, alden.userId);
  world.clearDice();
  assert.equal(world.enemies().length, 1, "no fight started");
  assert.deepEqual(names(model.requests[1]), names(model.requests[0]), "the narration after the start was sent another tool list");
  await kit.endFight();

  // The goblin is quicker: the call after the start plays it.
  world.dice(20, 1);
  model.script([reply({ calls: [start()] }), reply({ text: "The goblin is on Alden before he can draw." })]);
  await model.turn(world, "I step into the barn.", alden.id, alden.userId);
  world.clearDice();
  assert.ok(!names(model.requests[0]).includes("enemy_attack"), "the turn began in a fight");
  assert.ok(names(model.requests[1]).includes("enemy_attack"), "an enemy who acts first was not offered enemy_attack");
  await kit.endFight();
});

// The turn after a fight begins starts with the fight's rules and tools, a
// first message the narrator has not read: it is sent ahead as the turn
// ends (src/lib/dm/turn-warmup.ts), and the next turn starts with exactly it.
await test("After a turn that starts a fight, the next turn's first message and tools are sent ahead, once, and the next turn starts with exactly them.", async () => {
  await kit.endFight();
  process.env.DM_TURN_WARMUP = "1";
  try {
    world.dice(1, 20);
    model.script([
      reply({ calls: [call("start_encounter", { enemies: [{ monster: "goblin", name: "Hayloft Goblin" }] })] }),
      reply({ text: "A goblin bursts out of the hay, snarling." }),
    ]);
    await model.turn(world, "I step into the barn.", alden.id, alden.userId);
    world.clearDice();
    const until = Date.now() + 10_000;
    while ((model.requests.length < 3 || globalThis.__odmTurnWarmups?.size) && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(model.requests.length, 3, "no warm-up, or more than one");
    const warm = model.requests[2];
    assert.ok(warm.max_tokens <= 16, `the warm-up asked for ${warm.max_tokens} tokens; it needs none`);
    assert.equal(warm.messages.length, 2);
    assert.notEqual(warm.messages[0].content, model.requests[0].messages[0].content, "the warm-up re-sent what the narrator already held");
    assert.ok(warm.tools.some((tool) => tool.function.name === "enemy_attack"), "the warm-up was not the fight's tool list");

    model.script([reply({ text: "Alden keeps the goblin at sword's length." })]);
    await model.turn(world, "I hold my ground.", alden.id, alden.userId);
    assert.equal(model.requests[0].messages[0].content, warm.messages[0].content, "the next turn's first message is not the one sent ahead");
    assert.deepEqual(model.requests[0].tools, warm.tools, "the next turn's tools are not the ones sent ahead");
    // Nothing changed this turn: nothing more is sent ahead.
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(model.requests.length, 1, "a warm-up went out with nothing to read ahead");
  } finally {
    process.env.DM_TURN_WARMUP = "0";
    await kit.endFight();
  }
});

// A warm-up never holds play up: any table's turn on the same narrator stops
// it at once (two long prompts do not fit a two-slot server's one cache), and
// a turn whose first message turned out different stops it too.
await test("A warm-up gives way to any turn on the same narrator, and a turn with another first message stops it.", async () => {
  const http = await import("node:http");
  const campaigns = await import("../src/lib/db/campaigns.ts");
  const { asInteractive } = await import("../src/lib/dm/inference-gate.ts");
  const { storyRouteKey } = await import("../src/lib/dm/model.ts");
  const { settleTurnWarmup, warmNextTurn } = await import("../src/lib/dm/turn-warmup.ts");
  // A narrator that reads forever: each request stays open until the client lets go.
  const hung = [];
  const server = http.createServer((req, res) => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const entry = { closed: false };
    hung.push(entry);
    res.on("close", () => {
      entry.closed = true;
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const before = world.campaign().settings;
  campaigns.updateStorySettings(world.campaignId, { customBaseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const waitFor = async (check, what) => {
    const until = Date.now() + 5_000;
    while (!check()) {
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const tool = (name) => ({ type: "function", function: { name, description: name, parameters: { type: "object", properties: {} } } });
  process.env.DM_TURN_WARMUP = "1";
  try {
    warmNextTurn(world.campaignId, { tools: [tool("look")], thinking: true, wordsDecide: false });
    await waitFor(() => hung.length === 1, "the warm-up to reach the narrator");
    // Another table's turn calls the same narrator.
    await asInteractive(storyRouteKey(world.campaign().settings), () => new Promise((resolve) => setTimeout(resolve, 400)));
    await waitFor(() => hung[0].closed && !globalThis.__odmTurnWarmups.size, "the warm-up to give way");

    warmNextTurn(world.campaignId, { tools: [tool("listen")], thinking: true, wordsDecide: false });
    await waitFor(() => hung.length === 2, "the second warm-up to reach the narrator");
    await settleTurnWarmup(world.campaignId, "a first message the warm-up is not reading");
    await waitFor(() => hung[1].closed && !globalThis.__odmTurnWarmups.size, "the turn to stop a warm-up of another first message");

    // A compact or short-rules table sends nothing ahead.
    warmNextTurn(world.campaignId, { tools: [tool("smell")], thinking: true, wordsDecide: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(hung.length, 2, "a table whose tools follow the players' words was warmed");
  } finally {
    process.env.DM_TURN_WARMUP = "0";
    campaigns.updateStorySettings(world.campaignId, { customBaseUrl: before.customBaseUrl });
    server.close();
  }
});

// ---- where the fight opens ----

// A party of three against three, at a console (nothing plays the enemies
// forward before the board is read).
const field = await openWorld({ gameSettings: { ttsEnabled: false } });
const fieldKit = await combatKit(field);
for (const name of ["Kara", "Brom", "Sage"]) {
  field.addHero({ name, class: "fighter", level: 5, maxHp: 44, abilities: { str: 16 }, proficiencies: TRAINED });
}
const nearest = () => {
  const tokens = listTokens(getBattleMapForEncounter(field.encounter().id).id);
  const heroes = tokens.filter((token) => token.kind === "pc");
  return Math.min(
    ...tokens
      .filter((token) => token.kind === "enemy")
      .flatMap((enemy) => heroes.map((hero) => Math.max(Math.abs(hero.x - enemy.x), Math.abs(hero.y - enemy.y)))),
  );
};
const open = async (args) => {
  await fieldKit.endFight();
  const started = await field.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 3 }], ...args });
  assert.equal(started.ok, true, started.error);
  return nearest();
};

await test("start_encounter's distanceFeet sets how far the nearest enemy stands, on every board; without it an ambush opens 30 feet apart and anything else across the field.", async () => {
  for (const [feet, tiles] of [[5, 1], [10, 2], [30, 6]]) {
    for (let round = 0; round < 8; round += 1) {
      assert.equal(await open({ distanceFeet: feet }), tiles, `${feet} feet`);
    }
  }
  const apart = [];
  for (let round = 0; round < 8; round += 1) {
    apart.push(await open({}));
  }
  assert.ok(Math.max(...apart) >= 8, `the sides never opened across the field: ${apart.join(", ")}`);
  // An ambush struck from close by: one move puts a melee fighter beside the
  // nearest enemy, unless the story said how far.
  for (let round = 0; round < 4; round += 1) {
    assert.equal(await open({ ambush: "enemies" }), 6, "an ambush opened across the field");
    assert.equal(await open({ surprised: "party" }), 6, "a surprise opened across the field");
  }
  assert.equal(await open({ ambush: "party", distanceFeet: 60 }), 12, "the story's distance gave way to the ambush's");
  // A value that is no distance at all (a weak tool caller's null or "")
  // is the same as none given, never a reason to refuse the fight.
  const ai = await aiEngine(field);
  for (const sent of [null, ""]) {
    await fieldKit.endFight();
    const started = await ai.invoke("start_encounter", { enemies: [{ monster: "goblin" }], distanceFeet: sent });
    assert.equal(started.ok, true, started.error);
  }
  await fieldKit.endFight();
});

// ---- Ask the DM ----

await test("Ask the DM reads the hit points and the dice as the server holds them, whatever the narration said.", async () => {
  await kit.fight(1, { heroFaces: { [alden.id]: 20 } });
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(alden.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  const swing = await kit.swing(alden.id, enemy.id, [15, 4], { characterId: alden.id, targetEnemyId: enemy.id, weapon: "Longsword" });
  assert.equal(swing.ok, true, swing.error);
  world.say("dm", BLAST);
  model.script([reply({ text: JSON.stringify({ answer: "Alden is at 10 of 10.", citations: [] }) })]);
  const answer = await runAsk({ campaignId: world.campaignId, userId: alden.userId, question: "How much damage has Alden taken?", scope: "story" });
  assert.equal(answer.answer, "Alden is at 10 of 10.", JSON.stringify(answer));
  const [request] = model.requests;
  const record = userLines(request).at(-1);
  assert.match(record, /\[vitals\] Alden Veyr: 10\/10 hit points/);
  assert.match(record, /\[roll:[^\]]+\] Alden Veyr: damage[^\n]* = 7/);
  assert.match(request.messages[0].content, /\[vitals\] and \[roll\] lines/);
  await kit.endFight();
});

// ---- the after-fight card ----

const { getLatestEndedEncounter } = await import("../src/lib/db/encounters.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const card = () =>
  JSON.parse(getDatabase().prepare("SELECT summary_json AS card FROM encounters WHERE id = ?").get(getLatestEndedEncounter(world.campaignId).id).card);

await test("The blow that ends the fight is damage dealt: a weapon's is on its wielder's line, and a weapon's, a spell's and a hazard's all show in the card's total beside the kill.", async () => {
  const mage = world.addHero({ name: "Mira", level: 1, proficiencies: TRAINED, ...caster("wizard", "int", ["Magic Missile"]) });
  const kills = [
    ["a weapon", alden, (enemy) => kit.swing(alden.id, enemy.id, [15, 4], { characterId: alden.id, targetEnemyId: enemy.id, weapon: "Longsword" }), 7, true],
    // A spell's card shows its dice as rolled, not what a save let through,
    // so it is on nobody's line; the total still counts what the enemy lost.
    ["a spell", mage, (enemy) => world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: enemy.id, spell: "Magic Missile", level: 1 }), 3, false],
    ["a hazard", null, (enemy) => world.invoke("damage_enemy", { enemyId: enemy.id, amount: 9, source: "hazard", type: "bludgeoning" }), 3, false],
  ];
  for (const [label, hero, kill, least, credited] of kills) {
    await kit.endFight();
    await kit.fight(1, { heroFaces: { [alden.id]: 20, [mage.id]: 19 } });
    const [enemy] = world.enemies();
    kit.setEnemy(enemy.id, { maxHp: 3, currentHp: 3 });
    kit.place(alden.id, 5, 5);
    kit.place(mage.id, 4, 5);
    kit.place(enemy.id, 5, 6);
    if (hero && hero.id !== alden.id) {
      kit.giveTurn(hero.id);
    }
    const out = await kill(enemy);
    assert.equal(out.ok, true, `${label}: ${out.error}`);
    const summary = card();
    assert.equal(summary.kills, 1, label);
    assert.ok(summary.totals.dealt >= least, `${label}: ${summary.totals.dealt} dealt beside a kill`);
    if (credited) {
      assert.ok(summary.fighters.find((line) => line.characterId === hero.id).dealt >= least, `${label}: the killing blow is not on ${hero.name}'s line`);
    }
  }
});

model.close();
finish();
