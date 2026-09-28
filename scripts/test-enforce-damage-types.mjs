// Damage types, and what resistance, vulnerability and immunity do to a
// number, on both sides of the table.
//
// SRD 5.1, Damage Resistance and Vulnerability: "If a creature or an object
// has resistance to a damage type, damage of that type is halved against it.
// If a creature or an object has vulnerability to a damage type, damage of
// that type is doubled against it. Resistance and then vulnerability are
// applied after all other modifiers to damage. [...] Multiple instances of
// resistance or vulnerability that affect the same damage type count as only
// one instance." Halving rounds down (SRD 5.1, Round Down). Immunity is no
// damage at all.
//
// ODM's own rules, pinned here as the code documents them:
//   - Resistances are matched as text, on whole words: a damage type is
//     resisted when the stat block's resistance line names it
//     (condition-logic.ts damageAdjust), so "bludgeoning, piercing, and
//     slashing from nonmagical attacks" resists slashing from anything that
//     is not flagged magical.
//   - A character has resistances only. Nothing gives a character an immunity
//     or a vulnerability (apply_damage passes empty lists).
//   - damage_enemy and apply_damage take 1 to 200 a call.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite, abilityMod } from "./lib/enforce-harness.mjs";
import { kit as conditionsKit, FIGHTER } from "./lib/enforce-conditions.mjs";

const { test, finish } = suite("test-enforce-damage-types");
const world = await openWorld({ campaign: { difficulty: "deadly" } });
const kit = conditionsKit(world);
const encounters = await import("../src/lib/db/encounters.ts");

const TYPES = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison",
  "psychic", "radiant", "slashing", "thunder",
];
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];
const NONMAGICAL = "bludgeoning, piercing, and slashing from nonmagical attacks";

const base = { ...FIGHTER, level: 20, maxHp: 100 };
const human = world.addHero({
  ...base,
  equipment: [...FIGHTER.equipment, { name: "Longsword +1", qty: 1 }, { name: "Mace", qty: 1 }],
});
const tiefling = world.addHero({ ...base, race: "tiefling" });
const dwarf = world.addHero({ ...base, race: "hill dwarf" });
const halfling = world.addHero({ ...base, race: "stout halfling" });
const barbarian = world.addHero({ ...base, class: "barbarian" });
const rogue = world.addHero({ ...base, class: "rogue", abilities: { dex: 16 } });

// What a character loses to one typed hit of apply_damage.
async function hurt(id, amount, type, extra = {}) {
  kit.reset(id, extra);
  const before = world.sheet(id);
  const out = await world.invoke("apply_damage", { characterId: id, amount, type });
  const after = world.sheet(id);
  return {
    out,
    hp: before.currentHp - after.currentHp,
    temp: before.tempHp - after.tempHp,
  };
}

// ---- characters ----

for (const type of TYPES) {
  await test(`${type}: a character with no resistance takes it whole`, async () => {
    assert.equal((await hurt(human.id, 10, type)).hp, 10);
  });
  await test(`${type}: a tiefling halves fire and nothing else`, async () => {
    assert.equal((await hurt(tiefling.id, 10, type)).hp, type === "fire" ? 5 : 10);
  });
  await test(`${type}: a dwarf and a stout halfling halve poison and nothing else`, async () => {
    assert.equal((await hurt(dwarf.id, 10, type)).hp, type === "poison" ? 5 : 10);
    assert.equal((await hurt(halfling.id, 10, type)).hp, type === "poison" ? 5 : 10, "stout halfling");
  });
  await test(`${type}: rage halves bludgeoning, piercing and slashing, only while it lasts`, async () => {
    const raging = await hurt(barbarian.id, 10, type, { conditions: ["raging"] });
    assert.equal(raging.hp, PHYSICAL.includes(type) ? 5 : 10);
    assert.equal((await hurt(barbarian.id, 10, type)).hp, 10);
  });
}

