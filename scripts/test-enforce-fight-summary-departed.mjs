// The After the fight card counts everyone who fought on the party's side
// (issue 663). A companion who leaves the party part way through a fight has
// their sheet deleted, but what they rolled and took is on record: the card
// keeps their line, their damage and their natural 1s. One who turned on the
// party before leaving is not on the party's line.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-fight-summary-departed");
const world = await openWorld({ gameSettings: { companions: "full" } });
const kit = await combatKit(world);
const encounters = await import("../src/lib/db/encounters.ts");
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");

const BODY = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
const hero = world.addHero({
  name: "Mira", class: "fighter", level: 3, abilities: BODY, proficiencies: TRAINED,
  maxHp: 40, ac: 12, acOverride: true, equipment: [{ name: "Longsword", qty: 1 }],
});

async function recruit(name, kind) {
  const joined = await world.invoke("add_companion", {
    gender: "Male", name, class: "fighter", race: "human", level: 3, personality: "Steady.", kind,
  });
  assert.equal(joined.ok, true, joined.error);
  const id = joined.result.characterId;
  world.patch(id, {
    abilities: BODY, proficiencies: TRAINED, maxHp: 30, currentHp: 30, ac: 14, acOverride: true,
    equipment: [{ name: "Longsword", qty: 1 }], conditions: [], conditionMeta: {},
  });
  return world.sheet(id);
}

// A fight with one dummy; the companion lands a hit and fumbles a swing,
// then leaves, and the hero finishes the fight.
async function fightAndLeave(companion, { turncoat = false } = {}) {
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [companion.id]: 18 } });
  const [enemy] = world.enemies();
  kit.place(hero.id, 5, 5);
  kit.place(companion.id, 6, 5);
  kit.place(enemy.id, 5, 6);
  kit.giveTurn(companion.id);
  // 18 + 3 + 2 against AC 13; a longsword's d8 of 7, +3: 10 dealt.
  const hit = await kit.swing(companion.id, enemy.id, [18, 7]);
  assert.equal(hit.result.hit, true, hit.error);
  kit.freshTurn();
  const fumble = await kit.swing(companion.id, enemy.id, [1]);
  assert.equal(fumble.result.hit, false, fumble.error);
  if (turncoat) {
    assert.equal(moveToSide(world.campaign(), companion.id, "foe").ok, true);
  }
  const left = await world.invoke("dismiss_companion", { characterId: companion.id, reason: "He walks off." });
  assert.equal(left.ok, true, left.error);
  assert.equal(world.sheet(companion.id), null);
  const ended = await world.invoke("end_encounter", { outcome: "victory" });
  assert.equal(ended.ok, true, ended.error);
  return encounters.getLatestEndedEncounter(world.campaignId).summaryCard;
}

await test("A lasting companion who left mid-fight keeps their line, damage and natural 1 on the card.", async () => {
  const hollis = await recruit("Sir Hollis", "party");
  const card = await fightAndLeave(hollis);
  assert.ok(card, "the card was written");
  const line = card.fighters.find((fighter) => fighter.characterId === hollis.id);
  assert.ok(line, `Sir Hollis is on the card: ${JSON.stringify(card.fighters)}`);
  assert.equal(line.name, "Sir Hollis");
  assert.equal(line.dealt, 10);
  assert.equal(line.nat1s, 1);
  assert.ok(card.fighters.some((fighter) => fighter.characterId === hero.id), "the hero still has a line");
  assert.equal(card.totals.nat1s, 1);
  assert.ok(card.totals.dealt >= 10);
});

await test("A guest companion who left mid-fight is named on the card as the dice named them.", async () => {
  const wren = await recruit("Wren", "guest");
  const card = await fightAndLeave(wren);
  const line = card.fighters.find((fighter) => fighter.characterId === wren.id);
  assert.ok(line, `Wren is on the card: ${JSON.stringify(card.fighters)}`);
  assert.equal(line.name, "Wren");
  assert.equal(line.dealt, 10);
  assert.equal(line.nat1s, 1);
});

await test("A companion who turned on the party and then left is not on the party's card.", async () => {
  const brand = await recruit("Brand", "guest");
  const card = await fightAndLeave(brand, { turncoat: true });
  assert.equal(card.fighters.some((fighter) => fighter.characterId === brand.id), false);
});

finish();
