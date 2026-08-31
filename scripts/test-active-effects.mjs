// Active effects: what an effect may claim, how a stack resolves, and when
// one wears off.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  applyField,
  checkEffect,
  describeDurationLeft,
  describeEffect,
  describeModifier,
  EFFECT_FIELDS,
  EFFECT_FIELD_LABELS,
  emptyOutcome,
  endEncounterEffects,
  MAX_EFFECT_VALUE,
  MAX_MODIFIERS,
  resolveField,
  tickMinutes,
  tickRound,
  visibleEffects,
} = await import("../src/lib/dm/effects-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function effect(overrides = {}) {
  return {
    id: overrides.id ?? "e1",
    campaignId: "c1",
    targetKind: "character",
    targetId: "pc1",
    name: overrides.name ?? "Bless",
    source: overrides.source ?? "",
    modifiers: overrides.modifiers ?? [{ field: "save", mode: "add", value: 2 }],
    duration: overrides.duration ?? "manual",
    remaining: overrides.remaining ?? 0,
    saveAbility: overrides.saveAbility ?? "",
    saveDc: overrides.saveDc ?? 0,
    visible: overrides.visible ?? false,
    createdAt: "t0",
  };
}

test("every field has a label", () => {
  for (const field of EFFECT_FIELDS) {
    assert.ok(EFFECT_FIELD_LABELS[field], `${field} needs a label`);
  }
});

test("an effect needs a name and something to change", () => {
  assert.ok("error" in checkEffect({ name: "", modifiers: [{ field: "ac" }] }));
  assert.ok("error" in checkEffect({ name: "Hex", modifiers: [] }));
});

test("an unknown field or mode is refused rather than stored", () => {
  assert.ok("error" in checkEffect({ name: "X", modifiers: [{ field: "luck" }] }));
  assert.ok("error" in checkEffect({ name: "X", modifiers: [{ field: "ac", mode: "multiply", value: 2 }] }));
});

test("add and override need a nonzero amount inside the cap", () => {
  assert.ok("error" in checkEffect({ name: "X", modifiers: [{ field: "ac", mode: "add", value: 0 }] }));
  assert.ok(
    "error" in
      checkEffect({ name: "X", modifiers: [{ field: "ac", mode: "add", value: MAX_EFFECT_VALUE + 1 }] }),
  );
  assert.ok(!("error" in checkEffect({ name: "X", modifiers: [{ field: "ac", mode: "add", value: 2 }] })));
});

test("advantage needs no amount", () => {
  const checked = checkEffect({ name: "X", modifiers: [{ field: "save", mode: "advantage" }] });
  assert.ok(!("error" in checked));
  assert.equal(checked.effect.modifiers[0].mode, "advantage");
});

test("an effect changes a bounded number of things", () => {
  const many = Array.from({ length: MAX_MODIFIERS + 1 }, () => ({ field: "ac", mode: "add", value: 1 }));
  assert.ok("error" in checkEffect({ name: "X", modifiers: many }));
});

test("a timed effect has to say how long", () => {
  assert.ok("error" in checkEffect({ name: "X", modifiers: [{ field: "ac", mode: "add", value: 1 }], duration: "rounds" }));
  const ok = checkEffect({
    name: "X",
    modifiers: [{ field: "ac", mode: "add", value: 1 }],
    duration: "rounds",
    remaining: 10,
  });
  assert.equal(ok.effect.remaining, 10);
});

test("a save to end needs an ability and a DC that exist", () => {
  assert.ok(
    "error" in
      checkEffect({ name: "X", modifiers: [{ field: "ac", mode: "add", value: 1 }], saveAbility: "luck", saveDc: 12 }),
  );
  assert.ok(
    "error" in
      checkEffect({ name: "X", modifiers: [{ field: "ac", mode: "add", value: 1 }], saveAbility: "con", saveDc: 99 }),
  );
});

test("bonuses to the same field sum", () => {
  const outcome = resolveField(
    [
      effect({ id: "a", modifiers: [{ field: "save", mode: "add", value: 2 }] }),
      effect({ id: "b", modifiers: [{ field: "save", mode: "add", value: 1 }] }),
    ],
    "save",
  );
  assert.equal(outcome.bonus, 3);
  assert.equal(outcome.sources.length, 2);
});

test("a field nothing touches resolves to nothing", () => {
  assert.deepEqual(resolveField([effect()], "ac"), emptyOutcome());
});

