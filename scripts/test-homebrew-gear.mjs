// Homebrew gear: the structured half of a homebrew entry, normalized into
// the SRD shapes the engines already read, and the snapshot a sheet's
// equipment line carries. See docs/workshop-parity-audit.md phase 11.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  describeHomebrew,
  gearFromHomebrewData,
  normalizeArmor,
  normalizeEffects,
  normalizeHomebrewData,
  normalizeSpellMech,
  normalizeWeapon,
} = await import("../src/lib/homebrew/gear.ts");
const { computeArmorClass } = await import("../src/lib/srd/armor.ts");
const { magicItemRiders, effectiveAbilities } = await import("../src/lib/srd/magic-items.ts");
const { resolveAttackWeapon } = await import("../src/lib/dm/attack-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a weapon needs damage the table can roll", () => {
  assert.ok("error" in normalizeWeapon({}, "Stick"));
  const bad = normalizeWeapon({ damage: "2dx slashing" }, "Stick");
  assert.ok("error" in bad);
  assert.ok(bad.error.includes("2dx"));
  const good = normalizeWeapon(
    { category: "martial", kind: "melee", damage: "1d10 slashing", properties: ["heavy", "reach", "nonsense"], rangeFt: 0 },
    "Glaive of Marr",
  );
  assert.ok("data" in good);
  assert.deepEqual(good.data, {
    name: "Glaive of Marr",
    category: "martial",
    kind: "melee",
    damage: "1d10 slashing",
    properties: ["heavy", "reach"],
  });
});

test("armour is clamped to what the engine can wear", () => {
  assert.ok("error" in normalizeArmor({ category: "light" }, "Vest"));
  assert.ok("error" in normalizeArmor({ category: "light", baseAc: 30 }, "Vest"));
  assert.ok("error" in normalizeArmor({ category: "shield", baseAc: 9 }, "Wall"));
  const medium = normalizeArmor({ category: "medium", baseAc: 14, dexCap: 2, weightLb: 20 }, "Scale");
  assert.ok("data" in medium);
  assert.equal(medium.data.dexCap, 2);
  const heavy = normalizeArmor({ category: "heavy", baseAc: 17, dexCap: 5, strengthRequirement: 15, stealthDisadvantage: true }, "Plate");
  assert.ok("data" in heavy);
  assert.equal(heavy.data.dexCap, 0, "heavy armour lets no DEX through whatever was typed");
  assert.equal(heavy.data.strengthRequirement, 15);
  const light = normalizeArmor({ category: "light", baseAc: 12, dexCap: 2 }, "Leather");
  assert.ok("data" in light);
  assert.equal(light.data.dexCap, undefined, "light armour lets all DEX through");
});

test("effects keep the magic-items vocabulary and drop what they cannot read", () => {
  const effects = normalizeEffects([
    { kind: "ac_bonus", amount: 1 },
    { kind: "ac_bonus", amount: 0 },
    { kind: "save_bonus", amount: 99 },
    { kind: "set_ability", ability: "str", score: 19 },
    { kind: "set_ability", ability: "luck", score: 19 },
    { kind: "resistance", types: ["Fire", "fire", "cold"] },
    { kind: "teleport" },
    "nope",
  ]);
  assert.deepEqual(effects, [
    { kind: "ac_bonus", amount: 1 },
    { kind: "save_bonus", amount: 5 },
    { kind: "set_ability", ability: "str", score: 19 },
    { kind: "set_ability", ability: "str", score: 19 },
    { kind: "resistance", types: ["fire", "cold"] },
  ]);
});

test("an item entry normalizes by kind and the snapshot only exists when it means something", () => {
  const gearOnly = normalizeHomebrewData("item", { desc: "A rope.", itemKind: "gear", weight: 10 }, "Silk rope");
  assert.ok("data" in gearOnly);
  assert.equal(gearOnly.data.weight, 10);
  assert.equal(gearOnly.data.weapon, undefined);
  const snapshot = gearFromHomebrewData("Silk rope", gearOnly.data);
  assert.deepEqual(snapshot, { weight: 10 });
  assert.equal(gearFromHomebrewData("Rope", { desc: "A rope." }), null);

  const weapon = normalizeHomebrewData(
    "item",
    { itemKind: "weapon", weapon: { damage: "1d8 piercing", kind: "ranged", rangeFt: 80 } },
    "Bone bow",
  );
  assert.ok("data" in weapon);
  const bow = gearFromHomebrewData("Bone bow", weapon.data);
  assert.equal(bow.weapon.damage, "1d8 piercing");
  assert.equal(bow.weapon.rangeFt, 80);

  const refused = normalizeHomebrewData("item", { itemKind: "weapon", weapon: { damage: "lots" } }, "Bad");
  assert.ok("error" in refused);
});

test("a magic item carries its effects and attunement into the snapshot", () => {
  const ring = normalizeHomebrewData(
    "item",
    {
      itemKind: "magic_item",
      rarity: "rare",
      requiresAttunement: true,
      effects: [{ kind: "ac_bonus", amount: 1 }, { kind: "save_bonus", amount: 1 }],
      charges: { max: 3, recharge: "dawn" },
    },
    "Ring of the Marsh",
  );
  assert.ok("data" in ring);
  assert.deepEqual(ring.data.charges, { max: 3, recharge: "dawn" });
  const gear = gearFromHomebrewData("Ring of the Marsh", ring.data);
  assert.equal(gear.magic.requiresAttunement, true);
  assert.equal(gear.magic.effects.length, 2);
  assert.ok(describeHomebrew("item", ring.data).includes("AC +1"));
  assert.ok(describeHomebrew("item", ring.data).includes("attunement"));
});

