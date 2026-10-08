// What the combat feats do, as src/lib/srd/feat-combat.ts reads them from
// sheet.feats (issue #125): the -5/+10 trade of Great Weapon Master and
// Sharpshooter, Sharpshooter's and Spell Sniper's cover and range, Crossbow
// Expert's and Gunner's shot in melee, Elemental Adept's type and dice
// floor, Dungeon Delver's notice, Defensive Duelist's bonus, the prompt tag.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  defensiveDuelistBonus, dungeonDelverNotices, elementalAdeptApplies, elementalAdeptType, featEngineTag, floorDamageDice,
  powerAttackFeat, shootsFreelyInMelee, shotIgnoresCover, shotIgnoresLongRange, spellIgnoresCover, spellRangeFactor,
} = await import("../src/lib/srd/feat-combat.ts");
const { featGrantSpec, featPicksOwed, applyFeatGrants } = await import("../src/lib/srd/feat-grants.ts");
const { authoredFeatDesc } = await import("../src/lib/srd/feat-effects.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const sheet = (feats, extra = {}) => ({ feats, features: [], ...extra });

test("the -5/+10 trade belongs to the feat that fits the weapon", () => {
  const melee = { weaponAttack: true, ranged: false, heavy: true, proficient: true };
  const shot = { weaponAttack: true, ranged: true, heavy: false, proficient: true };
  assert.deepEqual(powerAttackFeat(sheet(["Great Weapon Master"]), melee), { feat: "Great Weapon Master" });
  assert.deepEqual(powerAttackFeat(sheet(["Sharpshooter"]), shot), { feat: "Sharpshooter" });
  assert.match(powerAttackFeat(sheet([]), melee).refused, /neither/);
  assert.match(powerAttackFeat(sheet(["Great Weapon Master"]), shot).refused, /needs Sharpshooter/);
  assert.match(powerAttackFeat(sheet(["Sharpshooter"]), melee).refused, /needs Great Weapon Master/);
  assert.match(powerAttackFeat(sheet(["Great Weapon Master"]), { ...melee, heavy: false }).refused, /heavy melee weapon/);
  assert.match(powerAttackFeat(sheet(["Great Weapon Master"]), { ...melee, weaponAttack: false }).refused, /spell attack/);
  // A feat written as a feature (a DM's tool) counts the same.
  assert.deepEqual(powerAttackFeat(sheet([], { features: [{ name: "Great Weapon Master" }] }), melee), { feat: "Great Weapon Master" });
});

test("cover, long range and a foe at the elbow", () => {
  assert.equal(shotIgnoresCover(sheet(["Sharpshooter"])), true);
  assert.equal(shotIgnoresLongRange(sheet(["Sharpshooter"])), true);
  assert.equal(shotIgnoresCover(sheet(["Spell Sniper"])), false);
  assert.equal(spellIgnoresCover(sheet(["Spell Sniper"])), true);
  assert.equal(spellRangeFactor(sheet(["Spell Sniper"])), 2);
  assert.equal(spellRangeFactor(sheet([])), 1);
  assert.equal(shootsFreelyInMelee(sheet(["Crossbow Expert"])), true);
  assert.equal(shootsFreelyInMelee(sheet(["Gunner"])), true);
  assert.equal(shootsFreelyInMelee(sheet(["Sharpshooter"])), false);
});

test("Elemental Adept names its type on the sheet, and floors the dice of that type at 2", () => {
  const spec = featGrantSpec(authoredFeatDesc("Elemental Adept"));
  assert.deepEqual(spec.damageTypes, ["acid", "cold", "fire", "lightning", "thunder"]);
  assert.equal(featPicksOwed("Elemental Adept", spec, undefined), "Elemental Adept: pick a damage type.");
  assert.equal(featPicksOwed("Elemental Adept", spec, { damageType: "fire" }), null);
  const wrong = applyFeatGrants({
    proficiencies: { saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: [] },
    feats: [{ name: "Elemental Adept", desc: authoredFeatDesc("Elemental Adept") }],
    choices: { "elemental adept": { damageType: "necrotic" } },
    strict: true,
  });
  assert.ok(wrong.problems.some((line) => /"necrotic" is not a damage type Elemental Adept offers/.test(line)), wrong.problems.join(" | "));
  const adept = sheet(["Elemental Adept"], { featChoices: { "elemental adept": { damageType: "Fire" } } });
  assert.equal(elementalAdeptType(adept), "fire");
  assert.equal(elementalAdeptApplies(adept, "fire"), true);
  assert.equal(elementalAdeptApplies(adept, "cold"), false);
  assert.equal(elementalAdeptType(sheet(["Elemental Adept"])), null, "no type picked, no feat");
  assert.equal(floorDamageDice("8d6"), "8d6f2");
  assert.equal(floorDamageDice("2d10+3"), "2d10f2+3");
  assert.equal(floorDamageDice("1d8+1d6-1"), "1d8f2+1d6f2-1");
  assert.equal(floorDamageDice("4d6kh3"), "4d6kh3f2");
  assert.equal(floorDamageDice("2d6f3"), "2d6f3", "a higher floor stays");
  assert.equal(floorDamageDice("12"), "12");
});

test("Dungeon Delver notices traps and secret doors; Defensive Duelist needs the feat and a finesse weapon in hand", () => {
  const delver = sheet(["Dungeon Delver"]);
  assert.equal(dungeonDelverNotices(delver, "a pressure plate trap under the rug"), true);
  assert.equal(dungeonDelverNotices(delver, "the secret door behind the tapestry"), true);
  assert.equal(dungeonDelverNotices(delver, "a concealed passage"), true);
  assert.equal(dungeonDelverNotices(delver, "an ambusher in the rafters"), false);
  assert.equal(dungeonDelverNotices(sheet([]), "a trap"), false);
  const duelist = sheet(["Defensive Duelist"], { equipment: [{ name: "Rapier", qty: 1, equipped: true }] });
  assert.equal(defensiveDuelistBonus(duelist, 3), 3);
  assert.equal(defensiveDuelistBonus(sheet(["Defensive Duelist"], { equipment: [{ name: "Rapier", qty: 1 }] }), 3), null, "not in hand");
  assert.equal(defensiveDuelistBonus(sheet(["Defensive Duelist"], { equipment: [{ name: "Greatsword", qty: 1, equipped: true }] }), 3), null, "not finesse");
  assert.equal(defensiveDuelistBonus(sheet([], { equipment: [{ name: "Rapier", qty: 1, equipped: true }] }), 3), null);
});

test("the prompt tags the feats the server applies", () => {
  assert.equal(featEngineTag("Great Weapon Master"), "[pc_attack powerAttack]");
  assert.equal(featEngineTag("Defensive Duelist"), "[use_reaction]");
  assert.equal(featEngineTag("Elemental Adept"), "[server]");
  assert.equal(featEngineTag("Fey Touched"), "[cast tools]");
  assert.equal(featEngineTag("Actor"), null);
});

console.log(`${passed} checks passed`);
