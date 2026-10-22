// A player's turn ends where the table was told it ends. pc_attack's
// endTurn ends it with the attack (encounter-tools.ts endTurnAfterAttack),
// and a narration that hands the turn on ("It is now Kara's turn") ends it
// after the narration although the model never called end_turn (claims.ts
// turnOverFor, turn.ts). A narration that asks what they do next ends
// nothing. The player's own words ("...then I end my turn") end it too, once
// the DM ruled on what they did (claims.ts readTurnEndInWords). And a later
// reply in the same turn that recalls a swing the turn already rolled is not
// sent back as a blow nobody rolled (engine-boundary.ts resolveOutcomes, the
// turn budget's struck swings).
//
// On the skirmish smoke (2026-10-20) gpt-oss-20b and Qwen3.6-35B wrote "Your
// turn ends. It's now Avery's move." with no end_turn, so the next player's
// line went to the same character, round after round; and Qwen, asked to
// attack again on a spent turn, recalled its hit, was told no tool rolled
// it, and rewrote the hit into a miss.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { aiEngine, call, fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-turn-handoff");
const world = await openWorld({ campaign: { maxPlayers: 8 }, gameSettings: { ttsEnabled: false } });
const kit = await combatKit(world);
const model = await fakeModel();
model.pointAt(world);
const ai = await aiEngine(world);
const { updateGameSettings } = await import("../src/lib/db/campaigns.ts");

const hero = (name) =>
  world.addHero({
    name,
    class: "fighter",
    level: 3,
    abilities: { str: 16, dex: 12 },
    proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    maxHp: 60,
  });
const avery = hero("Avery");
const kara = hero("Kara");

const current = () => {
  const encounter = world.encounter();
  const entry = encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
  return entry?.kind === "pc" ? entry.characterId : null;
};
const corrections = () =>
  model.requests.flatMap((request) =>
    request.messages.filter((message) => message.role === "user" && String(message.content).startsWith("[System]")),
  );

// One sturdy goblin beside Avery, whose turn it is; Kara acts next and the
// goblin last.
async function stage() {
  await kit.endFight();
  await kit.fight(1, { heroFaces: { [avery.id]: 20, [kara.id]: 15 } });
  const [goblin] = world.enemies();
  kit.setEnemy(goblin.id, { maxHp: 400 });
  kit.place(avery.id, 5, 5);
  kit.place(kara.id, 5, 8);
  kit.place(goblin.id, 6, 5);
  kit.giveTurn(avery.id);
  return goblin;
}

async function playerTurn(line, entries, claims = []) {
  model.claims(claims);
  model.script(entries);
  const message = await model.turn(world, line, avery.id, avery.userId);
  await settleQueue(world.campaignId);
  world.clearDice();
  return message;
}

await test("pc_attack with endTurn ends the attacker's turn with the attack, and its result names who acts next", async () => {
  const goblin = await stage();
  world.dice(15, 4);
  await playerTurn("I cut at the goblin, then I end my turn.", [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword", endTurn: true })] }),
    reply({ text: "Avery's longsword bites, and Avery falls back a step." }),
  ]);
  const attack = model.requests[1] && model.results(model.requests[1]).at(-1)?.result;
  assert.match(String(attack?.turnEnded?.note ?? ""), /Avery's turn is over/, JSON.stringify(attack));
  assert.equal(current(), kara.id, "the pointer stayed on Avery");
});

await test("approach with endTurn: a walk that falls short ends the turn as the player asked, nothing attacked", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 16, 5);
  await playerTurn("I close in on the goblin and attack it, then I end my turn.", [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword", approach: true, endTurn: true })] }),
    reply({ text: "Avery charges across the stones but cannot reach the goblin before the moment passes." }),
  ]);
  const attack = model.results(model.requests[1]).at(-1)?.result;
  assert.equal(attack?.outOfReach, true, JSON.stringify(attack));
  assert.ok(attack?.turnEnded, "the short walk did not end the turn");
  assert.equal(kit.enemy(goblin.id).currentHp, 400);
  assert.equal(current(), kara.id);
});

await test("approach walks nobody into a swing something else refuses, and that refusal ends no turn", async () => {
  // Qwen3.6-35B sent a fighter's approach and endTurn with a monk's bonus
  // strike: he was walked, refused, and lost the turn.
  const goblin = await stage();
  kit.place(goblin.id, 9, 5);
  await playerTurn("I rush the goblin and strike, then I end my turn.", [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword", approach: true, endTurn: true, bonusAttack: "martial arts" })] }),
    reply({ text: "Avery hesitates." }),
  ]);
  const attack = model.results(model.requests[1]).at(-1)?.result;
  assert.match(String(attack?.error ?? ""), /Martial Arts/, JSON.stringify(attack));
  assert.deepEqual([kit.token(avery.id).x, kit.token(avery.id).y], [5, 5], "Avery walked for a swing that was refused anyway");
  assert.equal(attack?.turnEnded, undefined);
});

