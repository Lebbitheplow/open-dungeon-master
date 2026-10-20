// An item named in the table's language does what its row says
// (src/lib/srd/item-row.ts): the armor, weapon, magic-item and check-rider
// engines find the row by the srdName the DM gave it (#408), as they find an
// English item by its own name. Pure, and reads only the bundled tables, so
// it runs without the content pack, which only the price parity reads.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { acBreakdownFor, computeSheetDerived } = await import("../src/lib/srd/index.ts");
const { resolveAttackWeapon, weaponAttackProfile } = await import("../src/lib/dm/attack-logic.ts");
const { handsBusy } = await import("../src/lib/dm/cast-rules.ts");
const { itemCheckRiders } = await import("../src/lib/srd/item-check-riders.ts");
const { featureBonusAttack, MELEE_ATTACKED } = await import("../src/lib/dm/feature-bonus-attacks.ts");
const { loadLine } = await import("../src/lib/srd/encumbrance.ts");
const { wearableGear } = await import("../src/components/sheet/sheet-state.ts");
const { matchWeapon } = await import("../src/lib/srd/weapons.ts");
const { matchArmor } = await import("../src/lib/srd/armor.ts");
const { matchMagicItem } = await import("../src/lib/srd/magic-items.ts");
const { carriedItemsMatching, findCarriedItem, itemUseProblem, srdNameFor } = await import("../src/lib/dm/item-logic.ts");
const { removeItemMath } = await import("../src/lib/dm/mutation-math.ts");
const { removePartyItem } = await import("../src/lib/dm/party-logic.ts");
const { listPriceCp, keepsFullValue, worthProblem } = await import("../src/lib/dm/trade-value.ts");
const { wearSlotOf } = await import("../src/lib/srd/wear-slots.ts");
const { itemTags } = await import("../src/lib/srd/item-tags.ts");
const { armorOfRow } = await import("../src/lib/srd/armor.ts");
const { gearDefFor } = await import("../src/lib/srd/magic-gear.ts");
const require = createRequire(import.meta.url);

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  passed += 1;
}

function hero(equipment, overrides = {}) {
  return {
    name: "Iris",
    class: "fighter",
    level: 1,
    subclass: "",
    classes: [],
    abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    conditions: [],
    features: [],
    feats: [],
    resources: {},
    equipment,
    spellcasting: undefined,
    proficiencies: {
      saves: ["str", "con"],
      skills: [],
      expertise: [],
      languages: [],
      tools: [],
      armor: ["light", "medium", "heavy", "shields"],
      weapons: ["simple", "martial", "firearms"],
    },
    ...overrides,
  };
}

const item = (name, srdName, extra = {}) => ({ name, ...(srdName ? { srdName } : {}), qty: 1, equipped: true, ...extra });
const derived = (sheet) => computeSheetDerived(sheet);

test("a Mantello di protezione named Cloak of Protection gives +1 AC and +1 saves while attuned, as the English cloak does", () => {
  const plain = hero([]);
  const italian = hero([item("Mantello di protezione", "Cloak of Protection", { attuned: true })]);
  const english = hero([item("Cloak of Protection", undefined, { attuned: true })]);
  assert.equal(acBreakdownFor(plain).ac, 12);
  assert.equal(acBreakdownFor(italian).ac, 13);
  assert.equal(acBreakdownFor(english).ac, 13);
  assert.deepEqual(derived(italian).saves, derived(english).saves);
  assert.equal(derived(italian).saves.dex, derived(plain).saves.dex + 1);
  assert.equal(derived(italian).saves.str, derived(plain).saves.str + 1);
  const unattuned = hero([item("Mantello di protezione", "Cloak of Protection")]);
  assert.equal(acBreakdownFor(unattuned).ac, 12, "not attuned: no AC");
  assert.deepEqual(derived(unattuned).saves, derived(plain).saves, "not attuned: no saves");
});

test("a Cotta di maglia named Chain Mail sets AC 16 with its Strength and Stealth rules; a Scudo named Shield adds 2", () => {
  const mail = item("Cotta di maglia", "Chain Mail");
  const worn = acBreakdownFor(hero([mail]));
  assert.equal(worn.ac, 16);
  assert.equal(worn.armor?.name, "Chain Mail");
  assert.equal(worn.armorName, "Cotta di maglia", "the sheet shows the item's own name");
  assert.equal(worn.speedPenalty, 10, "Strength 10 is below chain mail's 13");
  assert.equal(worn.stealthDisadvantage, true);
  const shielded = acBreakdownFor(hero([mail, item("Scudo", "Shield")]));
  assert.equal(shielded.ac, 18);
  assert.equal(shielded.shieldName, "Scudo");
  assert.deepEqual(
    wearableGear([mail, item("Corda", undefined)]).map((row) => row.name),
    ["Cotta di maglia"],
    "the sheet offers the wear toggle on it",
  );
  assert.equal(loadLine(mail).eachLb, 55, "it weighs chain mail's 55 lb");
});

