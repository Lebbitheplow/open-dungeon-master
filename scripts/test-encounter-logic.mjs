// Pure combat bookkeeping: initiative ordering, turn advancement, enemy
// damage clamps, and duplicate-name numbering.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { buildOrder, advanceOrder, coerceEncounterOutcome, enemyDamageMath, numberDuplicates, pickEnemyTarget, spliceIntoOrder } = await import(
  "../src/lib/dm/encounter-logic.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const pcs = [
  { characterId: "c1", userId: "u1", name: "Kara", initiative: 18 },
  { characterId: "c2", userId: "u2", name: "Brom", initiative: 7 },
];
const enemies = [
  { enemyId: "e1", name: "Wolf 1", initiative: 12 },
  { enemyId: "e2", name: "Wolf 2", initiative: 7 },
];

test("buildOrder sorts descending, PCs win ties", () => {
  const order = buildOrder(pcs, enemies);
  assert.deepEqual(
    order.map((entry) => entry.name),
    ["Kara", "Wolf 1", "Brom", "Wolf 2"],
  );
});

test("tied enemies sort by name deterministically", () => {
  const order = buildOrder([], [
    { enemyId: "b", name: "Bear", initiative: 10 },
    { enemyId: "a", name: "Ant", initiative: 10 },
  ]);
  assert.deepEqual(order.map((entry) => entry.name), ["Ant", "Bear"]);
});

test("advanceOrder from -1 lands on the first living PC", () => {
  const order = buildOrder(pcs, enemies);
  const next = advanceOrder(order, -1, () => true);
  assert.equal(order[next.turnIndex].name, "Kara");
  assert.deepEqual(next.enemiesPassed, []);
  assert.equal(next.wrapped, false);
});

test("advanceOrder collects intervening enemies and wraps into a new round", () => {
  const order = buildOrder(pcs, enemies);
  // From Brom (index 2): passes Wolf 2, wraps, lands on Kara.
  const next = advanceOrder(order, 2, () => true);
  assert.equal(order[next.turnIndex].name, "Kara");
  assert.deepEqual(next.enemiesPassed, ["e2"]);
  assert.equal(next.wrapped, true);
});

test("advanceOrder skips dead combatants", () => {
  const order = buildOrder(pcs, enemies);
  // Kara dead: from index -1 the pointer passes Wolf 1 and lands on Brom.
  const next = advanceOrder(order, -1, (entry) =>
    entry.kind === "pc" ? entry.characterId !== "c1" : true,
  );
  assert.equal(order[next.turnIndex].name, "Brom");
  assert.deepEqual(next.enemiesPassed, ["e1"]);
});

test("advanceOrder reports skipped downed PCs in pcsPassed", () => {
  const order = buildOrder(pcs, enemies);
  const next = advanceOrder(order, -1, (entry) =>
    entry.kind === "pc" ? entry.characterId !== "c1" : true,
  );
  assert.deepEqual(next.pcsPassed, ["c1"]);
  // No downed PCs passed: empty list.
  const clean = advanceOrder(order, -1, () => true);
  assert.deepEqual(clean.pcsPassed, []);
});

test("advanceOrder returns null with no living PCs", () => {
  const order = buildOrder(pcs, enemies);
  assert.equal(advanceOrder(order, 0, (entry) => entry.kind === "enemy"), null);
});

test("solo living PC advances back to themselves through a full round", () => {
  const order = buildOrder(pcs, enemies);
  const alive = (entry) => (entry.kind === "pc" ? entry.characterId === "c1" : true);
  const next = advanceOrder(order, 0, alive);
  assert.equal(order[next.turnIndex].name, "Kara");
  assert.deepEqual(next.enemiesPassed, ["e1", "e2"]);
  assert.equal(next.wrapped, true);
});

test("spliceIntoOrder inserts by initiative and keeps the pointer on the current combatant", () => {
  const order = buildOrder(pcs, enemies);
  const current = order[1];
  const spliced = spliceIntoOrder(order, 1, [
    { kind: "enemy", enemyId: "e9", name: "Ogre", initiative: 99 },
  ]);
  // Highest initiative lands at the front; the pointer follows its entry.
  assert.equal(spliced.order[0].name, "Ogre");
  assert.equal(spliced.turnIndex, 2);
  assert.equal(spliced.order[spliced.turnIndex], current);
});

