// A table's ruleset as one object: what it says it does, what applying it
// would change, and how its prose merges with prose a table already wrote.
// See docs/workshop-plan.md section 2.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  activeVariantRules,
  countHouseRulings,
  describeRuleset,
  mergeHouseRules,
  rulesetChanges,
  REST_VARIANT_LABELS,
  VARIANT_RULE_KEYS,
  VARIANT_RULE_LABELS,
} = await import("../src/lib/rulesets/logic.ts");
const { gameSettingsSchema, normalizeGameSettings } = await import(
  "../src/lib/schemas/game-settings.ts"
);
const { chunkHouseRules } = await import("../src/lib/dm/rules-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Fields declared with .default() are wrapped in a ZodDefault, so reaching
// the object or enum underneath means unwrapping first.
const unwrap = (schema) => schema?.def?.innerType ?? schema;

const plain = normalizeGameSettings({}).variantRules;
const gritty = { ...plain, encumbrance: true, ammunition: true, restVariant: "gritty" };

// ---- the labels stay in step with the engine ----

test("every variant rule in the schema has a label", () => {
  // The failure this prevents: a rule added to the engine that no ruleset
  // editor can ever switch on, because nothing renders a control for it.
  const schemaKeys = Object.keys(unwrap(gameSettingsSchema.shape.variantRules).shape).filter(
    (key) => key !== "restVariant",
  );
  for (const key of schemaKeys) {
    assert.ok(VARIANT_RULE_LABELS[key], `variant rule ${key} has no label`);
  }
  assert.equal(VARIANT_RULE_KEYS.length, schemaKeys.length);
});

test("every rest variant has a label", () => {
  const restVariant = unwrap(unwrap(gameSettingsSchema.shape.variantRules).shape.restVariant);
  for (const value of restVariant.options) {
    assert.ok(REST_VARIANT_LABELS[value], `rest variant ${value} has no label`);
  }
});

// ---- saying what a ruleset does ----

test("the plain rules are described as such rather than as nothing", () => {
  assert.deepEqual(activeVariantRules(plain), []);
  assert.match(describeRuleset({ variantRules: plain, houseRulesText: "" }), /plain rules/);
});

test("standard rests are not listed as a variant", () => {
  // Only a departure from the default is worth a line.
  assert.equal(activeVariantRules(plain).length, 0);
  assert.equal(activeVariantRules({ ...plain, restVariant: "gritty" }).length, 1);
});

test("an active ruleset lists each rule it turns on", () => {
  const active = activeVariantRules(gritty);
  assert.equal(active.length, 3);
  assert.ok(active.includes(VARIANT_RULE_LABELS.encumbrance));
  assert.ok(active.includes(REST_VARIANT_LABELS.gritty));
});

test("the description counts rules and rulings together", () => {
  const summary = describeRuleset({
    variantRules: gritty,
    houseRulesText: "Potions:\nDrinking a potion is a bonus action.",
  });
  assert.match(summary, /3 variant rules/);
  assert.match(summary, /1 house ruling\b/);
});

// ---- counting house rulings the way the engine chunks them ----

test("empty house rules count as none", () => {
  assert.equal(countHouseRulings(""), 0);
  assert.equal(countHouseRulings("   \n\n  "), 0);
});

test("prose with no headings is one ruling, not none", () => {
  assert.equal(countHouseRulings("We use milestone leveling."), 1);
});

test("each heading is a ruling", () => {
  const text = "Potions:\nA bonus action.\n\nCrits:\nMax the first die.";
  assert.equal(countHouseRulings(text), 2);
});

test("markdown headings count too, because the chunker takes them", () => {
  // This is the case a hand-rolled colon-only counter got wrong, which is
  // why the count is derived from chunkHouseRules rather than re-guessed.
  const text = "## Potions\nA bonus action.\n\n## Crits\nMax the first die.";
  assert.equal(countHouseRulings(text), 2);
  assert.equal(new Set(chunkHouseRules(text).map((chunk) => chunk.heading)).size, 2);
});

test("the count never disagrees with the chunker it describes", () => {
  const samples = [
    "Rests:\nGritty realism.",
    "# Travel\nEight hours a day.\n\n# Rests\nGritty.",
    "One line, no heading at all.",
    "Potions:\nA bonus action.\nAnd stabilizing is one too.",
  ];
  for (const text of samples) {
    const headings = new Set(chunkHouseRules(text).map((chunk) => chunk.heading).filter(Boolean));
    const expected = headings.size || 1;
    assert.equal(countHouseRulings(text), expected, `disagreed on: ${text}`);
  }
});

// ---- what applying one would change ----

test("applying a ruleset that matches the table changes nothing", () => {
  const changes = rulesetChanges(
    { variantRules: plain, houseRulesText: "" },
    { variantRules: plain, houseRulesText: "" },
  );
  assert.deepEqual(changes, []);
});

test("each differing variant rule is reported with its direction", () => {
  const changes = rulesetChanges(
    { variantRules: gritty, houseRulesText: "" },
    { variantRules: plain, houseRulesText: "" },
  );
  const encumbrance = changes.find((change) => change.label === VARIANT_RULE_LABELS.encumbrance);
  assert.ok(encumbrance, "encumbrance turning on was not reported");
  assert.equal(encumbrance.from, false);
  assert.equal(encumbrance.to, true);
});

test("a rest-pace change reads in words, not enum values", () => {
  const changes = rulesetChanges(
    { variantRules: gritty, houseRulesText: "" },
    { variantRules: plain, houseRulesText: "" },
  );
  const rest = changes.find((change) => change.label === "Rest pace");
  assert.ok(rest);
  assert.equal(rest.from, REST_VARIANT_LABELS.standard);
  assert.equal(rest.to, REST_VARIANT_LABELS.gritty);
});

test("turning a rule OFF is a change too", () => {
  const changes = rulesetChanges(
    { variantRules: plain, houseRulesText: "" },
    { variantRules: gritty, houseRulesText: "" },
  );
  const encumbrance = changes.find((change) => change.label === VARIANT_RULE_LABELS.encumbrance);
  assert.equal(encumbrance.from, true);
  assert.equal(encumbrance.to, false);
});

test("overwriting prose a table already wrote is flagged as replacing", () => {
  const [change] = rulesetChanges(
    { variantRules: plain, houseRulesText: "Crits:\nMax the die." },
    { variantRules: plain, houseRulesText: "Potions:\nA bonus action." },
  );
  assert.equal(change.kind, "houseRules");
  assert.equal(change.replaces, true);
});

test("writing prose into an empty table is not flagged as replacing", () => {
  const [change] = rulesetChanges(
    { variantRules: plain, houseRulesText: "Crits:\nMax the die." },
    { variantRules: plain, houseRulesText: "" },
  );
  assert.equal(change.replaces, false);
  assert.equal(change.from, 0);
  assert.equal(change.to, 1);
});

test("identical prose with different trailing whitespace is not a change", () => {
  const changes = rulesetChanges(
    { variantRules: plain, houseRulesText: "Crits:\nMax the die.\n\n" },
    { variantRules: plain, houseRulesText: "Crits:\nMax the die." },
  );
  assert.deepEqual(changes, []);
});

// ---- merging prose ----

test("replace mode discards what the table had", () => {
  assert.equal(mergeHouseRules("new", "old", "replace"), "new");
});

test("append mode keeps both, separated by a blank line", () => {
  assert.equal(mergeHouseRules("new", "old", "append"), "old\n\nnew");
});

test("appending to an empty table is just the incoming text", () => {
  assert.equal(mergeHouseRules("new", "", "append"), "new");
  assert.equal(mergeHouseRules("new", "   \n ", "append"), "new");
});

test("appending nothing leaves the table's own rules alone", () => {
  // A ruleset that carries only variant flags must not blank the prose.
  assert.equal(mergeHouseRules("", "old", "append"), "old");
  assert.equal(mergeHouseRules("  ", "old", "append"), "old");
});

test("appended text is chunkable as two sections, not glued into one", () => {
  const merged = mergeHouseRules("Crits:\nMax the die.", "Potions:\nA bonus action.", "append");
  assert.equal(countHouseRulings(merged), 2);
});

console.log(`rulesets: ${passed} assertions passed.`);
