// A companion leaving the party and its return (issue 503 Phases 2 and 3),
// the pure half: the response a companion at its breaking point makes, from
// who it is, what it holds to and the odds; the odds themselves (the
// companion rated as a foe for the party, shifted by how whole each side
// is); the rating's two adjustments; when a held plan finds its opening;
// the return's allies, budgeted under the table's ceiling; parley or fight;
// the rumours; and the record.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const logic = await import("../src/lib/dm/departure-logic.ts");
const wear = await import("../src/lib/dm/return-wear-logic.ts");
const { evaluateEncounter, encounterCeiling } = await import("../src/lib/srd/encounter-math.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const axes = (overrides = {}) => ({ drive: 0, diligence: 0, boldness: 0, warmth: 0, empathy: 0, composure: 0, ...overrides });
const held = (value, strength = "cares", faction = "") => ({ value, strength, faction });
const choose = (personality, odds, setting = "turn", values = [], canReport = false) =>
  logic.chooseResponse({ personality: axes(personality), values, odds, setting, canReport });

// ---- the response ----

test("bold and rash confronts whatever the odds; a table that never fights walks it out loudly", () => {
  for (const odds of ["against", "even", "good"]) {
    assert.equal(choose({ boldness: 3, composure: -1 }, odds), "confront", odds);
    assert.equal(choose({ boldness: 3, composure: -1 }, odds, "leave"), "walk_out", odds);
  }
});

test("the timid walk out at once", () => {
  assert.equal(choose({ boldness: -2 }, "good"), "walk_out");
  assert.equal(choose({ boldness: -1, composure: 3 }, "against"), "walk_out", "fear beats patience");
});

test("the composed and outmatched slip away; with the odds on their side they bide and strike, at Turn only", () => {
  assert.equal(choose({ composure: 2 }, "against"), "slip_away");
  assert.equal(choose({ composure: 2 }, "even"), "slip_away");
  assert.equal(choose({ composure: 2 }, "good"), "bide_strike");
  assert.equal(choose({ composure: 2 }, "good", "leave"), "slip_away");
});

test("the dutiful with a faction to answer to report the party, and only when there is one", () => {
  const law = [held("respects_law", "red_line")];
  assert.equal(choose({ diligence: 3 }, "against", "leave", law, true), "report");
  assert.equal(choose({ diligence: 3 }, "against", "leave", [held("faction_loyalty", "cares", "Silver Order")], true), "report");
  assert.equal(choose({ diligence: 3 }, "against", "leave", law, false), "walk_out", "nobody to tell");
  assert.equal(choose({ diligence: 3 }, "against", "leave", [held("protects_innocent")], true), "walk_out", "no duty to a faction");
  assert.equal(choose({ diligence: 3, boldness: 3, composure: -2 }, "against", "turn", law, true), "confront", "rashness comes first");
});

test("values move the choice: ruthless is the readier to fight, a mercenary never fights a battle it is not sure of", () => {
  assert.equal(choose({ boldness: 1, composure: 0 }, "against", "turn", [held("ruthless")]), "confront", "ruthless and bold enough");
  assert.equal(choose({ boldness: 1, composure: 0 }, "against", "turn"), "walk_out");
  assert.equal(choose({ boldness: 3, composure: -1 }, "against", "turn", [held("mercenary")]), "walk_out");
  assert.equal(choose({ boldness: 3, composure: -1 }, "good", "turn", [held("mercenary")]), "confront", "a sure thing");
});

test("a middling nature fights only a fight it can win, and only where companions may turn", () => {
  assert.equal(choose({ boldness: 1 }, "good"), "confront");
  assert.equal(choose({ boldness: 1 }, "good", "leave"), "walk_out");
  assert.equal(choose({}, "even"), "walk_out");
  assert.equal(logic.chooseResponse({ personality: null, values: [], odds: "against", setting: "turn", canReport: false }), "walk_out");
});

test("which responses wait for an opening, and which set the companion against the party", () => {
  assert.deepEqual(logic.DEPARTURE_RESPONSES.filter(logic.waitsForOpening), ["slip_away", "bide_strike"]);
  assert.deepEqual(logic.DEPARTURE_RESPONSES.filter(logic.turnsOnParty), ["confront", "bide_strike"]);
  assert.equal(logic.allowedResponse("report", "leave"), "report");
});

// ---- the odds ----

test("a companion alone against a full party is outmatched; against one character of its level, the odds are its own", () => {
  const four = logic.readOdds([5, 5, 5, 5], 4, 1, 1);
  assert.equal(four.odds, "against", four.verdict);
  const solo = logic.readOdds([5], 4, 1, 1);
  assert.equal(solo.odds, "good", solo.verdict);
  assert.equal(solo.adjustedXp, evaluateEncounter([5], [4]).adjustedXp, "the encounter math, unshifted at full strength");
});

test("hurt and spent, a party is a weaker one: the shift turns the odds", () => {
  const whole = logic.readOdds([5, 5, 5], 5, 1, 1);
  const hurt = logic.readOdds(
    [5, 5, 5],
    5,
    logic.sideFitness([
      { hp: 8, maxHp: 40, slotsLeft: 0, slotsMax: 0 },
      { hp: 10, maxHp: 36, slotsLeft: 0, slotsMax: 4 },
      { hp: 6, maxHp: 30, slotsLeft: 1, slotsMax: 6 },
    ]),
    1,
  );
  assert.ok(hurt.shiftedXp > whole.shiftedXp);
  assert.notEqual(whole.odds, "good");
  assert.equal(hurt.odds, "good");
  const spentCompanion = logic.readOdds([5], 4, 1, 0.3);
  assert.notEqual(spentCompanion.odds, "good", "a hurt companion reads its own odds as worse");
});

test("fitness counts hit points, and for a caster its slots beside them; never below a tenth", () => {
  assert.equal(logic.memberFitness({ hp: 20, maxHp: 40, slotsLeft: 0, slotsMax: 0 }), 0.5);
  assert.equal(logic.memberFitness({ hp: 40, maxHp: 40, slotsLeft: 0, slotsMax: 4 }), 0.6);
  assert.equal(logic.sideFitness([]), 1);
  assert.equal(logic.sideFitness([{ hp: 0, maxHp: 40, slotsLeft: 0, slotsMax: 0 }]), 0.1);
  assert.equal(logic.verdictFor(0, { easy: 100, medium: 200, hard: 300, deadly: 400 }), "trivial");
  assert.equal(logic.verdictFor(650, { easy: 100, medium: 200, hard: 300, deadly: 400 }), "beyond_deadly");
});

// ---- the rating's adjustments ----

test("the support handicap: a step for a healer from 5 and two from 11, one for a paladin's aura from 6, never summed", () => {
  assert.equal(logic.supportHandicap({ cleric: 4 }), 0);
  assert.equal(logic.supportHandicap({ cleric: 5 }), 1);
  assert.equal(logic.supportHandicap({ druid: 11 }), 2);
  assert.equal(logic.supportHandicap({ bard: 12 }), 2);
  assert.equal(logic.supportHandicap({ paladin: 5 }), 0);
  assert.equal(logic.supportHandicap({ paladin: 6 }), 1);
  assert.equal(logic.supportHandicap({ fighter: 20 }), 0);
  assert.equal(logic.supportHandicap({ paladin: 6, cleric: 11 }), 2);
});

test("a rating steps along the table's rows", () => {
  assert.equal(logic.stepCr(0.125, 1), 0.25);
  assert.equal(logic.stepCr(0.5, 1), 1);
  assert.equal(logic.stepCr(4, 2), 6);
  assert.equal(logic.stepCr(30, 1), 30);
  assert.equal(logic.stepCr(0, -1), 0);
});

// ---- openings ----

test("slipping away goes at any opening; biding to strike waits for the odds", () => {
  assert.equal(logic.opensAt("slip_away", "against"), true);
  assert.equal(logic.opensAt("bide_strike", "even"), false);
  assert.equal(logic.opensAt("bide_strike", "good"), true);
});

test("what the table sees of a departure never names the plan it held", () => {
  assert.equal(logic.departureHow("slip_away", "fight"), "Broke off from the fight and fled the field");
  assert.equal(logic.departureHow("slip_away", "night"), "Slipped away in the night");
  assert.equal(logic.departureHow("report", "scene", "the Watch"), "Left to report the party to the Watch");
  for (const response of logic.DEPARTURE_RESPONSES) {
    for (const where of ["fight", "night", "scene"]) {
      assert.doesNotMatch(logic.departureHow(response, where), /means to|plan/);
    }
  }
});

// ---- the return ----

const allies = [
  { slug: "knight", name: "Knight", cr: 3 },
  { slug: "priest", name: "Priest", cr: 2 },
  { slug: "guard", name: "Guard", cr: 0.125 },
];

test("allies are budgeted to hard, or deadly for one who hates the party, and never past the ceiling", () => {
  for (const [levels, cr, hostile, difficulty] of [
    [[5, 5, 5, 5], 5, false, "normal"],
    [[5, 5, 5, 5], 5, true, "normal"],
    [[3], 3, true, "easy"],
    [[10, 10, 10], 9, true, "hard"],
  ]) {
    const plan = logic.planReturn({ partyLevels: levels, difficulty, companionCr: cr, hostile, candidates: allies });
    const thresholds = evaluateEncounter(levels, [cr]).thresholds;
    const ceiling = encounterCeiling(difficulty, thresholds.deadly);
    assert.equal(plan.ceiling, ceiling);
    const alone = evaluateEncounter(levels, [cr]).adjustedXp;
    if (alone > ceiling) {
      assert.deepEqual(plan.allies, [], "already past the ceiling alone: no allies");
      assert.equal(plan.standoff, true, "with no wear to try, no fight can be staged");
      assert.equal(plan.wear, null);
      continue;
    }
    assert.equal(plan.wear, null, "inside the ceiling whole: it comes unworn");
    assert.ok(plan.adjustedXp <= ceiling, `${plan.adjustedXp} within ${ceiling}`);
    assert.equal(plan.target, hostile ? "deadly" : "hard");
    const crs = [cr, ...plan.allies.flatMap((ally) => new Array(ally.count).fill(ally.cr))];
    assert.equal(evaluateEncounter(levels, crs).adjustedXp, plan.adjustedXp, "the plan's own number is the engine's");
    assert.ok(crs.length <= 8, "start_encounter takes eight at most");
    if (!hostile && plan.allies.length) {
      assert.ok(plan.adjustedXp < thresholds.deadly, "a hard return stays under deadly");
    }
  }
  const four = logic.planReturn({ partyLevels: [5, 5, 5, 5], difficulty: "normal", companionCr: 5, hostile: true, candidates: allies });
  assert.ok(["deadly", "hard"].includes(four.verdict), four.verdict);
  assert.ok(four.allies.length > 0, "a companion alone is no match for four: it brings help");
});

// ---- coming back worn ----

test("a wear takes the highest slot left, then a tenth of the hit points, in turn, and never below half", () => {
  assert.equal(wear.WORN_HP_FLOOR, 0.5);
  const steps = wear.wearSteps(40, [{ key: "1", level: 1, count: 2 }, { key: "2", level: 2, count: 1 }]);
  assert.deepEqual(steps[0], { hpLost: 0, slotsSpent: { 2: 1 } }, "the highest slot goes first");
  assert.deepEqual(steps[1], { hpLost: 4, slotsSpent: { 2: 1 } });
  assert.deepEqual(steps[2], { hpLost: 4, slotsSpent: { 2: 1, 1: 1 } });
  const last = steps.at(-1);
  assert.equal(last.hpLost, 20, "the floor: half of 40");
  assert.deepEqual(last.slotsSpent, { 1: 2, 2: 1 }, "every levelled slot spent at the floor");
  assert.ok(steps.every((step, index) => index === 0 || step.hpLost >= steps[index - 1].hpLost), "each step at least the last");
  assert.ok(steps.every((step) => step.hpLost <= 20));
  assert.equal(wear.maxHpLost(41), 20, "half rounds up what stays");
  const fighter = wear.wearSteps(30, []);
  assert.deepEqual(fighter.map((step) => step.hpLost), [3, 6, 9, 12, 15], "no slots: hit points alone, to the floor");
  assert.equal(wear.slotsSpentCount(last), 3);
  assert.equal(wear.wearWords(40, last), "20 of 40 hit points, 3 spell slots spent");
});

test("past the ceiling whole, it comes alone and worn: the gentlest wear that fits, deadly at most, hard for one who does not hate them", () => {
  const steps = wear.wearSteps(40, []);
  // A rating that falls a row each step: CR 5, 4, 3, 2, 1, 1/2.
  const rateWorn = (worn) => [5, 4, 3, 2, 1, 0.5][Math.round(worn.hpLost / 4)] ?? 0.5;
  for (const [difficulty, hostile] of [["normal", true], ["easy", true], ["hard", true], ["normal", false]]) {
    const plan = logic.planReturn({ partyLevels: [5], difficulty, companionCr: 5, hostile, candidates: allies, wearSteps: steps, rateWorn });
    const thresholds = evaluateEncounter([5], [5]).thresholds;
    const ceiling = encounterCeiling(difficulty, thresholds.deadly);
    assert.ok(evaluateEncounter([5], [5]).adjustedXp > ceiling, "a solo character's equal is past the ceiling whole");
    assert.equal(plan.standoff, false, difficulty);
    assert.deepEqual(plan.allies, [], "worn, it comes alone");
    assert.ok(plan.wear, `${difficulty}: worn`);
    assert.equal(plan.wornCr, rateWorn(plan.wear));
    assert.equal(evaluateEncounter([5], [plan.wornCr]).adjustedXp, plan.adjustedXp, "the plan's own number is the engine's");
    assert.ok(plan.adjustedXp <= ceiling, `${difficulty}: inside the ceiling`);
    if (hostile) {
      assert.ok(plan.adjustedXp <= Math.round(thresholds.deadly * 1.5), "deadly at most");
    } else {
      assert.ok(plan.adjustedXp < thresholds.deadly, "hard for one who does not hate them");
    }
    const gentler = steps[steps.indexOf(plan.wear) - 1];
    if (gentler) {
      const cap = hostile ? Math.min(ceiling, Math.round(thresholds.deadly * 1.5)) : thresholds.deadly - 1;
      assert.ok(evaluateEncounter([5], [rateWorn(gentler)]).adjustedXp > cap, "no gentler wear would have done");
    }
  }
  const tooStrong = logic.planReturn({ partyLevels: [1], difficulty: "easy", companionCr: 5, hostile: true, candidates: allies, wearSteps: steps, rateWorn });
  assert.equal(tooStrong.standoff, true, "past the ceiling even at the floor: a standoff");
  assert.equal(tooStrong.wear, null);
});

test("why they are worn, in words, follows what they hold to; the record keeps the wear", () => {
  assert.match(wear.wornReason([held("mercenary")], false), /paid for allies/);
  assert.match(wear.wornReason([held("ruthless")], true), /old wound/);
  assert.match(wear.wornReason([held("protects_innocent")], true), /hard road .* magic/);
  assert.deepEqual(wear.parseWear({ hpLost: 7, slotsSpent: { 3: 1, pact: 2, nope: 4 } }), { hpLost: 7, slotsSpent: { 3: 1, pact: 2 } });
  assert.equal(wear.parseWear({ hpLost: 0, slotsSpent: {} }), null, "an empty wear is no wear");
  const record = logic.parseDeparture(JSON.stringify({ intent: null, gone: { response: "walk_out", cued: "fight", wear: { hpLost: 9, slotsSpent: { 1: 1 } }, wornBy: "a hard road" } }));
  assert.deepEqual(record.gone.wear, { hpLost: 9, slotsSpent: { 1: 1 } });
  assert.equal(record.gone.wornBy, "a hard road");
});

test("who comes back with them follows what they hold to", () => {
  assert.equal(logic.allyPreferences([held("protects_innocent", "red_line")], false)[0], "knight");
  assert.equal(logic.allyPreferences([held("mercenary")], false)[0], "bandit-captain");
  assert.equal(logic.allyPreferences([held("mercenary")], true)[0], "knight", "the faction they told sends its soldiers");
  assert.ok(logic.allyPreferences([], false).length > 0);
});

test("a companion whose standing has climbed back comes to parley; one still disliked, or set against them, to fight", () => {
  assert.equal(logic.returnKind(-24, true), "parley");
  assert.equal(logic.returnKind(10, false), "parley");
  assert.equal(logic.returnKind(-25, false), "fight");
  assert.equal(logic.returnKind(null, true), "fight");
  assert.equal(logic.returnKind(null, false), "parley");
});

test("the goal's rumours grow as it goes, and a driven companion needs fewer rounds", () => {
  assert.match(logic.rumourFor("Seren", 0, 3, false), /asking questions about the party/);
  assert.match(logic.rumourFor("Seren", 1, 3, false), /seeking out old allies/);
  assert.match(logic.rumourFor("Seren", 2, 3, false), /armed companions/);
  assert.match(logic.rumourFor("Seren", 3, 3, true), /gathered allies and is coming for the party/);
  assert.equal(logic.avengeTarget(axes({ drive: 2 })), 2);
  assert.equal(logic.avengeTarget(axes()), 3);
  assert.match(logic.avengeGoal("Seren"), /bring down the party Seren left/);
});

// ---- the record ----

test("the record reads back what was written, and anything else as nothing", () => {
  const record = {
    intent: { response: "slip_away", at: 600, cause: "torture by Kael" },
    gone: null,
  };
  assert.deepEqual(logic.parseDeparture(JSON.stringify(record)), record);
  const gone = logic.parseDeparture(JSON.stringify({ intent: null, gone: { response: "report", how: "Left to report the party to the Watch", at: 10, reportedTo: "the Watch", hostile: false, leftLevel: 5, xpSince: 900, avenging: true, rumours: 2, cued: "fight", standoff: false, templateId: "t", eventId: "e", returned: false } }));
  assert.equal(gone.gone.xpSince, 900);
  assert.equal(gone.gone.cued, "fight");
  assert.deepEqual(logic.parseDeparture(""), logic.NO_DEPARTURE);
  assert.deepEqual(logic.parseDeparture("{nope"), logic.NO_DEPARTURE);
  assert.deepEqual(logic.parseDeparture(JSON.stringify({ intent: { response: "confront" }, gone: { response: "fly" } })), logic.NO_DEPARTURE, "a plan is only one that waits, a response only one of the five");
});

console.log(`test-departure: ${passed} passed`);
