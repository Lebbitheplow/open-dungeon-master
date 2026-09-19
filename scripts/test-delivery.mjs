// The damage delivery table (docs/visual-overhaul-plan.md section 5.5): how
// each damage type arrives on the board. The table decides no rule, but it is
// what every hit looks like, so a palette type without a row, a heal that
// shakes the stage or a low tier that still throws a full burst are all bugs
// a player would see on the first swing.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { DAMAGE_PALETTE } = await import("../src/lib/battlemap/damage-palette.ts");
const {
  BURST_COUNT,
  DELIVERY,
  RING_COUNT,
  boltPoints,
  burstCount,
  deliveryFor,
  landingOf,
  numberStyleFor,
  particleSpecs,
  presentationFor,
  recoilFor,
  ringCount,
  ringSpecs,
  seedOf,
  shakeFor,
} = await import("../src/lib/battlemap/delivery.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// ---- the table ----

test("every palette type has a delivery row", () => {
  for (const type of Object.keys(DAMAGE_PALETTE)) {
    assert.ok(DELIVERY[type], `no delivery row for ${type}`);
  }
  assert.ok(DELIVERY.heal);
  assert.ok(DELIVERY.teleport);
});

test("the rows are the plan's rows", () => {
  assert.deepEqual([DELIVERY.fire.mode, DELIVERY.fire.delay, DELIVERY.fire.shake], ["lob", 420, 7]);
  assert.deepEqual([DELIVERY.cold.mode, DELIVERY.cold.delay, DELIVERY.cold.shake], ["straight", 200, 4]);
  assert.deepEqual([DELIVERY.lightning.mode, DELIVERY.lightning.delay, DELIVERY.lightning.shake], ["bolt", 90, 6]);
  assert.deepEqual([DELIVERY.acid.mode, DELIVERY.acid.delay, DELIVERY.acid.shake], ["lob", 380, 3]);
  assert.deepEqual([DELIVERY.poison.mode, DELIVERY.poison.delay, DELIVERY.poison.shake], ["lob", 380, 2]);
  assert.deepEqual([DELIVERY.necrotic.mode, DELIVERY.necrotic.delay, DELIVERY.necrotic.shake], ["none", 90, 3]);
  assert.deepEqual([DELIVERY.radiant.mode, DELIVERY.radiant.delay, DELIVERY.radiant.shake], ["beam", 120, 4]);
  assert.deepEqual([DELIVERY.force.mode, DELIVERY.force.delay, DELIVERY.force.shake], ["none", 90, 5]);
  assert.deepEqual([DELIVERY.psychic.mode, DELIVERY.psychic.delay, DELIVERY.psychic.shake], ["none", 90, 4]);
  assert.deepEqual([DELIVERY.thunder.mode, DELIVERY.thunder.delay, DELIVERY.thunder.shake], ["none", 90, 9]);
  assert.deepEqual([DELIVERY.bludgeoning.mode, DELIVERY.bludgeoning.delay, DELIVERY.bludgeoning.shake], ["swing", 150, 5]);
  assert.deepEqual([DELIVERY.piercing.shake, DELIVERY.slashing.shake], [4, 4]);
  assert.equal(DELIVERY.cold.freeze, true);
});

test("shake is zero for heal and teleport", () => {
  assert.equal(DELIVERY.heal.shake, 0);
  assert.equal(DELIVERY.teleport.shake, 0);
  assert.equal(presentationFor({ kind: "heal", amount: 8 }).shake, null);
  assert.equal(presentationFor({ kind: "teleport" }).shake, null);
});

test("thunder shakes hardest", () => {
  const max = Math.max(...Object.values(DELIVERY).map((row) => row.shake));
  assert.equal(DELIVERY.thunder.shake, max);
});

// ---- counts ----

test("the burst counts are the plan's", () => {
  assert.deepEqual(BURST_COUNT, { spark: 14, shard: 13, mist: 9, drip: 11, bloom: 10, ring: 0 });
  assert.equal(RING_COUNT, 3);
});

test("the low tier halves counts, and never to nothing", () => {
  for (const family of ["spark", "shard", "mist", "drip", "bloom"]) {
    assert.equal(burstCount(family, true), Math.ceil(BURST_COUNT[family] / 2));
    assert.ok(burstCount(family, true) > 0);
    assert.ok(burstCount(family, true) < burstCount(family, false));
  }
  assert.equal(ringCount("ring", false), 3);
  assert.equal(ringCount("ring", true), 2);
  assert.equal(ringCount("spark", false), 0);
  const full = presentationFor({ kind: "spell", damageType: "fire", outcome: "fail" });
  const low = presentationFor({ kind: "spell", damageType: "fire", outcome: "fail" }, { low: true });
  assert.equal(full.particles.count, 14);
  assert.equal(low.particles.count, 7);
});

// ---- outcome ----

test("a miss, a fumble and a clean save play no impact", () => {
  for (const outcome of ["miss", "fumble", "save"]) {
    const p = presentationFor({ kind: "attack", damageType: "slashing", outcome });
    assert.equal(landingOf({ kind: "attack", outcome }), "none");
    assert.equal(p.flash, null);
    assert.equal(p.shake, null);
    assert.equal(p.particles, null);
    assert.equal(p.flipbook, null);
    assert.equal(p.freeze, false);
  }
});

test("half on a save lands at half weight", () => {
  const full = presentationFor({ kind: "spell", damageType: "fire", outcome: "fail", amount: 20 });
  const half = presentationFor({ kind: "spell", damageType: "fire", outcome: "half", amount: 10 });
  assert.equal(half.particles.count, Math.ceil(full.particles.count / 2));
  assert.ok(half.shake.px < full.shake.px);
  assert.equal(half.number.variant, "half");
});

test("a hit shakes for 420 ms, a crit for 620 ms and harder", () => {
  const hit = shakeFor(5, "hit", "full");
  const crit = shakeFor(5, "crit", "full");
  assert.deepEqual(hit, { px: 3, ms: 420 });
  assert.deepEqual(crit, { px: 7, ms: 620 });
  assert.ok(shakeFor(9, "crit", "full").px <= 9);
});

test("a crit is gold and large, a heal is green, a sword keeps the ember number", () => {
  assert.deepEqual(numberStyleFor({ kind: "attack", outcome: "crit", damageType: "slashing" }), {
    color: "#d4ab3a",
    size: 18,
    variant: "crit",
  });
  assert.equal(numberStyleFor({ kind: "heal" }).color, "#7ed6a4");
  assert.equal(numberStyleFor({ kind: "attack", outcome: "hit", damageType: "slashing" }).color, "#ff9d5c");
  assert.equal(numberStyleFor({ kind: "spell", outcome: "fail", damageType: "cold" }).color, DAMAGE_PALETTE.cold.color);
});

test("the number is planned only when the viewer was sent one", () => {
  assert.equal(presentationFor({ kind: "attack", outcome: "hit", damageType: "slashing" }).number, null);
  assert.ok(presentationFor({ kind: "attack", outcome: "hit", damageType: "slashing", amount: 6 }).number);
});

test("cold freezes, and only when it lands", () => {
  assert.equal(presentationFor({ kind: "spell", damageType: "cold", outcome: "fail" }).freeze, true);
  assert.equal(presentationFor({ kind: "spell", damageType: "cold", outcome: "save" }).freeze, false);
});

test("energy types carry their flipbook, a sword does not", () => {
  assert.equal(presentationFor({ kind: "spell", damageType: "fire", outcome: "fail" }).flipbook, "burst-fire");
  assert.equal(presentationFor({ kind: "attack", damageType: "slashing", outcome: "hit" }).flipbook, null);
  assert.equal(presentationFor({ kind: "attack", damageType: "slashing", outcome: "crit" }).flipbook, "crit-flare");
  assert.equal(presentationFor({ kind: "heal", amount: 5 }).flipbook, "heal-bloom");
});

// ---- reach ----

test("an arrow flies flat, a flame tongue still swings, an untyped blow swings", () => {
  assert.equal(deliveryFor({ kind: "attack", damageType: "piercing", ranged: true }).mode, "straight");
  assert.equal(deliveryFor({ kind: "attack", damageType: "fire", ranged: false }).mode, "swing");
  assert.equal(deliveryFor({ kind: "attack", ranged: false }).mode, "swing");
  assert.equal(deliveryFor({ kind: "spell", damageType: "fire" }).mode, "lob");
  assert.equal(deliveryFor({ kind: "spell" }).mode, "none");
});

// ---- determinism ----

test("the same effect id replays the same particles", () => {
  const a = particleSpecs("spark", seedOf("atk-abc-1"), 14);
  const b = particleSpecs("spark", seedOf("atk-abc-1"), 14);
  const c = particleSpecs("spark", seedOf("atk-abc-2"), 14);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(a.length, 14);
});

test("mist, drips and blooms rise; sparks go all round", () => {
  for (const family of ["mist", "drip", "bloom"]) {
    for (const spec of particleSpecs(family, 7, 9)) {
      assert.ok(Math.sin(spec.angle) < 0.5, `${family} should open upward`);
    }
  }
  const sparks = particleSpecs("spark", 7, 14);
  assert.ok(sparks.some((spec) => Math.sin(spec.angle) > 0.5));
});

test("rings are concentric and a beat apart", () => {
  const rings = ringSpecs(3);
  assert.equal(rings.length, 3);
  assert.ok(rings[0].scale < rings[1].scale && rings[1].scale < rings[2].scale);
  assert.deepEqual(rings.map((ring) => ring.delay), [0, 110, 220]);
  assert.equal(rings[1].edge, true);
});

test("a bolt starts and ends where it was told, and is the same twice", () => {
  const from = { x: 10, y: 10 };
  const to = { x: 110, y: 40 };
  const a = boltPoints(42, from, to);
  assert.deepEqual(a[0], from);
  assert.deepEqual(a[a.length - 1], to);
  assert.equal(a.length, 8);
  assert.deepEqual(a, boltPoints(42, from, to));
});

test("a struck figure kicks away from the blow, and only when the stage shakes", () => {
  const shake = { px: 3, ms: 420 };
  assert.equal(recoilFor({ x: 1, y: 1 }, { x: 4, y: 1 }, null), null);
  assert.deepEqual(recoilFor({ x: 1, y: 1 }, { x: 4, y: 1 }, shake), { dx: 5.3, dy: 0, deg: 4, ms: 420 });
  assert.deepEqual(recoilFor({ x: 4, y: 1 }, { x: 1, y: 1 }, shake), { dx: -5.3, dy: 0, deg: -4, ms: 420 });
  const down = recoilFor({ x: 2, y: 2 }, { x: 2, y: 6 }, shake);
  assert.equal(down.dx, 0);
  assert.equal(down.dy, 5.3);
  // No origin (a trap) and a blow from the same tile both kick to the right.
  assert.deepEqual(recoilFor(null, { x: 3, y: 3 }, shake), recoilFor({ x: 3, y: 3 }, { x: 3, y: 3 }, shake));
  assert.equal(recoilFor(null, { x: 3, y: 3 }, shake).dx, 5.3);
});

console.log(`test-delivery: ${passed} passed`);
