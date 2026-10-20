// The gear receipt (backlog F14). The gear step shows the pack as one table:
// each item with its quantity, what the kit gave free and what was paid, the
// price, and the coin left at the foot. Quantities are typed or stepped, and
// one fewer takes one off instead of the whole row. Each weapon carries a
// to-hit and damage line worked the way the sheet's attack cards work it.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { openBuilder } = await import("./lib/enforce-builder.mjs");
const receiptMath = await import("../src/app/characters/builder/receiptMath.ts");
const { purseViewFor } = await import("../src/app/characters/builder/derivedReasons.ts");
const { judgeStartingGear } = await import("../src/lib/srd/starting-wealth.ts");
const { deriveHand } = await import("../src/lib/battlemap/hand.ts");
const { storedSheetSchema } = await import("../src/lib/schemas/sheet.ts");

const { buildReceipt, settleQty, stepDown, withAddedQty, formatCoin, MAX_QTY } = receiptMath;

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const builder = await openBuilder();

// A build whose setters apply their update in place, so a test reads what a
// tap on the receipt leaves behind and builds again from it.
function buildWith(fields) {
  const held = { equipment: [], removedAutoNames: [], ...fields };
  const apply = (key) => (next) => {
    held[key] = typeof next === "function" ? next(held[key]) : next;
  };
  const again = () =>
    builder.build({
      race: "human",
      background: "acolyte",
      ...held,
      setEquipment: apply("equipment"),
      setRemovedAutoNames: apply("removedAutoNames"),
    });
  return { held, again };
}

const row = (receipt, name) => receipt.rows.find((entry) => entry.name === name);
const priceTable = { Dagger: 200, Rope: 100, Torch: 1 };
const priceOf = (name) =>
  name === "Flame Tongue"
    ? { copper: null, magic: true }
    : name in priceTable
      ? { copper: priceTable[name], magic: false }
      : { copper: null, magic: false };

test("a line splits the kit's free copies from the bought ones", () => {
  const receipt = buildReceipt({
    equipment: [{ name: "Dagger", qty: 3 }, { name: "Rope", qty: 1 }],
    preAdded: new Map([["dagger", 2]]),
    freeKit: ["Dagger", "Dagger"],
    coinCopper: 1500,
    priceOf,
  });
  assert.deepEqual(
    { ...row(receipt, "Dagger"), weapon: undefined },
    { name: "Dagger", qty: 3, preAdded: 2, free: 2, bought: 1, unitCopper: 200, costCopper: 200, refused: null, weapon: undefined },
  );
  assert.equal(row(receipt, "Rope").costCopper, 100);
  assert.equal(receipt.spentCopper, 300);
  assert.equal(receipt.leftCopper, 1200);
});

test("the receipt spends what the purse spends and refuses what it refuses", () => {
  const equipment = [
    { name: "Dagger", qty: 4 },
    { name: "Torch", qty: 10 },
    { name: "Flame Tongue", qty: 1 },
    { name: "Strange Idol", qty: 1 },
    { name: "Brew Blade", qty: 1, slug: "homebrew:brew-blade" },
  ];
  const freeKit = ["Dagger", "Torch", "Torch"];
  const receipt = buildReceipt({ equipment, preAdded: new Map(), freeKit, coinCopper: 5000, priceOf });
  const verdict = judgeStartingGear({ equipment, freeKit, coinCopper: 5000, priceOf });
  assert.equal(receipt.spentCopper, verdict.spentCopper);
  assert.equal(row(receipt, "Flame Tongue").refused, "magic");
  assert.equal(row(receipt, "Strange Idol").refused, "unpriced");
  assert.equal(row(receipt, "Brew Blade").refused, "homebrew");
  assert.equal(verdict.problems.length, 3);
});

test("rolled wealth gives nothing free, so pre-added kit copies are paid", () => {
  const receipt = buildReceipt({
    equipment: [{ name: "Dagger", qty: 2 }],
    preAdded: new Map([["dagger", 2]]),
    freeKit: [],
    coinCopper: 1000,
    priceOf,
  });
  assert.equal(row(receipt, "Dagger").free, 0);
  assert.equal(row(receipt, "Dagger").bought, 2);
  assert.equal(row(receipt, "Dagger").preAdded, 2);
  assert.equal(receipt.leftCopper, 600);
});

