// What a magic item does, as the engines read it off the stored sheet.
//
// ODM parses a magic item's effect out of the content pack's prose into
// five kinds (src/lib/srd/magic-items.ts): a flat AC bonus, an AC bonus for
// the unarmored, a bonus to every save, an ability score set to a number if
// it is lower, and damage resistances. docs/rules-coverage.md, "Deliberate
// omissions": an item whose prose does not parse stays narrative. So the
// table below holds well-known SRD 5.1 items in those five kinds only, as
// the SRD states them, and the generated data is checked against it.
//
// Homebrew gear (src/lib/homebrew/gear.ts) is read by the same engines as
// SRD gear and bounded where it is written: armour class 10 to 21, a shield
// 1 to 5, a bonus within 3, a score 3 to 30, six effects, a weapon's dice a
// d12 at most and 30 on their best roll. At a table its mechanics are those
// of whoever runs the table, it never renames published gear, and the
// snapshot on a row is rebuilt by the server from the stored entry.
import assert from "node:assert/strict";
import { heroInput, openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";

const { test, finish } = suite("test-enforce-magic-items");
const { matchMagicItem } = await import("../src/lib/srd/magic-items.ts");
const { computeSheetDerived, speedFor } = await import("../src/lib/srd/index.ts");

const ac = (amount) => ({ kind: "ac_bonus", amount });
const save = (amount) => ({ kind: "save_bonus", amount });
const score = (ability, value) => ({ kind: "set_ability", ability, score: value });
const resist = (...types) => ({ kind: "resistance", types });

// SRD 5.1, "Magic Items". [name, requires attunement, effects]
const BOOK = [
  ["Staff of Power", true, [ac(2), save(2)]],
  ["Stone of Good Luck (Luckstone)", true, [save(1)]],
  ["Ring of Fire Resistance", true, [resist("fire")]],
  ["Ring of Protection", true, [ac(1), save(1)]],
  ["Cloak of Protection", true, [ac(1), save(1)]],
  ["Bracers of Defense", true, [{ kind: "ac_unarmored", amount: 2 }]],
  ["Amulet of Health", true, [score("con", 19)]],
  ["Gauntlets of Ogre Power", true, [score("str", 19)]],
  ["Headband of Intellect", true, [score("int", 19)]],
  ["Robe of Stars", true, [save(1)]],
  ["Luck Blade", true, [save(1)]],
  ["Ring of Warmth", true, [resist("cold")]],
  ["Boots of the Winterlands", true, [resist("cold")]],
  ["Brooch of Shielding", true, [resist("force")]],
  ["Staff of Fire", true, [resist("fire")]],
  ["Staff of Frost", true, [resist("cold")]],
  ["Frost Brand", true, [resist("fire")]],
  ["Belt of Dwarvenkind", true, [resist("poison")]],
  ["Cloak of Arachnida", true, [resist("poison")]],
  // SRD 5.1: "resistance to nonmagical damage", every type, not the three
  // weapon types alone; pcResistances expands the token for damage that is
  // not magical (test-enforce-explore-defects).
  ["Armor of Invulnerability", true, [resist("nonmagical damage")]],
];

await test("well-known SRD items carry the effects and the attunement the book gives them", () => {
  for (const [name, attunement, effects] of BOOK) {
    const item = matchMagicItem(name);
    assert.ok(item, name);
    assert.equal(item.name, name);
    assert.equal(item.requiresAttunement, attunement, `${name} attunement`);
    assert.deepEqual(item.effects, effects, name);
  }
});

const world = await openWorld();
const kit = await gearKit(world);
const LEVEL = 5;
const PB = proficiencyBonus(LEVEL);
const anchor = world.addHero({ class: "fighter", level: LEVEL });
const player = world.addUser("relic");
const hero = world.addHero({
  user: player, class: "fighter", level: LEVEL, acOverride: false, maxHp: 60,
  proficiencies: profs({ armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] }),
});
// The table owner's second character, for the homebrew cases: at a table the
// workshop that counts is the one of whoever runs it.
const keeper = world.addHero({
  user: world.owner, class: "fighter", level: LEVEL, acOverride: false, maxHp: 60,
  proficiencies: profs({ armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] }),
});
const sheet = () => world.sheet(hero.id);
const scores = (overrides = {}) => ({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides });
const carry = (equipment, abilities = {}) => world.patch(hero.id, { equipment, abilities: scores(abilities), currentHp: 60 });
const derived = () => computeSheetDerived(sheet());
await kit.arena({ first: anchor.id });
kit.stand(hero.id, 1);

