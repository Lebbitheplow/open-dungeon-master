// Health words, condition glyphs and the particle field: the three pure
// pieces under the board's presentation (docs/vtt-parity-implementation-
// plan.md sections 1.1, 1.2 and 0.6).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { healthWord, HEALTH_RING, HEALTH_LABEL } = await import(
  "../src/lib/battlemap/health-words.ts"
);
const { CONDITION_GLYPHS, glyphFor, MAX_BADGES } = await import(
  "../src/lib/battlemap/condition-glyphs.ts"
);
const { burst, createField, emit, mulberry, spawnWeather, step, MAX_SPRITES, LOW_SPRITES } =
  await import("../src/lib/particles.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("health words walk the thresholds from the plan", () => {
  assert.equal(healthWord(20, 20), "unharmed");
  assert.equal(healthWord(19, 20), "unharmed");
  assert.equal(healthWord(18, 20), "scratched");
  assert.equal(healthWord(11, 20), "scratched");
  assert.equal(healthWord(10, 20), "bloodied");
  assert.equal(healthWord(6, 20), "bloodied");
  assert.equal(healthWord(5, 20), "critical");
  assert.equal(healthWord(1, 20), "critical");
  assert.equal(healthWord(0, 20), "down");
  assert.equal(healthWord(-4, 20), "down");
  assert.equal(healthWord(0, 20, { dead: true }), "dead");
  assert.equal(healthWord(3, 0), "unharmed", "a zero max never divides by zero");
});

test("every word has a ring colour and a label", () => {
  for (const word of ["unharmed", "scratched", "bloodied", "critical", "down", "dead"]) {
    assert.match(HEALTH_RING[word], /^#[0-9a-f]{6}$/);
    assert.ok(HEALTH_LABEL[word].length > 0);
  }
});

test("every SRD condition has a glyph, and free text finds one", () => {
  for (const condition of [
    "blinded",
    "charmed",
    "deafened",
    "frightened",
    "grappled",
    "incapacitated",
    "invisible",
    "paralyzed",
    "petrified",
    "poisoned",
    "prone",
    "restrained",
    "stunned",
    "unconscious",
    "exhaustion",
  ]) {
    assert.ok(CONDITION_GLYPHS[condition], `${condition} has a glyph`);
    assert.ok(CONDITION_GLYPHS[condition].path.length > 10);
  }
  assert.equal(glyphFor("Poisoned").id, "poisoned");
  assert.equal(glyphFor("exhaustion 2").id, "exhaustion");
  assert.equal(glyphFor("prone (until stands)").id, "prone");
  const unknown = glyphFor("Hexed by the moon");
  assert.equal(unknown.id, "effect");
  assert.equal(unknown.label, "Hexed by the moon");
  assert.equal(MAX_BADGES, 4);
});

test("glyph ids are unique and every path is a stroke on the 16 grid", () => {
  const ids = new Set(Object.values(CONDITION_GLYPHS).map((glyph) => glyph.id));
  assert.equal(ids.size, Object.keys(CONDITION_GLYPHS).length);
  for (const glyph of Object.values(CONDITION_GLYPHS)) {
    const numbers = glyph.path.match(/-?\d+(\.\d+)?/g).map(Number);
    for (const n of numbers) {
      assert.ok(Math.abs(n) <= 18, `${glyph.id} stays on the grid (${n})`);
    }
  }
});

test("the particle field respects its cap and drops the dead", () => {
  const field = createField(100, 100, 50);
  const rng = mulberry(7);
  burst(field, 50, 50, "#fff", "spark", 30, rng);
  assert.equal(field.sprites.length, 30);
  burst(field, 50, 50, "#fff", "shard", 40, rng);
  assert.equal(field.sprites.length, 50, "never over the cap");
  step(field, 10_000);
  assert.equal(field.sprites.length, 0, "everything from a burst dies");
  assert.equal(MAX_SPRITES, 400);
  assert.equal(LOW_SPRITES, 80);
});

test("weather tops up to the target and wraps instead of dying", () => {
  const field = createField(200, 100, 400);
  const rng = mulberry(11);
  spawnWeather(field, "rain", 120, 0.2, rng);
  assert.equal(field.sprites.length, 120);
  spawnWeather(field, "rain", 120, 0.2, rng);
  assert.equal(field.sprites.length, 120, "does not overfill");
  for (let i = 0; i < 300; i += 1) {
    step(field, 16);
  }
  assert.equal(field.sprites.length, 120, "rain keeps falling");
  for (const sprite of field.sprites) {
    assert.ok(sprite.y <= 120 && sprite.y >= -30, "wrapped inside the frame");
  }
  const fog = createField(200, 100, 400);
  spawnWeather(fog, "fog", 6, 0, rng);
  assert.equal(fog.sprites.length, 6);
  assert.equal(fog.sprites[0].shape, "blob");
});

test("emit makes room for the newest sprites when full", () => {
  const field = createField(10, 10, 3);
  const make = (tag) => ({
    x: 0, y: 0, vx: 0, vy: 0, life: 100, total: 100, size: 1, color: tag, shape: "dot", depth: 1, gravity: 0, drag: 1,
  });
  emit(field, [make("a"), make("b"), make("c")]);
  emit(field, [make("d")]);
  assert.deepEqual(
    field.sprites.map((sprite) => sprite.color),
    ["b", "c", "d"],
  );
});

test("the seeded generator is deterministic", () => {
  const a = mulberry(42);
  const b = mulberry(42);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(a(), b());
  }
});

console.log(`test-health-words: ${passed} passed`);
