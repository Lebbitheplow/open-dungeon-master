// The feature-effects table: what a name on a character sheet actually does.
import assert from "node:assert/strict";
import {
  FEATURE_EFFECTS,
  FIGHTING_STYLES,
  chosenFightingStyles,
  combatRiders,
  effectsFor,
  fightingStyleFeatureName,
  fightingStyleSlots,
  guidanceFor,
  martialArtsDie,
  sneakAttackDice,
  songOfRestDie,
  songOfRestDieFor,
  defenseRiders,
} from "../src/lib/srd/feature-effects.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const riders = (klass, level, ...names) =>
  combatRiders({ class: klass, level, features: names.map((name) => ({ name })) });

test("a sheet with no matching features gets plain defaults", () => {
  const plain = riders("commoner", 5, "Darkvision", "Lucky");
  assert.equal(plain.extraAttacks, 0);
  assert.equal(plain.sneakAttackDice, 0);
  assert.equal(plain.critRange, 20);
  assert.equal(plain.martialArtsDie, null);
  assert.equal(plain.acBonus, 0);
});

test("sneak attack dice scale by level", () => {
  assert.equal(sneakAttackDice(1), 1);
  assert.equal(sneakAttackDice(2), 1);
  assert.equal(sneakAttackDice(3), 2);
  assert.equal(sneakAttackDice(20), 10);
  assert.equal(riders("rogue", 5, "Sneak Attack").sneakAttackDice, 3);
});

test("martial arts die grows at 5, 11, and 17", () => {
  assert.equal(martialArtsDie(1), "d4");
  assert.equal(martialArtsDie(4), "d4");
  assert.equal(martialArtsDie(5), "d6");
  assert.equal(martialArtsDie(11), "d8");
  assert.equal(martialArtsDie(17), "d10");
  assert.equal(riders("monk", 11, "Martial Arts").martialArtsDie, "d8");
});

test("the numbered Extra Attack variants replace rather than stack", () => {
  assert.equal(riders("fighter", 5, "Extra Attack").extraAttacks, 1);
  assert.equal(riders("fighter", 11, "Extra Attack", "Extra Attack (2)").extraAttacks, 2);
  assert.equal(
    riders("fighter", 20, "Extra Attack", "Extra Attack (2)", "Extra Attack (3)").extraAttacks,
    3,
  );
});

test("the most specific feature name wins the match", () => {
  const found = effectsFor({ class: "fighter", features: [{ name: "Extra Attack (2)" }] });
  assert.equal(found.length, 1);
  assert.equal(found[0].effect.kind, "extra_attack");
  assert.equal(found[0].effect.attacks, 2);
});

test("parenthesised SRD variants land on the base entry", () => {
  // "Brutal Critical (2 dice)" is how the table names it on a sheet.
  const brutal = riders("barbarian", 13, "Brutal Critical (2 dice)");
  assert.equal(brutal.critExtraDice, 2);
});

test("crit range takes the best of Improved and Superior Critical", () => {
  assert.equal(riders("fighter", 3, "Improved Critical").critRange, 19);
  assert.equal(riders("fighter", 15, "Improved Critical", "Superior Critical").critRange, 18);
});

test("crit dice stack across features", () => {
  const halfOrcBarbarian = riders("barbarian", 17, "Brutal Critical", "Savage Attacks");
  assert.equal(halfOrcBarbarian.critExtraDice, 4);
});

test("each fighting style produces its own rider", () => {
  assert.equal(riders("fighter", 1, "Fighting Style: Archery").rangedAttackBonus, 2);
  assert.equal(riders("fighter", 1, "Fighting Style: Dueling").oneHandedMeleeDamageBonus, 2);
  const defense = riders("fighter", 1, "Fighting Style: Defense");
  assert.equal(defense.acBonus, 1);
  assert.equal(defense.acBonusRequiresArmor, true);
  assert.equal(
    riders("fighter", 1, "Fighting Style: Great Weapon Fighting").greatWeaponRerollBelow,
    2,
  );
  assert.equal(
    riders("ranger", 2, "Fighting Style: Two-Weapon Fighting").twoWeaponKeepsAbility,
    true,
  );
});

