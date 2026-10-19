// A tool's fixed choice is one of its listed values, at every table. The
// server used to guess a listed value from English words ("adv", "a long
// rest", "the bandits surrender", "healer's kit", "learn"), which read an
// English call and no other language's. A value outside the list is now
// refused with the values listed (src/lib/dm/tool-errors.ts invalidArguments),
// nothing happens, and the model resends the call. Two tools upstream never
// refuses keep their fallback and read no words either: end_encounter takes
// the roster's outcome, record_event records a story. Each case is a scripted
// model turn (the console's forms offer the listed values only): one reply
// sends the old English synonym and the same word in Italian, French, Spanish
// and German, the next the listed value.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { fightDummies } from "./lib/enforce-spells.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-fixed-choices");
const model = await fakeModel();

async function table() {
  const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: false } });
  model.pointAt(world);
  return world;
}

// One model turn: the calls with values off the list, then the listed one,
// then the prose. Returns each call's result, the off-list ones first.
async function turn(world, heroId, offList, listed) {
  model.script([reply({ calls: offList }), reply({ calls: [listed] }), reply({ text: "The moment passes." })]);
  await model.turn(world, "We go on.", heroId);
  const results = new Map(model.requests.flatMap((request) => model.results(request)).map((entry) => [entry.id, entry.result]));
  return { offList: offList.map((entry) => results.get(entry.id)), listed: results.get(listed.id) };
}

function allRefused(results, listed) {
  for (const result of results) {
    assert.equal(result.retry, true, JSON.stringify(result));
    assert.match(result.error, listed);
  }
}

// end_encounter is the one fixed choice never refused (a fight can always
// be ended): an outcome off its list is read off the enemy roster, never
// from its words.
for (const said of ["the bandits surrender", "i banditi si arrendono", "les bandits se rendent", "los bandidos se rinden", "die Banditen ergeben sich"]) {
  await test(`end_encounter: "${said}" is not read; the roster's outcome is recorded`, async () => {
    const world = await table();
    const kara = world.addHero({ name: "Kara", class: "fighter", level: 3 });
    await fightDummies(world, 2);
    const { getDatabase } = await import("../src/lib/db/core.ts");
    getDatabase().prepare("UPDATE encounter_enemies SET status = 'dead', current_hp = 0 WHERE id = ?").run(world.enemies()[0].id);
    const result = await turn(world, kara.id, [], call("end_encounter", { outcome: said }));
    assert.equal(result.listed.ok, true, result.listed.error);
    assert.equal(result.listed.outcome, "truce");
    assert.match(result.listed.note, /was not recognized; recorded as truce/);
    assert.equal(world.encounter(), null);
  });
}

await test("take_rest: a rest is short or long", async () => {
  const world = await table();
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3 });
  world.patch(kara.id, { currentHp: 5 });
  const kinds = ["a long rest", "riposo lungo", "repos long", "descanso largo", "lange Rast"];
  const result = await turn(world, kara.id, kinds.map((kind) => call("take_rest", { kind })), call("take_rest", { kind: "long" }));
  allRefused(result.offList, /Send \{"kind":"short"\} or \{"kind":"long"\}/);
  assert.equal(result.listed.ok, true, result.listed.error);
  assert.equal(world.sheet(kara.id).currentHp, world.sheet(kara.id).maxHp);
});

// record_event, too, is never refused for its kind (a milestone is always
// worth recording): a kind off the list is a story, its words unread.
await test("record_event: a kind off the list is recorded as a story", async () => {
  const world = await table();
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3 });
  const kinds = ["bond formed", "amicizia", "amitié", "amistad", "Freundschaft"];
  const result = await turn(
    world,
    kara.id,
    kinds.map((kind, index) => call("record_event", { characterId: kara.id, kind, summary: `Kara befriended miller ${index}.` })),
    call("record_event", { characterId: kara.id, kind: "relationship", summary: "Kara befriended the smith." }),
  );
  const { listRecentCampaignEvents } = await import("../src/lib/db/character-events.ts");
  const recorded = listRecentCampaignEvents(world.campaignId).map((event) => [event.summary, event.kind]);
  for (const [index, outcome] of result.offList.entries()) {
    assert.equal(outcome.ok, true, outcome.error);
    assert.ok(recorded.some(([summary, kind]) => summary === `Kara befriended miller ${index}.` && kind === "story"), JSON.stringify(recorded));
  }
  assert.ok(recorded.some(([summary, kind]) => summary === "Kara befriended the smith." && kind === "relationship"));
});

await test("stabilize: the method is check, kit or spell", async () => {
  const world = await table();
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3 });
  const tavi = world.addHero({ name: "Tavi", class: "cleric", level: 3, equipment: [{ name: "Healer's kit", qty: 1 }] });
  world.patch(kara.id, { currentHp: 0, deathSaves: { successes: 0, failures: 1, stable: false, dead: false } });
  const methods = ["healer's kit", "kit del guaritore", "trousse de soins", "equipo de sanador", "Heilerausrüstung"];
  const result = await turn(
    world,
    tavi.id,
    methods.map((method) => call("stabilize", { characterId: kara.id, healerId: tavi.id, method })),
    call("stabilize", { characterId: kara.id, healerId: tavi.id, method: "kit" }),
  );
  allRefused(result.offList, /method: Invalid option: expected one of "check"\|"kit"\|"spell"/);
  assert.equal(result.listed.ok, true, result.listed.error);
  assert.equal(world.sheet(kara.id).deathSaves.stable, true);
});

await test("learn_spell: the action is add or remove", async () => {
  const world = await table();
  const mira = world.addHero({
    name: "Mira", class: "wizard", level: 3,
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } }, known: ["Magic Missile"], prepared: [], cantrips: [] },
  });
  // Copying a spell into the book costs 50 gp a level.
  world.patch(mira.id, { gold: 100 });
  const actions = ["learn", "impara", "apprendre", "aprender", "lernen"];
  const result = await turn(
    world,
    mira.id,
    actions.map((action) => call("learn_spell", { characterId: mira.id, action, spell: "Shield", reason: "a scroll" })),
    call("learn_spell", { characterId: mira.id, action: "add", spell: "Shield", reason: "a scroll" }),
  );
  allRefused(result.offList, /action: Invalid option: expected one of "add"\|"remove"\|"buy"\|"sell"/);
  assert.equal(result.listed.ok, true, result.listed.error);
});

await test("pc_attack and enemy_attack: advantage is none, advantage or disadvantage", async () => {
  const world = await table();
  const kara = world.addHero({ name: "Kara", class: "fighter", level: 3 });
  // The goblin's turn, so enemy_attack reaches its arguments.
  const [goblin] = await fightDummies(world, 1, { enemyFace: 20, heroFaces: { [kara.id]: 1 } });
  const words = ["adv", "vantaggio", "avantage", "ventaja", "Vorteil"];
  const result = await turn(
    world,
    kara.id,
    [
      ...words.map((advantage) => call("pc_attack", { characterId: kara.id, targetEnemyId: goblin.id, weapon: "Longsword", advantage })),
      ...words.map((advantage) => call("enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id, advantage })),
    ],
    call("enemy_attack", { enemyId: goblin.id, targetCharacterId: kara.id, advantage: "none" }),
  );
  allRefused(result.offList, /advantage: Invalid option: expected one of "none"\|"advantage"\|"disadvantage"/);
  assert.equal(result.listed.error, undefined, "the listed value attacks");
});

model.close();
finish();
