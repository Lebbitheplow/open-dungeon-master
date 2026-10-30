// The SRD 5.1 equipment chapter and the running-the-game pages on traps,
// diseases, madness, objects and poisons, held against the engine row by
// row: coinage, selling treasure, armor, weapons, adventuring gear, tools,
// mounts and vehicles, trade goods and expenses; then the sample traps,
// the three diseases, the madness tables, the object tables and the list of
// poisons (src/lib/rulebook/srd-5.1.json, pages coinage through poisons).
//
// Each gap() below is a finding of the issue #570 SRD text audit: the place
// where the engine does something other than what the quoted sentence says,
// reproduced through the real tools. Each test() is a row the audit checked
// and found held that no other suite states. The armor and weapon tables,
// the weapon properties, coin weights, the half-price sale and the three
// diseases' main rules have suites of their own (test-enforce-armor,
// test-enforce-weapons, test-enforce-weapon-rules, test-encumbrance,
// test-enforce-economy, test-enforce-afflictions) and are not repeated here.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { gearKit, profs } from "./lib/enforce-equipment.mjs";
import { kit as conditionsKit } from "./lib/enforce-conditions.mjs";

const { test, gap, finish } = suite("test-enforce-srd-equipment");

const world = await openWorld({ campaign: { maxPlayers: 40 } });
const { objectAc, objectHp } = await import("../src/lib/srd/objects.ts");
const { gearPriceCopper, gearWeightLb } = await import("../src/lib/srd/adventuring-gear.ts");
const { POISONS, SHORT_TERM_MADNESS, LONG_TERM_MADNESS, INDEFINITE_MADNESS } = await import("../src/lib/srd/afflictions.ts");
const { findSampleTrap } = await import("../src/lib/srd/trap-specs.ts");
const { carriedLight } = await import("../src/lib/dm/light-timers.ts");
const { LIFESTYLE_COST_CP } = await import("../src/lib/dm/lifestyle.ts");
const { armorChangeMinutes } = await import("../src/lib/dm/don-doff.ts");
const { handsRuling } = await import("../src/lib/dm/attack-rules.ts");
const { liveZones } = await import("../src/lib/dm/zone-store.ts");
const { afflictionConditionsFor } = await import("../src/lib/dm/afflictions.ts");
const { packListCp } = await import("../src/lib/dm/trade-value.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

// A setup step that went wrong is the test breaking, not the rule: a plain
// Error, which the harness fails the suite on, never an AssertionError that
// would be filed as the finding.
function must(condition, message) {
  if (!condition) {
    throw new Error(`setup: ${message}`);
  }
}

const d20sIn = (log) => log.filter((die) => die.sides === 20).length;
const conditionsOf = (id) => world.sheet(id).conditions.map((name) => name.toLowerCase());
const carried = (id, name) => world.sheet(id).equipment.find((item) => item.name === name) ?? null;

// ---- objects (running-the-game page "objects") ----

await test("Objects, Statistics for Objects: the Object Armor Class table, substance by substance.", () => {
  const table = {
    cloth: 11, paper: 11, rope: 11, crystal: 13, glass: 13, ice: 13, wood: 15, bone: 15,
    stone: 17, iron: 19, steel: 19, mithral: 21, adamantine: 23,
  };
  for (const [material, ac] of Object.entries(table)) {
    assert.equal(objectAc(material), ac, material);
  }
});

// objects, Statistics for Objects (Hit Points): the Object Hit Points table
// gives Tiny 2 (1d4) fragile / 5 (2d4) resilient, Small 3 (1d6) / 10 (3d6),
// Medium 4 (1d8) / 18 (4d8), Large 5 (1d10) / 27 (5d10).
await test("EQP-01", () => {
  const table = { tiny: [2, 5], small: [3, 10], medium: [4, 18], large: [5, 27] };
  const odm = Object.fromEntries(Object.keys(table).map((size) => [size, [objectHp(size, true), objectHp(size, false)]]));
  assert.deepEqual(odm, table, `fragile / resilient hit points by size: ${JSON.stringify(odm)}`);
});

// ---- adventuring gear, tools, mounts (equipment pages) ----

// SRD 5.1 Adventuring Gear, Tools and Mounts tables: [catalog name, cost in
// copper, weight in pounds or null where the book prints "-"]. The foci
// variants are EQP-02.
const SRD_PRICES = [
  ["Abacus", 200, 2], ["Acid (vial)", 2500, 1], ["Alchemist's Fire (flask)", 5000, 1],
  ["Arrows (20)", 100, 1], ["Blowgun Needles (50)", 100, 1], ["Crossbow Bolts (20)", 100, 1.5], ["Sling Bullets (20)", 4, 1.5],
  ["Antitoxin (vial)", 5000, null], ["Backpack", 200, 5], ["Ball Bearings (bag of 1000)", 100, 2], ["Barrel", 200, 70],
  ["Basket", 40, 2], ["Bedroll", 100, 7], ["Bell", 100, null], ["Blanket", 50, 3], ["Block and Tackle", 100, 5],
  ["Book", 2500, 5], ["Bottle, Glass", 200, 2], ["Bucket", 5, 2], ["Caltrops (bag of 20)", 100, 2], ["Candle", 1, null],
  ["Case, Crossbow Bolt", 100, 1], ["Case, Map or Scroll", 100, 1], ["Chain (10 feet)", 500, 10], ["Chalk (1 piece)", 1, null],
  ["Chest", 500, 25], ["Climber's Kit", 2500, 12], ["Clothes, Common", 50, 3], ["Clothes, Costume", 500, 4],
  ["Clothes, Fine", 1500, 6], ["Clothes, Traveler's", 200, 4], ["Component Pouch", 2500, 2], ["Crowbar", 200, 5],
  ["Fishing Tackle", 100, 4], ["Flask or tankard", 2, 1], ["Grappling Hook", 200, 4], ["Hammer", 100, 3],
  ["Hammer, Sledge", 200, 10], ["Healer's Kit", 500, 3], ["Holy Water (flask)", 2500, 1], ["Hourglass", 2500, 1],
  ["Hunting Trap", 500, 25], ["Ink (1 ounce bottle)", 1000, null], ["Ink Pen", 2, null], ["Jug or pitcher", 2, 4],
  ["Ladder (10-foot)", 10, 25], ["Lamp", 50, 1], ["Lantern, Bullseye", 1000, 2], ["Lantern, Hooded", 500, 2],
  ["Lock", 1000, 1], ["Magnifying Glass", 10000, null], ["Manacles", 200, 6], ["Mess Kit", 20, 1], ["Mirror, Steel", 500, 0.5],
  ["Oil (flask)", 10, 1], ["Paper (one sheet)", 20, null], ["Parchment (one sheet)", 10, null], ["Perfume (vial)", 500, null],
  ["Pick, Miner's", 200, 10], ["Piton", 5, 0.25], ["Poison, Basic (vial)", 10000, null], ["Pole (10-foot)", 5, 7],
  ["Pot, Iron", 200, 10], ["Potion of Healing", 5000, 0.5], ["Pouch", 50, 1], ["Quiver", 100, 1], ["Ram, Portable", 400, 35],
  ["Rations (1 day)", 50, 2], ["Robes", 100, 4], ["Rope, Hempen (50 feet)", 100, 10], ["Rope, Silk (50 feet)", 1000, 5],
  ["Sack", 1, 0.5], ["Scale, Merchant's", 500, 3], ["Sealing Wax", 50, null], ["Shovel", 200, 5], ["Signal Whistle", 5, null],
  ["Signet Ring", 500, null], ["Soap", 2, null], ["Spellbook", 5000, 3], ["Spikes, Iron (10)", 100, 5], ["Spyglass", 100000, 1],
  ["Tent, Two-Person", 200, 20], ["Tinderbox", 50, 1], ["Torch", 1, 1], ["Vial", 100, null], ["Waterskin", 20, 5], ["Whetstone", 1, 1],
  ["Alchemist's Supplies", 5000, 8], ["Brewer's Supplies", 2000, 9], ["Calligrapher's Supplies", 1000, 5], ["Carpenter's Tools", 800, 6],
  ["Cartographer's Tools", 1500, 6], ["Cobbler's Tools", 500, 5], ["Cook's Utensils", 100, 8], ["Glassblower's Tools", 3000, 5],
  ["Jeweler's Tools", 2500, 2], ["Leatherworker's Tools", 500, 5], ["Mason's Tools", 1000, 8], ["Painter's Supplies", 1000, 5],
  ["Potter's Tools", 1000, 3], ["Smith's Tools", 2000, 8], ["Tinker's Tools", 5000, 10], ["Weaver's Tools", 100, 5],
  ["Woodcarver's Tools", 100, 5], ["Disguise Kit", 2500, 3], ["Forgery Kit", 1500, 5], ["Dice Set", 10, null],
  ["Playing Card Set", 50, null], ["Herbalism Kit", 500, 3], ["Bagpipes", 3000, 6], ["Drum", 600, 3], ["Dulcimer", 2500, 10],
  ["Flute", 200, 1], ["Lute", 3500, 2], ["Lyre", 3000, 2], ["Horn", 300, 2], ["Pan Flute", 1200, 2], ["Shawm", 200, 1],
  ["Viol", 3000, 1], ["Navigator's Tools", 2500, 2], ["Poisoner's Kit", 5000, 2], ["Thieves' Tools", 2500, 1],
  ["Camel", 5000, null], ["Donkey or Mule", 800, null], ["Elephant", 20000, null], ["Horse, Draft", 5000, null],
  ["Horse, Riding", 7500, null], ["Mastiff", 2500, null], ["Pony", 3000, null], ["Warhorse", 40000, null],
  ["Bit and Bridle", 200, 1], ["Feed (per day)", 5, 10], ["Saddle, Exotic", 6000, 40], ["Saddle, Military", 2000, 30],
  ["Saddle, Pack", 500, 15], ["Saddle, Riding", 1000, 25], ["Saddlebags", 400, 8],
];

await test("Adventuring Gear, Tools and Mounts tables: every priced row costs and weighs what the SRD prints, with no pack installed or with one.", () => {
  for (const [name, cost, weight] of SRD_PRICES) {
    assert.deepEqual([gearPriceCopper(name), gearWeightLb(name)], [cost, weight], name);
  }
  // Equipment Packs: the price each pack is sold at.
  const packs = { "Burglar's Pack": 1600, "Diplomat's Pack": 3900, "Dungeoneer's Pack": 1200, "Entertainer's Pack": 4000, "Explorer's Pack": 1000, "Priest's Pack": 1900, "Scholar's Pack": 4000 };
  for (const [name, cost] of Object.entries(packs)) {
    assert.equal(gearPriceCopper(name), cost, name);
  }
});

await gap("EQP-02", {
  rule: "adventuring-gear, Adventuring Gear table: each focus is its own row: an orb 20 gp and 3 lb., a rod 10 gp and 2 lb., a staff 5 gp and 4 lb., a yew wand 10 gp, a wooden staff 5 gp and 4 lb., a reliquary 2 lb., an emblem weightless.",
  where: "src/lib/srd/adventuring-gear.ts SRD_GEAR (one Arcane Focus, Druidic Focus and Holy Symbol row each, the variants as aliases)",
  severity: "low",
  note: "The builder's purse, the encumbrance fallback and a shop with no pack read these numbers.",
}, () => {
  const wanted = { Orb: [2000, 3], Rod: [1000, 2], Staff: [500, 4], "Yew wand": [1000, 1], "Wooden staff": [500, 4], Reliquary: [500, 2], Emblem: [500, null] };
  const odm = Object.fromEntries(Object.keys(wanted).map((name) => [name, [gearPriceCopper(name), gearWeightLb(name)]]));
  assert.deepEqual(odm, wanted, `[copper, pounds] by focus: ${JSON.stringify(odm)}`);
});

await gap("EQP-03", {
  rule: "adventuring-gear, Lamp: \"A lamp casts bright light in a 15-foot radius and dim light for an additional 30 feet. Once lit, it burns for 6 hours on a flask (1 pint) of oil.\"",
  where: "src/lib/dm/light-timers.ts SOURCES (no lamp entry; the board draws dim light at twice the bright radius, src/lib/battlemap/los.ts)",
  severity: "medium",
  note: "The Diplomat's Pack carries a lamp; lit, it gives no light on the board.",
}, () => {
  const light = carriedLight({ equipment: [{ name: "Lamp", qty: 1 }, { name: "Oil (flask)", qty: 1 }] });
  assert.deepEqual(light, { radius: 3, minutes: 360 }, `a lamp with a flask of oil gives ${JSON.stringify(light)} (tiles of bright light, minutes)`);
});

// ---- traps (running-the-game page "traps") ----

await test("Traps, Sample Traps: each sample trap the engine holds has the SRD's DCs, attack, dice and conditions.", () => {
  const trap = (name) => {
    const found = findSampleTrap(name);
    must(found, `no sample trap named ${name}`);
    return found;
  };
  let t = trap("Collapsing Roof");
  assert.deepEqual([t.spot.dc, t.disarm.dc, t.save, t.damage], [10, 15, { ability: "dex", dc: 15, halfOnSave: true }, { dice: "4d10", type: "bludgeoning" }]);
  t = trap("Falling Net");
  assert.deepEqual([t.spot.dc, t.disarm.dc, t.conditionsAlways, t.save, t.condition, t.escape], [10, 15, ["restrained"], { ability: "str", dc: 10, halfOnSave: false }, "prone", { ability: "str", dc: 10 }]);
  t = trap("Fire-Breathing Statue");
  assert.deepEqual([t.spot.dc, t.disarm.dc, t.save, t.damage], [15, 13, { ability: "dex", dc: 13, halfOnSave: true }, { dice: "4d10", type: "fire" }]);
  assert.deepEqual([trap("Simple Pit").spot.dc, trap("Simple Pit").fallFeet], [10, 10]);
  assert.deepEqual([trap("Hidden Pit").spot.dc, trap("Hidden Pit").fallFeet], [15, 10]);
  assert.deepEqual(trap("Spiked Pit").hit, [{ dice: "2d10", type: "piercing" }]);
  t = trap("Spiked Pit (poisoned)");
  assert.deepEqual([t.save, t.damage], [{ ability: "con", dc: 13, halfOnSave: true }, { dice: "4d10", type: "poison" }]);
  t = trap("Poison Darts");
  assert.deepEqual([t.spot.dc, t.attackBonus, t.hit, t.save, t.damage], [15, 8, [{ dice: "1d4", type: "piercing" }], { ability: "con", dc: 15, halfOnSave: true }, { dice: "2d10", type: "poison" }]);
  t = trap("Poison Needle");
  assert.deepEqual([t.spot, t.disarm.dc, t.hit, t.save, t.condition, t.rounds], [{ dc: 20, skill: "investigation" }, 15, [{ dice: "1", type: "piercing" }, { dice: "2d10", type: "poison" }], { ability: "con", dc: 15, halfOnSave: false }, "poisoned", 600]);
  t = trap("Rolling Sphere");
  assert.deepEqual([t.spot.dc, t.save, t.damage, t.condition], [15, { ability: "dex", dc: 15, halfOnSave: false }, { dice: "10d10", type: "bludgeoning" }, "prone"]);
});

await gap("EQP-04", {
  rule: "traps, Pits (Locking Pit) and Sphere of Annihilation: the SRD's sample traps include a locking pit (a hidden pit whose cover snaps shut: DC 20 Strength to pry it open, DC 15 Dexterity with thieves' tools from inside) and a sphere of annihilation (DC 20 Arcana to recognize it, dispel magic DC 18).",
  where: "src/lib/srd/trap-specs.ts SAMPLE_TRAPS",
  severity: "low",
  note: "apply_hazard refuses trap \"Locking Pit\" as unknown and lists the samples it has.",
}, () => {
  assert.ok(findSampleTrap("Locking Pit"), "no Locking Pit among the sample traps");
  assert.ok(findSampleTrap("Sphere of Annihilation"), "no Sphere of Annihilation among the sample traps");
});

// ---- armor (equipment page "armor") ----

await gap("EQP-05", {
  rule: "armor, Getting Into and Out of Armor (Doff): \"This is the time it takes to take off armor. If you have help, reduce this time by half.\"",
  where: "src/lib/dm/don-doff.ts armorChangeMinutes (no helper), the sheet usage route",
  severity: "low",
}, () => {
  const taken = armorChangeMinutes([{ name: "Plate", qty: 1, equipped: true }], { Plate: { equipped: false } }, { helped: true });
  assert.equal(taken.minutes, 2.5, `taking off plate with help takes ${taken.minutes} minutes`);
});

await test("Weapons, Special Weapons (Lance): a lance needs two hands on foot, so not beside a shield, and one hand when mounted.", () => {
  const base = { who: "Hero", weapon: "Lance", properties: ["reach"], lance: true, twoHandedAsked: false, shieldName: "Shield" };
  assert.ok("error" in handsRuling({ ...base, mounted: false }));
  assert.ok(!("error" in handsRuling({ ...base, mounted: true })));
});

await test("Expenses, Lifestyle Expenses: wretched free, squalid 1 sp, poor 2 sp, modest 1 gp, comfortable 2 gp, wealthy 4 gp, aristocratic 10 gp a day.", () => {
  assert.deepEqual(LIFESTYLE_COST_CP, { wretched: 0, squalid: 10, poor: 20, modest: 100, comfortable: 200, wealthy: 400, aristocratic: 1000 });
});

// ---- poisons and madness, the tables (running-the-game pages) ----

await test("Poisons, List of Poisons and Sample Poisons: each poison's type, price, DC, dice and duration.", () => {
  const H = 60;
  const want = {
    "Assassin's Blood": ["ingested", 150, 10, "1d12", true, 24 * H],
    "Burnt Othur Fumes": ["inhaled", 500, 13, "3d6", undefined, undefined],
    "Crawler Mucus": ["contact", 200, 13, undefined, undefined, 1],
    "Drow Poison": ["injury", 200, 13, undefined, undefined, H],
    "Essence of Ether": ["inhaled", 300, 15, undefined, undefined, 8 * H],
    Malice: ["inhaled", 250, 15, undefined, undefined, H],
    "Midnight Tears": ["ingested", 1500, 17, "9d6", true, undefined],
    "Oil of Taggit": ["contact", 400, 13, undefined, undefined, 24 * H],
    "Pale Tincture": ["ingested", 250, 16, "1d6", undefined, undefined],
    "Purple Worm Poison": ["injury", 2000, 19, "12d6", true, undefined],
    "Serpent Venom": ["injury", 200, 11, "3d6", true, undefined],
    Torpor: ["ingested", 600, 15, undefined, undefined, undefined],
    "Truth Serum": ["ingested", 150, 11, undefined, undefined, H],
    "Wyvern Poison": ["injury", 1200, 15, "7d6", true, undefined],
  };
  assert.deepEqual(POISONS.map((poison) => poison.name).sort(), Object.keys(want).sort());
  for (const poison of POISONS) {
    assert.deepEqual([poison.type, poison.priceGp, poison.dc, poison.damage, poison.halfOnSave, poison.minutes], want[poison.name], poison.name);
  }
  const named = (name) => POISONS.find((poison) => poison.name === name);
  assert.deepEqual(named("Burnt Othur Fumes").repeat, { every: "turn_start", damage: "1d6", successes: 3 });
  assert.deepEqual(named("Pale Tincture").repeat, { every: "day", damage: "1d6", successes: 7 });
  assert.equal(named("Torpor").hoursDice, "4d6");
  assert.deepEqual(named("Torpor").conditions, ["poisoned", "incapacitated"]);
  assert.deepEqual(named("Malice").conditions, ["poisoned", "blinded"]);
  assert.deepEqual([named("Essence of Ether").conditions, named("Oil of Taggit").conditions], [["poisoned", "unconscious"], ["poisoned", "unconscious"]]);
  assert.equal(named("Drow Poison").unconsciousIfFailBy, 5);
  assert.equal(named("Midnight Tears").atMidnight, true);
});

await test("Madness, Madness Effects: the short-term, long-term and indefinite d100 tables, band by band, with the conditions the bands lay.", () => {
  const bands = (table) => table.map((entry) => [entry.low, entry.high]);
  assert.deepEqual(bands(SHORT_TERM_MADNESS), [[1, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 70], [71, 75], [76, 80], [81, 90], [91, 100]]);
  assert.deepEqual(bands(LONG_TERM_MADNESS), [[1, 10], [11, 20], [21, 30], [31, 40], [41, 45], [46, 55], [56, 65], [66, 75], [76, 85], [86, 90], [91, 95], [96, 100]]);
  assert.deepEqual(bands(INDEFINITE_MADNESS), [[1, 15], [16, 25], [26, 30], [31, 35], [36, 45], [46, 50], [51, 55], [56, 70], [71, 80], [81, 85], [86, 95], [96, 100]]);
  const short = SHORT_TERM_MADNESS.map((entry) => entry.conditions[0]);
  assert.deepEqual([short[0], short[1], short[2], short[8], short[9]], ["paralyzed", "incapacitated", "frightened", "stunned", "unconscious"]);
  assert.equal(SHORT_TERM_MADNESS[0].endsOnDamage, true);
  assert.equal(LONG_TERM_MADNESS[9].confusionOnDamage, true);
  assert.deepEqual(LONG_TERM_MADNESS[11].conditions, ["unconscious"]);
});

if (world.hasPack) {
  await test("Trade Goods, Cost of Trade Goods: a pound of wheat 1 cp, of iron 1 sp, of saffron 15 gp, of gold 50 gp; a square yard of silk 10 gp; a cow 10 gp, an ox 15 gp.", () => {
    const want = { Wheat: 1, "Iron (1 lb.)": 10, Saffron: 1500, "Gold (1 lb.)": 5000, "Silk (1 sq. yd.)": 1000, Cow: 1000, Ox: 1500 };
    for (const [name, cp] of Object.entries(want)) {
      assert.equal(packListCp(name), cp, name);
    }
  });
}

// ---- the fight: thrown flasks, a torch, a net, caltrops ----

const kit = await gearKit(world);
const ckit = conditionsKit(world);
const trained = profs({ weapons: ["simple", "martial"], armor: ["light", "medium", "heavy", "shields"] });
const anchor = world.addHero({ class: "fighter", level: 5, abilities: { str: 16, dex: 14 }, proficiencies: trained });
const thrower = world.addHero({ class: "fighter", level: 5, abilities: { str: 16, dex: 14 }, proficiencies: trained });
await kit.arena({ first: anchor.id });

// One flask thrown at the dummy 15 feet off, the hit forced.
async function throwFlask(name, ...faces) {
  kit.stand(thrower.id, 3);
  world.patch(thrower.id, { equipment: [{ name, qty: 2 }] });
  const swing = await kit.swing(thrower.id, { weapon: name, improvised: true }, 18, ...faces);
  must(swing.ok, `${name} could not be thrown: ${swing.error}`);
  must(swing.result.hit, `${name} missed on an 18`);
  return swing;
}

await gap("EQP-06", {
  rule: "adventuring-gear, Acid: \"make a ranged attack against a creature or object, treating the acid as an improvised weapon. On a hit, the target takes 2d6 acid damage.\" The vial shatters on impact.",
  where: "src/lib/dm/attack-logic.ts weaponAttackProfile (an object that is no weapon is an improvised 1d4 bludgeoning), src/lib/dm/pc-attack-profile.ts",
  severity: "high",
}, async () => {
  const swing = await throwFlask("Acid (vial)", 6, 6, 6);
  const shown = `${swing.result.damage} ${swing.result.damageType} from d${swing.damageDice.join(", d")}`;
  assert.equal(swing.result.damageType, "acid", `the acid hit for ${shown}`);
  assert.deepEqual(swing.damageDice, [6, 6], `the acid hit for ${shown}`);
  assert.equal(carried(thrower.id, "Acid (vial)")?.qty ?? 0, 1, "the thrown vial is still in the pack");
});

await gap("EQP-07", {
  rule: "adventuring-gear, Alchemist's Fire: \"On a hit, the target takes 1d4 fire damage at the start of each of its turns. A creature can end this damage by using its action to make a DC 10 Dexterity check to extinguish the flames.\"",
  where: "src/lib/dm/attack-logic.ts weaponAttackProfile (improvised 1d4 bludgeoning), no burning condition in src/lib/srd/condition-effects.ts",
  severity: "high",
}, async () => {
  const swing = await throwFlask("Alchemist's Fire (flask)", 3, 3);
  assert.equal(swing.result.damageType, "fire", `the flask hit for ${swing.result.damage} ${swing.result.damageType}`);
  assert.ok(kit.dummy().conditions.some((name) => /fire|burn/i.test(name)), `the target holds ${JSON.stringify(kit.dummy().conditions)}: nothing burns at the start of its turns`);
});

await gap("EQP-08", {
  rule: "adventuring-gear, Holy Water: \"make a ranged attack against a target creature, treating the holy water as an improvised weapon. If the target is a fiend or undead, it takes 2d6 radiant damage.\" Any other creature takes nothing.",
  where: "src/lib/dm/attack-logic.ts weaponAttackProfile (improvised 1d4 bludgeoning against any creature)",
  severity: "medium",
}, async () => {
  const before = kit.dummy().currentHp;
  const swing = await throwFlask("Holy Water (flask)", 3, 3);
  assert.equal(before - kit.dummy().currentHp, 0, `holy water hit a goblin, neither fiend nor undead, for ${swing.result.damage} ${swing.result.damageType}`);
});

await gap("EQP-09", {
  rule: "adventuring-gear, Oil: \"On a hit, the target is covered in oil. If the target takes any fire damage before the oil dries (after 1 minute), the target takes an additional 5 fire damage from the burning oil.\"",
  where: "src/lib/dm/attack-logic.ts weaponAttackProfile (improvised 1d4 bludgeoning, nothing left on the target), src/lib/dm/enemy-damage.ts",
  severity: "low",
}, async () => {
  await throwFlask("Oil (flask)", 1);
  const before = kit.dummy().currentHp;
  const burnt = await world.invoke("apply_damage", { enemyId: kit.dummy().id, amount: 3, type: "fire", reason: "a torch put to the oil" });
  must(burnt.ok, `apply_damage refused: ${burnt.error}`);
  assert.equal(before - kit.dummy().currentHp, 8, `3 fire damage on an oiled target took ${before - kit.dummy().currentHp} hit points`);
});

await gap("EQP-10", {
  rule: "adventuring-gear, Torch: \"If you make a melee attack with a burning torch and hit, it deals 1 fire damage.\"",
  where: "src/lib/dm/attack-logic.ts weaponAttackProfile (a torch swings as an improvised 1d4 bludgeoning)",
  severity: "low",
}, async () => {
  kit.stand(thrower.id, 1);
  world.patch(thrower.id, { equipment: [{ name: "Torch", qty: 1 }] });
  const swing = await kit.swing(thrower.id, { weapon: "Torch", improvised: true }, 18, 2);
  must(swing.ok && swing.result.hit, `the torch swing failed: ${swing.error}`);
  assert.equal(swing.result.damageType, "fire", `the torch hit for ${swing.result.damage} ${swing.result.damageType}`);
});

await gap("EQP-11", {
  rule: "weapons, Improvised Weapons: \"If a character uses a ranged weapon to make a melee attack, or throws a melee weapon that does not have the thrown property, it also deals 1d4 damage. An improvised thrown weapon has a normal range of 20 feet and a long range of 60 feet.\"",
  where: "src/lib/dm/attack-logic.ts resolveAttackWeapon (improvised only for a name that is no weapon), src/lib/dm/map-tools.ts checkPcAttackRange",
  severity: "low",
}, async () => {
  kit.stand(thrower.id, 3);
  world.patch(thrower.id, { equipment: [{ name: "Longsword", qty: 1 }] });
  const swing = await kit.swing(thrower.id, { weapon: "Longsword", improvised: true }, 18, 3);
  assert.equal(swing.ok, true, `a longsword thrown 15 feet: ${swing.error}`);
  assert.deepEqual(swing.damageDice, [4], `the thrown longsword rolled d${swing.damageDice.join(", d")}`);
});

await gap("EQP-12", {
  rule: "weapons, Special Weapons (Net): \"When you use an action, bonus action, or reaction to attack with a net, you can make only one attack regardless of the number of attacks you can normally make.\"",
  where: "src/lib/dm/pc-attack-spend.ts (the loading rule's once-per-action check is not applied to the net), src/lib/dm/attack-rules.ts",
  severity: "medium",
}, async () => {
  world.patch(anchor.id, { equipment: [{ name: "Net", qty: 2 }, { name: "Longsword", qty: 1 }] });
  kit.stand(anchor.id, 1, 1);
  kit.freshTurn();
  try {
    const net = await kit.swing(anchor.id, { weapon: "Net" }, 15, 15);
    must(net.ok, `the net throw failed: ${net.error}`);
    const sword = await kit.swing(anchor.id, { weapon: "Longsword" }, 15, 4);
    assert.equal(sword.ok, false, `after a net, a level 5 fighter's Extra Attack swung a longsword (attacks made: ${world.encounter().turnBudget?.attacksMade})`);
  } finally {
    encounters.patchEnemyConditions(kit.dummy().id, [], {});
  }
});

await test("Weapons, Special Weapons (Net): a net has no effect on a creature that is Huge or larger.", async () => {
  const dummy = kit.dummy();
  const setSize = (size) => getDatabase().prepare("UPDATE encounter_enemies SET stat_json = ? WHERE id = ?").run(JSON.stringify({ ...kit.dummy().stats, size }), dummy.id);
  setSize("Huge");
  world.patch(anchor.id, { equipment: [{ name: "Net", qty: 1 }] });
  kit.freshTurn();
  try {
    const net = await kit.swing(anchor.id, { weapon: "Net" }, 15, 15);
    must(net.ok && net.result.hit, `the net throw failed: ${net.error}`);
    assert.equal(kit.dummy().conditions.includes("restrained"), false);
  } finally {
    setSize("Small");
    encounters.patchEnemyConditions(dummy.id, [], {});
  }
});

await gap("EQP-13", {
  rule: "adventuring-gear, Caltrops: \"As an action, you can spread a bag of caltrops to cover a square area that is 5 feet on a side. Any creature that enters the area must succeed on a DC 15 Dexterity saving throw or stop moving this turn and take 1 piercing damage.\" Ball Bearings: a 10-foot square, DC 10 Dexterity save or fall prone.",
  where: "src/lib/dm/resource-tools.ts computeUseItem (a generic consumable is removed and nothing is placed), src/lib/dm/zone-store.ts",
  severity: "medium",
}, async () => {
  kit.stand(thrower.id, 2);
  world.patch(thrower.id, { equipment: [{ name: "Caltrops (bag of 20)", qty: 1 }] });
  const used = await kit.onTurnOf(thrower.id, () => world.invoke("use_item", { characterId: thrower.id, item: "Caltrops (bag of 20)" }));
  must(used.ok, `use_item refused: ${used.error}`);
  const zones = liveZones(kit.board(), world.encounter());
  assert.ok(zones.length > 0, `the bag was spent (${JSON.stringify(used.result)}) and nothing lies on the board`);
});

await kit.endFight();

// ---- a second fight: cackle fever's laughter spreading, crawler mucus ----

const near = world.addHero({ class: "fighter", level: 5, abilities: { con: 10 }, proficiencies: trained });
const sick = world.addHero({ class: "fighter", level: 5, maxHp: 60, proficiencies: trained });
await kit.arena({ first: anchor.id });
{
  // The anchor, then the healthy hero beside the sick one, then the sick
  // one: the healthy hero's turn starts right after the anchor's ends.
  const encounter = world.encounter();
  const entry = (id) => encounter.order.find((row) => row.characterId === id);
  const rest = encounter.order.filter((row) => ![anchor.id, near.id, sick.id].includes(row.characterId));
  encounters.saveEncounter({ ...encounter, order: [entry(anchor.id), entry(near.id), entry(sick.id), ...rest], turnIndex: 0, turnBudget: null });
}
kit.stand(near.id, 3);
kit.stand(sick.id, 4);
const pointerAt = () => {
  const encounter = world.encounter();
  return encounter.order[encounter.turnIndex]?.characterId;
};

await gap("EQP-14", {
  rule: "diseases, Cackle Fever: \"Any humanoid creature that starts its turn within 10 feet of an infected creature in the throes of mad laughter must succeed on a DC 10 Constitution saving throw or also become infected with the disease.\"",
  where: "src/lib/dm/afflictions.ts (no turn-start check), src/lib/dm/turn-start-effects.ts",
  severity: "low",
}, async () => {
  try {
    const infected = await world.invoke("afflict", { characterId: sick.id, kind: "disease", name: "Cackle Fever", save: false, symptomsNow: true });
    must(infected.ok, `afflict refused: ${infected.error}`);
    world.clearDice();
    world.dice(1, 5);
    await world.invoke("apply_damage", { characterId: sick.id, amount: 2, type: "slashing", reason: "a cut" });
    world.clearDice();
    must(conditionsOf(sick.id).includes("incapacitated"), "the laughter did not take the sick hero");
    must(pointerAt() === anchor.id, "the anchor does not hold the turn");
    world.diceLog();
    world.dice(15, 15, 15);
    must(ckit.skipTurn(), "the anchor's turn did not end");
    const rolled = world.diceLog();
    world.clearDice();
    must(pointerAt() === near.id, "the healthy hero's turn did not start");
    assert.ok(d20sIn(rolled) >= 1, `a humanoid began its turn 5 feet from a laughing infected creature and rolled ${d20sIn(rolled)} saves`);
  } finally {
    await world.invoke("clear_condition", { characterId: sick.id, condition: "cackle fever" });
    world.patch(sick.id, { conditions: [], conditionMeta: {}, exhaustion: 0, currentHp: 60 });
  }
});

await gap("EQP-15", {
  rule: "poisons, Crawler Mucus: \"must succeed on a DC 13 Constitution saving throw or be poisoned for 1 minute. The poisoned creature is paralyzed. The creature can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success.\"",
  where: "src/lib/dm/affliction-poisons.ts applyPoison (the paralysis gets the minute and 10 more rounds, and the save ends the paralysis alone)",
  severity: "medium",
}, async () => {
  try {
    const out = await world.invoke("afflict", { characterId: near.id, kind: "poison", name: "Crawler Mucus", save: false });
    must(out.ok, `afflict refused: ${out.error}`);
    const meta = world.sheet(near.id).conditionMeta;
    assert.ok((meta.paralyzed?.rounds ?? 0) <= 10, `the paralysis is held for ${meta.paralyzed?.rounds} rounds, the poison for ${meta.poisoned?.rounds}`);
    must(pointerAt() === near.id, "the poisoned hero does not hold the turn");
    world.dice(20);
    must(ckit.skipTurn(), "the poisoned hero's turn did not end");
    world.clearDice();
    const left = conditionsOf(near.id).filter((name) => name === "poisoned" || name === "paralyzed");
    assert.deepEqual(left, [], `after the save that ends the effect the hero is still ${left.join(" and ")}`);
  } finally {
    world.patch(near.id, { conditions: [], conditionMeta: {} });
  }
});

await kit.endFight();

// ---- out of a fight: antitoxin, poisons, diseases, gear used up ----

await gap("EQP-16", {
  rule: "adventuring-gear, Antitoxin: \"A creature that drinks this vial of liquid gains advantage on saving throws against poison for 1 hour.\"",
  where: "src/lib/dm/consumables.ts applyConsumable (no antitoxin plan), src/lib/dm/affliction-poisons.ts applyPoison (advantage only from recuperating)",
  severity: "medium",
  note: "A hill dwarf's Dwarven Resilience rolls two d20s on the same save, so the path carries advantage; the vial gives none.",
}, async () => {
  const sipper = world.addHero({ class: "fighter", level: 5, maxHp: 44, equipment: [{ name: "Antitoxin (vial)", qty: 1 }] });
  const drunk = await world.invoke("use_item", { characterId: sipper.id, item: "Antitoxin (vial)" });
  must(drunk.ok, `use_item refused: ${drunk.error}`);
  world.clearDice();
  world.diceLog();
  world.dice(15, 15, 4, 4, 4);
  const out = await world.invoke("afflict", { characterId: sipper.id, kind: "poison", name: "Serpent Venom" });
  const rolled = world.diceLog();
  world.clearDice();
  must(out.ok, `afflict refused: ${out.error}`);
  assert.equal(d20sIn(rolled), 2, `the save against Serpent Venom an hour inside the antitoxin rolled ${d20sIn(rolled)} d20`);
});

await gap("EQP-17", {
  rule: "poisons, Pale Tincture: \"Until this poison ends, the damage the poison deals can't be healed by any means.\"",
  where: "src/lib/dm/affliction-poisons.ts applyPoison (only a line telling the model not to heal), the heal path in src/lib/dm/mutations.ts",
  severity: "medium",
}, async () => {
  const victim = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.patch(victim.id, { currentHp: 44 });
  world.clearDice();
  world.dice(5);
  const out = await world.invoke("afflict", { characterId: victim.id, kind: "poison", name: "Pale Tincture", save: false });
  world.clearDice();
  must(out.ok && world.sheet(victim.id).currentHp === 39, `the tincture did not deal its 5: ${out.error ?? world.sheet(victim.id).currentHp}`);
  const healed = await world.invoke("heal", { characterId: victim.id, amount: 10, reason: "cure wounds" });
  must(healed.ok, `heal refused: ${healed.error}`);
  assert.equal(world.sheet(victim.id).currentHp, 39, `10 healing on 5 tincture damage left the hero at ${world.sheet(victim.id).currentHp} of 44`);
});

await gap("EQP-18", {
  rule: "diseases, Cackle Fever: \"This disease targets humanoids, although gnomes are strangely immune.\"",
  where: "src/lib/dm/afflictions.ts infectDisease (no immunity by race)",
  severity: "low",
}, async () => {
  const gnome = world.addHero({ class: "fighter", level: 5, maxHp: 44, race: "rock_gnome" });
  world.clearDice();
  world.dice(1, 2);
  const out = await world.invoke("afflict", { characterId: gnome.id, kind: "disease", name: "Cackle Fever" });
  world.clearDice();
  must(out.ok, `afflict refused: ${out.error}`);
  assert.equal(out.result.infected, undefined, `a rock gnome was infected: ${out.result.note}`);
});

await gap("EQP-19", {
  rule: "diseases, Cackle Fever: \"Any event that causes the infected creature great stress, including entering combat, taking damage, experiencing fear, or having a nightmare, forces the creature to make a DC 13 Constitution saving throw.\"",
  where: "src/lib/dm/afflictions.ts afflictionStress (cause \"fear\" has no caller), src/lib/dm/set-condition.ts",
  severity: "low",
}, async () => {
  const laugher = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  try {
    await world.invoke("afflict", { characterId: laugher.id, kind: "disease", name: "Cackle Fever", save: false, symptomsNow: true });
    world.clearDice();
    world.diceLog();
    world.dice(15, 5);
    const scared = await world.invoke("set_condition", { characterId: laugher.id, condition: "frightened", reason: "a dragon's roar" });
    const rolled = world.diceLog();
    world.clearDice();
    must(scared.ok && conditionsOf(laugher.id).includes("frightened"), `set_condition refused: ${scared.error}`);
    assert.equal(d20sIn(rolled), 1, `frightened with cackle fever, the hero rolled ${d20sIn(rolled)} saves`);
  } finally {
    await world.invoke("clear_condition", { characterId: laugher.id, condition: "cackle fever" });
    world.patch(laugher.id, { conditions: [], conditionMeta: {}, exhaustion: 0 });
  }
});

await gap("EQP-20", {
  rule: "traps, Poison Darts: \"The trap activates when more than 20 pounds of weight is placed on the pressure plate, releasing four darts. Each dart makes a ranged attack with a +8 bonus against a random target within 10 feet of the pressure plate.\"",
  where: "src/lib/dm/hazard-tools.ts apply_hazard trap path (one springTrapOn per victim), src/lib/dm/trap-run.ts springTrapOn (one attack roll)",
  severity: "medium",
}, async () => {
  const walker = world.addHero({ class: "fighter", level: 5, maxHp: 44 });
  world.clearDice();
  world.diceLog();
  for (let dart = 0; dart < 4; dart += 1) {
    world.dice(15, 2, 10, 5, 5);
  }
  const out = await world.invoke("apply_hazard", { type: "trap", trap: "Poison Darts", characterIds: [walker.id] });
  const rolled = world.diceLog();
  world.clearDice();
  must(out.ok, `apply_hazard refused: ${out.error}`);
  const attacks = rolled.filter((die) => die.sides === 20 && die.face === 15).length;
  assert.equal(attacks, 4, `one creature alone on the plate faced ${attacks} dart attack${attacks === 1 ? "" : "s"}`);
});

await gap("EQP-21", {
  rule: "tools, Herbalism Kit: \"proficiency with this kit is required to create antitoxin and potions of healing.\"",
  where: "src/lib/dm/lifestyle.ts downtimeProblem (crafting checks only the named tool's proficiency)",
  severity: "low",
}, async () => {
  const smith = world.addHero({ class: "fighter", level: 3, gold: 200, proficiencies: profs({ tools: ["Smith's Tools"] }) });
  const out = await world.invoke("downtime", { characterId: smith.id, activity: "crafting", item: "Potion of Healing", tool: "Smith's Tools", days: 1 });
  assert.equal(out.ok && !out.result?.error, false, `a smith with no herbalism kit crafted: ${JSON.stringify(out.result?.results ?? out.result)}`);
});

await gap("EQP-22", {
  rule: "adventuring-gear, Healer's Kit: \"The kit has ten uses. As an action, you can expend one use of the kit to stabilize a creature that has 0 hit points.\"",
  where: "src/lib/dm/resource-tools.ts computeUseItem (removes the whole line), src/lib/dm/mutations.ts use_item (healerKitUse answers only for the Healer feat)",
  severity: "medium",
  note: "stabilize with method kit spends one use correctly (test-enforce-death); use_item, the Hand's use card, takes the whole kit.",
}, async () => {
  const medic = world.addHero({ class: "cleric", level: 3, equipment: [{ name: "Healer's Kit", qty: 1 }] });
  const patient = world.addHero({ class: "fighter", level: 3 });
  const out = await world.invoke("use_item", { characterId: medic.id, item: "Healer's Kit", targetCharacterId: patient.id });
  const kitLine = carried(medic.id, "Healer's Kit");
  assert.ok(kitLine && (kitLine.charges ?? 10) >= 9, `one use of a healer's kit left the medic with ${kitLine ? `${kitLine.charges} uses` : "no kit"} (${JSON.stringify(out.result ?? out.error)})`);
});

await gap("EQP-23", {
  rule: "adventuring-gear: manacles bind a creature (DC 20 Dexterity to escape, DC 20 Strength to break), a hunting trap is set with an action and holds what steps on it, a climber's kit anchors its user; none of them is used up by its use.",
  where: "src/lib/dm/item-logic.ts itemUseProblem (an untagged item counts as a consumable), src/lib/dm/resource-tools.ts computeUseItem",
  severity: "low",
}, async () => {
  const jailer = world.addHero({ class: "rogue", level: 3, equipment: [{ name: "Manacles", qty: 1 }, { name: "Hunting Trap", qty: 1 }, { name: "Climber's Kit", qty: 1 }] });
  const gone = [];
  for (const name of ["Manacles", "Hunting Trap", "Climber's Kit"]) {
    const out = await world.invoke("use_item", { characterId: jailer.id, item: name });
    if (!carried(jailer.id, name)) {
      gone.push(`${name} (${JSON.stringify(out.result ?? out.error)})`);
    }
  }
  assert.deepEqual(gone, [], `used once, these left the pack: ${gone.join("; ")}`);
});

await gap("EQP-24", {
  rule: "mounts-and-vehicles, Saddles: \"An exotic saddle is required for riding any aquatic or flying mount.\"",
  where: "src/lib/dm/mount-tools.ts mount_up, src/lib/srd/mounts.ts checkMount",
  severity: "low",
}, async () => {
  const rider = world.addHero({ class: "fighter", level: 3, equipment: [{ name: "Saddle, Riding", qty: 1 }] });
  const out = await world.invoke("mount_up", { characterId: rider.id, mount: "Griffon" });
  assert.equal(out.ok && !out.result?.error, false, `a rider with no exotic saddle mounted a griffon: ${JSON.stringify(out.result)}`);
});

await gap("EQP-26", {
  rule: "adventuring-gear, Block and Tackle: \"a block and tackle allows you to hoist up to four times the weight you can normally lift.\"",
  where: "src/lib/dm/explore-tools.ts lift, src/lib/dm/load-rules.ts liftLimits (no factor for a carried block and tackle)",
  severity: "low",
}, async () => {
  const hauler = world.addHero({ class: "fighter", level: 3, abilities: { str: 10 }, equipment: [{ name: "Block and Tackle", qty: 1 }] });
  // Strength 10 lifts 300 pounds; with the pulleys, up to 1,200.
  const out = await world.invoke("lift", { characterId: hauler.id, weightLb: 1000, how: "lift", reason: "a portcullis" });
  assert.equal(out.ok && !out.result?.error, true, `hoisting 1,000 pounds with a block and tackle at Strength 10: ${out.error ?? out.result?.error}`);
});

if (world.hasPack) {
  await gap("EQP-25", {
    rule: "selling-treasure, Trade Goods: \"trade goods (bars of iron, bags of salt, livestock, and so on) retain their full value in the market and can be used as currency.\"",
    where: "src/lib/dm/trade-value.ts isTreasure (a trade good the pack prices counts as priced gear, so keepsFullValue is false)",
    severity: "medium",
    note: "Content pack only: with no pack nothing prices a trade good and the given worth is paid in full. docs/rules-coverage.md (Commerce) claims full value for trade goods.",
  }, async () => {
    const trader = world.addHero({ class: "fighter", level: 3, gold: 0, equipment: [{ name: "Saffron", qty: 1 }] });
    const sold = await world.invoke("purchase", { characterId: trader.id, item: "Saffron", action: "sell" });
    must(sold.ok && sold.result?.ok, `the sale was refused: ${sold.error ?? sold.result?.error}`);
    assert.equal(world.sheet(trader.id).gold * 100 + (world.sheet(trader.id).copper ?? 0), 1500, `a pound of saffron (15 gp) sold for ${sold.result.received}`);
  });
}

await test("Madness, Curing Madness: lesser restoration reaches a short- or long-term madness and not an indefinite one, which greater restoration reaches.", async () => {
  const mad = world.addHero({ class: "wizard", level: 3, maxHp: 20 });
  world.clearDice();
  world.dice(25, 3);
  const short = await world.invoke("afflict", { characterId: mad.id, kind: "madness", duration: "short" });
  world.dice(60);
  const lasting = await world.invoke("afflict", { characterId: mad.id, kind: "madness", duration: "indefinite" });
  world.clearDice();
  must(short.ok && lasting.ok, `afflict refused: ${short.error ?? lasting.error}`);
  const sheet = world.sheet(mad.id);
  assert.deepEqual(afflictionConditionsFor(world.campaignId, sheet, "madness"), ["incapacitated"]);
  assert.deepEqual(afflictionConditionsFor(world.campaignId, sheet, "indefinite madness"), ["indefinite madness"]);
});

world.close();
finish();
