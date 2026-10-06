// The SRD adventuring gear table and what reads it (issues #111, #112, #113):
// the builder's purse prices a backpack, the encumbrance rule weighs a
// bedroll, a background's prose kit comes to the sheet as catalog items with
// its packs opened, "work leathers" is clothing and not Leather, and the
// setting armor is suggested to its own genre's classes only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { SRD_GEAR, matchGear, gearPriceCopper, gearWeightLb, resolveGearLine, resolveBackgroundGear } = await import(
  "../src/lib/srd/adventuring-gear.ts"
);
const { PACKS } = await import("../src/lib/srd/starting-kit-data.ts");
const { bundledPrices, bundledPriceCopper, judgeStartingGear } = await import("../src/lib/srd/starting-wealth.ts");
const { lineWeightLb } = await import("../src/lib/srd/encumbrance.ts");
const { matchArmor, suggestArmor, armorOfRow } = await import("../src/lib/srd/armor.ts");
const { srdBackgroundOptions } = await import("../src/lib/characters/options.ts");
const { classGenres } = await import("../src/lib/classes/index.ts");
const { acBreakdownFor } = await import("../src/lib/srd/index.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}
const names = (line) => resolveGearLine(line).items.map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name));

// The six items the builder's "Add adventurer's starter pack" adds
// (src/app/characters/builder/EquipmentSection.tsx).
const STARTER = [
  { name: "Backpack", qty: 1 },
  { name: "Bedroll", qty: 1 },
  { name: "Rations (1 day)", qty: 5 },
  { name: "Rope, Hempen (50 feet)", qty: 1 },
  { name: "Torch", qty: 5 },
  { name: "Waterskin", qty: 1 },
];

test("every item of the starter pack has an SRD price, and the pack fits a 10 gp purse (#111)", () => {
  for (const item of STARTER) {
    assert.ok(bundledPriceCopper(item.name) !== null, `${item.name} is priced`);
  }
  const verdict = judgeStartingGear({ equipment: STARTER, freeKit: [], coinCopper: 1000, priceOf: bundledPrices });
  assert.deepEqual(verdict.problems, []);
  // 2 gp + 1 gp + 5 x 5 sp + 1 gp + 5 x 1 cp + 2 sp = 6 gp 75 cp.
  assert.equal(verdict.spentCopper, 675);
});

test("every item in every SRD equipment pack is known to the table, priced where the book prices it", () => {
  for (const [pack, items] of Object.entries(PACKS)) {
    for (const item of items) {
      assert.ok(matchGear(item.name), `${pack}: ${item.name}`);
    }
  }
  assert.equal(gearPriceCopper("Torch"), 1);
  assert.equal(gearPriceCopper("Clothes, Fine"), 1500);
  assert.equal(gearPriceCopper("Vestments"), null);
  // Weapons and armor keep their own table.
  assert.equal(bundledPriceCopper("Longsword"), 1500);
  assert.equal(bundledPriceCopper("Chain Mail"), 7500);
});

test("the table reads the book's inverted names, aliases, plurals and counts", () => {
  assert.equal(matchGear("common clothes")?.name, "Clothes, Common");
  assert.equal(matchGear("Clothes, common")?.name, "Clothes, Common");
  assert.equal(matchGear("torches")?.name, "Torch");
  assert.equal(matchGear("hempen rope")?.name, "Rope, Hempen (50 feet)");
  assert.equal(matchGear("traveller's clothes")?.name, "Clothes, Traveler's");
  assert.equal(matchGear("quill")?.name, "Ink Pen");
  assert.equal(matchGear("Leather"), null);
  assert.equal(matchGear("Longsword"), null);
});

test("the encumbrance rule weighs gear the content pack did not stamp", () => {
  assert.equal(lineWeightLb({ name: "Bedroll" }), 7);
  assert.equal(lineWeightLb({ name: "Rations (1 day)", qty: 10 }), 20);
  assert.equal(lineWeightLb({ name: "Hunting Trap" }), 25);
  assert.equal(gearWeightLb("Bell"), null);
  assert.equal(lineWeightLb({ name: "A trophy from an animal you killed" }), null);
});

