// The party as a thing in its own right: the shared pack, the common purse,
// the marching order and banked experience.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  addPartyItem,
  describeParty,
  emptyParty,
  MAX_PARTY_ITEMS,
  moveInMarchingOrder,
  normalizeParty,
  partyWeight,
  reconcileMarchingOrder,
  removePartyItem,
  splitBankedXp,
} = await import("../src/lib/dm/party-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("an empty party is empty, not undefined", () => {
  const party = emptyParty();
  assert.equal(party.copper, 0);
  assert.deepEqual(party.inventory, []);
  assert.equal(party.bankedXp, 0);
});

test("the same thing merges instead of making a second row", () => {
  let inventory = [];
  inventory = addPartyItem(inventory, { name: "Rope (50 ft.)", qty: 1 }).inventory;
  inventory = addPartyItem(inventory, { name: "rope (50 ft.)", qty: 2 }).inventory;
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].qty, 3);
});

test("an unidentified item never merges with a known one of the same name", () => {
  let inventory = addPartyItem([], { name: "Iron ring", qty: 1 }).inventory;
  inventory = addPartyItem(inventory, { name: "Iron ring", qty: 1, identified: false }).inventory;
  assert.equal(inventory.length, 2);
  assert.equal(inventory.filter((item) => item.identified === false).length, 1);
});

test("a nameless item is refused", () => {
  assert.ok("error" in addPartyItem([], { name: "   " }));
});

test("the pack has a ceiling", () => {
  let inventory = [];
  for (let index = 0; index < MAX_PARTY_ITEMS; index += 1) {
    inventory = addPartyItem(inventory, { name: `thing ${index}` }).inventory;
  }
  assert.ok("error" in addPartyItem(inventory, { name: "one more" }));
});

test("taking removes part of a stack, or the row", () => {
  const inventory = addPartyItem([], { name: "Torch", qty: 5 }).inventory;
  const partial = removePartyItem(inventory, "torch", 2);
  assert.equal(partial.removed, 2);
  assert.equal(partial.inventory[0].qty, 3);
  const all = removePartyItem(partial.inventory, "Torch", 99);
  assert.equal(all.removed, 3);
  assert.deepEqual(all.inventory, []);
});

test("taking what the pack does not hold says so", () => {
  assert.ok("error" in removePartyItem([], "ladder"));
});

test("the pack's weight is reported, not enforced", () => {
  const inventory = addPartyItem([], { name: "Anvil", qty: 2, weight: 50 }).inventory;
  assert.equal(partyWeight(inventory), 100);
  assert.equal(partyWeight([{ name: "Feather", qty: 1 }]), 0);
});

test("the marching order never names someone who left", () => {
  const order = reconcileMarchingOrder(["a", "b", "c"], ["b", "c", "d"]);
  assert.deepEqual(order, ["b", "c", "d"]);
});

test("a new character joins the back of the line", () => {
  assert.deepEqual(reconcileMarchingOrder(["a"], ["a", "b"]), ["a", "b"]);
});

test("moving in the order swaps, and stops at the ends", () => {
  assert.deepEqual(moveInMarchingOrder(["a", "b", "c"], "b", "up"), ["b", "a", "c"]);
  assert.deepEqual(moveInMarchingOrder(["a", "b", "c"], "a", "up"), ["a", "b", "c"]);
  assert.deepEqual(moveInMarchingOrder(["a", "b", "c"], "c", "down"), ["a", "b", "c"]);
  // Someone not in the order is left alone rather than appended.
  assert.deepEqual(moveInMarchingOrder(["a"], "z", "up"), ["a"]);
});

test("banked XP splits with the remainder to the first share", () => {
  const split = splitBankedXp(100, 3);
  assert.deepEqual(split.each, [34, 33, 33]);
  assert.equal(split.spent, 100);
  assert.equal(split.each.reduce((a, b) => a + b, 0), 100);
});

test("an unreadable party record reads as an empty one", () => {
  assert.deepEqual(normalizeParty(null), emptyParty());
  assert.deepEqual(normalizeParty("nonsense"), emptyParty());
  assert.equal(normalizeParty({ copper: -5 }).copper, 0);
});

test("the prompt block is empty until the party has something to say", () => {
  assert.equal(describeParty(emptyParty(), String, () => "x"), "");
});

test("the prompt block names what is actually set", () => {
  const party = {
    ...emptyParty(),
    location: "The Broken Oar",
    copper: 342,
    inventory: [{ name: "Rope", qty: 2 }],
    marchingOrder: ["a", "b"],
  };
  const block = describeParty(party, (copper) => `${copper} copper`, (id) => id.toUpperCase());
  assert.match(block, /The Broken Oar/);
  assert.match(block, /342 copper/);
  assert.match(block, /Rope x2/);
  assert.match(block, /A, B/);
});

console.log(`party: ${passed} tests passed`);
