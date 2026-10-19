// Where an item is worn, and one of a kind at a time (issue 412). SRD 5.1,
// Magic Items, Multiple Items of the Same Kind: "A character can't normally
// wear more than one pair of footwear, one pair of gloves or gauntlets, one
// pair of bracers, one suit of armor, one item of headwear, and one cloak.
// You can make exceptions; a character might be able to wear a circlet under
// a helmet, for example, or to layer two cloaks." Held as tests:
//
//   every item has its place from its name (a magic suit is its suit), and a
//   workshop item from the place its author picked ("Worn on"); a
//   second cloak's, bracers' or boots' riders do not apply, worn or merely
//   carried on a sheet that never said; the attuned one counts first; the
//   DM's exception (`layered`) lets both count; rings, amulets and belts have
//   no limit; the usage route refuses a second of a kind with the rows to
//   take off, takes a swap in one request, keeps the exception to the DM and
//   the party lead, and a never-touched sheet's first toggle keeps the armor
//   it wore. And the readers that each judged "worn" their own way (rage,
//   donning, Shield Master) now read it the armor engine's way.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { openTable, postUsage } from "./lib/enforce-resources.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-wear-slots");
const { wearSlotOf, countedWorn, wearConflict, wornButIdle, firstWearConflict } = await import("../src/lib/srd/wear-slots.ts");
const { magicItemRiders } = await import("../src/lib/srd/magic-items.ts");
const { itemCheckRiders } = await import("../src/lib/srd/item-check-riders.ts");
const { gearPatch, gearChanges } = await import("../src/lib/dm/usage-rules.ts");
const { wearsHeavyArmor } = await import("../src/lib/dm/damage-logic.ts");
const { wearsHeavy } = await import("../src/lib/srd/authored-effects.ts");
const { armorChangeMinutes } = await import("../src/lib/dm/don-doff.ts");
const { shieldMasterSaveBonus } = await import("../src/lib/srd/feat-combat.ts");
const { magicItemLine } = await import("../src/lib/dm/item-summary.ts");
const { acBreakdownFor } = await import("../src/lib/srd/index.ts");

const row = (name, extra = {}) => ({ name, qty: 1, ...extra });
const names = (set) => [...set].map((item) => item.name);