test("a background's prose kit comes to catalog items: packs open, counts count, names are the book's (#113)", () => {
  assert.deepEqual(names("an explorer's pack"), [
    "Backpack", "Bedroll", "Mess Kit", "Tinderbox", "Torch x10", "Rations (1 day) x10", "Waterskin", "Rope, Hempen (50 feet)",
  ]);
  assert.deepEqual(names("a set of common clothes"), ["Clothes, Common"]);
  assert.deepEqual(names("dark common clothes with hood"), ["Clothes, Common"]);
  assert.deepEqual(names("A set of dark common clothes including a hood"), ["Clothes, Common"]);
  assert.deepEqual(names("7 days rations"), ["Rations (1 day) x7"]);
  assert.deepEqual(names("2 days worth of rations"), ["Rations (1 day) x2"]);
  assert.deepEqual(names("50 feet of hempen rope"), ["Rope, Hempen (50 feet)"]);
  assert.deepEqual(names("50 ft silk rope"), ["Rope, Silk (50 feet)"]);
  assert.deepEqual(names("10 sheets of paper"), ["Paper (one sheet) x10"]);
  assert.deepEqual(names("5 torches"), ["Torch x5"]);
  assert.deepEqual(names("2 hunting traps"), ["Hunting Trap x2"]);
  assert.deepEqual(names("iron pot"), ["Pot, Iron"]);
  assert.deepEqual(names("bottle of black ink"), ["Ink (1 ounce bottle)"]);
  assert.deepEqual(names("belaying pin (club)"), ["Club"]);
  assert.deepEqual(names("a wood staff"), ["Quarterstaff"]);
  assert.deepEqual(names("Holy symbol (amulet or reliquary)"), ["Holy Symbol"]);
  assert.deepEqual(names("a shield bearing your previous employer's symbol"), ["Shield"]);
  assert.deepEqual(names("a signet ring emblazoned with the symbol of your family's free company"), ["Signet Ring"]);
  assert.deepEqual(names("ink and quill"), ["Ink (1 ounce bottle)", "Ink Pen"]);
  assert.deepEqual(names("Vestments and a holy symbol of your previous cult"), ["Vestments", "Holy Symbol"]);
  assert.deepEqual(names("a belt pouch"), ["Pouch"]);
});

test("what the catalog does not know stays as the book wrote it, tidied, and a choice stays one line", () => {
  for (const line of [
    "a trophy from an animal you killed",
    "letter of introduction from your guild",
    "a dagger, quarterstaff, or spear",
    "Lute or other musical instrument",
    "a prayer book or prayer wheel",
    "5 sticks of incense",
    "one person tent",
    "a pet monkey wearing a tiny fez",
    "work leathers",
  ]) {
    const resolved = resolveGearLine(line);
    assert.equal(resolved.resolved, false, line);
    assert.equal(resolved.items.length, 1, line);
    assert.equal(resolved.items[0].name, line.charAt(0).toUpperCase() + line.slice(1), line);
  }
});

test("'work leathers' is not Leather armor: a barbarian keeps Unarmored Defense (#113)", () => {
  assert.equal(matchArmor("work leathers"), null);
  assert.equal(matchArmor("Work Leathers"), null);
  assert.equal(armorOfRow({ name: "Work leathers" }), null);
  // The tail rule still finds armor written out in full.
  assert.equal(matchArmor("Dwarven Chain Mail")?.name, "Chain Mail");
  assert.equal(matchArmor("+1 Studded Leather")?.name, "Studded Leather");
  assert.equal(matchArmor("Shields")?.name, "Shield");
  const ac = acBreakdownFor({
    class: "barbarian",
    level: 1,
    abilities: { str: 16, dex: 14, con: 16, int: 8, wis: 10, cha: 10 },
    proficiencies: { armor: ["light", "medium", "shields"], weapons: [], skills: [], saves: [], languages: [], tools: [], expertise: [] },
    equipment: [{ name: "Work leathers", qty: 1 }, { name: "Greataxe", qty: 1 }],
    features: [{ name: "Unarmored Defense", source: "class" }, { name: "Rage", source: "class" }],
  });
  assert.equal(ac.ac, 15, "10 + DEX 2 + CON 3");
});