// ---- ability scores ----

await test("Gauntlets of Ogre Power make a weak arm 19 on the attack and damage rolls, while attuned", async () => {
  carry([{ name: "Gauntlets of Ogre Power", qty: 1, attuned: true }, { name: "Mace", qty: 1 }], { str: 12 });
  let swing = await kit.swing(hero.id, { weapon: "Mace" }, 10, 3);
  assert.equal(swing.result.rolled, 10 + abilityMod(19) + PB);
  assert.equal(swing.result.damage, 3 + abilityMod(19));
  carry([{ name: "Gauntlets of Ogre Power", qty: 1 }, { name: "Mace", qty: 1 }], { str: 12 });
  swing = await kit.swing(hero.id, { weapon: "Mace" }, 10, 3);
  assert.equal(swing.result.rolled, 10 + abilityMod(12) + PB);
});

await test("an ability-setting item never lowers a score that is already higher, and leaves the stored score alone", async () => {
  for (const [name, ability] of [["Gauntlets of Ogre Power", "str"], ["Amulet of Health", "con"], ["Headband of Intellect", "int"]]) {
    for (const natural of [3, 10, 18, 19, 20]) {
      carry([{ name, qty: 1, attuned: true }], { [ability]: natural });
      assert.equal(derived().abilityMods[ability], abilityMod(Math.max(19, natural)), `${name} on ${natural}`);
      assert.equal(sheet().abilities[ability], natural);
    }
  }
});

await test("the raised score reaches saves, skills and the spell save DC", () => {
  world.patch(hero.id, { spellcasting: { ability: "int", slots: {}, prepared: [], known: [], cantrips: [] } });
  carry([{ name: "Headband of Intellect", qty: 1, attuned: true }, { name: "Amulet of Health", qty: 1, attuned: true }], { int: 8, con: 8 });
  assert.equal(derived().spellSaveDc, 8 + PB + 4);
  assert.equal(derived().skills.arcana, 4);
  assert.equal(derived().saves.con, 4);
  world.patch(hero.id, { spellcasting: null });
});

await test("a Strength score set by a magic item is the score the character carries by", () => {
  carry([{ name: "Gauntlets of Ogre Power", qty: 1, attuned: true }, { name: "Crate", qty: 1, weight: 90 }], { str: 8 });
  const speed = speedFor(sheet(), { encumbrance: true });
  assert.equal(speed, 30, `with STR 19 from the gauntlets and 90 lb carried the speed is ${speed}`);
});

// ---- resistances ----

async function hit(amount, type) {
  world.patch(hero.id, { currentHp: 60, tempHp: 0 });
  const outcome = await world.invoke("apply_damage", { characterId: hero.id, amount, type, reason: "test" });
  assert.equal(outcome.ok, true, outcome.error);
  return 60 - sheet().currentHp;
}

await test("a resistance from an attuned item halves that damage type and no other", async () => {
  carry([{ name: "Ring of Warmth", qty: 1, attuned: true }]);
  assert.equal(await hit(10, "cold"), 5);
  assert.equal(await hit(11, "cold"), 5);
  assert.equal(await hit(10, "fire"), 10);
  carry([{ name: "Ring of Warmth", qty: 1 }]);
  assert.equal(await hit(10, "cold"), 10);
});

await test("two sources of the same resistance halve once", async () => {
  carry([{ name: "Ring of Warmth", qty: 1, attuned: true }, { name: "Boots of the Winterlands", qty: 1, attuned: true }, { name: "Staff of Frost", qty: 1, attuned: true }]);
  assert.equal(await hit(20, "cold"), 10);
});

// ---- Bracers of Defense ----

await test("Bracers of Defense add 2 only with no armor and no shield", async () => {
  const bracers = { name: "Bracers of Defense", qty: 1, attuned: true };
  carry([bracers], { dex: 14 });
  assert.equal(sheet().ac, 10 + 2 + 2);
  carry([bracers, { name: "Leather", qty: 1 }], { dex: 14 });
  assert.equal(sheet().ac, 11 + 2);
  carry([bracers, { name: "Shield", qty: 1 }], { dex: 14 });
  assert.equal(sheet().ac, 10 + 2 + 2);
  carry([{ ...bracers, attuned: false }], { dex: 14 });
  assert.equal(sheet().ac, 12);
});

// ---- where the data and the book part ----