await test("halving rounds down: 7 becomes 3, 25 becomes 12", async () => {
  assert.equal((await hurt(tiefling.id, 7, "fire")).hp, 3);
  assert.equal((await hurt(tiefling.id, 25, "fire")).hp, 12);
  assert.equal((await hurt(tiefling.id, 2, "fire")).hp, 1);
});

await test("the type is read whatever its case or spacing; no type and an unknown type change nothing", async () => {
  for (const type of ["Fire", "FIRE", "  fire  "]) {
    assert.equal((await hurt(tiefling.id, 10, type)).hp, 5, type);
  }
  for (const type of [undefined, "", "weird", "sonic"]) {
    assert.equal((await hurt(tiefling.id, 10, type)).hp, 10, String(type));
  }
});

await test("several sources of one resistance halve once", async () => {
  // Hellish Resistance, a story feature and Absorb Elements all name fire.
  const out = await hurt(tiefling.id, 20, "fire", {
    conditions: ["absorb elements (fire)"],
    features: [...world.sheet(tiefling.id).features, { name: "Fire Resistance", source: "story" }],
  });
  assert.equal(out.hp, 10);
  world.patch(tiefling.id, { features: tiefling.features });
  const stacked = await hurt(barbarian.id, 20, "slashing", { conditions: ["raging", "stoneskin"] });
  assert.equal(stacked.hp, 10);
});

await test("resistance comes first, then temporary hit points, then hit points", async () => {
  const out = await hurt(tiefling.id, 20, "fire", { tempHp: 4 });
  assert.equal(out.temp, 4);
  assert.equal(out.hp, 6);
});

await test("the damage a call may carry is 1 to 200", async () => {
  for (const amount of [0, -5]) {
    const out = await hurt(human.id, amount, "fire");
    assert.equal(out.out.ok, false);
    assert.equal(out.hp, 0);
  }
  assert.equal((await hurt(human.id, 1, "fire")).hp, 1);
  world.patch(human.id, { maxHp: 500 });
  assert.equal((await hurt(human.id, 200, "fire")).hp, 200);
  // ODM's rule: past the cap the call is clamped, not refused.
  assert.equal((await hurt(human.id, 100000, "fire")).hp, 200);
  world.patch(human.id, { maxHp: 100, currentHp: 100 });
});

await test("rage ends when the barbarian drops to 0 hit points", async () => {
  kit.reset(barbarian.id, { conditions: ["raging"], currentHp: 4 });
  await world.invoke("apply_damage", { characterId: barbarian.id, amount: 20, type: "fire" });
  assert.equal(world.sheet(barbarian.id).currentHp, 0);
  // Down is unconscious and prone, and no longer raging.
  assert.deepEqual(world.sheet(barbarian.id).conditions, ["unconscious", "prone"]);
});

// SRD 5.1 magic items that grant a resistance, all of which need attunement.
const ITEMS = {
  "Boots of the Winterlands": "cold",
  "Brooch of Shielding": "force",
  "Belt of Dwarvenkind": "poison",
  "Cloak of Arachnida": "poison",
};
for (const [name, type] of Object.entries(ITEMS)) {
  await test(`${name}: ${type} is halved while attuned, and not before`, async () => {
    const carried = await hurt(human.id, 10, type, { equipment: [{ name, qty: 1 }] });
    assert.equal(carried.hp, 10);
    const attuned = await hurt(human.id, 10, type, { equipment: [{ name, qty: 1, attuned: true }] });
    assert.equal(attuned.hp, 5);
    const other = await hurt(human.id, 10, type === "cold" ? "fire" : "cold", {
      equipment: [{ name, qty: 1, attuned: true }],
    });
    assert.equal(other.hp, 10);
    world.patch(human.id, { equipment: human.equipment });
  });
}

// ---- enemies ----

const roster = world.hasPack
  ? [{ monster: "goblin", count: 2 }, { monster: "skeleton" }, { monster: "zombie" },
    { monster: "fire-elemental" }, { monster: "ghoul" }, { monster: "werewolf" },
    { monster: "gargoyle" }]
  : [{ monster: "goblin", count: 2 }];