test("a Spada lunga named Longsword attacks as a longsword and fills a hand", () => {
  const sword = item("Spada lunga", "Longsword");
  const sheet = hero([sword]);
  const mods = { abilityMods: { str: 0, dex: 2, con: 1, int: 0, wis: 0, cha: 0 }, proficiencyBonus: 2 };
  for (const asked of [undefined, "Spada lunga"]) {
    const resolved = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, asked);
    assert.equal(resolved.srd?.name, "Longsword", String(asked));
    assert.equal(resolved.displayName, "Spada lunga", String(asked));
    const profile = weaponAttackProfile(mods, sheet.proficiencies.weapons, resolved);
    assert.match(profile.damageExpression, /^1d8\b/, String(asked));
    assert.equal(profile.damageType, "slashing");
    assert.ok(profile.properties?.includes("versatile"), String(asked));
    assert.equal(profile.base, "Longsword");
    assert.equal(profile.magicBonus, 0);
  }
  assert.equal(handsBusy(sheet), 1);
  assert.equal(handsBusy(hero([{ ...sword, equipped: false }])), 0, "carried is not held");
  const plusOne = resolveAttackWeapon([item("Spada lunga +1", "Longsword")], sheet.proficiencies.weapons, undefined);
  assert.equal(plusOne.srd?.name, "Longsword");
  assert.equal(weaponAttackProfile(mods, sheet.proficiencies.weapons, plusOne).magicBonus, 1, "the +1 is read off the item's own name");
});

// Every name the item tables list: the catalog's rows and the magic items'.
const LISTED = [
  ...new Set([
    ...require("../src/lib/classes/item-tags.json").items.map(([name]) => name),
    ...require("../src/lib/classes/magic-items.json").items.map(({ name }) => name),
  ]),
];
const profs = ["simple", "martial", "firearms"];
const mods = { abilityMods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: 0 }, proficiencyBonus: 2 };
const READERS = {
  weight: (it) => loadLine(it).eachLb,
  slot: (it) => wearSlotOf(it),
  tags: (it) => itemTags(it),
  price: (it) => listPriceCp(it),
  worth: (it) => worthProblem(it, 50, "grant_item")?.retry ?? null,
  fullValue: (it) => keepsFullValue(it),
  weapon: (it) => matchWeapon(it)?.name ?? null,
  armor: (it) => matchArmor(it)?.name ?? null,
  armorRow: (it) => armorOfRow(it),
  gear: (it) => gearDefFor(it),
  magic: (it) => matchMagicItem(it)?.name ?? null,
  wearToggle: (it) => wearableGear([it]).length,
  stealth: (it) => itemCheckRiders([it], "stealth"),
  attack: (it) => {
    const resolved = resolveAttackWeapon([it], profs, undefined);
    return { resolved, profile: weaponAttackProfile(mods, profs, resolved) };
  },
  hands: (it) => handsBusy(hero([it])),
  useItem: (it) => itemUseProblem(it)?.error ?? null,
};

// Parity: an item named in the table's language with its srdName does
// everything an item named as the row does, in every engine that reads an
// item, for every row the lists hold, plain and with a bonus in its name;
// only what is shown keeps the item's own name. Prices are the pack's, so
// they are compared only where it is installed.
test("an item with srdName reads as an item named as the row, for every listed row, in every engine", () => {
  const json = (value) => JSON.stringify(value ?? null);
  let compared = 0;
  for (const listed of LISTED) {
    const sent = srdNameFor(listed, "grant_item");
    if (sent.error) {
      assert.ok(/[\s,]\+[123]\b/.test(listed), `only a row named with a bonus is refused: ${listed}`);
      continue;
    }
    const plain = [item(listed, undefined, { attuned: true }), item("Oggetto", sent.srdName, { attuned: true }), "Oggetto", listed];
    const bonused = [item(`${listed} +1`, undefined, { attuned: true }), item("Oggetto +1", sent.srdName, { attuned: true }), "Oggetto +1", `${listed} +1`];
    for (const [twin, named, own, rowWithBonus] of [plain, bonused]) {
      for (const [reader, read] of Object.entries(READERS)) {
        assert.equal(json(read(named)).replaceAll(own, rowWithBonus), json(read(twin)), `${named.name} (${sent.srdName}) as ${twin.name}: ${reader}`);
      }
      compared += 1;
    }
  }
  assert.ok(compared > 3000, `${compared} compared`);
});