await test("a Vorpal Sword gives its wielder no resistance and a Defender no standing armor class", async () => {
  carry([{ name: "Vorpal Sword", qty: 1, attuned: true }]);
  const taken = await hit(10, "slashing");
  assert.equal(taken, 10, `the wielder of a Vorpal Sword took ${taken} of 10 slashing damage`);
  carry([{ name: "Defender", qty: 1, attuned: true }]);
  assert.equal(sheet().ac, 10);
});

await test("the Belts of Giant Strength set Strength to 21 through 29", () => {
  for (const [name, strength] of [["Belt of Hill Giant Strength", 21], ["Belt of Frost Giant Strength", 23], ["Belt of Fire Giant Strength", 25], ["Belt of Cloud Giant Strength", 27], ["Belt of Storm Giant Strength", 29]]) {
    carry([{ name, qty: 1, attuned: true }]);
    assert.equal(derived().abilityMods.str, abilityMod(strength), `${name} leaves Strength at +${derived().abilityMods.str}`);
  }
});

await kit.endFight();

// ---- homebrew ----

const homebrew = await world.route("homebrew");
async function brew(user, name, data) {
  world.signIn(user);
  const response = await homebrew.POST(
    new Request("http://test/", { method: "POST", body: JSON.stringify({ kind: "item", name, data }) }),
  );
  return { status: response.status, body: await response.json() };
}

await test("homebrew armour outside 10 to 21, and a shield outside 1 to 5, is refused where it is written", async () => {
  for (const [category, baseAc] of [["heavy", 30], ["light", 22], ["medium", 9], ["shield", 6], ["shield", 0]]) {
    const reply = await brew(player, `Absurd ${category} ${baseAc}`, { itemKind: "armor", armor: { category, baseAc } });
    assert.equal(reply.status, 400, `${category} ${baseAc}`);
  }
  assert.equal((await brew(player, "Edge Plate", { itemKind: "armor", armor: { category: "heavy", baseAc: 21 } })).status, 201);
});

await test("homebrew effects are clamped: a bonus within 3, a score within 3 to 30, six effects", async () => {
  const reply = await brew(player, "Crown of Excess", {
    itemKind: "magic_item",
    requiresAttunement: true,
    effects: [
      { kind: "ac_bonus", amount: 20 },
      { kind: "save_bonus", amount: -20 },
      { kind: "set_ability", ability: "str", score: 99 },
      { kind: "set_ability", ability: "dex", score: -4 },
      { kind: "ac_unarmored", amount: 9 },
      { kind: "resistance", types: ["fire"] },
      { kind: "ac_bonus", amount: 5 },
      { kind: "wish", amount: 1 },
    ],
  });
  assert.equal(reply.status, 201, reply.body.error);
  const effects = reply.body.entry.data.effects;
  assert.equal(effects.length, 6);
  assert.deepEqual(effects.slice(0, 5), [ac(3), save(-3), score("str", 30), score("dex", 3), { kind: "ac_unarmored", amount: 3 }]);
});

await test("a homebrew weapon's dice are a weapon's: a d12 at most, 30 on the best roll", async () => {
  const weapon = (damage) => ({ itemKind: "weapon", weapon: { category: "martial", kind: "melee", damage } });
  for (const damage of ["12d12 piercing", "1d20 slashing", "3d12 fire", "2d6+40 bludgeoning"]) {
    const reply = await brew(player, `Ruinous ${damage}`, weapon(damage));
    assert.equal(reply.status, 400, damage);
  }
  for (const damage of ["2d6 slashing", "1d12+2 radiant", "2d12 piercing", "1 piercing"]) {
    const reply = await brew(player, `Fair ${damage}`, weapon(damage));
    assert.equal(reply.status, 201, `${damage}: ${reply.body.error}`);
  }
});

const keep = (equipment, abilities = {}) => world.patch(keeper.id, { equipment, abilities: scores(abilities), currentHp: 60 });