for (const sheet of world.sheets()) {
  kit.reset(sheet.id);
}
await world.beginFight(roster, { heroFaces: { [human.id]: 20 } });
kit.offBoard();
const [dummy, bystander] = world.enemies();
encounters.patchEnemyIdentity(dummy.id, { maxHp: 200 });
const named = (slug) => world.enemies().find((enemy) => enemy.slug === slug);

function dress(stats) {
  kit.setEnemyStats(dummy.id, { resist: "", immune: "", vulnerable: "", conditionImmune: "", ...stats });
  return kit.resetEnemy(dummy.id);
}
async function strike(enemyId, amount, type) {
  const before = kit.resetEnemy(enemyId);
  const out = await world.invoke("damage_enemy", { enemyId, amount, type });
  return { out, lost: before.currentHp - kit.enemy(enemyId).currentHp };
}

for (const type of TYPES) {
  await test(`${type}: resisted 10 is 5, vulnerable 10 is 20, immune 10 is 0`, async () => {
    dress({ resist: type });
    assert.equal((await strike(dummy.id, 10, type)).lost, 5);
    dress({ vulnerable: type });
    assert.equal((await strike(dummy.id, 10, type)).lost, 20);
    dress({ immune: type });
    assert.equal((await strike(dummy.id, 10, type)).lost, 0);
    dress({ resist: TYPES.filter((other) => other !== type).join(", ") });
    assert.equal((await strike(dummy.id, 10, type)).lost, 10);
  });
}

await test("immunity beats vulnerability and resistance", async () => {
  dress({ immune: "fire", vulnerable: "fire", resist: "fire" });
  assert.equal((await strike(dummy.id, 10, "fire")).lost, 0);
});

await test("an enemy's resistance line naming three types resists each", async () => {
  dress({ resist: NONMAGICAL });
  for (const type of PHYSICAL) {
    assert.equal((await strike(dummy.id, 9, type)).lost, 4, type);
  }
  assert.equal((await strike(dummy.id, 9, "fire")).lost, 9);
});

await test("damage_enemy refuses 0, a negative and more than 200", async () => {
  dress({});
  for (const amount of [0, -4, 201]) {
    const out = await strike(dummy.id, amount, "fire");
    assert.equal(out.out.ok, false, String(amount));
    assert.equal(out.lost, 0);
  }
});

await test("the fighter's modifier is added before the halving", async () => {
  dress({ resist: "slashing" });
  const out = await kit.swing([18, 6], human.id, dummy.id, { weapon: "Longsword" });
  assert.equal(out.result.damage, 6 + abilityMod(16));
  // (6 + 3) halved is 4, not 6 halved plus 3.
  assert.equal(200 - kit.enemy(dummy.id).currentHp, 4);
});

await test("a critical hit is doubled dice, then resistance or vulnerability", async () => {
  dress({ resist: "slashing" });
  const halved = await kit.swing([20, 5, 5], human.id, dummy.id, { weapon: "Longsword" });
  assert.equal(halved.result.crit, true);
  assert.equal(200 - kit.enemy(dummy.id).currentHp, Math.floor((5 + 5 + 3) / 2));
  dress({ vulnerable: "bludgeoning" });
  const doubled = await kit.swing([20, 3, 3], human.id, dummy.id, { weapon: "Mace" });
  assert.equal(doubled.result.crit, true);
  assert.equal(200 - kit.enemy(dummy.id).currentHp, (3 + 3 + 3) * 2);
});

await test("an enemy dies at 0 hit points, never below, and takes no more", async () => {
  dress({});
  encounters.patchEnemyHp(dummy.id, 5, "alive");
  const out = await world.invoke("damage_enemy", { enemyId: dummy.id, amount: 60, type: "fire" });
  assert.equal(out.ok, true, out.error);
  assert.equal(kit.enemy(dummy.id).currentHp, 0);
  assert.equal(kit.enemy(dummy.id).status, "dead");
  const again = await world.invoke("damage_enemy", { enemyId: dummy.id, amount: 5 });
  assert.equal(again.ok, false);
  kit.resetEnemy(dummy.id);
  assert.equal(kit.enemy(bystander.id).status, "alive");
});

