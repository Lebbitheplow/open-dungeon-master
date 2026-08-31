// Stats to challenge rating: the DMG's own procedure, run backwards from a
// stat block. The interesting assertions are not the arithmetic (that is a
// table lookup) but the two places the method is subtle: averaging ratings
// in ROW POSITIONS rather than as numbers, and pricing resistances against
// the rating the monster is heading for rather than the one it started at.
//
// The accuracy check at the bottom runs against real Open5e monsters when
// the content pack is present, because a CR calculator that has never been
// compared to a published monster is a calculator nobody should trust.
// See docs/workshop-plan.md phase 6.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  CR_TABLE,
  countCommonTypes,
  crLabel,
  crRowIndex,
  damagePerRound,
  defensiveCr,
  deriveCr,
  effectiveHp,
  expectedFor,
  offensiveCr,
} = await import("../src/lib/bestiary/derive-cr.ts");
const { synthesizeStats } = await import("../src/lib/bestiary/synthesize.ts");
const { xpForCr } = await import("../src/lib/srd/encounter-math.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A stat block with only the fields the derivation reads.
function block(overrides = {}) {
  return {
    ac: 13,
    maxHp: 20,
    dexMod: 1,
    speed: "30",
    attacks: [{ name: "Bite", toHit: 3, damage: "1d6+1", type: "piercing" }],
    traits: [],
    resist: "",
    immune: "",
    vulnerable: "",
    conditionImmune: "",
    cr: 0.25,
    xp: 50,
    attacksPerTurn: 1,
    ...overrides,
  };
}

// ---- the table itself ----

test("the table covers every rating from 0 to 30 with no gaps in the bands", () => {
  assert.equal(CR_TABLE[0].cr, 0);
  assert.equal(CR_TABLE.at(-1).cr, 30);
  for (let index = 1; index < CR_TABLE.length; index += 1) {
    assert.ok(CR_TABLE[index].cr > CR_TABLE[index - 1].cr, `row ${index} is out of order`);
    // The hit point bands must abut: a monster with 71 hp has to land
    // somewhere, and a gap between rows is a monster the method cannot rate.
    assert.equal(
      CR_TABLE[index].hpMin,
      CR_TABLE[index - 1].hpMax + 1,
      `hit point gap before CR ${CR_TABLE[index].cr}`,
    );
    assert.equal(
      CR_TABLE[index].damageMin,
      CR_TABLE[index - 1].damageMax + 1,
      `damage gap before CR ${CR_TABLE[index].cr}`,
    );
  }
});

test("crRowIndex snaps an unlisted rating to the nearest row", () => {
  assert.equal(CR_TABLE[crRowIndex(0.125)].cr, 0.125);
  assert.equal(CR_TABLE[crRowIndex(0.2)].cr, 0.25);
  assert.equal(CR_TABLE[crRowIndex(7.4)].cr, 7);
  assert.equal(CR_TABLE[crRowIndex(99)].cr, 30);
  assert.equal(CR_TABLE[crRowIndex(-5)].cr, 0);
});

test("expectedFor hands back the whole DMG row for a rating", () => {
  const row = expectedFor(5);
  assert.equal(row.ac, 15);
  assert.equal(row.hpMin, 131);
  assert.equal(row.attack, 6);
  assert.equal(row.saveDc, 15);
});

test("crLabel prints the fractional ratings the way the books do", () => {
  assert.equal(crLabel(0.125), "1/8");
  assert.equal(crLabel(0.25), "1/4");
  assert.equal(crLabel(0.5), "1/2");
  assert.equal(crLabel(7), "7");
});

// ---- the defensive half ----

test("hit points pick the band and armour class moves it two points a step", () => {
  // 140 hp is the CR 5 band; AC 15 is what CR 5 expects, so nothing moves.
  const even = defensiveCr(140, 15);
  assert.equal(even.baseCr, 5);
  assert.equal(even.adjustment, 0);
  assert.equal(even.cr, 5);

  // Four points of armour above expectations is two ratings.
  const armoured = defensiveCr(140, 19);
  assert.equal(armoured.adjustment, 2);
  assert.equal(armoured.cr, 7);

  const naked = defensiveCr(140, 11);
  assert.equal(naked.adjustment, -2);
  assert.equal(naked.cr, 3);
});

test("the defensive half explains both of its numbers", () => {
  const readout = defensiveCr(140, 19);
  assert.equal(readout.parts.length, 2);
  assert.match(readout.parts[0].detail, /CR 5 band \(131 to 145\)/);
  assert.match(readout.parts[1].detail, /\+2 ratings/);
});

test("a monster below the first band and above the last still gets a rating", () => {
  assert.equal(defensiveCr(1, 13).cr, 0);
  assert.equal(defensiveCr(5000, 19).cr, 30);
});

// ---- the offensive half ----

test("damage picks the band and attack bonus moves it two points a step", () => {
  const even = offensiveCr(36, 6);
  assert.equal(even.baseCr, 5);
  assert.equal(even.adjustment, 0);

  const accurate = offensiveCr(36, 10);
  assert.equal(accurate.adjustment, 2);
  assert.equal(accurate.cr, 7);
});

test("a monster that deals no damage rates at the bottom", () => {
  assert.equal(offensiveCr(0, 0).baseCr, 0);
});

// ---- averaging in row positions ----

test("the two halves average by row, not by number", () => {
  // The four ratings below CR 1 are an eighth apart and everything above is
  // a whole one, so the ladder is not the number line and averaging on it
  // gives a different answer. A glass cannon with 5 hit points and a
  // 3d8+3 hit is defensive CR 0 (row 0) and offensive CR 2 (row 5). By ROW
  // that is row 2.5, rounded up to row 3, which is CR 1/2. By NUMBER it
  // would be (0 + 2) / 2 = CR 1, twice as much XP for the same monster.
  const glassCannon = deriveCr(
    block({
      maxHp: 5,
      ac: 13,
      attacks: [{ name: "Sting", toHit: 3, damage: "3d8+3", type: "poison" }],
      attacksPerTurn: 1,
      cr: 1,
    }),
  );
  assert.equal(glassCannon.defensive.cr, 0);
  assert.equal(glassCannon.offensive.cr, 2);
  assert.equal(glassCannon.cr, 0.5);
});

test("a monster with nothing going for it rates at the bottom of the ladder", () => {
  const tiny = deriveCr(block({ maxHp: 10, ac: 13, attacks: [], cr: 0 }));
  assert.ok(tiny.cr <= 0.25, `expected a scrap of a monster, got CR ${tiny.cr}`);
});

test("a monster between two ratings is priced as the harder one", () => {
  // Rows 4 and 5 (CR 1 and CR 2) average to 4.5, which rounds up to CR 2.
  // A fight that turns out easier than the budget said disappoints; one that
  // turns out harder kills somebody.
  const between = deriveCr(
    block({
      maxHp: 80, // the CR 1 hit point band
      ac: 13,
      attacks: [{ name: "Slam", toHit: 3, damage: "2d10+5", type: "bludgeoning" }],
      attacksPerTurn: 1, // 16 a round, the CR 2 damage band
      cr: 1,
    }),
  );
  assert.equal(between.defensive.cr, 1);
  assert.equal(between.offensive.cr, 2);
  assert.equal(between.cr, 2);
});

// ---- damage per round ----

test("the routine is read the way the engine runs it: the best attack, swung", () => {
  const output = damagePerRound(
    block({
      attacks: [
        { name: "Claw", toHit: 5, damage: "1d6+3", type: "slashing" },
        { name: "Bite", toHit: 5, damage: "2d8+3", type: "piercing" },
      ],
      attacksPerTurn: 2,
    }),
  );
  assert.equal(output.attackName, "Bite");
  assert.equal(output.swings, 2);
  assert.equal(output.perSwing, 12);
  assert.equal(output.perRound, 24);
});

test("a multiattack past three swings is clipped, because the engine clips it", () => {
  const output = damagePerRound(block({ attacksPerTurn: 7 }));
  assert.equal(output.swings, 3);
  assert.ok(output.notes.some((note) => /three swings/.test(note)));
});

test("spellcasters and breath weapons announce what the number is missing", () => {
  const caster = damagePerRound(
    block({ traits: ["Spellcasting: the mage is a 9th-level spellcaster."] }),
  );
  assert.ok(caster.notes.some((note) => /casts spells/.test(note)));

  const dragon = damagePerRound(
    block({ traits: ["Fire Breath (Recharge 5-6): DC 17 Dex save, 12d6 fire, half on success"] }),
  );
  assert.ok(dragon.notes.some((note) => /dice in the traits/.test(note)));
});

test("damage added by hand counts, and silences the warning it answers", () => {
  const withBreath = damagePerRound(
    block({
      attacks: [{ name: "Bite", toHit: 7, damage: "2d10+5", type: "piercing" }],
      traits: ["Fire Breath: 12d6 fire"],
    }),
    18,
  );
  assert.equal(withBreath.extra, 18);
  assert.equal(withBreath.perRound, 16 + 18);
  assert.deepEqual(withBreath.notes, []);
});

test("a monster with no attacks says so rather than rating itself at zero quietly", () => {
  const output = damagePerRound(block({ attacks: [] }));
  assert.equal(output.perRound, 0);
  assert.ok(output.notes.some((note) => /rests on nothing/.test(note)));
});

// ---- effective hit points ----

test("fewer than three common resistances is situational and moves nothing", () => {
  const two = effectiveHp(block({ resist: "fire, cold" }), 5);
  assert.equal(two.multiplier, 1);
  assert.equal(two.hp, 20);
});

test("three common resistances are worth hit points, and less of them higher up", () => {
  const stats = block({ maxHp: 100, resist: "bludgeoning, piercing, slashing" });
  assert.equal(effectiveHp(stats, 3).hp, 200);
  assert.equal(effectiveHp(stats, 8).hp, 150);
  assert.equal(effectiveHp(stats, 14).hp, 125);
  // By high level the party is dealing damage it cannot resist anyway.
  assert.equal(effectiveHp(stats, 20).hp, 100);
});

test("immunity is worth more than resistance at the same rating", () => {
  const resistant = effectiveHp(block({ maxHp: 100, resist: "fire, cold, acid" }), 8);
  const immune = effectiveHp(block({ maxHp: 100, immune: "fire, cold, acid" }), 8);
  assert.ok(immune.hp > resistant.hp);
});

test("countCommonTypes ignores the exotic types nobody deals", () => {
  assert.equal(countCommonTypes("psychic"), 0);
  assert.equal(countCommonTypes("bludgeoning, piercing, and slashing from nonmagical attacks"), 3);
});

test("resistances are priced against the rating the monster ends up at", () => {
  // A tough, resistant monster: the first pass prices it with raw hit points
  // only to learn which band the multiplier belongs in, then re-derives. A
  // single-pass version would use the CR written on the block, which for a
  // monster somebody is still building is whatever they last typed.
  const stats = block({
    maxHp: 200,
    ac: 18,
    resist: "bludgeoning, piercing, slashing",
    attacks: [{ name: "Slam", toHit: 9, damage: "3d10+6", type: "bludgeoning" }],
    attacksPerTurn: 2,
    // Deliberately a lie: the block claims CR 1.
    cr: 1,
  });
  const derived = deriveCr(stats);
  assert.ok(derived.cr >= 9, `expected a real threat, got CR ${derived.cr}`);
  // The multiplier chosen is the one for where it LANDED, not for CR 1.
  assert.ok(derived.effectiveHp.multiplier < 2, "priced the resistance as if it were CR 1");
});

// ---- the whole thing ----

test("deriveCr reports its parts and its drift from the stated rating", () => {
  const derived = deriveCr(block({ maxHp: 140, ac: 15, cr: 5 }));
  assert.equal(derived.statedCr, 5);
  assert.ok(derived.parts.length >= 4);
  assert.ok(derived.parts.some((part) => part.label === "The average"));
  assert.equal(typeof derived.drift, "number");
});

test("XP always matches the derived rating, never the stated one", () => {
  const derived = deriveCr(block({ maxHp: 140, ac: 15, cr: 1 }));
  assert.notEqual(derived.cr, 1);
  assert.equal(derived.xp, xpForCr(derived.cr));
});

test("the synthesized baselines rate near the rating they were built for", () => {
  // synthesizeStats goes CR to stats; this goes back. They will not agree
  // exactly (the baseline is deliberately a little soft), but a baseline
  // that rated three ratings away from its own input would mean one of the
  // two modules is wrong about what a CR is.
  for (const cr of [1, 3, 5, 8, 12, 16, 20]) {
    const derived = deriveCr(synthesizeStats(cr));
    assert.ok(
      Math.abs(derived.drift) <= 3,
      `CR ${cr} baseline derived as CR ${derived.cr}, ${derived.drift} rows away`,
    );
  }
});

// ---- against published monsters ----

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const contentDbPath = path.resolve(scriptsDir, "../data/content/open5e.sqlite");

if (fs.existsSync(contentDbPath)) {
  const { default: Database } = await import("better-sqlite3-multiple-ciphers");
  const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
  const db = new Database(contentDbPath, { readonly: true });
  const rows = db
    .prepare(`SELECT name, cr, data_json FROM monsters WHERE document_slug LIKE '%srd%'`)
    .all();

  test("published monsters land within one rating most of the time", () => {
    let scored = 0;
    let within = 0;
    for (const row of rows) {
      const stats = parseMonster(JSON.parse(row.data_json), row.cr);
      if (!stats.attacks.length) {
        continue;
      }
      scored += 1;
      if (Math.abs(deriveCr(stats).drift) <= 1) {
        within += 1;
      }
    }
    assert.ok(scored > 200, `only ${scored} monsters to check against`);
    const rate = within / scored;
    // Measured at 79% when this was written. The floor is set below that
    // rather than at it, so an honest improvement to statblock parsing does
    // not have to come with a test edit, but a regression does.
    assert.ok(rate > 0.7, `only ${(rate * 100).toFixed(1)}% within one rating`);
  });

  test("the misses are the ones the module warns about", () => {
    // The method's known blind spot is damage that is not in the attack
    // list. If the monsters it gets badly wrong were NOT disproportionately
    // spellcasters and breath weapons, the blind spot would be something
    // else and the warnings would be pointing at the wrong thing.
    let badWithNotes = 0;
    let badTotal = 0;
    for (const row of rows) {
      const stats = parseMonster(JSON.parse(row.data_json), row.cr);
      if (!stats.attacks.length) {
        continue;
      }
      const derived = deriveCr(stats);
      // Only under-rating counts: that is what uncounted damage causes.
      if (derived.drift <= -3) {
        badTotal += 1;
        if (derived.notes.length) {
          badWithNotes += 1;
        }
      }
    }
    assert.ok(badTotal > 5, "not enough badly-rated monsters to draw a conclusion from");
    // Measured at 87%. The handful that get through are monsters whose extra
    // damage is in a LEGENDARY action, which EnemyStats does not carry and
    // the engine does not run, so the low rating is the right answer for
    // this table even though it disagrees with the book.
    assert.ok(
      badWithNotes / badTotal > 0.75,
      `only ${badWithNotes} of ${badTotal} badly-rated monsters carry a warning`,
    );
  });

  db.close();
} else {
  test("published monsters skipped: no content pack installed", () => {
    assert.ok(true);
  });
}

console.log(`derive cr: ${passed} assertions passed.`);