test("fighting style slots and picks round-trip", () => {
  const features = [{ name: "Fighting Style" }, { name: "Additional Fighting Style" }];
  assert.equal(fightingStyleSlots(features), 2);
  assert.equal(fightingStyleSlots([{ name: "Fighting Style: Archery" }]), 0);
  const name = fightingStyleFeatureName("great_weapon_fighting");
  assert.equal(name, "Fighting Style: Great Weapon Fighting");
  assert.deepEqual(chosenFightingStyles([{ name }]), ["Great Weapon Fighting"]);
  // Every listed style must produce a name the table then recognizes.
  for (const style of FIGHTING_STYLES) {
    const featureName = fightingStyleFeatureName(style.id);
    assert.equal(
      effectsFor({ class: "fighter", features: [{ name: featureName }] }).length >= 1,
      true,
      featureName,
    );
  }
});

test("unarmored movement scales and fast movement is flat", () => {
  assert.equal(riders("barbarian", 5, "Fast Movement").unarmoredSpeedBonus, 10);
  assert.equal(riders("monk", 2, "Unarmored Movement").unarmoredSpeedBonus, 10);
  assert.equal(riders("monk", 10, "Unarmored Movement").unarmoredSpeedBonus, 20);
  assert.equal(riders("monk", 18, "Unarmored Movement").unarmoredSpeedBonus, 30);
});

test("Divine Smite is recognized as an attack rider", () => {
  assert.equal(riders("paladin", 5, "Divine Smite").canSmite, true);
  assert.equal(riders("fighter", 5, "Extra Attack").canSmite, false);
});

test("guidance comes back for a feature the model asks about", () => {
  const text = guidanceFor({ class: "rogue", features: [], feature: "Sneak Attack" });
  assert.match(text, /Sneak Attack/);
  assert.equal(guidanceFor({ class: "rogue", features: [], feature: "Thieves' Cant" }), null);
});

test("every entry in the table is well formed", () => {
  for (const def of FEATURE_EFFECTS) {
    assert.ok(def.match.length > 0);
    assert.ok(def.effects.length > 0);
    for (const term of def.match) {
      // Match terms are compared against lowercased names, so they must be
      // lowercase themselves or they can never match.
      assert.equal(term, term.toLowerCase(), term);
    }
    // Every entry earns its keep: mechanics, guidance, or both.
    assert.ok(def.guidance || def.effects.some((effect) => effect.kind !== "narrative"));
  }
});

test("Song of Rest reads its die from the feature name, then the level", () => {
  assert.equal(songOfRestDie(2), "d6");
  assert.equal(songOfRestDie(9), "d8");
  assert.equal(songOfRestDie(13), "d10");
  assert.equal(songOfRestDie(17), "d12");
  // The SRD names the feature with its own die, which wins over the table.
  assert.equal(
    songOfRestDieFor({ class: "bard", level: 2, features: [{ name: "Song of Rest (d10)" }] }),
    "d10",
  );
  // A stripped name falls back to the level.
  assert.equal(
    songOfRestDieFor({ class: "bard", level: 9, features: [{ name: "Song of Rest" }] }),
    "d8",
  );
  // Nobody else has it.
  assert.equal(
    songOfRestDieFor({ class: "fighter", level: 9, features: [{ name: "Extra Attack" }] }),
    null,
  );
});

const defense = (klass, level, mods, ...names) =>
  defenseRiders({ class: klass, level, features: names.map((name) => ({ name })) }, mods);

test("Aura of Protection adds the paladin's CHA to saves, minimum 1", () => {
  const withCha = defense("paladin", 6, { cha: 4 }, "Aura of Protection");
  assert.equal(withCha.saveBonus, 4);
  // The minimum floor applies when CHA is low.
  const lowCha = defense("paladin", 6, { cha: 0 }, "Aura of Protection");
  assert.equal(lowCha.saveBonus, 1);
  // No aura, no bonus.
  assert.equal(defense("fighter", 6, { cha: 4 }, "Extra Attack").saveBonus, 0);
});

test("Danger Sense flags advantage on Dexterity saves", () => {
  const barbarian = defense("barbarian", 3, {}, "Danger Sense");
  assert.equal(barbarian.saveAdvantage.has("dex"), true);
  assert.equal(barbarian.saveAdvantage.has("wis"), false);
});

test("Evasion and the feats are recognized as riders", () => {
  assert.equal(defense("rogue", 7, {}, "Evasion").evasion, true);
  assert.equal(defense("fighter", 1, {}, "Alert").initiativeBonus, 5);
  assert.equal(defense("fighter", 1, {}, "Observant").passiveBonus, 5);
  // Reliable Talent is recognized even though it is not yet enforced.
  assert.equal(defense("rogue", 11, {}, "Reliable Talent").reliableTalent, true);
});

console.log(`test-feature-effects: ${passed} passed`);