await test("item-slots.json is current with the content pack", () => {
  // Only meaningful where the pack is (CI has none and reads the committed table).
  if (!existsSync(new URL("../data/content/open5e.sqlite", import.meta.url))) return;
  const result = spawnSync(process.execPath, [new URL("./generate-item-slots.mjs", import.meta.url).pathname, "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

await test("every item's place comes from its row, never from words in its name", () => {
  const places = {
    "Cloak of Protection": "cloak",
    "Cape of the Mountebank": "cloak",
    "Mantle of Spell Resistance": "cloak",
    "Hat of Disguise": "head",
    "Helm of Brilliance": "head",
    "Circlet of Blasting": "head",
    "Headband of Intellect": "head",
    "Boots of Speed": "feet",
    "Winged Boots": "feet",
    "Slippers of Spider Climbing": "feet",
    "Gauntlets of Ogre Power": "hands",
    "Gloves of Missile Snaring": "hands",
    "Bracers of Defense": "wrists",
    "Aurochs Bracers": "wrists",
    "Amulet of Health": "neck",
    "Periapt of Wound Closure": "neck",
    "Belt of Hill Giant Strength": "waist",
    "Ring of Protection": "ring",
    "Goggles of Night": "eyes",
    "Eyes of the Eagle": "eyes",
    "Robe of the Archmagi": "robe",
    "Cloak of Protection (spare)": "cloak",
    "+1 Ring of Protection": "ring",
    Plate: "armor",
    "Ring Mail": "armor",
    "Mithral Half Plate": "armor",
    "+1 Shield": "shield",
  };
  for (const [name, place] of Object.entries(places)) {
    assert.equal(wearSlotOf(row(name)), place, name);
  }
  // Carried or held, not worn; and a name no row knows (a homebrew cloak, an
  // Italian table's "Mantello di protezione") has no place to be counted in
  // unless its workshop author picked one (the test below).
  for (const name of ["Longsword", "Belt Pouch", "Rope, hempen (50 feet)", "Wand of Magic Missiles", "Hatchet", "Bag of Holding", "Cloak of the Midnight Fox", "Mantello di protezione"]) {
    assert.equal(wearSlotOf(row(name)), null, name);
  }
  // A workshop suit is armor whatever its name says.
  assert.equal(wearSlotOf(row("Mistweave", { gear: { armor: { name: "Mistweave", category: "light", baseAc: 12, weightLb: 4 } } })), "armor");
  // The same Italian cloak named by its SRD row (srdName, #408) has the
  // row's place, so a second cloak beside it is counted as one.
  const mantello = row("Mantello di protezione", { srdName: "Cloak of Protection", equipped: true, attuned: true });
  assert.equal(wearSlotOf(mantello), "cloak");
  const spare = row("Cloak of Protection", { equipped: true });
  assert.equal(countedWorn([mantello, spare]).size, 1, "two cloaks both counted at an Italian table");
});

await test("two cloaks worn and attuned: one cloak's magic, not both (the issue's example)", () => {
  const elvenFirst = [
    row("Cloak of Elvenkind", { equipped: true, attuned: true }),
    row("Cloak of Protection", { equipped: true, attuned: true }),
  ];
  assert.equal(magicItemRiders(elvenFirst).acBonus, 0, "the Cloak of Protection's +1 AC rides on a second cloak");
  assert.equal(magicItemRiders(elvenFirst).saveBonus, 0);
  assert.equal(itemCheckRiders(elvenFirst, "stealth").advantage, true);
  assert.equal(wornButIdle(elvenFirst[1], elvenFirst), "cloak");
  const protectionFirst = [elvenFirst[1], elvenFirst[0]];
  assert.equal(magicItemRiders(protectionFirst).acBonus, 1);
  assert.equal(itemCheckRiders(protectionFirst, "stealth").advantage, false, "the Cloak of Elvenkind's advantage rides on a second cloak");
});

await test("two pairs of bracers: Bracers of Defense and Aurochs Bracers do not both apply", () => {
  const both = [row("Bracers of Defense", { equipped: true, attuned: true }), row("Aurochs Bracers", { equipped: true, attuned: true })];
  const riders = magicItemRiders(both);
  assert.equal(riders.acUnarmoredBonus, 2);
  assert.equal(riders.abilitySet.str, undefined);
  assert.deepEqual(riders.sources, ["Bracers of Defense"]);
});

await test("a spare cloak carried on a sheet that never said what it wears adds nothing", () => {
  const pack = [row("Cloak of Protection"), row("Cloak of Protection (spare)"), row("Ring of Protection", { attuned: true })];
  pack[0].attuned = true;
  assert.deepEqual(names(countedWorn(pack)).sort(), ["Cloak of Protection", "Ring of Protection"]);
  assert.equal(magicItemRiders(pack).acBonus, 2, "the cloak and the ring");
});

await test("the attuned one counts first; the DM's exception lets both count", () => {
  const pack = [row("Cloak of Elvenkind", { equipped: true }), row("Cloak of Protection", { equipped: true, attuned: true })];
  assert.deepEqual(names(countedWorn(pack)), ["Cloak of Protection"]);
  assert.equal(magicItemRiders(pack).acBonus, 1);
  const layered = [pack[0], { ...pack[1], layered: true }];
  assert.deepEqual(names(countedWorn(layered)).sort(), ["Cloak of Elvenkind", "Cloak of Protection"]);
  const circlet = [row("Helm of Brilliance", { equipped: true }), row("Circlet of Blasting", { equipped: true, layered: true })];
  assert.equal(wearConflict(row("Circlet of Blasting"), circlet.slice(0, 1)).wearing[0], "Helm of Brilliance");
  assert.equal(countedWorn(circlet).size, 2);
});

await test("every place has its own limit; rings, amulets and belts have none beyond attunement", () => {
  const pack = [
    row("Cloak of Protection", { equipped: true, attuned: true }),
    row("Boots of Speed", { equipped: true }),
    row("Bracers of Defense", { equipped: true }),
    row("Hat of Disguise", { equipped: true }),
    row("Ring of Protection", { equipped: true, attuned: true }),
    row("Ring of Resistance (Fire)", { equipped: true }),
    row("Amulet of Health", { equipped: true }),
  ];
  assert.equal(countedWorn(pack).size, pack.length);
  assert.equal(wearConflict(row("Ring of Swimming"), pack), null);
  assert.deepEqual(wearConflict(row("Winged Boots"), pack), { item: "Winged Boots", slot: "feet", wearing: ["Boots of Speed"] });
});

await test("a change is blamed only for what it puts on", () => {
  const legacy = [row("Cloak of Protection", { equipped: true }), row("Cloak of Elvenkind", { equipped: true }), row("Ring of Protection", { equipped: true })];
  const ringOff = legacy.map((item) => (item.name === "Ring of Protection" ? { ...item, equipped: false } : item));
  assert.equal(firstWearConflict(legacy, ringOff), null, "a pack written before the rule still takes things off");
  const third = [...legacy, row("Cloak of Displacement", { equipped: false })];
  const on = third.map((item) => (item.name === "Cloak of Displacement" ? { ...item, equipped: true } : item));
  assert.deepEqual(firstWearConflict(third, on).wearing, ["Cloak of Protection", "Cloak of Elvenkind"]);
});

await test("gearPatch: a second of a kind is refused with what to take off; a swap is one request", () => {
  const sheet = { name: "Tavi", equipment: [row("Cloak of Protection", { equipped: true }), row("Cloak of Elvenkind", { equipped: false })] };
  const armor = { armorName: null, shieldName: null };
  const refused = gearPatch(sheet, { "Cloak of Elvenkind": { equipped: true } }, { corrects: false, armor });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.conflict, { item: "Cloak of Elvenkind", slot: "cloak", wearing: ["Cloak of Protection"] });
  assert.match(refused.error, /Tavi already wears Cloak of Protection, and a character wears one cloak at a time/);
  const swapped = gearPatch(sheet, { "Cloak of Protection": { equipped: false }, "Cloak of Elvenkind": { equipped: true } }, { corrects: false, armor });
  assert.deepEqual(swapped.equipment.map((item) => item.equipped), [false, true]);
  // Attuning on a sheet that says what it wears puts the item on: the same rule.
  assert.equal(gearPatch(sheet, { "Cloak of Elvenkind": { attuned: true } }, { corrects: false, armor }).status, 409);
});

await test("gearPatch: the exception is the DM's and the lead's, and taking the row off ends it", () => {
  const sheet = { name: "Tavi", equipment: [row("Helm of Brilliance", { equipped: true }), row("Circlet of Blasting", { equipped: false })] };
  const armor = { armorName: null, shieldName: null };
  assert.equal(gearPatch(sheet, { "Circlet of Blasting": { equipped: true, layered: true } }, { corrects: false, armor }).status, 403);
  const allowed = gearPatch(sheet, { "Circlet of Blasting": { equipped: true, layered: true } }, { corrects: true, armor });
  assert.deepEqual(allowed.equipment[1], { name: "Circlet of Blasting", qty: 1, equipped: true, layered: true });
  const off = gearPatch({ ...sheet, equipment: allowed.equipment }, { "Circlet of Blasting": { equipped: false } }, { corrects: false, armor });
  assert.equal(off.equipment[1].layered, undefined);
  assert.equal(off.equipment[1].equipped, false);
});

await test("gearPatch: a never-touched sheet's first toggle keeps its armor, shield and cloak on", () => {
  const equipment = [
    row("Chain Mail"),
    row("Leather"),
    row("Shield"),
    row("Cloak of Protection", { attuned: true }),
    row("Cloak of Elvenkind"),
    row("Longsword"),
    row("Rope, hempen (50 feet)"),
    row("Ring of Protection"),
  ];
  const sheet = { name: "Brann", equipment };
  const out = gearPatch(sheet, { "Ring of Protection": { equipped: true } }, { corrects: false, armor: { armorName: "Chain Mail", shieldName: "Shield" } });
  const worn = Object.fromEntries(out.equipment.map((item) => [item.name, item.equipped]));
  assert.deepEqual(worn, {
    "Chain Mail": true,
    Leather: false,
    Shield: true,
    "Cloak of Protection": true,
    "Cloak of Elvenkind": false,
    Longsword: false,
    "Rope, hempen (50 feet)": false,
    "Ring of Protection": true,
  });
  // Taking one thing off a never-touched sheet no longer strips the rest.
  const taken = gearPatch(sheet, { Shield: { equipped: false } }, { corrects: false, armor: { armorName: "Chain Mail", shieldName: "Shield" } });
  assert.equal(taken.equipment.find((item) => item.name === "Chain Mail").equipped, true);
});

await test("worn is read one way: a character who took everything off wears nothing", () => {
  const allOff = [row("Plate", { equipped: false }), row("Shield", { equipped: false }), row("Splint")];
  assert.equal(wearsHeavyArmor(allOff), false, "rage was blocked by plate the barbarian had taken off");
  assert.equal(wearsHeavy({ equipment: allOff }), false);
  assert.deepEqual(gearChanges({ equipment: allOff }, { Splint: { equipped: true } }).armor, ["Splint"]);
  assert.equal(armorChangeMinutes(allOff, { Splint: { equipped: true } }).minutes, 10, "putting the splint on takes its ten minutes");
  assert.equal(wearsHeavyArmor([row("Plate")]), true, "a sheet that never said still wears what it carries");
});

await test("Shield Master counts a worn shield, not one taken off or a Shield Guardian's amulet", () => {
  const holder = (equipment) => ({ feats: ["Shield Master"], features: [], equipment });
  assert.equal(shieldMasterSaveBonus(holder([row("Shield", { equipped: true })])), 2);
  assert.equal(shieldMasterSaveBonus(holder([row("Longsword", { equipped: true }), row("Shield")])), 0, "a shield the sheet does not mark worn");
  assert.equal(shieldMasterSaveBonus(holder([row("Shield Guardian Amulet", { equipped: true })])), 0);
});

await test("the DM's game state says a second cloak is worn but not in effect", () => {
  const pack = [row("Cloak of Protection", { equipped: true, attuned: true }), row("Cloak of Displacement", { equipped: true })];
  assert.match(magicItemLine(pack[0], pack), /attuned, worn$/);
  assert.match(magicItemLine({ ...pack[1], name: "Cloak of Protection (spare)", attuned: true }, [pack[0], { ...pack[1], name: "Cloak of Protection (spare)", attuned: true }]), /worn, not in effect \(one cloak at a time\)/);
});

await test("a workshop item's author picks where it is worn, and it keeps the limits with the published ones", async () => {
  const { normalizeHomebrewData, gearFromHomebrewData, describeHomebrew } = await import("../src/lib/homebrew/gear.ts");
  const { itemMechanicsOf } = await import("../src/lib/workshop/catalog-mechanics.ts");
  const stored = normalizeHomebrewData(
    "item",
    { itemKind: "magic_item", requiresAttunement: true, effects: [{ kind: "ac_bonus", amount: 2 }], wornOn: "cloak" },
    "Mantle of the Gloaming",
  );
  assert.equal(stored.data.wornOn, "cloak");
  assert.match(describeHomebrew("item", stored.data), /worn on the shoulders/);
  const gear = gearFromHomebrewData("Mantle of the Gloaming", stored.data);
  assert.equal(gear.wornOn, "cloak");
  const pack = [row("Cloak of Protection", { equipped: true, attuned: true }), row("Mantle of the Gloaming", { equipped: true, attuned: true, gear })];
  assert.equal(wearSlotOf(pack[1]), "cloak");
  assert.equal(wornButIdle(pack[1], pack), "cloak");
  assert.equal(magicItemRiders(pack).acBonus, 1, "the mantle's +2 rode on a second cloak");
  const sheet = { name: "Tavi", equipment: [pack[0], { ...pack[1], equipped: false }] };
  const refused = gearPatch(sheet, { "Mantle of the Gloaming": { equipped: true } }, { corrects: false, armor: { armorName: null, shieldName: null } });
  assert.deepEqual(refused.conflict, { item: "Mantle of the Gloaming", slot: "cloak", wearing: ["Cloak of Protection"] });
  // Plain gear takes a place too: a homebrew pair of boots is footwear.
  const boots = normalizeHomebrewData("item", { itemKind: "gear", wornOn: "feet" }, "Mudstompers");
  assert.equal(gearFromHomebrewData("Mudstompers", boots.data).wornOn, "feet");
  // A place no one wears things on is dropped, and a weapon is held and a
  // suit places itself, whatever the data says.
  const dropped = [
    normalizeHomebrewData("item", { itemKind: "gear", wornOn: "tail" }, "Tail Ribbon"),
    normalizeHomebrewData("item", { itemKind: "weapon", weapon: { category: "martial", kind: "melee", damage: "1d8 slashing" }, wornOn: "hands" }, "Fist Blade"),
    normalizeHomebrewData("item", { itemKind: "armor", armor: { category: "light", baseAc: 12 }, wornOn: "cloak" }, "Mistweave"),
    normalizeHomebrewData("item", { itemKind: "magic_item", armor: { category: "light", baseAc: 12 }, wornOn: "cloak" }, "Starweave"),
  ];
  for (const outcome of dropped) assert.equal(outcome.data.wornOn, undefined);
  assert.equal(gearFromHomebrewData("Fist Blade", { weapon: { category: "martial", kind: "melee", damage: "1d8 slashing" }, wornOn: "hands" }).wornOn, undefined);
  // A copy of a published item starts in that item's place.
  assert.equal(itemMechanicsOf({ name: "Cloak of Elvenkind", source: "srd", kind: "magic_item", data: {} }).wornOn, "cloak");
  assert.equal(itemMechanicsOf({ name: "Ring of Protection", source: "srd", kind: "magic_item", data: {} }).wornOn, "ring");
  assert.equal(itemMechanicsOf({ name: "Flame Tongue Longsword", source: "srd", kind: "magic_item", data: {} })?.wornOn, undefined);
});

// ---- the route ----

const world = await openTable();
const lead = world.addHero({ class: "fighter", level: 5 });

async function postAs(user, body) {
  const route = await world.route("campaigns/[campaignId]/sheet/usage");
  world.signIn(user);
  const response = await route.POST(new Request("http://test/", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  return { status: response.status, json: await response.json() };
}

await test("the route refuses a second cloak with the conflict, takes the swap, and leaves the exception to the lead", async () => {
  const rogue = world.addHero({
    class: "rogue",
    level: 5,
    equipment: [row("Cloak of Protection", { equipped: true, attuned: true }), row("Cloak of Elvenkind", { equipped: false, attuned: true })],
  });
  const before = world.sheet(rogue.id).equipment;
  const refused = await postUsage(world, rogue.id, { gear: { "Cloak of Elvenkind": { equipped: true } } });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.json.wearConflict, { item: "Cloak of Elvenkind", slot: "cloak", wearing: ["Cloak of Protection"] });
  assert.deepEqual(world.sheet(rogue.id).equipment, before);

  const self = await postUsage(world, rogue.id, { gear: { "Cloak of Elvenkind": { equipped: true, layered: true } } });
  assert.equal(self.status, 403, "a player does not grant themselves the exception");
  assert.deepEqual(world.sheet(rogue.id).equipment, before);

  const swap = await postUsage(world, rogue.id, { gear: { "Cloak of Protection": { equipped: false }, "Cloak of Elvenkind": { equipped: true } } });
  assert.equal(swap.status, 200, swap.json.error);
  const worn = Object.fromEntries(world.sheet(rogue.id).equipment.map((item) => [item.name, item.equipped]));
  assert.deepEqual(worn, { "Cloak of Protection": false, "Cloak of Elvenkind": true });

  const both = await postAs(world.owner, { characterId: rogue.id, gear: { "Cloak of Protection": { equipped: true, layered: true } } });
  assert.equal(both.status, 200, both.json.error);
  const sheet = world.sheet(rogue.id);
  assert.equal(sheet.equipment.find((item) => item.name === "Cloak of Protection").layered, true);
  assert.equal(magicItemRiders(sheet.equipment, sheet).acBonus, 1, "the layered cloak's magic counts");
  assert.equal(itemCheckRiders(sheet.equipment, "stealth").advantage, true);
});

await test("a never-touched sheet's first toggle through the route keeps its armor class", async () => {
  const fighter = world.addHero({
    class: "fighter",
    level: 5,
    acOverride: false,
    equipment: [row("Chain Mail"), row("Shield"), row("Longsword"), row("Ring of Protection")],
  });
  const acBefore = acBreakdownFor(world.sheet(fighter.id)).ac;
  const out = await postUsage(world, fighter.id, { gear: { "Ring of Protection": { attuned: true } } });
  assert.equal(out.status, 200, out.json.error);
  const wear = await postUsage(world, fighter.id, { gear: { "Ring of Protection": { equipped: true } } });
  assert.equal(wear.status, 200, wear.json.error);
  const sheet = world.sheet(fighter.id);
  assert.equal(acBreakdownFor(sheet).ac, acBefore, "putting a ring on took the mail and shield off");
  assert.equal(sheet.equipment.find((item) => item.name === "Longsword").equipped, false, "a weapon is not left in hand");
});

void lead;
world.close();
finish();
