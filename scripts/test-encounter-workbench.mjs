// The encounter workbench. The XP half is the DMG budget the engine already
// enforces, so what is worth asserting there is that the workbench agrees
// with it. The attrition half is new, and what matters about it is that it
// is honest: it counts misses, it counts the optional crit rules, it prices
// resistances the same way the CR derivation does, and it says out loud
// what it left out.
// See docs/workshop-plan.md phase 6.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { PARTY_BASELINE, baselineFor, workbench } = await import(
  "../src/lib/dm/encounter-workbench.ts"
);
const { evaluateEncounter, thresholdsForParty, xpForCr } = await import(
  "../src/lib/srd/encounter-math.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function monster(overrides = {}) {
  return {
    ac: 13,
    maxHp: 30,
    dexMod: 1,
    speed: "30",
    attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", type: "slashing" }],
    traits: [],
    resist: "",
    immune: "",
    vulnerable: "",
    conditionImmune: "",
    cr: 1,
    xp: 200,
    attacksPerTurn: 1,
    ...overrides,
  };
}

const party = [3, 3, 3, 3];
const goblins = [{ name: "Goblin", count: 4, stats: monster({ cr: 0.25, maxHp: 7 }) }];

// ---- the baseline ----

test("the party baseline covers every level with a rollable attack", () => {
  assert.equal(PARTY_BASELINE.length, 20);
  for (const row of PARTY_BASELINE) {
    assert.ok(row.hp > 0 && row.ac > 0 && row.attacks >= 1);
    assert.match(row.damage, /^\d+d\d+\+\d+$/);
  }
});

test("the baseline gets stronger with level and clamps outside 1 to 20", () => {
  for (let level = 2; level <= 20; level += 1) {
    assert.ok(
      baselineFor(level).hp > baselineFor(level - 1).hp,
      `level ${level} is not tougher than ${level - 1}`,
    );
  }
  assert.equal(baselineFor(0).hp, baselineFor(1).hp);
  assert.equal(baselineFor(99).hp, baselineFor(20).hp);
});

// ---- the budget ----

test("the budget agrees with the engine's own encounter maths", () => {
  const readout = workbench({ partyLevels: party, roster: goblins });
  const engine = evaluateEncounter(party, [0.25, 0.25, 0.25, 0.25]);
  assert.equal(readout.budget.totalXp, engine.totalXp);
  assert.equal(readout.budget.adjustedXp, engine.adjustedXp);
  assert.equal(readout.budget.verdict, engine.verdict);
  assert.deepEqual(readout.budget.thresholds, thresholdsForParty(party));
});

test("counts are per body, not per roster line", () => {
  const readout = workbench({ partyLevels: party, roster: goblins });
  assert.equal(readout.budget.monsterCount, 4);
  assert.equal(readout.budget.totalXp, 4 * xpForCr(0.25));
});

test("the multiplier explains itself, including the party size shift", () => {
  const small = workbench({ partyLevels: [3, 3], roster: goblins });
  const large = workbench({ partyLevels: [3, 3, 3, 3, 3, 3], roster: goblins });
  assert.ok(small.budget.multiplier > large.budget.multiplier);
  const smallPart = small.budget.parts.find((part) => part.label === "Group multiplier");
  assert.match(smallPart.detail, /one band harder/);
  const largePart = large.budget.parts.find((part) => part.label === "Group multiplier");
  assert.match(largePart.detail, /one band easier/);
});

test("the raw XP line names every monster and what it cost", () => {
  const readout = workbench({
    partyLevels: party,
    roster: [
      { name: "Goblin", count: 4, stats: monster({ cr: 0.25 }) },
      { name: "Hobgoblin", count: 1, stats: monster({ cr: 0.5 }) },
    ],
  });
  const raw = readout.budget.parts.find((part) => part.label === "Raw XP");
  assert.match(raw.detail, /4 x Goblin at CR 1\/4/);
  assert.match(raw.detail, /1 x Hobgoblin at CR 1\/2/);
});

test("a roster past the campaign ceiling is flagged rather than merely rated", () => {
  const readout = workbench({
    partyLevels: [1, 1],
    roster: [{ name: "Ogre", count: 4, stats: monster({ cr: 2 }) }],
    ceiling: 100,
  });
  assert.equal(readout.budget.overCeiling, true);
});

// ---- attrition ----

test("both sides get hit points, output and a number of rounds", () => {
  const readout = workbench({ partyLevels: party, roster: goblins });
  const { attrition } = readout;
  assert.ok(attrition.party.damagePerRound > 0);
  assert.ok(attrition.monsters.damagePerRound > 0);
  assert.ok(attrition.party.rounds >= 1);
  assert.ok(attrition.monsters.rounds >= 1);
  assert.match(attrition.outcome, /round/);
});