// Every tool that finds a carried or stashed item by name takes the line by
// that very name, else the one whose srdNameWithBonus it is, so the same
// packs named as the rows and in the table's language answer alike, and a
// starting-kit line is the one its own name takes.
const FINDERS = {
  attack: (pack, asked) => resolveAttackWeapon(pack, profs, asked).displayName,
  find: (pack, asked) => findCarriedItem(pack, asked)?.name,
  matching: (pack, asked) => carriedItemsMatching(pack, asked).map((row) => row.name).join(" | "),
  remove: (pack, asked) => removeItemMath(pack, asked, 1)?.item.name,
  stash: (pack, asked) => {
    const taken = removePartyItem(pack, asked, true, 1);
    return "error" in taken ? null : taken.item.name;
  },
};

test("a name finds the line by that name, else the one whose srdNameWithBonus it is, in every finder", () => {
  const sword = item("Spada lunga", "Longsword");
  const plusOne = item("Spada lunga +1", "Longsword");
  const kit = item("Longsword", undefined);
  const cases = [
    [[sword], "Longsword", "Spada lunga"],
    [[plusOne, sword], "Longsword", "Spada lunga"],
    [[sword, plusOne], "Longsword", "Spada lunga"],
    [[plusOne, sword], "Longsword +1", "Spada lunga +1"],
    [[sword, plusOne], "Longsword +1", "Spada lunga +1"],
    [[sword, plusOne], "Spada lunga", "Spada lunga"],
    [[sword, kit], "Longsword", "Longsword"],
    [[kit, sword], "Longsword", "Longsword"],
    [[sword, kit], "Spada lunga", "Spada lunga"],
  ];
  for (const [pack, asked, held] of cases) {
    for (const [finder, find] of Object.entries(FINDERS)) {
      assert.equal(find(pack, asked), held, `${finder}: ${asked} in ${pack.map((row) => row.name)}`);
    }
  }
  const englishPack = [item("Longsword +1", undefined), item("Longsword", undefined)];
  for (const asked of ["Longsword", "Longsword +1"]) {
    for (const [finder, find] of Object.entries(FINDERS)) {
      assert.equal(find(englishPack, asked), asked, `${finder}: ${asked}, English`);
    }
  }
  assert.equal(resolveAttackWeapon([], profs, "Longsword").carried, false, "a row nobody carries is still not theirs");
  assert.equal(removeItemMath([sword], "Dagger", 1), null);
});

test("an item named in the table's language answers to its row's whole name as one named as the row does, and to no word of it", () => {
  // A "+1" asked of a plain sword swings the sword they carry, whose own
  // bonus the attack takes.
  for (const pack of [[item("Spada lunga", "Longsword")], [item("Longsword", undefined)]]) {
    assert.equal(resolveAttackWeapon(pack, profs, "Longsword +1").displayName, pack[0].name);
    assert.equal(resolveAttackWeapon(pack, profs, "Longsword").displayName, pack[0].name);
  }
  const potion = item("Pozione di guarigione", "Potion of Healing", { equipped: false });
  const englishPotion = item("Potion of Healing", undefined, { equipped: false });
  const climbing = item("Potion of Climbing", undefined, { equipped: false });
  for (const [pack, englishPack, asked] of [
    [[potion], [englishPotion], "Potion of Healing"],
    [[potion], [englishPotion], "healing potion"],
    [[potion], [englishPotion], "healing"],
    [[potion, climbing], [englishPotion, climbing], "potion"],
    [[climbing, potion], [climbing, englishPotion], "Potion of Healing"],
  ]) {
    const where = `${asked} in ${pack.map((row) => row.name)}`;
    assert.equal(pack.indexOf(findCarriedItem(pack, asked)), englishPack.indexOf(findCarriedItem(englishPack, asked)), where);
  }
  const another = item("Fiala di guarigione", "Potion of Healing", { equipped: false });
  assert.deepEqual(
    carriedItemsMatching([potion, another], "Potion of Healing").map((row) => row.name),
    ["Pozione di guarigione", "Fiala di guarigione"],
    "a name two lines answer to is ambiguous, as two English lines of one name would be",
  );
  assert.deepEqual(carriedItemsMatching([potion, another], "healing"), [], "a word of a name answers to nothing");
});

