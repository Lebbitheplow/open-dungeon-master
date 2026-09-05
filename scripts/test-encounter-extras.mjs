// The rest of a prepared encounter: where each enemy starts, who is hidden,
// the name and hit point overrides, the rewards and the phases. See
// docs/workshop-parity-audit.md phase 13.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  EMPTY_TEMPLATE_EXTRAS,
  EXTRAS_LIMITS,
  describeExtras,
  expandRoster,
  matchSlots,
  normalizeTemplateExtras,
} = await import("../src/lib/dm/encounter-template-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a roster expands into slots in roster order", () => {
  const slots = expandRoster([
    { monster: "goblin", count: 3 },
    { monster: "hobgoblin", count: 1 },
  ]);
  assert.deepEqual(
    slots.map((slot) => `${slot.slot}:${slot.monster}:${slot.label}`),
    ["0:goblin:goblin 1", "1:goblin:goblin 2", "2:goblin:goblin 3", "3:hobgoblin:hobgoblin"],
  );
});

test("extras are cleaned against the roster: slots that do not exist are dropped", () => {
  const extras = normalizeTemplateExtras({
    placements: [
      { slot: 0, x: 3, y: 4 },
      { slot: 9, x: 1, y: 1 },
      { slot: 1, x: -2, y: 4 },
      { slot: 0, x: 5, y: 5 },
    ],
    entry: { x: 2, y: 2 },
    hidden: [1, 1, 7, 9, "x"],
    overrides: [{ slot: 2, name: "  Snik  ", hp: 3 }, { slot: 9, name: "Nope" }, { slot: 3, hp: 0 }],
    rewards: "  A silver key. ",
    phases: ["When the shaman drops, the wolves flee.", "", "The bridge burns on round 3."],
  });
  assert.deepEqual(extras.placements, [{ slot: 0, x: 5, y: 5 }], "one placement per slot, the last written wins");
  assert.deepEqual(extras.entry, { x: 2, y: 2 });
  assert.deepEqual(extras.hidden, [1, 7]);
  assert.deepEqual(extras.overrides, [{ slot: 2, name: "Snik", hp: 3 }]);
  assert.equal(extras.rewards, "A silver key.");
  assert.equal(extras.phases.length, 2);
  // Trimmed against a roster of four.
  const fitted = normalizeTemplateExtras(extras, 4);
  assert.deepEqual(fitted.hidden, [1]);
  assert.equal(normalizeTemplateExtras(null).placements.length, 0);
  assert.deepEqual(normalizeTemplateExtras(undefined), EMPTY_TEMPLATE_EXTRAS);
});

test("the lists are capped", () => {
  const extras = normalizeTemplateExtras({
    phases: Array.from({ length: 30 }, (_, i) => `phase ${i}`),
    placements: Array.from({ length: 30 }, (_, i) => ({ slot: i, x: 1, y: 1 })),
  });
  assert.ok(extras.phases.length <= EXTRAS_LIMITS.phases);
  assert.ok(extras.placements.length <= EXTRAS_LIMITS.slots);
});

test("slots match the enemies the fight actually made, by name, in order", () => {
  const slots = expandRoster([
    { monster: "goblin", count: 2 },
    { monster: "hobgoblin", count: 1 },
  ]);
  const enemies = [
    { id: "h", slug: "hobgoblin", displayName: "Hobgoblin" },
    { id: "g1", slug: "goblin", displayName: "Goblin" },
    { id: "g2", slug: "goblin", displayName: "Goblin" },
    { id: "extra", slug: "wolf", displayName: "Wolf" },
  ];
  const matched = matchSlots(slots, enemies);
  assert.deepEqual(
    [...matched.entries()].map(([slot, enemy]) => `${slot}:${enemy.id}`),
    ["0:g1", "1:g2", "2:h"],
  );
});

test("the DM note says what the fight is worth and what happens when", () => {
  const lines = describeExtras({
    ...EMPTY_TEMPLATE_EXTRAS,
    rewards: "200 gp and a silver key.",
    phases: ["Round 3: the bridge burns."],
  });
  assert.ok(lines.some((line) => line.includes("silver key")));
  assert.ok(lines.some((line) => line.includes("bridge burns")));
  assert.deepEqual(describeExtras(EMPTY_TEMPLATE_EXTRAS), []);
});

console.log(`test-encounter-extras: ${passed} passed`);
