// Freeform typed attributes: what a DM may invent, and what the console does
// with it afterwards.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  adjustAttribute,
  ATTRIBUTE_TYPES,
  ATTRIBUTE_TYPE_HINTS,
  ATTRIBUTE_TYPE_LABELS,
  attributeKey,
  buildAttribute,
  describeAttribute,
  groupAttributes,
  isFormula,
  MAX_ATTRIBUTES_PER_TARGET,
  normalizeAttributes,
  removeAttribute,
  setAttribute,
  visibleAttributes,
} = await import("../src/lib/dm/attributes-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const built = (input) => {
  const result = buildAttribute(input);
  assert.ok(!("error" in result), `expected ${JSON.stringify(input)} to build`);
  return result.attribute;
};

test("every type has a label and a hint", () => {
  for (const type of ATTRIBUTE_TYPES) {
    assert.ok(ATTRIBUTE_TYPE_LABELS[type]);
    assert.ok(ATTRIBUTE_TYPE_HINTS[type]);
  }
});

test("the key folds case and punctuation so one fact stays one fact", () => {
  assert.equal(attributeKey("Lamp Oil"), "lamp_oil");
  assert.equal(attributeKey("lamp   oil!"), "lamp_oil");
  assert.equal(attributeKey("  Ritual: progress  "), "ritual_progress");
});

test("an unnamed attribute is refused", () => {
  assert.ok("error" in buildAttribute({ label: "   ", type: "text" }));
  assert.ok("error" in buildAttribute({ label: "!!!", type: "text" }));
});

test("an unknown type is refused", () => {
  assert.ok("error" in buildAttribute({ label: "X", type: "colour" }));
});

test("a number needs a number", () => {
  assert.ok("error" in buildAttribute({ label: "Barrels", type: "number", value: "lots" }));
  assert.equal(built({ label: "Barrels", type: "number", value: "12" }).value, 12);
});

test("a counter needs a maximum and is clamped into it", () => {
  assert.ok("error" in buildAttribute({ label: "Ritual", type: "resource", value: 3 }));
  const attribute = built({ label: "Ritual", type: "resource", value: 9, max: 5 });
  assert.equal(attribute.value, 5);
  assert.equal(attribute.max, 5);
  assert.equal(built({ label: "Ritual", type: "resource", value: -2, max: 5 }).value, 0);
});

test("a rollable has to be a dice expression", () => {
  assert.ok(isFormula("2d6+1"));
  assert.ok(isFormula("1d100"));
  assert.ok(!isFormula("a lot"));
  assert.ok("error" in buildAttribute({ label: "Curse", type: "formula", value: "a lot" }));
  assert.equal(built({ label: "Curse", type: "formula", value: "2d6+1" }).value, "2d6+1");
});

test("a secret is the default, because an invented track usually is one", () => {
  assert.equal(built({ label: "X", type: "text", value: "y" }).visible, false);
  assert.equal(built({ label: "X", type: "text", value: "y", visible: true }).visible, true);
});

test("setting replaces by key rather than making a second row", () => {
  const first = built({ label: "Barrels", type: "number", value: 3 });
  const second = built({ label: "barrels", type: "number", value: 7 });
  const once = setAttribute([], first);
  const twice = setAttribute(once.attributes, second);
  assert.equal(twice.attributes.length, 1);
  assert.equal(twice.attributes[0].value, 7);
});

test("a target carries a bounded number of attributes", () => {
  let attributes = [];
  for (let index = 0; index < MAX_ATTRIBUTES_PER_TARGET; index += 1) {
    attributes = setAttribute(attributes, built({ label: `a${index}`, type: "number", value: 1 })).attributes;
  }
  assert.ok("error" in setAttribute(attributes, built({ label: "one more", type: "number", value: 1 })));
});

test("removing by key leaves the rest", () => {
  const attributes = [
    built({ label: "A", type: "number", value: 1 }),
    built({ label: "B", type: "number", value: 2 }),
  ];
  assert.deepEqual(removeAttribute(attributes, "a").map((entry) => entry.key), ["b"]);
});

test("a counter is nudged inside its range, a plain number anywhere", () => {
  const attributes = [
    built({ label: "Ritual", type: "resource", value: 4, max: 5 }),
    built({ label: "Debt", type: "number", value: 0 }),
  ];
  const capped = adjustAttribute(attributes, "ritual", 5);
  assert.equal(capped.attribute.value, 5);
  const floored = adjustAttribute(attributes, "ritual", -99);
  assert.equal(floored.attribute.value, 0);
  // A debt and a temperature are both legitimately negative.
  const debt = adjustAttribute(attributes, "debt", -40);
  assert.equal(debt.attribute.value, -40);
});

test("nudging something that is not a number says so", () => {
  const attributes = [built({ label: "Motto", type: "text", value: "hold fast" })];
  assert.ok("error" in adjustAttribute(attributes, "motto", 1));
  assert.ok("error" in adjustAttribute(attributes, "nothing", 1));
});

test("each type describes itself the way it should be read", () => {
  assert.equal(describeAttribute(built({ label: "Ritual", type: "resource", value: 3, max: 5 })), "Ritual: 3/5");
  assert.equal(describeAttribute(built({ label: "Barred", type: "boolean", value: true })), "Barred: yes");
  assert.equal(describeAttribute(built({ label: "Curse", type: "formula", value: "2d6" })), "Curse: roll 2d6");
  assert.equal(describeAttribute(built({ label: "Motto", type: "text", value: "hold" })), "Motto: hold");
});

test("ungrouped attributes lead, then groups in order", () => {
  const groups = groupAttributes([
    built({ label: "A", type: "number", value: 1, group: "Zeta" }),
    built({ label: "B", type: "number", value: 1 }),
    built({ label: "C", type: "number", value: 1, group: "Alpha" }),
  ]);
  assert.deepEqual(groups.map((entry) => entry.group), ["", "Alpha", "Zeta"]);
});

test("players see only what was marked visible", () => {
  const attributes = [
    built({ label: "Open", type: "number", value: 1, visible: true }),
    built({ label: "Secret", type: "number", value: 1 }),
  ];
  assert.equal(visibleAttributes(attributes, true).length, 2);
  assert.deepEqual(visibleAttributes(attributes, false).map((entry) => entry.key), ["open"]);
});

test("unreadable stored rows are dropped, not thrown on", () => {
  assert.deepEqual(normalizeAttributes(null), []);
  const kept = normalizeAttributes([
    { label: "Good", type: "number", value: 2 },
    { label: "", type: "number", value: 2 },
    { label: "Bad", type: "resource", value: 1 },
  ]);
  assert.deepEqual(kept.map((entry) => entry.key), ["good"]);
});

console.log(`attributes: ${passed} tests passed`);
