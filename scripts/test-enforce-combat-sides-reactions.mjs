// A turncoat's blow is answered like an enemy's (issue 503, Phase 6): the
// attack leaves the record a character's reactions answer
// (src/lib/dm/last-hit.ts), the Hand offers them from it, and use_reaction
// re-resolves the blow.
//
//   - Shield turns a turncoat's pc_attack hit into a miss and gives the
//     hit points back;
//   - Uncanny Dodge halves it;
//   - a turncoat's opportunity attack on a party member walking away leaves
//     the record too, and Uncanny Dodge halves that;
//   - a party member's opportunity attack on a turncoat walking away leaves
//     the turncoat's record.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-combat-sides-reactions");
const world = await openWorld();
const kit = await combatKit(world);
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const { freshLastHit } = await import("../src/lib/dm/last-hit.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");

const BODY = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
const wizard = world.addHero({
  name: "Ione", class: "wizard", level: 5, maxHp: 30, abilities: { int: 16 }, proficiencies: TRAINED,
  spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Shield"], known: [], cantrips: [] },
});
const rogue = world.addHero({ name: "Tam", class: "rogue", level: 5, maxHp: 30, abilities: { dex: 16 }, proficiencies: TRAINED, equipment: [{ name: "Shortsword", qty: 1 }] });

// A fight with a turncoat (a guest fighter with a longsword, +5 to hit and
// 1d8+3) moved to the foes' side, and one dummy far off.
async function stage() {
  await kit.endFight();
  for (const hero of [wizard, rogue]) {
    world.patch(hero.id, { ac: 12, acOverride: true, currentHp: 30, tempHp: 0, conditions: [], conditionMeta: {} });
  }
  world.patch(wizard.id, { spellcasting: { ...world.sheet(wizard.id).spellcasting, slots: { 1: { max: 4, used: 0 } } } });
  const joined = await world.invoke("add_companion", {
    gender: "Unknown", name: "Aldric", class: "fighter", race: "human", level: 3, personality: "Grim.", kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  const turncoat = joined.result.characterId;
  world.patch(turncoat, {
    abilities: BODY, proficiencies: TRAINED, maxHp: 30, currentHp: 30, ac: 12, acOverride: true,
    equipment: [{ name: "Longsword", qty: 1 }], conditions: [], conditionMeta: {},
  });
  await kit.fight(1, { heroFaces: { [wizard.id]: 19, [rogue.id]: 18, [turncoat]: 3 } });
  moveToSide(world.campaign(), turncoat, "foe");
  kit.place(wizard.id, 2, 2);
  kit.place(rogue.id, 8, 8);
  kit.place(turncoat, 3, 2);
  kit.place(world.enemies()[0].id, 18, 18);
  return world.sheet(turncoat);
}

const hp = (hero) => world.sheet(hero.id).currentHp;
const react = (hero, feature) => world.invoke("use_reaction", { characterId: hero.id, feature });

await test("Shield answers a turncoat's hit as it answers an enemy's: the Hand is offered the hit, and the +5 turns it into a miss", async () => {
  const turncoat = await stage();
  kit.giveTurn(turncoat.id);
  // 10 + 5 = 15 against AC 12: a hit for 3 + 3.
  const blow = await kit.swing(turncoat.id, wizard.id, [10, 3]);
  assert.equal(blow.ok, true, blow.error);
  assert.equal(blow.result.hit, true, JSON.stringify(blow.result));
  assert.equal(hp(wizard), 24);
  const offered = (activePublicEncounter(world.campaignId).lastHits ?? []).find((hit) => hit.characterId === wizard.id);
  assert.ok(offered, "the Hand's record of the hit");
  assert.equal(offered.attackerId, turncoat.id);
  assert.equal(offered.hit, true);
  const out = await react(wizard, "Shield");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(wizard), 30, "15 against AC 17 misses");
  assert.equal(world.sheet(wizard.id).spellcasting.slots["1"].used, 1);
});

await test("Uncanny Dodge halves a turncoat's hit", async () => {
  const turncoat = await stage();
  kit.place(rogue.id, 4, 2);
  kit.giveTurn(turncoat.id);
  const blow = await kit.swing(turncoat.id, rogue.id, [15, 5]);
  assert.equal(blow.ok, true, blow.error);
  assert.equal(hp(rogue), 30 - 8);
  const out = await react(rogue, "Uncanny Dodge");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(rogue), 30 - 4);
});

await test("A turncoat's opportunity attack leaves the record a reaction answers, and Uncanny Dodge halves it", async () => {
  const turncoat = await stage();
  kit.place(rogue.id, 5, 5);
  kit.place(turncoat.id, 5, 6);
  kit.giveTurn(rogue.id);
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: rogue.userId });
  world.dice(15, 5);
  const response = await route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 5, y: 2 }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  world.clearDice();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(hp(rogue), 30 - 8, "the turncoat's longsword as Tam breaks away");
  const record = freshLastHit(world.campaignId, rogue.id);
  assert.ok(record, "the opportunity attack's record");
  assert.equal(record.attacker.kind, "sheet");
  assert.equal(record.attacker.id, turncoat.id);
  assert.match(record.attack, /opportunity attack/);
  const out = await react(rogue, "Uncanny Dodge");
  assert.equal(out.ok, true, out.error);
  assert.equal(hp(rogue), 30 - 4);
});

await test("A party member's opportunity attack on a turncoat walking away leaves the turncoat's record", async () => {
  const turncoat = await stage();
  kit.place(rogue.id, 5, 5);
  kit.place(turncoat.id, 5, 6);
  kit.giveTurn(turncoat.id);
  world.dice(15, 4);
  const walked = await world.invoke("move_token", { tokenName: turncoat.id, x: 5, y: 9 });
  world.clearDice();
  assert.equal(walked.ok, true, walked.error);
  const record = freshLastHit(world.campaignId, turncoat.id);
  assert.ok(record, "the record on the turncoat");
  assert.equal(record.attacker.id, rogue.id);
  assert.equal(record.swings.length, 1);
  assert.equal(record.swings[0].hit, true);
});

await kit.endFight();
finish();