test("misses are counted: a swing never lands for its full average", () => {
  // Four level 3 characters swinging 2d6+5 (average 12) at one target would
  // be 48 a round if everything hit. Against AC 13 with a +5 attack it is
  // markedly less, and a workbench that printed 48 would be lying.
  const readout = workbench({
    partyLevels: party,
    roster: [{ name: "Target", count: 1, stats: monster({ ac: 13 }) }],
  });
  assert.ok(
    readout.attrition.party.damagePerRound < 48,
    "the party's output ignores its own miss chance",
  );
  assert.ok(readout.attrition.party.damagePerRound > 20);
});

test("tougher armour on the roster slows the party down", () => {
  const soft = workbench({
    partyLevels: party,
    roster: [{ name: "Soft", count: 1, stats: monster({ ac: 10 }) }],
  });
  const hard = workbench({
    partyLevels: party,
    roster: [{ name: "Hard", count: 1, stats: monster({ ac: 20 }) }],
  });
  assert.ok(hard.attrition.party.damagePerRound < soft.attrition.party.damagePerRound);
});

test("the optional crit rules move the numbers", () => {
  // powerfulCritical maximizes the extra crit dice, so both sides hit harder.
  // If this did not move, the workbench would be describing a different
  // table from the one the fight will happen at.
  const plain = workbench({ partyLevels: party, roster: goblins });
  const brutal = workbench({
    partyLevels: party,
    roster: goblins,
    variantRules: { powerfulCritical: true },
  });
  assert.ok(brutal.attrition.party.damagePerRound > plain.attrition.party.damagePerRound);
  assert.ok(brutal.attrition.monsters.damagePerRound > plain.attrition.monsters.damagePerRound);
});

test("resistances are priced the way the CR derivation prices them", () => {
  const plain = workbench({
    partyLevels: party,
    roster: [{ name: "Plain", count: 1, stats: monster({ maxHp: 100, cr: 3 }) }],
  });
  const tough = workbench({
    partyLevels: party,
    roster: [
      {
        name: "Tough",
        count: 1,
        stats: monster({ maxHp: 100, cr: 3, resist: "bludgeoning, piercing, slashing" }),
      },
    ],
  });
  assert.equal(plain.attrition.monsters.hitPoints, 100);
  assert.equal(tough.attrition.monsters.hitPoints, 200);
  assert.ok(tough.attrition.party.rounds > plain.attrition.party.rounds);
  const line = tough.attrition.monsters.parts.find((part) => part.label === "Roster hit points");
  assert.match(line.detail, /shrugs off/);
});

test("a monster with no attack is reported, not silently ignored", () => {
  const readout = workbench({
    partyLevels: party,
    roster: [{ name: "Statue", count: 1, stats: monster({ attacks: [] }) }],
  });
  assert.ok(readout.attrition.warnings.some((warning) => /no attacks/.test(warning)));
  assert.equal(readout.attrition.monsters.damagePerRound, 0);
  // Nothing getting through reads as null rather than as infinity.
  assert.equal(readout.attrition.monsters.rounds, null);
  assert.match(readout.attrition.outcome, /takes nothing back/);
});

test("uncounted trait damage is admitted", () => {
  const readout = workbench({
    partyLevels: party,
    roster: [
      {
        name: "Dragon",
        count: 1,
        stats: monster({ traits: ["Fire Breath: 12d6 fire in a 60-foot line"] }),
      },
    ],
  });
  assert.ok(
    readout.attrition.warnings.some((warning) => /hits harder than the number says/.test(warning)),
  );
});

test("the standing assumptions are stated, not buried", () => {
  // Nobody heals, nobody runs, everybody concentrates fire. That is why a
  // real fight of this shape usually goes better for the party than the
  // number does, and it belongs on the screen rather than in a comment.
  const readout = workbench({ partyLevels: party, roster: goblins });
  assert.ok(readout.attrition.warnings.some((warning) => /nobody healing/.test(warning)));
});

test("a fight the party cannot win says so instead of printing a round count", () => {
  const readout = workbench({
    partyLevels: [1, 1],
    roster: [
      { name: "Wall", count: 1, stats: monster({ ac: 30, maxHp: 500, cr: 20 }) },
    ],
  });
  // AC 30 against a +5 attack still hits on a natural 20, so the party is
  // not literally shut out; what matters is that the roster wins.
  assert.match(readout.attrition.outcome, /drops the party first/);
});

test("a one-round fight is called out as not being a fight", () => {
  const readout = workbench({
    partyLevels: [20, 20, 20, 20],
    roster: [{ name: "Rat", count: 1, stats: monster({ maxHp: 4, ac: 10, cr: 0 }) }],
  });
  assert.ok(readout.attrition.warnings.some((warning) => /not a fight/.test(warning)));
});

console.log(`encounter workbench: ${passed} assertions passed.`);