test("a typed count settles on the kit's set or more, and none removes all", () => {
  const kitted = { preAdded: 2 };
  assert.equal(settleQty(kitted, 5), 5);
  assert.equal(settleQty(kitted, 1), 2);
  assert.equal(settleQty(kitted, 0), 0);
  assert.equal(settleQty(kitted, -3), 0);
  assert.equal(settleQty(kitted, Number.NaN), 0);
  assert.equal(settleQty({ preAdded: 0 }, 2.7), 2);
  assert.equal(settleQty({ preAdded: 0 }, 1e9), MAX_QTY);
});

test("one fewer takes one copy off, then the kit's set together", () => {
  assert.equal(stepDown({ qty: 4, preAdded: 2 }), 3);
  assert.equal(stepDown({ qty: 3, preAdded: 2 }), 2);
  assert.equal(stepDown({ qty: 2, preAdded: 2 }), 0);
  assert.equal(stepDown({ qty: 3, preAdded: 0 }), 2);
  assert.equal(stepDown({ qty: 1, preAdded: 0 }), 0);
});

test("the player's added list takes a count, adds a line, or drops it", () => {
  const list = [{ name: "Rope", qty: 1, priceCp: 100 }];
  assert.deepEqual(withAddedQty(list, "Rope", 3), [{ name: "Rope", qty: 3, priceCp: 100 }]);
  assert.deepEqual(withAddedQty(list, "Dagger", 1, "dagger"), [...list, { name: "Dagger", qty: 1, slug: "dagger" }]);
  assert.deepEqual(withAddedQty(list, "Rope", 0), []);
  assert.equal(withAddedQty(list, "Dagger", 0), list);
});

test("coin reads as the purse line writes it", () => {
  assert.equal(formatCoin(0), "0 gp");
  assert.equal(formatCoin(1525), "15 gp 25 cp");
  assert.equal(formatCoin(7), "7 cp");
});

// The rogue's kit carries two daggers; the acolyte's purse is 15 gp.
test("the builder's receipt foots to the purse it shows", () => {
  const { held, again } = buildWith({ class: "rogue", equipment: [{ name: "Rope, Hempen (50 feet)", qty: 1 }] });
  const { derived } = again();
  const receipt = derived.purse.receipt;
  assert.equal(receipt.leftCopper, derived.purse.gold * 100 + derived.purse.copper);
  assert.equal(receipt.spentCopper, derived.purse.spentCopper);
  const dagger = row(receipt, "Dagger");
  assert.ok(dagger, receipt.rows.map((entry) => entry.name).join(", "));
  assert.equal(dagger.preAdded, dagger.qty);
  assert.equal(dagger.bought, 0);
  assert.equal(row(receipt, "Rope, Hempen (50 feet)").bought, 1);
  assert.deepEqual(held.equipment, [{ name: "Rope, Hempen (50 feet)", qty: 1 }]);
});

test("stepping a kit weapon up buys one, and stepping down returns it", () => {
  const { held, again } = buildWith({ class: "rogue" });
  const kitDaggers = row(again().derived.purse.receipt, "Dagger").qty;
  let receipt = again().derived.purse.receipt;
  receipt.setQty("Dagger", row(receipt, "Dagger").qty + 1);
  assert.deepEqual(held.equipment, [{ name: "Dagger", qty: 1 }]);
  receipt = again().derived.purse.receipt;
  assert.equal(row(receipt, "Dagger").qty, kitDaggers + 1);
  assert.equal(row(receipt, "Dagger").bought, 1);
  receipt.setQty("Dagger", stepDown(row(receipt, "Dagger")));
  assert.deepEqual(held.equipment, []);
  assert.equal(row(again().derived.purse.receipt, "Dagger").qty, kitDaggers);
});

