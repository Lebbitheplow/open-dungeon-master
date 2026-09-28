// Hit points, temporary hit points and healing, as the sheet stores them.
//
// SRD 5.1, Damage and Healing:
//   - Hit points never go below 0 and healing never takes them above the hit
//     point maximum.
//   - Temporary hit points are a buffer, not hit points: damage comes off them
//     first and the rest carries over; healing cannot restore them; they do
//     not stack (a creature decides which to keep, so the higher one stands);
//     they can exceed the maximum; they last until spent or until a long
//     rest; at 0 hit points they neither wake nor stabilize a creature.
//
// ODM's own rules, pinned here as the code documents them:
//   - Temporary hit points are granted through heal with temp:true, and the
//     higher value always wins (src/lib/dm/mutations.ts heal).
//   - heal takes 1 to 200 a call and clamps a larger number rather than
//     refusing it; temporary hit points hold no duration of their own.
//   - A healing spell named to heal is rolled by the server from the content
//     pack's dice plus the caster's ability modifier.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-enforce-temp-hp-healing");
const world = await openWorld();
const kit = conditionsKit(world);

const hero = world.addHero(FIGHTER);
const healer = world.addHero({
  class: "cleric",
  level: 5,
  abilities: { wis: 16 },
  maxHp: 30,
  spellcasting: {
    ability: "wis",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } },
    prepared: ["Cure Wounds", "Healing Word"],
    known: [],
    cantrips: [],
  },
});

const pools = (id = hero.id) => {
  const sheet = world.sheet(id);
  return { hp: sheet.currentHp, temp: sheet.tempHp };
};
const damage = (amount, id = hero.id) => world.invoke("apply_damage", { characterId: id, amount });
const heal = (amount, extra = {}, id = hero.id) =>
  world.invoke("heal", { characterId: id, amount, ...extra });
const grant = (amount, id = hero.id) => heal(amount, { temp: true }, id);

// ---- temporary hit points ----

await test("temporary hit points take the damage first and the rest carries over", async () => {
  kit.reset(hero.id, { tempHp: 5 });
  await damage(3);
  assert.deepEqual(pools(), { hp: 40, temp: 2 });
  await damage(7);
  assert.deepEqual(pools(), { hp: 35, temp: 0 });
});

await test("temporary hit points do not stack: the higher value stands", async () => {
  kit.reset(hero.id);
  assert.equal((await grant(5)).ok, true);
  assert.deepEqual(pools(), { hp: 40, temp: 5 });
  await grant(3);
  assert.equal(pools().temp, 5);
  await grant(5);
  assert.equal(pools().temp, 5);
  await grant(8);
  assert.equal(pools().temp, 8);
  await damage(6);
  await grant(4);
  assert.equal(pools().temp, 4, "2 left of 8, then 4 offered: 4 is higher");
});

await test("temporary hit points sit on top of a full pool and are not hit points", async () => {
  kit.reset(hero.id);
  await grant(12);
  assert.deepEqual(pools(), { hp: 40, temp: 12 });
});

await test("healing does not restore temporary hit points", async () => {
  kit.reset(hero.id, { tempHp: 8 });
  await damage(18);
  assert.deepEqual(pools(), { hp: 30, temp: 0 });
  await grant(6);
  await damage(4);
  await heal(100);
  assert.deepEqual(pools(), { hp: 40, temp: 2 });
});

await test("a grant of 0 or less is refused", async () => {
  kit.reset(hero.id, { tempHp: 3 });
  for (const amount of [0, -4]) {
    assert.equal((await grant(amount)).ok, false);
  }
  assert.equal(pools().temp, 3);
});

await test("at 0 hit points temporary hit points neither wake nor stabilize", async () => {
  kit.reset(hero.id, { currentHp: 3 });
  await damage(3);
  const track = world.sheet(hero.id).deathSaves;
  assert.deepEqual(track, { successes: 0, failures: 0, stable: false, dead: false });
  assert.equal((await grant(6)).ok, true);
  assert.deepEqual(pools(), { hp: 0, temp: 6 });
  assert.deepEqual(world.sheet(hero.id).deathSaves, track);
});

await test("a long rest ends temporary hit points; a short rest does not", async () => {
  kit.reset(hero.id, { tempHp: 7 });
  await world.invoke("take_rest", { kind: "short" });
  assert.equal(pools().temp, 7);
  await world.invoke("take_rest", { kind: "long" });
  assert.deepEqual(pools(), { hp: 40, temp: 0 });
});

// ---- healing ----

await test("healing stops at the hit point maximum", async () => {
  kit.reset(hero.id, { currentHp: 38 });
  assert.equal((await heal(5)).ok, true);
  assert.equal(pools().hp, 40);
  await heal(200);
  assert.equal(pools().hp, 40);
});