await test("A narration that hands the turn on ends it after the narration, though the model never called end_turn", async () => {
  await stage();
  const text = "Avery feints and slips clear of the goblin's blade. It is now Kara's turn.";
  await playerTurn("I feint and slip clear.", [reply({ text })], [[{ kind: "turn_over", quote: "It is now Kara's turn." }]]);
  assert.ok(model.readerRequests.some((request) => String(request.messages?.[1]?.content ?? "").includes("turn_over")), "the reader was never asked whether the turn was handed on");
  assert.equal(current(), kara.id, "the table was told it is Kara's turn and the pointer stayed on Avery");
});

await test("A narration that asks what they do next ends nothing", async () => {
  await stage();
  await playerTurn("I feint at the goblin.", [reply({ text: "Avery feints, and the goblin flinches back. What does Avery do with the rest of the turn?" })], [[]]);
  assert.equal(current(), avery.id, "a question about the rest of the turn ended it");
});

const wordsRead = () => model.readerRequests.some((request) => String(request.messages?.[1]?.content ?? "").includes("Player's words:"));

await test("The player's own words end the turn once the DM ruled on what they did, though nothing else ended it", async () => {
  const goblin = await stage();
  kit.place(goblin.id, 15, 5);
  const ruled = [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
    reply({ text: "The goblin is too far off for Avery's blade to reach. What does Avery do?" }),
  ];
  // Plain English needs no reader call.
  await playerTurn("I close in on the goblin and attack it, then I end my turn.", ruled, [[]]);
  assert.equal(wordsRead(), false, "plain English was sent to the reader");
  assert.equal(current(), kara.id, "the player ended the turn and it stayed open");
  // Any other language is the reader's to read.
  const again = await stage();
  kit.place(again.id, 15, 5);
  await playerTurn(
    "Me acerco al goblin y lo ataco, y termino mi turno.",
    [
      reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: again.id, weapon: "Longsword" })] }),
      reply({ text: "The goblin is too far off for Avery's blade to reach. What does Avery do?" }),
    ],
    [[], [{ kind: "turn_over", quote: "y termino mi turno." }]],
  );
  assert.equal(wordsRead(), true, "the player's words were never read");
  assert.equal(current(), kara.id, "the player ended the turn in Spanish and it stayed open");
});

await test("The English phrases are read at an English table only: at every other table the player's words, English ones included, are the reader's to read", async () => {
  const wordReads = () => model.readerRequests.filter((request) => String(request.messages?.[1]?.content ?? "").includes("Player's words:")).length;
  const swing = (goblin) => [
    reply({ calls: [call("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" })] }),
    reply({ text: "The goblin is too far off for Avery's blade to reach. What does Avery do?" }),
  ];
  for (const language of ["italian", "french", "spanish", "german"]) {
    updateGameSettings(world.campaignId, { tableLanguage: language });
    // The reader reads no end in them: the turn stays open.
    const goblin = await stage();
    kit.place(goblin.id, 15, 5);
    await playerTurn(`I close in on the goblin and attack it, then I end my turn (${language}, first).`, swing(goblin), [[], []]);
    assert.equal(wordReads(), 1, `${language}: the words were not sent to the reader`);
    assert.equal(current(), avery.id, `${language}: the English phrase ended the turn without the reader`);
    // The reader reads the end: the turn ends.
    const again = await stage();
    kit.place(again.id, 15, 5);
    await playerTurn(`I close in on the goblin and attack it, then I end my turn (${language}, second).`, swing(again), [[], [{ kind: "turn_over", quote: "then I end my turn" }]]);
    assert.equal(current(), kara.id, `${language}: the reader read the end and the turn stayed open`);
  }
  updateGameSettings(world.campaignId, { tableLanguage: "english" });
});

await test("The player's words end nothing when the DM only asked them a question", async () => {
  await stage();
  await playerTurn("I attack it, then I end my turn.", [reply({ text: "Which of them, Avery: the goblin on the left or the one on the ledge?" })], [[], [{ kind: "turn_over", quote: "then I end my turn." }]]);
  assert.equal(wordsRead(), false, "words were read on a turn nothing was ruled on");
  assert.equal(current(), avery.id);
});

await test("A later reply that recalls this turn's own swing is not sent back as a blow nobody rolled", async () => {
  const goblin = await stage();
  world.say("player", "I cut at the goblin.", world.sheet(avery.id));
  world.dice(19, 4);
  const swing = await ai.invoke("pc_attack", { characterId: avery.id, targetEnemyId: goblin.id, weapon: "Longsword" });
  world.clearDice();
  assert.equal(swing.result?.hit, true, swing.error);
  const dealt = swing.result.damage;
  const text = `Avery's earlier cut already bit the goblin for ${dealt} damage, and Avery eases back.`;
  await playerTurn(
    "I ease back from it.",
    [reply({ text })],
    [[
      { kind: "hit", target: "goblin", quote: "Avery's earlier cut already bit the goblin" },
      { kind: "amount", value: dealt, of: "damage", quote: `for ${dealt} damage` },
    ]],
  );
  assert.deepEqual(corrections().map((message) => String(message.content).slice(0, 80)), [], "the recalled swing was sent back");
  assert.equal(model.served(), 1);
  assert.equal(current(), avery.id);
});

await kit.endFight();
model.close();
world.close();
finish();
