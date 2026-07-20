// Spell damage derived from the content pack's own prose, so the model no
// longer supplies (or forgets) cantrip scaling and upcast dice.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  baseDamageDice,
  baseHealingDice,
  cantripDamage,
  cantripTiers,
  scaledSpellDice,
  upcastDamage,
  upcastStep,
} from "../src/lib/srd/spell-scaling.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// Verbatim strings from the Open5e rows the app ships.
const FIRE_BOLT = {
  desc: "You hurl a mote of fire at a creature or object within range. Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage.",
  higher_level:
    "This spell's damage increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10).",
};
const FIREBALL = {
  desc: "A bright streak flashes from your pointing finger. Each creature in a 20-foot-radius sphere centered on that point must make a Dexterity saving throw. A target takes 8d6 fire damage on a failed save, or half as much damage on a successful one.",
  higher_level:
    "When you cast this spell using a spell slot of 4th level or higher, the damage increases by 1d6 for each slot level above 3rd.",
};
const CURE_WOUNDS = {
  desc: "A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier. This spell has no effect on undead or constructs.",
  higher_level:
    "When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d8 for each slot level above 1st.",
};
const MAGIC_MISSILE = {
  desc: "You create three glowing darts of magical force. A dart deals 1d4 + 1 force damage to its target.",
  higher_level:
    "When you cast this spell using a spell slot of 2nd level or higher, the spell creates one more dart for each slot level above 1st.",
};

test("base dice come out of the description", () => {
  assert.equal(baseDamageDice(FIRE_BOLT.desc), "1d10");
  assert.equal(baseDamageDice(FIREBALL.desc), "8d6");
  assert.equal(baseHealingDice(CURE_WOUNDS.desc), "1d8");
  assert.equal(baseDamageDice("You speak a word of comfort."), null);
});

test("a cantrip grows at 5th, 11th, and 17th level", () => {
  const at = (level) => cantripDamage(FIRE_BOLT.desc, FIRE_BOLT.higher_level, level).dice;
  assert.equal(at(1), "1d10");
  assert.equal(at(4), "1d10");
  assert.equal(at(5), "2d10");
  assert.equal(at(10), "2d10");
  assert.equal(at(11), "3d10");
  assert.equal(at(16), "3d10");
  assert.equal(at(17), "4d10");
  assert.equal(at(20), "4d10");
  assert.deepEqual(cantripTiers(FIRE_BOLT.higher_level), ["2d10", "3d10", "4d10"]);
});

test("upcasting adds dice per slot level above the spell's own", () => {
  const at = (slot) => upcastDamage(FIREBALL.desc, FIREBALL.higher_level, slot).dice;
  assert.equal(at(3), "8d6");
  assert.equal(at(4), "9d6");
  assert.equal(at(6), "11d6");
  assert.equal(at(9), "14d6");
  const step = upcastStep(FIREBALL.higher_level);
  assert.deepEqual(step, { dice: "1d6", baseLevel: 3, kind: "damage", per: 1 });
});

test("healing upcasts the same way", () => {
  assert.equal(upcastDamage(CURE_WOUNDS.desc, CURE_WOUNDS.higher_level, 1).dice, "1d8");
  assert.equal(upcastDamage(CURE_WOUNDS.desc, CURE_WOUNDS.higher_level, 3).dice, "3d8");
  assert.equal(upcastStep(CURE_WOUNDS.higher_level).kind, "healing");
});

test("an unparseable rule returns null instead of guessing", () => {
  // Magic Missile scales by darts, not dice: the parser must decline.
  assert.equal(upcastStep(MAGIC_MISSILE.higher_level), null);
  assert.equal(upcastDamage(MAGIC_MISSILE.desc, MAGIC_MISSILE.higher_level, 3), null);
  assert.equal(cantripTiers(FIREBALL.higher_level), null);
  assert.equal(cantripDamage(FIREBALL.desc, FIREBALL.higher_level, 5), null);
});

test("the single entry point routes cantrips and slots correctly", () => {
  assert.equal(
    scaledSpellDice({
      spellLevel: 0,
      desc: FIRE_BOLT.desc,
      higherLevel: FIRE_BOLT.higher_level,
      casterLevel: 11,
    }).dice,
    "3d10",
  );
  assert.equal(
    scaledSpellDice({
      spellLevel: 3,
      desc: FIREBALL.desc,
      higherLevel: FIREBALL.higher_level,
      casterLevel: 11,
      slotLevel: 5,
    }).dice,
    "10d6",
  );
  // No slot named: the spell's own level is the floor.
  assert.equal(
    scaledSpellDice({
      spellLevel: 3,
      desc: FIREBALL.desc,
      higherLevel: FIREBALL.higher_level,
      casterLevel: 5,
    }).dice,
    "8d6",
  );
});

// The parsers exist to read the shipped content pack, so when it is present
// they are held to it: a healthy share of damaging spells must parse.
const contentDb = "data/content/open5e.sqlite";
if (existsSync(contentDb)) {
  test("the shipped content pack parses at a useful rate", async () => {
    const { default: Database } = await import("better-sqlite3-multiple-ciphers");
    const db = new Database(contentDb, { readonly: true });
    const rows = db
      .prepare("SELECT name, level, data_json FROM spells WHERE data_json LIKE '%damage%'")
      .all();
    let scalable = 0;
    let parsed = 0;
    for (const row of rows) {
      const data = JSON.parse(row.data_json || "{}");
      const higher = String(data.higher_level || "");
      const desc = String(data.desc || "");
      // Only spells that actually claim to scale are fair to judge.
      if (!/increases by \d+d\d+/i.test(higher)) {
        continue;
      }
      scalable += 1;
      if (scaledSpellDice({
        spellLevel: row.level,
        desc,
        higherLevel: higher,
        casterLevel: 11,
        slotLevel: Math.max(1, row.level),
      })) {
        parsed += 1;
      }
    }
    db.close();
    assert.ok(scalable > 20, `expected a body of scaling spells, saw ${scalable}`);
    const rate = parsed / scalable;
    assert.ok(rate > 0.85, `only ${parsed}/${scalable} scaling spells parsed`);
    console.log(`  (content pack: ${parsed}/${scalable} scaling spells parsed)`);
  });
}

console.log(`test-spell-scaling: ${passed} passed`);