await test("healing by 0 or a negative number is refused", async () => {
  kit.reset(hero.id, { currentHp: 20 });
  for (const amount of [0, -3]) {
    assert.equal((await heal(amount)).ok, false);
  }
  assert.equal(pools().hp, 20);
  const none = await world.invoke("heal", { characterId: hero.id });
  assert.equal(none.ok, false);
  assert.equal(pools().hp, 20);
});

await test("damage stops at 0 hit points", async () => {
  kit.reset(hero.id, { currentHp: 5 });
  await damage(30);
  assert.equal(pools().hp, 0);
});

await test("healing a character at 0 hit points brings them round and ends the dying", async () => {
  kit.reset(hero.id, { currentHp: 5 });
  await damage(5);
  assert.notEqual(world.sheet(hero.id).deathSaves, null);
  assert.equal((await heal(1)).ok, true);
  assert.equal(pools().hp, 1);
  assert.equal(world.sheet(hero.id).deathSaves, null);
});

await test("the dead cannot be healed or given temporary hit points", async () => {
  kit.reset(hero.id, {
    currentHp: 0,
    deathSaves: { successes: 0, failures: 3, stable: false, dead: true },
  });
  assert.equal((await heal(10)).ok, false);
  assert.equal((await grant(10)).ok, false);
  assert.deepEqual(pools(), { hp: 0, temp: 0 });
  assert.equal(world.sheet(hero.id).deathSaves.dead, true);
});

if (world.hasPack) {
  await test("Cure Wounds is 1d8 plus the caster's modifier, and 1d8 more a slot level", async () => {
    kit.reset(hero.id, { currentHp: 1 });
    const first = await kit.withDice([5, 5], "heal", {
      characterId: hero.id, spell: "Cure Wounds", casterId: healer.id, level: 1,
    });
    assert.equal(first.outcome.ok, true, first.outcome.error);
    assert.deepEqual(first.dice, ["d8:5"]);
    assert.equal(pools().hp, 1 + 5 + abilityMod(16));
    kit.reset(hero.id, { currentHp: 1 });
    const upcast = await kit.withDice([5, 6, 7], "heal", {
      characterId: hero.id, spell: "Cure Wounds", casterId: healer.id, level: 2,
    });
    assert.deepEqual(upcast.dice, ["d8:5", "d8:6"]);
    assert.equal(pools().hp, 1 + 5 + 6 + abilityMod(16));
  });

  await test("Healing Word is 1d4 plus the caster's modifier", async () => {
    kit.reset(hero.id, { currentHp: 1 });
    const out = await kit.withDice([3, 3], "heal", {
      characterId: hero.id, spell: "Healing Word", casterId: healer.id, level: 1,
    });
    assert.equal(out.outcome.ok, true, out.outcome.error);
    assert.deepEqual(out.dice, ["d4:3"]);
    assert.equal(pools().hp, 1 + 3 + abilityMod(16));
  });
}

await test("hit points stay inside 0 and the maximum through any run of damage and healing", async () => {
  kit.reset(hero.id);
  // A fixed sequence, so a failure can be replayed.
  let seed = 20260927;
  const next = (span) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 1 + (seed % span);
  };
  for (let turn = 0; turn < 120; turn += 1) {
    const kind = next(3);
    if (world.sheet(hero.id).deathSaves?.dead) {
      kit.reset(hero.id);
    }
    if (kind === 1) {
      await damage(next(30));
    } else if (kind === 2) {
      await heal(next(30));
    } else {
      await grant(next(12));
    }
    const now = pools();
    assert.ok(now.hp >= 0 && now.hp <= 40, `hit points ${now.hp} after step ${turn}`);
    assert.ok(now.temp >= 0 && now.temp <= 12, `temporary hit points ${now.temp} after step ${turn}`);
  }
  kit.reset(hero.id);
});

// Without the content pack heal cannot derive a spell's dice and refuses the
// call for that reason, which would read as the rule being held.
if (world.hasPack) await test("a fighter with no spellcasting cannot cast Cure Wounds through heal", async () => {
  const fighter = world.sheet(hero.id);
  assert.equal(fighter.spellcasting, null);
  kit.reset(hero.id, { currentHp: 1 });
  const out = await kit.withDice([8], "heal", {
    characterId: hero.id, spell: "Cure Wounds", casterId: hero.id, level: 1,
  });
  assert.equal(out.outcome.ok, false, "a fighter with no spellcasting cast Cure Wounds on themselves");
  assert.equal(pools().hp, 1);
});

world.close();
finish();