await test("an area effect and the damage tray both go through the stat block", async () => {
  dress({ resist: "fire" });
  const blast = await kit.withDice([6, 6, 1], "aoe_damage", {
    damage: "2d6", saveAbility: "dex", dc: 30, type: "fire", halfOnSave: true, enemyIds: [dummy.id],
  });
  assert.equal(blast.outcome.ok, true, blast.outcome.error);
  assert.equal(200 - kit.enemy(dummy.id).currentHp, 6);
  kit.resetEnemy(dummy.id);
  kit.reset(tiefling.id);
  const tray = await world.invoke("split_damage", {
    amount: 21,
    type: "fire",
    targets: [
      { enemyId: dummy.id, share: "double" },
      { characterId: tiefling.id, share: "half" },
      { characterId: human.id, share: "none" },
    ],
  });
  assert.equal(tray.ok, true, tray.error);
  assert.equal(200 - kit.enemy(dummy.id).currentHp, 21);
  assert.equal(100 - world.sheet(tiefling.id).currentHp, 5);
  assert.equal(world.sheet(human.id).currentHp, 100);
});

await test("evasion: a Dexterity save for half becomes none on a success and half on a failure", async () => {
  kit.reset(rogue.id);
  kit.reset(human.id);
  const failed = await kit.withDice([6, 6, 1, 1], "aoe_damage", {
    damage: "2d6", saveAbility: "dex", dc: 25, type: "fire", halfOnSave: true,
    characterIds: [rogue.id, human.id],
  });
  assert.equal(failed.outcome.ok, true, failed.outcome.error);
  assert.equal(100 - world.sheet(rogue.id).currentHp, 6);
  assert.equal(100 - world.sheet(human.id).currentHp, 12);
  kit.reset(rogue.id);
  kit.reset(human.id);
  await kit.withDice([6, 6, 20, 20], "aoe_damage", {
    damage: "2d6", saveAbility: "dex", dc: 5, type: "fire", halfOnSave: true,
    characterIds: [rogue.id, human.id],
  });
  assert.equal(world.sheet(rogue.id).currentHp, 100);
  assert.equal(100 - world.sheet(human.id).currentHp, 6);
  kit.reset(rogue.id);
  // Not a Dexterity save: evasion does nothing.
  await kit.withDice([6, 6, 20], "aoe_damage", {
    damage: "2d6", saveAbility: "con", dc: 5, type: "poison", halfOnSave: true,
    characterIds: [rogue.id],
  });
  assert.equal(100 - world.sheet(rogue.id).currentHp, 6);
});

if (world.hasPack) {
  // SRD 5.1 stat blocks, as [type, what 10 points of it become].
  const BESTIARY = {
    skeleton: [["bludgeoning", 20], ["slashing", 10], ["fire", 10]],
    "fire-elemental": [["fire", 0], ["poison", 0], ["slashing", 5], ["cold", 10]],
    ghoul: [["poison", 0], ["slashing", 10]],
    werewolf: [["slashing", 0], ["piercing", 0], ["bludgeoning", 0], ["fire", 10]],
    gargoyle: [["poison", 0], ["slashing", 5], ["fire", 10]],
    zombie: [["slashing", 10], ["fire", 10]],
  };
  for (const [slug, rows] of Object.entries(BESTIARY)) {
    await test(`${slug}: the stat block's own resistances are applied`, async () => {
      const enemy = named(slug);
      assert.ok(enemy, `${slug} did not join the fight`);
      encounters.patchEnemyIdentity(enemy.id, { maxHp: 200 });
      for (const [type, expected] of rows) {
        assert.equal((await strike(enemy.id, 10, type)).lost, expected, `${slug} ${type}`);
      }
    });
  }

  await test(
    "A skeleton and a zombie are immune to poison damage (SRD 5.1 stat blocks: 'Damage Immunities poison'), read corrected from the pack row.",
    async () => {
      for (const slug of ["skeleton", "zombie"]) {
        const enemy = named(slug);
        encounters.patchEnemyIdentity(enemy.id, { maxHp: 200 });
        const out = await strike(enemy.id, 10, "poison");
        assert.equal(out.lost, 0, `a ${slug} lost ${out.lost} hit points to poison`);
      }
    },
  );
}