test("srdName takes only a name the lists hold, never a bonus, a family or a guess", () => {
  for (const sent of ["Longsword +1", "+2 Plate", "Weapon, +1", "Shield +3", "Wand of the War Mage, +2"]) {
    assert.match(srdNameFor(sent, "grant_item").error ?? "", /carries a bonus, which belongs in name/, sent);
  }
  for (const sent of ["Sword", "Bow", "Axe", "Crossbow", "Healing Potion"]) {
    assert.match(srdNameFor(sent, "grant_item").error ?? "", /no SRD or pack item is called/, sent);
  }
  for (const sent of ["Weapon", "Ammunition", "Wand of the War Mage"]) {
    assert.match(srdNameFor(sent, "grant_item").error ?? "", /a family of \+1 to \+3 items rather than one item/, sent);
  }
  assert.match(srdNameFor("Sword", "grant_item").error, /^grant_item: no SRD or pack item is called "Sword"\./, "no guess offered as the nearest");
  for (const [sent, stored] of [
    ["longsword", "Longsword"],
    ["Daggers", "Dagger"],
    ["Plate Armor", "Plate"],
    ["Staff", "Quarterstaff"],
    ["Crossbow, light", "Crossbow, light"],
    ["Torches", "Torch"],
    ["Belt of Fire Giant Strength", "Belt of Fire Giant Strength"],
    ["Black Dragon Scale Mail", "Black Dragon Scale Mail"],
    ["Ring of Fire Resistance", "Ring of Fire Resistance"],
  ]) {
    assert.deepEqual(srdNameFor(sent, "grant_item"), { srdName: stored }, sent);
  }
  const mail = item("Cotta di drago nero", "Black Dragon Scale Mail", { attuned: true });
  assert.equal(matchMagicItem(mail)?.name, "Black Dragon Scale Mail", "the dragon scale mail keeps its magic");
  assert.equal(acBreakdownFor(hero([mail])).ac, acBreakdownFor(hero([item("Black Dragon Scale Mail", undefined, { attuned: true })])).ac);
});

test("Stivali elfici named Boots of Elvenkind give advantage on Stealth checks while worn", () => {
  const boots = item("Stivali elfici", "Boots of Elvenkind");
  assert.equal(itemCheckRiders([boots], "stealth").advantage, true);
  assert.equal(itemCheckRiders([boots], "perception").advantage, false);
  assert.equal(itemCheckRiders([{ ...boots, equipped: false }], "stealth").advantage, false, "not worn");
});

test("a Pistola named Pistol is a firearm for Pistol and Blade", () => {
  const pistol = item("Pistola", "Pistol");
  const sheet = hero([pistol], { features: [{ name: "Pistol and Blade" }] });
  const mods = { abilityMods: { str: 0, dex: 2, con: 1, int: 0, wis: 0, cha: 0 }, proficiencyBonus: 2 };
  const profile = weaponAttackProfile(mods, sheet.proficiencies.weapons, resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, undefined));
  assert.equal(profile.base, "Pistol");
  const budget = { oncePerTurn: [MELEE_ATTACKED], attacksMade: 1, castThisAction: false };
  assert.deepEqual(featureBonusAttack({ sheet, budget, profile, melee: false, mods: {} }), { feature: "Pistol and Blade" });
});

test("an item whose own name and srdName both name rows reads the srdName row; English names and slugs as before", () => {
  assert.equal(matchWeapon({ name: "Dagger", srdName: "Longsword" })?.name, "Longsword");
  assert.equal(matchArmor({ name: "Leather", srdName: "Plate" })?.name, "Plate");
  assert.equal(matchMagicItem({ name: "Ring of Protection", srdName: "Cloak of Protection" })?.name, "Cloak of Protection");
  assert.equal(matchWeapon({ name: "+1 Longsword" })?.name, "Longsword");
  assert.equal(matchArmor({ name: "Spada lunga" }), null, "a table-language name with no srdName is no row");
  assert.equal(matchMagicItem({ name: "Grandmother's band", slug: "ring-of-protection" })?.name, "Ring of Protection");
});

test("rowName is the one place an item's srdName is read before its own name", () => {
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry)) files.push(path);
    }
  };
  walk(src);
  const copies = files
    .filter((path) => !path.endsWith(join("srd", "item-row.ts")))
    .filter((path) => /\bitem\.srdName \?\?|srdName\?\.trim\(\) \|\|/.test(readFileSync(path, "utf8")));
  assert.deepEqual(copies, []);
});

console.log(`item-row: ${passed} passed`);