test("the largest override wins, and bonuses still ride on top", () => {
  const outcome = resolveField(
    [
      effect({ id: "a", modifiers: [{ field: "ac", mode: "override", value: 16 }] }),
      effect({ id: "b", modifiers: [{ field: "ac", mode: "override", value: 13 }] }),
      effect({ id: "c", modifiers: [{ field: "ac", mode: "add", value: 1 }] }),
    ],
    "ac",
  );
  assert.equal(outcome.override, 16);
  assert.equal(applyField(11, outcome), 17);
});

test("with no override the base stands", () => {
  assert.equal(applyField(15, { ...emptyOutcome(), bonus: 2 }), 17);
});

test("advantage does not stack, and one of each cancels", () => {
  const twice = resolveField(
    [
      effect({ id: "a", modifiers: [{ field: "check", mode: "advantage" }] }),
      effect({ id: "b", modifiers: [{ field: "check", mode: "advantage" }] }),
    ],
    "check",
  );
  assert.equal(twice.advantage, true);
  assert.equal(twice.disadvantage, false);

  const cancels = resolveField(
    [
      effect({ id: "a", modifiers: [{ field: "check", mode: "advantage" }] }),
      effect({ id: "b", modifiers: [{ field: "check", mode: "disadvantage" }] }),
    ],
    "check",
  );
  assert.equal(cancels.advantage, false);
  assert.equal(cancels.disadvantage, false);
});

test("a round passing counts down only round-scoped effects", () => {
  const result = tickRound([
    effect({ id: "a", duration: "rounds", remaining: 2 }),
    effect({ id: "b", duration: "rounds", remaining: 1 }),
    effect({ id: "c", duration: "minutes", remaining: 60 }),
    effect({ id: "d", duration: "manual" }),
  ]);
  assert.deepEqual(result.expired.map((entry) => entry.id), ["b"]);
  assert.equal(result.kept.find((entry) => entry.id === "a").remaining, 1);
  assert.equal(result.kept.find((entry) => entry.id === "c").remaining, 60);
});

test("minutes passing counts down only minute-scoped effects", () => {
  const result = tickMinutes(
    [
      effect({ id: "a", duration: "minutes", remaining: 60 }),
      effect({ id: "b", duration: "minutes", remaining: 10 }),
      effect({ id: "c", duration: "rounds", remaining: 3 }),
    ],
    30,
  );
  assert.deepEqual(result.expired.map((entry) => entry.id), ["b"]);
  assert.equal(result.kept.find((entry) => entry.id === "a").remaining, 30);
  assert.equal(result.kept.find((entry) => entry.id === "c").remaining, 3);
});

test("the fight ending takes its own effects with it", () => {
  const result = endEncounterEffects([
    effect({ id: "a", duration: "encounter" }),
    effect({ id: "b", duration: "manual" }),
  ]);
  assert.deepEqual(result.expired.map((entry) => entry.id), ["a"]);
  assert.deepEqual(result.kept.map((entry) => entry.id), ["b"]);
});

test("modifiers read as a person would say them", () => {
  assert.equal(describeModifier({ field: "save", mode: "add", value: 2 }), "+2 Saving throws");
  assert.equal(describeModifier({ field: "ac", mode: "override", value: 16 }), "Armor Class becomes 16");
  assert.equal(describeModifier({ field: "check", mode: "advantage", value: 0 }), "advantage on ability checks");
});

test("a duration reads in its own unit", () => {
  assert.equal(describeDurationLeft(effect({ duration: "rounds", remaining: 1 })), "1 round left");
  assert.equal(describeDurationLeft(effect({ duration: "minutes", remaining: 30 })), "30 minutes left");
  assert.equal(describeDurationLeft(effect({ duration: "encounter" })), "until the fight ends");
  assert.equal(describeDurationLeft(effect({ duration: "manual" })), "until removed");
});

test("an effect describes itself with its save", () => {
  const line = describeEffect(effect({ saveAbility: "con", saveDc: 14, duration: "rounds", remaining: 3 }));
  assert.match(line, /Bless/);
  assert.match(line, /CON DC 14 to end/);
});

test("a player sees only the visible ones", () => {
  const all = [effect({ id: "a", visible: true }), effect({ id: "b", visible: false })];
  assert.equal(visibleEffects(all, true).length, 2);
  assert.deepEqual(visibleEffects(all, false).map((entry) => entry.id), ["a"]);
});

console.log(`active-effects: ${passed} tests passed`);
