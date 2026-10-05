// The opening of a fight, where the story and the engine used to part ways
// (issue 91): the narration landed "Hit! 8 damage." on a character before
// any fight existed, the sheet stayed at full hit points, the board opened
// with the enemy across the field from a blow struck at arm's length, and
// Ask the DM had neither the hit points nor the dice to answer from.
//   - a damage or healing figure in prose that no tool rolled this turn is
//     held back once and the model is sent to the tool that resolves it
//     (src/lib/dm/engine-boundary.ts statesUnrolledDamage);
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
const { statesUnrolledDamage, unrolledDamagePrompt } = await import("../src/lib/dm/engine-boundary.ts");
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

await test("A damage figure no tool rolled is found; dice notation, speech, a hedge and a figure already on the table are not.", () => {
  const input = [{ role: "system", content: "Alden Veyr HP 10/10, AC 8" }, { role: "user", content: "[Alden Veyr | attempt] I step into the chamber." }];
  assert.equal(statesUnrolledDamage(BLAST, input), "8 damage.");
  assert.equal(statesUnrolledDamage("The blast deals 2d6 damage on a failed save.", input), null);
  assert.equal(statesUnrolledDamage('"That was 8 damage, easily," Alden mutters.', input), null);
  assert.equal(statesUnrolledDamage("It looks like 8 damage at least.", input), null);
  assert.equal(statesUnrolledDamage("The blast scorches the wall and Alden ducks.", input), null);
  const noted = [...input, { role: "user", content: "[Table note] The spikes deal 8 piercing damage to Alden Veyr." }];
  assert.equal(statesUnrolledDamage("The spikes bite deep: 8 damage.", noted), null);
});

// ---- the turn loop ----

await test("An attack written in prose before any fight exists is held back: the model is sent to the tools, and the table never reads the blow that did not land.", async () => {
  const start = call("start_encounter", { enemies: [{ monster: "goblin", name: "Resonance Weaver" }] });
  model.script([
    reply({ text: BLAST }),
    reply({ calls: [start] }),
    reply({ text: "The Resonance Weaver unfolds from the dark, humming, ten feet from Alden." }),
  ]);
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
  const dm = await model.turn(world, "I look around.", alden.id, alden.userId);
  assert.equal(model.served(), 2);
  assert.ok(dm.content.includes("8 damage"));
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
  const dm = await model.turn(world, "I pull my foot free.", alden.id, alden.userId);
  assert.equal(model.served(), 1);
  assert.ok(dm.content.includes("8 damage"));
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

await test("start_encounter's distanceFeet sets how far the nearest enemy stands, on every board; without it the sides open across the field.", async () => {
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