test("a typed count of a kit item keeps the kit's set and buys the rest", () => {
  const { held, again } = buildWith({ class: "rogue" });
  const kitDaggers = row(again().derived.purse.receipt, "Dagger").qty;
  again().derived.purse.receipt.setQty("Dagger", kitDaggers + 3);
  assert.equal(held.equipment.find((item) => item.name === "Dagger").qty, 3);
  again().derived.purse.receipt.setQty("Dagger", 1);
  assert.equal(row(again().derived.purse.receipt, "Dagger").qty, kitDaggers);
  assert.ok(!held.equipment.some((item) => item.name === "Dagger"));
  assert.deepEqual(held.removedAutoNames, []);
});

test("none removes the kit's copies and the bought ones together", () => {
  const { held, again } = buildWith({ class: "rogue", equipment: [{ name: "Dagger", qty: 2 }] });
  again().derived.purse.receipt.setQty("Dagger", 0);
  assert.deepEqual(held.equipment, []);
  assert.deepEqual(held.removedAutoNames, ["Dagger"]);
  assert.equal(row(again().derived.purse.receipt, "Dagger"), undefined);
});

test("one fewer of a bought item takes one off, not the row", () => {
  const { held, again } = buildWith({ class: "rogue", equipment: [{ name: "Torch", qty: 5 }] });
  const receipt = again().derived.purse.receipt;
  receipt.setQty("Torch", stepDown(row(receipt, "Torch")));
  assert.deepEqual(held.equipment, [{ name: "Torch", qty: 4 }]);
});

// The sheet's attack cards (deriveHand) are what a player swings with at
// the table; the receipt's line must read the same numbers.
function attackCard(built, name) {
  // The server adds the level and the fields a new sheet is created without.
  const stored = { resources: {}, conditions: [], level: built.level, ...storedSheetSchema.parse(built.sheet) };
  return deriveHand(stored).find((card) => card.type === "attack" && card.name === name);
}

for (const [label, fields, weapon, rider] of [
  ["a rogue's rapier", { class: "rogue" }, "Rapier", null],
  ["a fighter's longsword with Dueling", { class: "fighter", stylePicks: ["dueling"] }, "Longsword", "Dueling"],
  ["a fighter's longbow with Archery", { class: "fighter", stylePicks: ["archery"], kitChoices: { options: [1, 1, 0, 0], picks: [] } }, "Longbow", "Archery"],
]) {
  test(`${label}: the receipt's weapon line matches the sheet`, () => {
    const { again } = buildWith({ ...fields, equipment: [{ name: weapon, qty: 1 }] });
    const built = again();
    assert.ok(built.sheet, `no sheet: ${built.blocker}`);
    const line = row(built.derived.purse.receipt, weapon)?.weapon;
    const card = attackCard(built, weapon);
    assert.ok(line, `no line for ${weapon}`);
    assert.ok(card, `no card for ${weapon}`);
    assert.equal(line.toHit, card.toHit);
    assert.equal(line.damage, card.damage);
    assert.equal(line.damageType, card.damageType);
    if (rider) {
      assert.ok(line.notes.some((note) => note.startsWith(rider)), line.notes.join("; "));
    }
  });
}

test("gear that is not a weapon has no attack line", () => {
  const { again } = buildWith({ class: "rogue", equipment: [{ name: "Torch", qty: 1 }] });
  assert.equal(row(again().derived.purse.receipt, "Torch").weapon, null);
});

test("the purse view hands the receipt to the gear step", () => {
  const { again } = buildWith({ class: "rogue" });
  const { derived } = again();
  const view = purseViewFor({
    purse: derived.purse,
    keepsStoredGear: false,
    backgroundName: "Acolyte",
    backgroundPurse: 15,
    classId: "rogue",
    className: "Rogue",
    table: { wealth: null, wealthBusy: false, wealthError: "", rollWealth: () => {} },
  });
  assert.equal(view.receipt, derived.purse.receipt);
  assert.equal(typeof view.receipt.setQty, "function");
});

console.log(`\n${passed} passed`);
