// The rules of a player's attack that are about hands, turns and where
// people stand (src/lib/dm/attack-rules.ts), and the weapon an attack is
// made with (src/lib/dm/attack-logic.ts resolveAttackWeapon). Pure, so every
// branch is walked here without a database.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  handsRuling,
  hostileWithinFiveFeet,
  isFlanking,
  isUndeadOrFiend,
  loadingProblem,
  offHandProblem,
  otherHandArmed,
  resourceLeft,
  slotFree,
  smiteDice,
  withLoadingFired,
} = await import("../src/lib/dm/attack-rules.ts");
const { ragingMeleeBonus, resolveAttackWeapon, weaponAttackProfile } = await import("../src/lib/dm/attack-logic.ts");
const { freshBudget } = await import("../src/lib/dm/action-budget.ts");
const { matchWeapon } = await import("../src/lib/srd/weapons.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const derived = { abilityMods: { str: 3, dex: 1 }, proficiencyBonus: 3 };
const profileOf = (name, stance = {}) =>
  weaponAttackProfile(
    derived,
    ["simple", "martial"],
    { displayName: name, srd: matchWeapon(name), unarmed: false },
    stance,
  );
const hands = (weapon, extra = {}) =>
  handsRuling({
    who: "Asha",
    weapon,
    properties: matchWeapon(weapon).properties ?? [],
    lance: weapon === "Lance",
    mounted: false,
    twoHandedAsked: false,
    shieldName: null,
    ...extra,
  });

// ---- the weapon in hand ----

test("the exact name wins over a name that contains it", () => {
  const pack = [{ name: "Longsword +1", qty: 1 }, { name: "Longsword", qty: 1 }];
  assert.equal(resolveAttackWeapon(pack, [], "Longsword").displayName, "Longsword");
  assert.equal(resolveAttackWeapon(pack, [], "longsword").displayName, "Longsword");
  assert.equal(resolveAttackWeapon(pack, [], "Longsword +1").displayName, "Longsword +1");
  // With only the magic one carried, the plain word still finds it.
  assert.equal(resolveAttackWeapon([pack[0]], [], "Longsword").displayName, "Longsword +1");
});

test("a weapon on the table and on nobody's back is not carried", () => {
  assert.equal(resolveAttackWeapon([], [], "Greatsword").carried, false);
  assert.equal(resolveAttackWeapon([{ name: "Dagger", qty: 1 }], [], "Greatsword").carried, false);
  assert.equal(resolveAttackWeapon([{ name: "Greatsword", qty: 1 }], [], "Greatsword").carried, true);
});

test("an unarmed strike and an improvised weapon need no place in the pack", () => {
  const fist = resolveAttackWeapon([], [], "unarmed strike");
  assert.equal(fist.unarmed, true);
  assert.equal(fist.carried, true);
  const stool = resolveAttackWeapon([], [], "bar stool");
  assert.equal(stool.srd, null);
  assert.equal(stool.carried, true);
  // Nothing named and nothing carried: the fists.
  assert.equal(resolveAttackWeapon([], [], undefined).unarmed, true);
});

// ---- hands ----

test("a two-handed weapon is refused with a shield on the arm, and swung without one", () => {
  assert.ok("error" in hands("Greatsword", { shieldName: "Shield" }));
  assert.deepEqual(hands("Greatsword"), { twoHanded: false, note: null });
  assert.ok("error" in hands("Longbow", { shieldName: "Shield" }));
});

test("a versatile weapon behind a shield is swung in one hand whatever was asked", () => {
  const ruled = hands("Longsword", { shieldName: "Shield", twoHandedAsked: true });
  assert.equal(ruled.twoHanded, false);
  assert.match(ruled.note, /one hand/);
  assert.equal(hands("Longsword", { twoHandedAsked: true }).twoHanded, true);
  assert.equal(profileOf("Longsword", { twoHanded: true }).damageExpression, "1d10+3");
  assert.equal(profileOf("Longsword", { twoHanded: false }).damageExpression, "1d8+3");
});

test("a lance needs both hands on foot and one in the saddle", () => {
  assert.ok("error" in hands("Lance", { shieldName: "Shield" }));
  assert.ok(!("error" in hands("Lance", { shieldName: "Shield", mounted: true })));
  assert.ok(!("error" in hands("Lance")));
});

// ---- two-weapon fighting ----

const turn = (overrides = {}) => ({
  ...freshBudget({ ownerId: "pc-1", round: 1, attacksAllowed: 2 }),
  ...overrides,
});
const offHand = (weapon, overrides = {}) =>
  offHandProblem({
    who: "Asha",
    profile: profileOf(weapon),
    budget: turn({ actionUsed: true, attacksMade: 1, lightMeleeAttack: true }),
    inFight: true,
    equipment: [{ name: "Shortsword", qty: 2 }],
    feats: [],
    shieldName: null,
    ...overrides,
  });

test("the off-hand attack follows an Attack action made with a light weapon", () => {
  assert.equal(offHand("Shortsword"), null);
  assert.match(offHand("Shortsword", { budget: turn() }), /first/);
  assert.match(
    offHand("Shortsword", { budget: turn({ actionUsed: true, attacksMade: 1 }) }),
    /light melee weapon/,
  );
  assert.match(offHand("Shortsword", { budget: null }), /not their turn/);
  // A spell is not the Attack action.
  assert.match(
    offHand("Shortsword", { budget: turn({ actionUsed: true, castThisAction: true }) }),
    /first/,
  );
});

test("the off-hand weapon is light, melee, and one of two", () => {
  assert.match(offHand("Longsword", { equipment: [{ name: "Longsword", qty: 2 }] }), /light/);
  assert.match(offHand("Hand Crossbow"), /light melee weapon/);
  assert.match(offHand("Shortsword", { equipment: [{ name: "Shortsword", qty: 1 }] }), /each hand/);
  assert.equal(
    offHand("Dagger", { equipment: [{ name: "Shortsword", qty: 1 }, { name: "Dagger", qty: 1 }] }),
    null,
  );
  assert.match(offHand("Shortsword", { shieldName: "Shield" }), /other hand/);
});

test("Dual Wielder lifts the word light", () => {
  assert.equal(
    offHand("Longsword", {
      feats: ["Dual Wielder"],
      equipment: [{ name: "Longsword", qty: 2 }],
      budget: turn({ actionUsed: true, attacksMade: 1 }),
    }),
    null,
  );
});

test("the off-hand swing keeps a penalty and drops a bonus", () => {
  assert.equal(profileOf("Shortsword", { offHand: true }).damageExpression, "1d6");
  const weak = weaponAttackProfile(
    { abilityMods: { str: -2, dex: -2 }, proficiencyBonus: 3 },
    ["martial"],
    { displayName: "Shortsword", srd: matchWeapon("Shortsword"), unarmed: false },
    { offHand: true },
  );
  assert.equal(weak.damageExpression, "1d6-2");
});

test("Dueling is refused by a second weapon marked as in hand, and by nothing else", () => {
  const armed = (equipment, shieldName = null) =>
    otherHandArmed({ equipment, weapon: "Shortsword", shieldName });
  assert.equal(armed([{ name: "Shortsword", qty: 1, equipped: true }]), false);
  assert.equal(
    armed([{ name: "Shortsword", qty: 1, equipped: true }, { name: "Dagger", qty: 1, equipped: true }]),
    true,
  );
  assert.equal(armed([{ name: "Shortsword", qty: 2, equipped: true }]), true);
  // Carried and not in hand, a bow on the back, a shield: no second weapon.
  assert.equal(armed([{ name: "Shortsword", qty: 1 }, { name: "Dagger", qty: 1 }]), false);
  assert.equal(
    armed([{ name: "Shortsword", qty: 1, equipped: true }, { name: "Longbow", qty: 1, equipped: true }]),
    false,
  );
  assert.equal(
    armed([{ name: "Shortsword", qty: 1, equipped: true }, { name: "Dagger", qty: 1, equipped: true }], "Shield"),
    false,
  );
});

// ---- loading ----

test("a loading weapon fires once in an action", () => {
  const crossbow = profileOf("Heavy Crossbow");
  const before = turn();
  assert.equal(loadingProblem({ who: "Asha", profile: crossbow, budget: before }), null);
  const after = withLoadingFired(before, crossbow);
  assert.deepEqual(after.loadingFired, ["heavy crossbow"]);
  assert.match(loadingProblem({ who: "Asha", profile: crossbow, budget: after }), /once per action/);
  // Another weapon is free, a bow never loads, and the feat ignores it.
  assert.equal(loadingProblem({ who: "Asha", profile: profileOf("Hand Crossbow"), budget: after }), null);
  assert.equal(withLoadingFired(before, profileOf("Longbow")), before);
  assert.equal(
    loadingProblem({ who: "Asha", profile: crossbow, budget: after, feats: ["Crossbow Expert"] }),
    null,
  );
});

// ---- what a rider would cost ----

test("a slot and a pool are looked at without being spent", () => {
  const sheet = {
    resources: { sub_superiority_dice: { max: 4, used: 3 } },
    spellcasting: {
      ability: "cha",
      slots: { 1: { max: 4, used: 4 }, 2: { max: 2, used: 1 } },
      pact: { level: 3, max: 2, used: 0 },
    },
  };
  assert.deepEqual(resourceLeft(sheet, "Superiority Dice"), { left: 1, max: 4 });
  assert.equal(resourceLeft({ resources: {} }, "Superiority Dice"), null);
  assert.equal(slotFree(sheet, 1), false);
  assert.equal(slotFree(sheet, 2), true);
  assert.equal(slotFree(sheet, 3), true);
  assert.equal(slotFree(sheet, 4), false);
  assert.equal(slotFree({ spellcasting: null }, 1), false);
  assert.deepEqual(sheet.resources.sub_superiority_dice, { max: 4, used: 3 });
});

// ---- Divine Smite ----

test("Divine Smite is 2d8 and one more per slot level, to 5d8, and 1d8 more against undead and fiends", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map((slot) => smiteDice(slot, false)), [2, 3, 4, 5, 5, 5, 5]);
  assert.deepEqual([1, 4, 5, 9].map((slot) => smiteDice(slot, true)), [3, 6, 6, 6]);
});