test("every bundled background's kit resolves without losing an item, and the forest dweller's pack opens once", () => {
  const options = srdBackgroundOptions();
  assert.ok(options.length >= 13);
  for (const background of options) {
    assert.ok(background.equipment.length > 0, background.id);
    for (const name of background.equipment) {
      assert.ok(name.trim().length > 0 && !/^(a|an)\s/i.test(name), `${background.id}: "${name}"`);
    }
  }
  const acolyte = options.find((entry) => entry.id === "acolyte");
  assert.deepEqual(acolyte.equipment, ["Holy Symbol", "Book", "5 sticks of incense", "Vestments", "Clothes, Common"]);
  assert.equal(acolyte.purse, 15);
  const sailor = options.find((entry) => entry.id === "sailor");
  assert.ok(sailor.equipment.includes("Club") && sailor.equipment.includes("Rope, Silk (50 feet)"));
  // The pack's Forest Dweller, as its row reads.
  const forest = resolveBackgroundGear([
    "A set of common clothes", "a hunting trap", "a wood staff", "a whetstone", "an explorer's pack", "a pouch",
  ]);
  assert.equal(forest.filter((name) => name === "Backpack").length, 1);
  assert.equal(forest.filter((name) => name === "Torch").length, 10);
  assert.ok(forest.includes("Quarterstaff") && forest.includes("Whetstone") && forest.includes("Pouch"));
});

test("the content pack's background rows, as dumped, resolve or keep their line: nothing is dropped", () => {
  // A copy of the pack's gear text as it stood on 2026-10-06, so this runs
  // without the pack. Every line comes to at least one item.
  const rows = readFileSync(new URL("./fixtures/pack-background-gear.txt", import.meta.url), "utf8")
    .split("\n")
    .filter(Boolean);
  let resolved = 0;
  let kept = 0;
  for (const row of rows) {
    const text = row.split(" | ")[2];
    if (!text) continue;
    for (const piece of text.split(/,\s*(?![^()]*\))/)) {
      const line = piece.replace(/^and\s+/i, "").replace(/\.$/, "").trim();
      if (!line) continue;
      const out = resolveGearLine(line);
      assert.ok(out.items.length >= 1, `${row}: "${line}"`);
      if (out.resolved) resolved += 1;
      else kept += 1;
    }
  }
  assert.ok(resolved > kept, `${resolved} resolved, ${kept} kept`);
  console.log(`  (${resolved} pack lines resolved, ${kept} kept as written)`);
});

test("the setting armor is suggested to its own genre's classes only (#112)", () => {
  const trained = ["light", "medium", "heavy", "shields"];
  const srdOffered = suggestArmor(trained).map((armor) => armor.name);
  for (const name of ["Armorweave Vest", "Kevlar Vest", "Riot Plating", "Brass Carapace", "Scrap Plate", "Ballistic Shield"]) {
    assert.ok(!srdOffered.includes(name), `${name} offered to an SRD class`);
  }
  assert.ok(srdOffered.includes("Chain Mail") && srdOffered.includes("Shield"));
  const cyber = suggestArmor(trained, classGenres("street_samurai")).map((armor) => armor.name);
  assert.ok(cyber.includes("Armorweave Vest") && cyber.includes("Kevlar Vest") && cyber.includes("Ballistic Shield"));
  assert.ok(!cyber.includes("Brass Carapace"));
  const steam = suggestArmor(trained, classGenres("machinist")).map((armor) => armor.name);
  assert.ok(steam.includes("Brass Carapace") && !steam.includes("Kevlar Vest"));
  // A light-armor SRD class: leather, padded, studded leather and nothing else.
  assert.deepEqual(suggestArmor(["light"]).map((armor) => armor.name), ["Padded", "Leather", "Studded Leather"]);
  // Every setting armor row names its genres.
  for (const armor of SRD_GEAR.length ? suggestArmor(trained, ["cyberpunk", "post_apocalyptic", "steampunk"]) : []) {
    if (["Armorweave Vest", "Kevlar Vest", "Riot Plating", "Brass Carapace", "Scrap Plate", "Ballistic Shield"].includes(armor.name)) {
      assert.ok(armor.genres?.length, armor.name);
    }
  }
});

console.log(`\n${passed} adventuring gear checks passed`);