await test("the engines read homebrew armour, weapons and magic as they read SRD gear", async () => {
  await brew(world.owner, "Wyrmhide", { itemKind: "armor", armor: { category: "medium", baseAc: 15, dexCap: 2, stealthDisadvantage: true } });
  await brew(world.owner, "Star Flail", { itemKind: "weapon", weapon: { category: "martial", kind: "melee", damage: "1d12 radiant", properties: ["heavy"] } });
  await brew(world.owner, "Circlet of Grit", { itemKind: "magic_item", requiresAttunement: true, effects: [{ kind: "save_bonus", amount: 2 }] });
  keep([{ name: "Wyrmhide", qty: 1 }, { name: "Star Flail", qty: 1 }, { name: "Circlet of Grit", qty: 1 }], { str: 16, dex: 18 });
  // The snapshot is laid on the row when the sheet is read, so the armor
  // class follows on the next write, as it does after every DM tool
  // (mutations.ts publishSheet patches the sheet once more).
  world.patch(keeper.id, {});
  const kept = () => world.sheet(keeper.id);
  assert.equal(kept().ac, 15 + 2);
  assert.equal(computeSheetDerived(kept()).saves.wis, 0);
  world.patch(keeper.id, { equipment: kept().equipment.map((item) => (item.name === "Circlet of Grit" ? { ...item, attuned: true } : item)) });
  assert.equal(computeSheetDerived(kept()).saves.wis, 2);
  await kit.arena({ first: anchor.id });
  kit.stand(keeper.id, 1);
  const swing = await kit.swing(keeper.id, { weapon: "Star Flail" }, 10, 11);
  assert.equal(swing.result.rolled, 10 + 3 + PB);
  assert.equal(swing.result.damage, 11 + 3);
  assert.equal(swing.result.damageType, "radiant");
  assert.deepEqual(swing.damageDice, [12]);
  kit.stand(keeper.id, 3, 3);
  kit.stand(hero.id, 1);
});

await test("an entry edited in the workshop reaches the sheet that carries it; a forgotten one keeps working there, and one deleted for good takes its mechanics with it", async () => {
  const made = await brew(world.owner, "Glass Buckler", { itemKind: "armor", armor: { category: "shield", baseAc: 1 } });
  keep([{ name: "Glass Buckler", qty: 1 }], { dex: 10 });
  world.patch(keeper.id, {});
  assert.equal(world.sheet(keeper.id).ac, 11);
  const entry = await world.route("homebrew/[id]");
  world.signIn(world.owner);
  const edited = await entry.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify({ data: { itemKind: "armor", armor: { category: "shield", baseAc: 3 } } }) }),
    { params: Promise.resolve({ id: made.body.entry.id }) },
  );
  assert.equal(edited.status, 200);
  world.patch(keeper.id, {});
  assert.equal(world.sheet(keeper.id).ac, 13);
  // Forgetting archives it (docs/workshop-rulebook-audit-pr169.md F06): the
  // sheet keeps the buckler as it was, through a reload and a later write.
  await entry.DELETE(new Request("http://test/", { method: "DELETE" }), { params: Promise.resolve({ id: made.body.entry.id }) });
  world.patch(keeper.id, {});
  assert.equal(world.sheet(keeper.id).equipment[0].gear?.armor?.baseAc, 3);
  assert.equal(world.sheet(keeper.id).ac, 13);
  await entry.DELETE(new Request("http://test/?purge=1", { method: "DELETE" }), { params: Promise.resolve({ id: made.body.entry.id }) });
  world.patch(keeper.id, {});
  assert.equal(world.sheet(keeper.id).equipment[0].gear, undefined);
  assert.equal(world.sheet(keeper.id).ac, 10);
});

await test("a magic bonus is read from +1 to +3: a '+20' in a name adds nothing", async () => {
  carry([{ name: "+20 Longsword", qty: 1 }, { name: "+9 Plate", qty: 1 }], { str: 16 });
  assert.equal(sheet().ac, 18);
  const swing = await kit.swing(hero.id, { weapon: "Longsword" }, 10, 5);
  assert.equal(swing.result.rolled, 10 + 3 + PB);
  assert.equal(swing.result.damage, 5 + 3);
});

