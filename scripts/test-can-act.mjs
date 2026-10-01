// May this combatant act: the one guard every handler asks
// (src/lib/dm/can-act.ts). Pure, so every branch is walked here without a
// database.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  actingCombatantId,
  canAct,
  canEnemyAct,
  enemyActedThisRound,
  isSurprised,
  markEnemyActed,
  oweEnemiesAnAction,
} = await import("../src/lib/dm/can-act.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const KINDS = ["action", "bonus", "reaction", "attack", "cast", "move", "free"];

const hero = (overrides = {}) => ({
  id: "pc-1",
  name: "Asha",
  currentHp: 20,
  conditions: [],
  deathSaves: null,
  ...overrides,
});

const goblin = (overrides = {}) => ({
  id: "en-1",
  displayName: "Goblin",
  status: "alive",
  conditions: [],
  ...overrides,
});

// Order: Asha, the goblin, Brom. The pointer rests on Asha.
const fight = (overrides = {}) => ({
  status: "active",
  kind: "fight",
  orderReady: true,
  round: 1,
  turnIndex: 0,
  surprisedIds: [],
  order: [
    { kind: "pc", characterId: "pc-1", userId: "u1", name: "Asha", initiative: 18 },
    { kind: "enemy", enemyId: "en-1", name: "Goblin", initiative: 12 },
    { kind: "pc", characterId: "pc-2", userId: "u2", name: "Brom", initiative: 5 },
  ],
  legendary: { pools: {}, lair: false, lairUsedRound: 0 },
  ...overrides,
});

const reasonOf = (result) => (result.ok ? "ok" : result.reason);

test("outside a fight a living character may do anything", () => {
  for (const kind of KINDS) {
    assert.deepEqual(canAct({ sheet: hero(), encounter: null, kind }), { ok: true });
  }
});

test("on their own turn a character may do anything", () => {
  for (const kind of KINDS) {
    assert.deepEqual(canAct({ sheet: hero(), encounter: fight(), kind }), { ok: true });
  }
});

test("a dead character is refused everything, in and out of a fight", () => {
  const dead = hero({
    currentHp: 0,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  for (const kind of KINDS) {
    assert.equal(reasonOf(canAct({ sheet: dead, encounter: null, kind })), "dead");
    assert.equal(reasonOf(canAct({ sheet: dead, encounter: fight(), kind })), "dead");
  }
});

test("dead is read from the death track, whatever the hit points say", () => {
  const dead = hero({
    currentHp: 12,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  assert.equal(reasonOf(canAct({ sheet: dead, encounter: null, kind: "attack" })), "dead");
});

test("a character at 0 HP is refused, dying or stable", () => {
  const dying = hero({
    currentHp: 0,
    deathSaves: { successes: 1, failures: 1, stable: false, dead: false },
  });
  const stable = hero({
    currentHp: 0,
    deathSaves: { successes: 3, failures: 0, stable: true, dead: false },
  });
  for (const kind of KINDS) {
    assert.equal(reasonOf(canAct({ sheet: dying, encounter: fight(), kind })), "down");
    assert.equal(reasonOf(canAct({ sheet: stable, encounter: null, kind })), "down");
  }
});

test("each incapacitating condition refuses every kind, a reaction included; bare incapacitation still moves", () => {
  // SRD 5.1: incapacitated takes actions and reactions only; the other four
  // also say "can't move".
  assert.equal(canAct({ sheet: hero({ conditions: ["incapacitated"] }), encounter: fight(), kind: "move" }).ok, true);
  for (const condition of ["incapacitated", "paralyzed", "stunned", "unconscious", "petrified"]) {
    for (const kind of KINDS.filter((entry) => condition !== "incapacitated" || entry !== "move")) {
      const result = canAct({ sheet: hero({ conditions: [condition] }), encounter: fight(), kind });
      assert.equal(reasonOf(result), "incapacitated", `${condition} ${kind}`);
      assert.match(result.error, new RegExp(condition));
    }
  }
  assert.equal(
    reasonOf(canAct({ sheet: hero({ conditions: ["Stunned"] }), encounter: null, kind: "cast" })),
    "incapacitated",
  );
});

test("conditions that do not incapacitate refuse nothing", () => {
  const sheet = hero({ conditions: ["poisoned", "prone", "frightened", "grappled", "restrained"] });
  assert.deepEqual(canAct({ sheet, encounter: fight(), kind: "attack" }), { ok: true });
});

test("a surprised character does nothing in round 1", () => {
  const encounter = fight({ surprisedIds: ["pc-1"] });
  for (const kind of KINDS) {
    assert.equal(reasonOf(canAct({ sheet: hero(), encounter, kind })), "surprised", kind);
  }
});

test("surprise is over from round 2", () => {
  const encounter = fight({ round: 2, surprisedIds: ["pc-1"] });
  assert.deepEqual(canAct({ sheet: hero(), encounter, kind: "attack" }), { ok: true });
});

test("a surprised character reacts once their place in the order has gone by", () => {
  // The pointer is on Brom (index 2): Asha (index 0) has had her lost turn.
  const encounter = fight({ turnIndex: 2, surprisedIds: ["pc-1"] });
  assert.deepEqual(canAct({ sheet: hero(), encounter, kind: "reaction" }), { ok: true });
  // Brom surprised with the pointer on Asha: his turn has not come yet.
  const early = fight({ turnIndex: 0, surprisedIds: ["pc-2"] });
  const brom = hero({ id: "pc-2", name: "Brom" });
  assert.equal(reasonOf(canAct({ sheet: brom, encounter: early, kind: "reaction" })), "surprised");
  assert.equal(isSurprised(early, "pc-2", true), true);
  assert.equal(isSurprised(encounter, "pc-1", true), false);
  assert.equal(isSurprised(encounter, "pc-1"), true);
});

test("nobody acts before initiative is in", () => {
  const encounter = fight({ orderReady: false, order: [] });
  for (const kind of KINDS) {
    assert.equal(reasonOf(canAct({ sheet: hero(), encounter, kind })), "no_initiative", kind);
  }
  assert.equal(actingCombatantId(encounter), null);
});

test("off their own turn a character has their reaction and nothing else", () => {
  const brom = hero({ id: "pc-2", name: "Brom" });
  for (const kind of KINDS) {
    const result = canAct({ sheet: brom, encounter: fight(), kind });
    assert.equal(reasonOf(result), kind === "reaction" ? "ok" : "not_your_turn", kind);
  }
  assert.equal(actingCombatantId(fight()), "pc-1");
});

test("a character who is not in the order is not on their turn", () => {
  const stranger = hero({ id: "pc-9", name: "Cole" });
  assert.equal(
    reasonOf(canAct({ sheet: stranger, encounter: fight(), kind: "attack" })),
    "not_your_turn",
  );
});

test("a scene on the map and an ended fight bind no turns", () => {
  const brom = hero({ id: "pc-2", name: "Brom" });
  assert.deepEqual(canAct({ sheet: brom, encounter: fight({ kind: "scene" }), kind: "move" }), { ok: true });
  assert.deepEqual(canAct({ sheet: brom, encounter: fight({ status: "ended" }), kind: "attack" }), { ok: true });
});

test("the refusals come in order: dead, down, incapacitated, surprised, initiative, turn", () => {
  const encounter = fight({ orderReady: false, surprisedIds: ["pc-2"] });
  const base = { id: "pc-2", name: "Brom" };
  const dead = { successes: 0, failures: 3, stable: false, dead: true };
  assert.equal(
    reasonOf(canAct({ sheet: hero({ ...base, currentHp: 0, deathSaves: dead, conditions: ["stunned"] }), encounter, kind: "attack" })),
    "dead",
  );
  assert.equal(
    reasonOf(canAct({ sheet: hero({ ...base, currentHp: 0, conditions: ["stunned"] }), encounter, kind: "attack" })),
    "down",
  );
  assert.equal(
    reasonOf(canAct({ sheet: hero({ ...base, conditions: ["stunned"] }), encounter, kind: "attack" })),
    "incapacitated",
  );
  assert.equal(reasonOf(canAct({ sheet: hero(base), encounter, kind: "attack" })), "surprised");
  assert.equal(
    reasonOf(canAct({ sheet: hero(base), encounter: fight({ orderReady: false }), kind: "attack" })),
    "no_initiative",
  );
});

test("every refusal carries a sentence naming the character", () => {
  const result = canAct({ sheet: hero({ currentHp: 0 }), encounter: null, kind: "cast" });
  assert.equal(result.ok, false);
  assert.match(result.error, /Asha/);
  assert.match(result.error, /cast a spell/);
});

// ---- enemies ----

test("a living enemy acts, reacts and takes legendary actions", () => {
  for (const kind of ["action", "reaction", "legendary"]) {
    assert.deepEqual(canEnemyAct({ enemy: goblin(), encounter: fight(), kind }), { ok: true });
  }
});

test("a dead or fled enemy does nothing", () => {
  for (const status of ["dead", "fled"]) {
    assert.equal(
      reasonOf(canEnemyAct({ enemy: goblin({ status }), encounter: fight(), kind: "reaction" })),
      "dead",
    );
  }
});

test("an incapacitated enemy does nothing", () => {
  assert.equal(
    reasonOf(canEnemyAct({ enemy: goblin({ conditions: ["paralyzed"] }), encounter: fight(), kind: "action" })),
    "incapacitated",
  );
});

test("a surprised enemy loses round 1 and its reaction until its place has gone by", () => {
  const encounter = fight({ surprisedIds: ["en-1"] });
  assert.equal(reasonOf(canEnemyAct({ enemy: goblin(), encounter, kind: "action" })), "surprised");
  assert.equal(reasonOf(canEnemyAct({ enemy: goblin(), encounter, kind: "reaction" })), "surprised");
  const later = fight({ surprisedIds: ["en-1"], turnIndex: 2 });
  assert.equal(reasonOf(canEnemyAct({ enemy: goblin(), encounter: later, kind: "action" })), "surprised");
  assert.deepEqual(canEnemyAct({ enemy: goblin(), encounter: later, kind: "reaction" }), { ok: true });
  assert.deepEqual(
    canEnemyAct({ enemy: goblin(), encounter: fight({ round: 2, surprisedIds: ["en-1"] }), kind: "action" }),
    { ok: true },
  );
});

test("an enemy takes one action a round", () => {
  const encounter = fight();
  assert.equal(enemyActedThisRound(encounter, "en-1"), false);
  markEnemyActed(encounter, "en-1");
  assert.equal(enemyActedThisRound(encounter, "en-1"), true);
  assert.equal(reasonOf(canEnemyAct({ enemy: goblin(), encounter, kind: "action" })), "already_acted");
  // The action taken refuses neither the reaction nor a legendary action.
  assert.deepEqual(canEnemyAct({ enemy: goblin(), encounter, kind: "reaction" }), { ok: true });
  assert.deepEqual(canEnemyAct({ enemy: goblin(), encounter, kind: "legendary" }), { ok: true });
  // Another enemy is untouched, and marking twice records once.
  assert.equal(enemyActedThisRound(encounter, "en-2"), false);
  markEnemyActed(encounter, "en-1");
  assert.deepEqual(encounter.legendary.acted, { round: 1, ids: ["en-1"] });
});

test("the next round gives the action back", () => {
  const encounter = fight();
  markEnemyActed(encounter, "en-1");
  encounter.round = 2;
  assert.equal(enemyActedThisRound(encounter, "en-1"), false);
  assert.deepEqual(canEnemyAct({ enemy: goblin(), encounter, kind: "action" }), { ok: true });
  markEnemyActed(encounter, "en-2");
  assert.deepEqual(encounter.legendary.acted, { round: 2, ids: ["en-2"] });
});

test("an enemy owed the round a surprised party lost acts twice, then no more", () => {
  const encounter = fight({ round: 2 });
  oweEnemiesAnAction(encounter, ["en-1"]);
  assert.deepEqual(canEnemyAct({ enemy: goblin(), encounter, kind: "action" }), { ok: true });
  markEnemyActed(encounter, "en-1");
  assert.equal(enemyActedThisRound(encounter, "en-1"), false);
  assert.deepEqual(canEnemyAct({ enemy: goblin(), encounter, kind: "action" }), { ok: true });
  markEnemyActed(encounter, "en-1");
  assert.equal(reasonOf(canEnemyAct({ enemy: goblin(), encounter, kind: "action" })), "already_acted");
  // What is owed belongs to that round and goes with it.
  encounter.round = 3;
  markEnemyActed(encounter, "en-1");
  assert.deepEqual(encounter.legendary.acted, { round: 3, ids: ["en-1"] });
});

test("an encounter stored before the ledger existed reads as nobody having acted", () => {
  const old = fight({ legendary: undefined });
  assert.equal(enemyActedThisRound(old, "en-1"), false);
  assert.deepEqual(canEnemyAct({ enemy: goblin(), encounter: old, kind: "action" }), { ok: true });
});

test("no enemy acts before initiative is in", () => {
  assert.equal(
    reasonOf(canEnemyAct({ enemy: goblin(), encounter: fight({ orderReady: false }), kind: "action" })),
    "no_initiative",
  );
});

console.log(`test-can-act: ${passed} passed`);