// ---- gaps ----

await test("Resistance halves and the half is rounded down, so 1 point of resisted damage is 0 (SRD 5.1, Damage Resistance and Round Down).", async () => {
  const out = await hurt(tiefling.id, 1, "fire");
  assert.equal(out.hp, 0, `1 point of resisted fire cost ${out.hp} hit point`);
});

await test("Resistance and then vulnerability are applied, in that order: 25 is halved to 12 and doubled to 24 (SRD 5.1, Damage Resistance and Vulnerability).", async () => {
  dress({ resist: "fire", vulnerable: "fire" });
  const out = await strike(dummy.id, 25, "fire");
  assert.equal(out.lost, 24, `25 fire against both became ${out.lost}`);
});

await test("Resistance or immunity to 'bludgeoning, piercing, and slashing from nonmagical attacks' does not apply to a magic weapon, nor to a monk's or druid's strikes that count as magical (SRD 5.1, stat blocks and Magic Weapons).", async () => {
  dress({ resist: NONMAGICAL });
  kit.reset(human.id, { equipment: [{ name: "Longsword +1", qty: 1 }] });
  try {
    const out = await kit.swing([18, 6], human.id, dummy.id, { weapon: "Longsword +1" });
    assert.equal(out.outcome.ok, true, out.outcome.error);
    // 1d8 + 3 Strength + 1 for the blade.
    assert.equal(out.result.damage, 6 + abilityMod(16) + 1);
    const lost = 200 - kit.enemy(dummy.id).currentHp;
    assert.equal(lost, out.result.damage, `a +1 sword dealt ${out.result.damage} and ${lost} landed`);
  } finally {
    world.patch(human.id, { equipment: human.equipment });
  }
});

await test("A petrified creature has resistance to all damage (SRD 5.1, Conditions).", async () => {
  dress({});
  kit.resetEnemy(dummy.id, ["petrified"]);
  const before = kit.enemy(dummy.id).currentHp;
  await world.invoke("damage_enemy", { enemyId: dummy.id, amount: 10, type: "slashing" });
  const lost = before - kit.enemy(dummy.id).currentHp;
  assert.equal(lost, 5, `a petrified enemy lost ${lost} to 10 slashing`);
  assert.equal((await hurt(human.id, 10, "fire", { conditions: ["petrified"] })).hp, 5);
});

await test("A resistance applies to its own damage type and to no other word.", async () => {
  const out = await hurt(tiefling.id, 10, "fir");
  assert.equal(out.hp, 10, `damage of type "fir" was halved by fire resistance`);
});

await test("A hit that deals two damage types is resolved per type: resistance to slashing does not halve the radiant dice riding the blow (SRD 5.1, Damage Resistance and Vulnerability).", async () => {
  dress({ resist: "slashing" });
  kit.reset(human.id, { conditions: ["divine favor"] });
  const out = await kit.swing([18, 6, 4], human.id, dummy.id, { weapon: "Longsword" });
  assert.equal(out.outcome.ok, true, out.outcome.error);
  assert.deepEqual(out.dice, ["d20:18", "d8:6", "d4:4"]);
  const lost = 200 - kit.enemy(dummy.id).currentHp;
  // Slashing 6 + 3 halved is 4, and the 4 radiant lands whole.
  assert.equal(lost, 8, `9 slashing and 4 radiant against slashing resistance cost ${lost}`);
});

world.close();
finish();
