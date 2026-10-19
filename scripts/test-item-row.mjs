// An item named in the table's language does what its row says
// (src/lib/srd/item-row.ts): the armor, weapon, magic-item and check-rider
// engines find the row by the srdName the DM gave it (#408), as they find an
// English item by its own name. Pure, and reads only the bundled tables, so
// it runs without the content pack.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