test("the armour engine reads a snapshotted homebrew armour as it reads SRD plate", () => {
  const plate = normalizeArmor({ category: "heavy", baseAc: 19, strengthRequirement: 17, stealthDisadvantage: true, weightLb: 70 }, "Marrow harness");
  assert.ok("data" in plate);
  const worn = computeArmorClass({
    equipment: [{ name: "Marrow harness", equipped: true, gear: { armor: plate.data } }],
    armorProfs: ["heavy"],
    dexMod: 3,
    abilityMods: { con: 2, wis: 1 },
    strength: 18,
    unarmored: null,
  });
  assert.equal(worn.ac, 19, "heavy armour ignores DEX and takes the homebrew base");
  assert.equal(worn.armorName, "Marrow harness");
  assert.equal(worn.stealthDisadvantage, true);
  // A name the SRD would never match still gets its class from the snapshot.
  const bare = computeArmorClass({
    equipment: [{ name: "Marrow harness", equipped: true }],
    armorProfs: ["heavy"],
    dexMod: 3,
    abilityMods: { con: 2, wis: 1 },
    strength: 18,
    unarmored: null,
  });
  assert.equal(bare.armorName, null, "without the snapshot the name means nothing");
});

test("the magic-item engine reads snapshotted effects, and attunement gates them", () => {
  const magic = { requiresAttunement: true, effects: [{ kind: "ac_bonus", amount: 2 }, { kind: "set_ability", ability: "con", score: 19 }] };
  const unattuned = magicItemRiders([{ name: "Amulet of the Fen", gear: { magic } }]);
  assert.equal(unattuned.acBonus, 0);
  const attuned = magicItemRiders([{ name: "Amulet of the Fen", attuned: true, gear: { magic } }]);
  assert.equal(attuned.acBonus, 2);
  assert.deepEqual(attuned.sources, ["Amulet of the Fen"]);
  const abilities = effectiveAbilities(
    { str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
    [{ name: "Amulet of the Fen", attuned: true, gear: { magic } }],
  );
  assert.equal(abilities.con, 19);
});

test("the attack profile picks a snapshotted homebrew weapon over the SRD table", () => {
  const weapon = normalizeWeapon({ category: "martial", kind: "melee", damage: "2d4 slashing", properties: ["finesse"] }, "Dagger of Thorns");
  assert.ok("data" in weapon);
  const equipment = [{ name: "Dagger of Thorns", qty: 1, gear: { weapon: weapon.data } }];
  // Named: "dagger" fuzzy-matches the carried item, whose own block wins
  // over the SRD dagger the name resembles.
  const named = resolveAttackWeapon(equipment, ["martial"], "dagger");
  assert.equal(named.srd.damage, "2d4 slashing");
  // Unnamed: the best carried weapon is the homebrew one.
  const best = resolveAttackWeapon(equipment, ["martial"], undefined);
  assert.equal(best.displayName, "Dagger of Thorns");
  assert.equal(best.srd.damage, "2d4 slashing");
});

test("a spell entry keeps its block only when it is one the engine can run", () => {
  assert.equal(normalizeSpellMech({ resolution: "fireworks" }), null);
  const saved = normalizeSpellMech({ resolution: "save", save: "dex", halfOnSave: true, damageType: "Fire" });
  assert.deepEqual(saved, { resolution: "save", save: "dex", halfOnSave: true, damageType: "fire" });
  const refused = normalizeHomebrewData("spell", { desc: "Boom.", mech: { resolution: "save" } }, "Boom");
  assert.ok("error" in refused);
  const fine = normalizeHomebrewData(
    "spell",
    { desc: "Each creature in a 20-foot radius takes 3d6 fire damage.", level: "2", school: "Evocation", classes: ["Wizard"], mech: saved },
    "Marsh fire",
  );
  assert.ok("data" in fine);
  assert.equal(fine.data.level, 2);
  assert.equal(fine.data.school, "evocation");
  assert.deepEqual(fine.data.classes, ["wizard"]);
  assert.equal(fine.data.casting_time, "1 action");
  assert.ok(describeHomebrew("spell", fine.data).includes("level 2"));
});

test("character options keep the fields the builder reads", () => {
  const background = normalizeHomebrewData(
    "background",
    { desc: "Raised on the salt flats.", skill_proficiencies: "Survival, Athletics", feature: "Salt Lore" },
    "Salter",
  );
  assert.ok("data" in background);
  assert.equal(background.data.skill_proficiencies, "Survival, Athletics");
  const race = normalizeHomebrewData(
    "race",
    { desc: "Marsh folk.", speed: { walk: 35 }, asi: [{ attributes: ["Dexterity"], value: 2 }, { attributes: [], value: 1 }] },
    "Fenborn",
  );
  assert.ok("data" in race);
  assert.deepEqual(race.data.speed, { walk: 35 });
  assert.equal(race.data.asi.length, 1);
  const archetype = normalizeHomebrewData(
    "archetype",
    { desc: "A ranger of the reeds.", classSlug: "Ranger", levels: { 3: [{ n: "Reed Walker", d: "Ignore marsh terrain." }], 99: [{ n: "Nope" }] } },
    "Fen Warden",
  );
  assert.ok("data" in archetype);
  assert.equal(archetype.data.classSlug, "ranger");
  assert.deepEqual(Object.keys(archetype.data.levels), ["3"]);
  assert.ok(describeHomebrew("archetype", archetype.data).includes("ranger"));
});

console.log(`test-homebrew-gear: ${passed} passed`);