test("spliceIntoOrder appends the lowest initiative without moving the pointer", () => {
  const order = buildOrder(pcs, enemies);
  const spliced = spliceIntoOrder(order, 1, [
    { kind: "enemy", enemyId: "e9", name: "Rat", initiative: -5 },
  ]);
  assert.equal(spliced.order[spliced.order.length - 1].name, "Rat");
  assert.equal(spliced.turnIndex, 1);
});

test("enemyDamageMath clamps and flags the drop", () => {
  assert.deepEqual(enemyDamageMath(10, 4), { currentHp: 6, dropped: false });
  assert.deepEqual(enemyDamageMath(10, 15), { currentHp: 0, dropped: true });
  assert.deepEqual(enemyDamageMath(0, 15), { currentHp: 0, dropped: false });
  assert.deepEqual(enemyDamageMath(500, 999), { currentHp: 300, dropped: false });
  assert.deepEqual(enemyDamageMath(10, 0), { currentHp: 9, dropped: false });
});

test("numberDuplicates numbers only repeats", () => {
  assert.deepEqual(numberDuplicates(["Wolf", "Wolf", "Bear"]), ["Wolf 1", "Wolf 2", "Bear"]);
  assert.deepEqual(numberDuplicates(["Ogre"]), ["Ogre"]);
});

test("pickEnemyTarget prefers nearest, then lowest AC", () => {
  const candidates = [
    { characterId: "far", ac: 10, position: { x: 9, y: 9 } },
    { characterId: "near", ac: 18, position: { x: 1, y: 1 } },
  ];
  assert.equal(pickEnemyTarget({ x: 0, y: 0 }, candidates), "near");
  assert.equal(
    pickEnemyTarget({ x: 0, y: 0 }, [
      { characterId: "a", ac: 16, position: { x: 2, y: 2 } },
      { characterId: "b", ac: 12, position: { x: 2, y: 0 } },
    ]),
    "b",
  );
});

test("pickEnemyTarget without positions falls back to lowest AC", () => {
  assert.equal(
    pickEnemyTarget(null, [
      { characterId: "tank", ac: 19, position: null },
      { characterId: "wizard", ac: 11, position: null },
    ]),
    "wizard",
  );
  assert.equal(pickEnemyTarget(null, []), null);
});

test("coerceEncounterOutcome: exact outcomes pass through", () => {
  assert.deepEqual(coerceEncounterOutcome("victory", ["dead"]), { outcome: "victory", inferred: false });
  assert.deepEqual(coerceEncounterOutcome("enemies_fled", ["alive"]), { outcome: "enemies_fled", inferred: false });
});

test("coerceEncounterOutcome: synonyms map", () => {
  assert.equal(coerceEncounterOutcome("the bandits surrender", ["alive"]).outcome, "truce");
  assert.equal(coerceEncounterOutcome("peace", ["alive"]).outcome, "truce");
  assert.equal(coerceEncounterOutcome("retreat", ["alive"]).outcome, "enemies_fled");
  assert.equal(coerceEncounterOutcome("enemies routed", ["alive"]).outcome, "enemies_fled");
  assert.equal(coerceEncounterOutcome("we won", ["dead"]).outcome, "victory");
  assert.equal(coerceEncounterOutcome("party flees", ["alive"]).outcome, "party_fled");
  assert.equal(coerceEncounterOutcome("tpk", ["alive"]).outcome, "party_defeated");
});

test("coerceEncounterOutcome: unknown/missing infers from roster", () => {
  assert.deepEqual(coerceEncounterOutcome(undefined, ["dead", "dead"]), { outcome: "victory", inferred: true });
  assert.deepEqual(coerceEncounterOutcome("???", ["fled", "fled"]), { outcome: "enemies_fled", inferred: true });
  assert.deepEqual(coerceEncounterOutcome("", ["alive", "dead"]), { outcome: "truce", inferred: true });
});

console.log(`test-encounter-logic: ${passed} passed`);
