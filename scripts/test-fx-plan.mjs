// The effect planner: every visual the board plays is planned from a
// resolved outcome, coloured by the damage type, and never planned for a
// roll the table may not see. See docs/vtt-parity-implementation-plan.md
// section 1.3.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  fxAllowedFor,
  fxTone,
  planAreaFx,
  planAttackFx,
  planDeathFx,
  planDoorFx,
  planHazardFx,
  planHealFx,
  planSpellFx,
  planTeleportFx,
  redactFx,
} = await import("../src/lib/battlemap/fx-plan.ts");
const { damageTone, DAMAGE_PALETTE } = await import("../src/lib/battlemap/damage-palette.ts");
const { STING_CUES } = await import("../src/lib/ambience/catalog.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const stingIds = new Set(STING_CUES.map((cue) => cue.id));
const A = { x: 2, y: 2 };
const B = { x: 5, y: 2 };

test("a natural 20 plans a crit with a gold tone and the crit sting", () => {
  const fx = planAttackFx({ from: A, to: B, hit: true, crit: true, damage: 14 });
  assert.equal(fx.kind, "attack");
  assert.equal(fx.outcome, "crit");
  assert.equal(fx.amount, 14);
  assert.equal(fx.sting, "hit_crit");
  assert.equal(fxTone(fx), "#d4ab3a");
  assert.ok(stingIds.has(fx.sting), "the crit sting is in the catalog");
});

test("a miss and a fumble plan no number and the miss sting", () => {
  const miss = planAttackFx({ from: A, to: B, hit: false, crit: false, damage: 9 });
  assert.equal(miss.outcome, "miss");
  assert.equal(miss.amount, undefined);
  assert.equal(miss.sting, "swing_miss");
  const fumble = planAttackFx({ from: A, to: B, hit: false, crit: false, fumble: true });
  assert.equal(fumble.outcome, "fumble");
});

test("melee and ranged hits pick their own sting and flag", () => {
  const melee = planAttackFx({ from: A, to: B, hit: true, crit: false, damage: 5 });
  assert.equal(melee.ranged, false);
  assert.equal(melee.sting, "hit_melee");
  const ranged = planAttackFx({ from: A, to: B, hit: true, crit: false, damage: 5, ranged: true });
  assert.equal(ranged.ranged, true);
  assert.equal(ranged.sting, "hit_ranged");
});

test("a fire spell plans fire: ember tone, fire sting", () => {
  const fx = planSpellFx({
    from: A,
    to: B,
    resolution: "attack",
    hit: true,
    damage: 11,
    damageType: "fire",
  });
  assert.equal(fx.kind, "spell");
  assert.equal(fx.damageType, "fire");
  assert.equal(fxTone(fx), DAMAGE_PALETTE.fire.color);
  assert.equal(fx.sting, "spell_fire");
  assert.ok(stingIds.has(fx.sting));
});

test("every damage type has a tone and unknown types fall back to bone", () => {
  for (const type of [
    "fire",
    "cold",
    "lightning",
    "acid",
    "poison",
    "necrotic",
    "radiant",
    "force",
    "psychic",
    "thunder",
    "bludgeoning",
    "piercing",
    "slashing",
  ]) {
    assert.ok(DAMAGE_PALETTE[type], `${type} has a tone`);
  }
  assert.equal(damageTone("Fire").color, DAMAGE_PALETTE.fire.color);
  assert.equal(damageTone("banana").color, DAMAGE_PALETTE.slashing.color);
  assert.equal(damageTone(undefined).burst, "shard");
});

test("a save spell plans save, fail, or half depending on the spell", () => {
  const saved = planSpellFx({ to: B, resolution: "save", saved: true, halfOnSave: false, damage: 8 });
  assert.equal(saved.outcome, "save");
  assert.equal(saved.amount, undefined);
  const half = planSpellFx({ to: B, resolution: "save", saved: true, halfOnSave: true, damage: 8 });
  assert.equal(half.outcome, "half");
  assert.equal(half.amount, 8);
  const failed = planSpellFx({ to: B, resolution: "save", saved: false, damage: 16 });
  assert.equal(failed.outcome, "fail");
  assert.equal(failed.amount, 16);
});

test("an area plans half on each target that saved and fail on the rest", () => {
  const fx = planAreaFx({
    origin: A,
    shape: { kind: "sphere", sizeFeet: 20, tiles: [A, B] },
    targets: [
      { at: A, tokenId: "t1", saved: true, damage: 10 },
      { at: B, tokenId: "t2", saved: false, damage: 20 },
      { at: { x: 3, y: 3 }, tokenId: "t3", saved: true, damage: 10 },
    ],
    halfOnSave: true,
    damageType: "fire",
  });
  assert.equal(fx.kind, "template");
  assert.deepEqual(fx.outcomes, ["half", "fail", "half"]);
  assert.deepEqual(fx.toTokenId, ["t1", "t2", "t3"]);
  assert.equal(fx.shape.tiles.length, 2);
});

test("no effect is planned for a roll the table cannot see", () => {
  assert.equal(fxAllowedFor("public"), true);
  assert.equal(fxAllowedFor("self"), true);
  assert.equal(fxAllowedFor("blind"), false);
  assert.equal(fxAllowedFor("dm"), false);
  assert.equal(fxAllowedFor(undefined), true);
  assert.equal(
    planAttackFx({ from: A, to: B, hit: true, crit: true, damage: 9, visibility: "blind" }),
    null,
  );
  assert.equal(
    planSpellFx({ to: B, resolution: "auto", damage: 4, visibility: "dm" }),
    null,
  );
  assert.equal(
    planAreaFx({
      origin: A,
      shape: { kind: "cone", sizeFeet: 15, tiles: [] },
      targets: [],
      halfOnSave: false,
      visibility: "blind",
    }),
    null,
  );
});

test("heal, death, door, hazard and teleport carry catalog stings", () => {
  const heal = planHealFx({ to: A, amount: 7 });
  assert.equal(heal.kind, "heal");
  assert.equal(heal.amount, 7);
  const death = planDeathFx({ to: A, name: "Goblin" });
  assert.equal(death.kind, "death");
  const door = planDoorFx({ at: A, state: "locked" });
  assert.equal(door.sting, "door_locked");
  const open = planDoorFx({ at: A, state: "open" });
  assert.equal(open.sting, "door_creak");
  const fall = planHazardFx({ to: A, hazard: "falling", damageType: "bludgeoning", amount: 6 });
  assert.equal(fall.sting, "thud");
  const teleport = planTeleportFx({ from: A, to: B, tokenId: "t1" });
  assert.equal(teleport.kind, "teleport");
  for (const fx of [heal, death, door, open, fall, teleport]) {
    assert.ok(stingIds.has(fx.sting), `${fx.kind} sting ${fx.sting} is in the catalog`);
  }
});

test("redaction strips the number and nothing else", () => {
  const fx = planAttackFx({ from: A, to: B, hit: true, crit: false, damage: 12, damageType: "fire" });
  const redacted = redactFx(fx);
  assert.equal(redacted.amount, undefined);
  assert.equal(redacted.outcome, "hit");
  assert.equal(redacted.damageType, "fire");
  assert.equal(redacted.id, fx.id);
  const none = planAttackFx({ from: A, to: B, hit: false, crit: false });
  assert.equal(redactFx(none), none, "nothing to strip returns the same object");
});

test("ids are unique across a burst of plans", () => {
  const ids = new Set();
  for (let i = 0; i < 50; i += 1) {
    ids.add(planAttackFx({ from: A, to: B, hit: true, crit: false, damage: 1 }).id);
  }
  assert.equal(ids.size, 50);
});

console.log(`test-fx-plan: ${passed} passed`);