test("undead and fiends are told by the stat block's type", () => {
  const enemy = (displayName, type, slug = "thing") => ({ displayName, slug, stats: { type } });
  assert.equal(isUndeadOrFiend(enemy("Pale Rider", "undead")), true);
  assert.equal(isUndeadOrFiend(enemy("Hound", "Fiend (devil)")), true);
  // The type is there and says otherwise, whatever the name suggests.
  assert.equal(isUndeadOrFiend(enemy("Shadow Imp Devil", "humanoid")), false);
  // No type on an old snapshot: the name, on whole words.
  assert.equal(isUndeadOrFiend(enemy("Zombie", undefined)), true);
  assert.equal(isUndeadOrFiend(enemy("Simple Imposter", undefined)), false);
  assert.equal(isUndeadOrFiend(enemy("Bandit", undefined, "skeleton-archer")), true);
});

// ---- Rage ----

test("Rage adds nothing to the damage of a barbarian in heavy armor", () => {
  const melee = { ranged: false, ability: "str" };
  const raging = { conditions: ["raging"], level: 5 };
  assert.equal(ragingMeleeBonus({ ...raging, equipment: [{ name: "Hide Armor", qty: 1 }] }, melee), 2);
  assert.equal(ragingMeleeBonus({ ...raging, equipment: [{ name: "Plate", qty: 1 }] }, melee), 0);
  // Carried and not worn, once the sheet says what is worn.
  assert.equal(
    ragingMeleeBonus(
      { ...raging, equipment: [{ name: "Plate", qty: 1 }, { name: "Hide Armor", qty: 1, equipped: true }] },
      melee,
    ),
    2,
  );
});

// ---- positions ----

test("flanking is an ally on the mirrored square", () => {
  const target = { x: 5, y: 5 };
  assert.equal(isFlanking({ x: 5, y: 4 }, target, [{ x: 5, y: 6 }]), true);
  assert.equal(isFlanking({ x: 4, y: 4 }, target, [{ x: 6, y: 6 }]), true);
  assert.equal(isFlanking({ x: 5, y: 4 }, target, [{ x: 6, y: 6 }]), false);
  assert.equal(isFlanking({ x: 5, y: 4 }, target, []), false);
  // Not from 10 feet away, reach weapon or not.
  assert.equal(isFlanking({ x: 5, y: 3 }, target, [{ x: 5, y: 7 }]), false);
});

test("a hostile within 5 feet is one on any of the eight squares around", () => {
  const me = { x: 5, y: 5 };
  assert.equal(hostileWithinFiveFeet(me, [{ x: 6, y: 6 }]), true);
  assert.equal(hostileWithinFiveFeet(me, [{ x: 7, y: 5 }]), false);
  assert.equal(hostileWithinFiveFeet(me, []), false);
});

console.log(`test-attack-rules: ${passed} passed`);