await test("a dagger is 1d4 piercing at every table: a homebrew entry named after published gear is refused, and one kept from before changes nothing on a sheet", async () => {
  // The workshop refuses the published name now (F12); an entry saved under
  // one before that is still in the shelf, and the name gives it no hold on
  // a sheet's Dagger. Written by the player and by the owner.
  const { createHomebrew } = await import("../src/lib/db/homebrew.ts");
  for (const author of [player, world.owner]) {
    const made = await brew(author, "Dagger", { itemKind: "weapon", weapon: { category: "simple", kind: "melee", damage: "2d12 piercing", properties: ["finesse", "light", "thrown"], rangeFt: 20 } });
    assert.equal(made.status, 400, "a homebrew Dagger was kept under the published name");
    createHomebrew(author.id, { kind: "item", name: "Dagger", data: { itemKind: "weapon", weapon: { name: "Dagger", category: "simple", kind: "melee", damage: "2d12 piercing", properties: ["finesse", "light", "thrown"], rangeFt: 20 } } });
    createHomebrew(author.id, { kind: "item", name: "Plate", data: { itemKind: "armor", armor: { name: "Plate", category: "light", baseAc: 21 } } });
    createHomebrew(author.id, { kind: "item", name: "Ring of Protection", data: { itemKind: "magic_item", requiresAttunement: false, effects: [{ kind: "ac_bonus", amount: 3 }] } });
  }
  for (const id of [hero.id, keeper.id]) {
    world.patch(id, { equipment: [{ name: "Dagger", qty: 1 }, { name: "Plate", qty: 1 }, { name: "Ring of Protection", qty: 1 }], abilities: scores({ str: 16 }) });
    world.patch(id, {});
    const stored = world.sheet(id);
    assert.deepEqual(stored.equipment.map((item) => item.gear), [undefined, undefined, undefined]);
    assert.equal(stored.ac, 18);
  }
  carry([{ name: "Dagger", qty: 1 }], { str: 10 });
  const swing = await kit.swing(hero.id, { weapon: "Dagger" }, 10, 3, 12);
  assert.deepEqual(swing.damageDice, [4], `the Dagger rolled ${swing.damageDice.length}d${swing.damageDice[0]} for ${swing.result?.damage}`);
});

await kit.endFight();

await test("A sheet's armor class is derived from what it wears from the moment it is created, homebrew armour included.", async () => {
  const smith = world.addUser("smith");
  const made = await brew(smith, "Wyrmhide", { itemKind: "armor", armor: { category: "medium", baseAc: 15, dexCap: 2 } });
  assert.equal(made.status, 201, made.body.error);
  const fresh = world.addHero({ user: smith, class: "fighter", level: 1, acOverride: false, abilities: { dex: 14 }, equipment: [{ name: "Wyrmhide", qty: 1 }] });
  assert.equal(fresh.equipment[0].gear?.armor?.baseAc, 15);
  assert.equal(fresh.ac, 15 + 2, `created in Wyrmhide (AC 15, DEX cap 2) with AC ${fresh.ac}`);
});

const lobby = await openWorld({ status: "lobby" });
const sheetRoute = await lobby.route("campaigns/[campaignId]/sheet");

// A forged block rides on a row the creation route otherwise accepts: a
// dagger bought from the background's purse. (A name with no listed price is
// refused at creation before its gear is ever read.)
const FORGED = { magic: { requiresAttunement: false, effects: [score("str", 30), save(50)] }, weapon: { name: "Dagger", category: "simple", kind: "melee", damage: "12d12 piercing" } };

await test("the snapshot on an equipment row is the server's to write: a gear block sent at creation is dropped", async () => {
  lobby.signIn(lobby.owner);
  const response = await sheetRoute.POST(
    new Request("http://test/", {
      method: "POST",
      body: JSON.stringify(heroInput({
        name: "Forger",
        portrait: { url: "/uploads/enforce-magic-items.png" },
        background: "acolyte",
        proficiencies: profs({ skills: ["insight", "religion"], languages: ["Common", "Elvish", "Dwarvish"] }),
        gold: 13,
        equipment: [{ name: "Dagger", qty: 1, gear: FORGED }],
      })),
    }),
    { params: Promise.resolve({ campaignId: lobby.campaignId }) },
  );
  const body = await response.json();
  assert.equal(response.status, 201, body.error);
  const stored = lobby.sheet(body.sheet.id);
  assert.equal(stored.equipment.find((item) => item.name === "Dagger").gear, undefined);
  const numbers = computeSheetDerived(stored);
  assert.equal(numbers.abilityMods.str, 0, `a dagger sent with its own gear block gives STR +${numbers.abilityMods.str} and WIS save +${numbers.saves.wis}`);
  assert.equal(numbers.saves.wis, 0);
});

await test("a gear block written to a stored row by any path is gone on the next read", () => {
  const forger = lobby.addHero({ name: "Second Forger", equipment: [{ name: "Lucky Pebble", qty: 1, gear: FORGED }] });
  assert.equal(forger.equipment[0].gear, undefined);
  assert.equal(computeSheetDerived(forger).abilityMods.str, 0);
  const patched = lobby.patch(forger.id, { equipment: [{ name: "Lucky Pebble", qty: 1, slug: "homebrew:no-such-entry", gear: FORGED }] });
  assert.equal(patched.equipment[0].gear, undefined);
  assert.equal(computeSheetDerived(patched).saves.wis, 0);
});

world.close();
finish();
