// The relationship engine: the approval meter and its derived friendship
// tiers, personality-modulated beats (the same deed landing differently on
// different people), the romance ladder gated behind actually being liked,
// diminishing returns, the bond backfill conversion, absence, and the
// bounded roster line.
import assert from "node:assert/strict";
import {
  APPROVAL_MAX,
  APPROVAL_MIN,
  addFlag,
  addMemory,
  applyApproval,
  approvalFromBond,
  approvalRollModifier,
  beatAlignment,
  beatDc,
  beatDelta,
  beatOutcome,
  beatSpec,
  bumpBeatCount,
  canAdvanceRomance,
  consentCheck,
  decayBeatCounts,
  demoteRomance,
  friendshipTier,
  FRIENDSHIP_TIERS,
  longingNote,
  MEMORY_LIMIT,
  nextRomanceStage,
  parseBeatCounts,
  parseFlags,
  parseMemories,
  parseRomance,
  parseStatus,
  REAPPEAR_AFTER,
  relationshipFragment,
  RELATIONSHIP_BEAT_NAMES,
  ROMANCE_MIN_TIER,
  ROMANCE_STAGES,
  ROMANCE_THRESHOLD,
  souredNote,
  tierIndex,
} from "../src/lib/dm/relationship-logic.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const blank = { approval: 0, repeats: 0, personality: null, hostile: false };
// A kind, cautious healer and a callous, bold mercenary.
const healer = { drive: 0, diligence: 1, boldness: -2, warmth: 2, empathy: 3, composure: 0 };
const mercenary = { drive: 2, diligence: -1, boldness: 3, warmth: -2, empathy: -3, composure: 1 };

test("parsers tolerate empty and garbage", () => {
  assert.equal(parseRomance(""), "none");
  assert.equal(parseRomance("married"), "married");
  assert.equal(parseRomance("smooching"), "none");
  assert.equal(parseStatus("parted"), "parted");
  assert.equal(parseStatus(null), "active");
  assert.deepEqual(parseBeatCounts("not json"), {});
  assert.deepEqual(parseMemories("[]"), []);
  assert.deepEqual(parseFlags("{}"), []);
});

test("beat counts drop unknown beats and clamp", () => {
  const counts = parseBeatCounts(JSON.stringify({ mercy: 3, nonsense: 4, gift: 0, insult: 99 }));
  assert.deepEqual(counts, { mercy: 3, insult: 9 });
});

test("every listed beat has a spec, and unknown ones resolve to null", () => {
  for (const name of RELATIONSHIP_BEAT_NAMES) {
    assert.ok(beatSpec(name), `no spec for ${name}`);
  }
  assert.equal(beatSpec("buy_them_a_horse"), null);
});

test("tiers are derived from the meter and never disagree with it", () => {
  assert.equal(friendshipTier(APPROVAL_MIN), "hostile");
  assert.equal(friendshipTier(-60), "hostile");
  assert.equal(friendshipTier(-59), "disliked");
  assert.equal(friendshipTier(-24), "wary");
  assert.equal(friendshipTier(-9), "neutral");
  assert.equal(friendshipTier(0), "neutral");
  assert.equal(friendshipTier(10), "cordial");
  assert.equal(friendshipTier(30), "friendly");
  assert.equal(friendshipTier(60), "close");
  assert.equal(friendshipTier(85), "devoted");
  assert.equal(friendshipTier(APPROVAL_MAX), "devoted");
  // Every tier is reachable and ordered worst to best.
  const seen = FRIENDSHIP_TIERS.map((tier) => tierIndex(tier));
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
});

test("the same deed lands differently on different people", () => {
  // Mercy in front of the empathetic healer is worth more than the base 6;
  // in front of the callous mercenary it actively costs.
  const onHealer = beatDelta("mercy", null, { ...blank, personality: healer });
  const onMercenary = beatDelta("mercy", null, { ...blank, personality: mercenary });
  const onStranger = beatDelta("mercy", null, blank);
  assert.equal(onStranger, 6);
  assert.ok(onHealer > onStranger, `expected mercy to please the healer, got ${onHealer}`);
  assert.ok(onMercenary < 0, `expected mercy to grate on the mercenary, got ${onMercenary}`);
});

test("courage impresses the bold and unsettles the timid", () => {
  const onMercenary = beatDelta("courage", null, { ...blank, personality: mercenary });
  const onHealer = beatDelta("courage", null, { ...blank, personality: healer });
  assert.ok(onMercenary > 7, `bold should love courage, got ${onMercenary}`);
  assert.ok(onHealer < 7, `the timid healer should be less moved, got ${onHealer}`);
});

test("a transgression a person shares stings half as much", () => {
  // Recklessness that endangers the bold mercenary barely registers as a
  // grievance; the cautious healer minds far more.
  const onMercenary = beatDelta("endangered", null, { ...blank, personality: mercenary });
  const onHealer = beatDelta("endangered", null, { ...blank, personality: healer });
  assert.equal(onMercenary, -4);
  assert.ok(onHealer < -8, `the timid healer should mind more, got ${onHealer}`);
});

test("alignment reads off the axis and its sign", () => {
  assert.equal(beatAlignment(beatSpec("cruelty"), healer), -3);
  assert.equal(beatAlignment(beatSpec("cruelty"), mercenary), 3);
  // A beat with no axis is one nobody is indifferent to.
  assert.equal(beatAlignment(beatSpec("betrayal"), healer), 0);
  assert.equal(beatAlignment(beatSpec("mercy"), null), 0);
});

test("betrayal is unforgivable to everyone", () => {
  assert.equal(beatDelta("betrayal", null, blank), -25);
  assert.equal(beatDelta("betrayal", null, { ...blank, personality: mercenary }), -25);
  assert.equal(beatDelta("betrayal", null, { ...blank, repeats: 5 }), -25);
});

test("checked overtures tier off the margin and a fumble costs", () => {
  assert.equal(beatDc(0), 15);
  assert.equal(beatDc(60), 10);
  assert.equal(beatDc(APPROVAL_MAX), 8);
  assert.equal(beatOutcome(20, 15), "strong");
  assert.equal(beatOutcome(15, 15), "good");
  assert.equal(beatOutcome(11, 15), "weak");
  assert.equal(beatOutcome(9, 15), "miss");
  assert.equal(beatDelta("gift", "strong", blank), 7);
  assert.equal(beatDelta("gift", "good", blank), 5);
  assert.equal(beatDelta("gift", "weak", blank), 3);
  assert.equal(beatDelta("gift", "miss", blank), -1);
});

test("repeating one move is worth steadily less, then nothing", () => {
  const at = (repeats) => beatDelta("gift", "good", { ...blank, repeats });
  assert.equal(at(0), 5);
  assert.equal(at(1), 3);
  assert.equal(at(2), 2);
  assert.equal(at(3), 0);
  assert.equal(at(9), 0);
  // A fumble is never softened by repetition.
  assert.equal(beatDelta("gift", "miss", { ...blank, repeats: 5 }), -1);
});

test("an NPC hostile to the party discounts kindness", () => {
  assert.equal(beatDelta("helped", null, { ...blank, hostile: true }), 3);
});

test("approval stays inside its bounds", () => {
  assert.equal(applyApproval(95, 20), APPROVAL_MAX);
  assert.equal(applyApproval(-95, -20), APPROVAL_MIN);
  assert.equal(applyApproval(10, -4), 6);
});

test("the old -3..+3 bond converts to the tier it always meant", () => {
  assert.equal(approvalFromBond(0), 0);
  assert.equal(approvalFromBond(2), 30);
  assert.equal(friendshipTier(approvalFromBond(1)), "cordial");
  assert.equal(friendshipTier(approvalFromBond(-1)), "wary");
  assert.equal(friendshipTier(approvalFromBond(2)), "friendly");
  assert.equal(friendshipTier(approvalFromBond(-2)), "disliked");
  assert.equal(friendshipTier(approvalFromBond(3)), "friendly");
  assert.equal(friendshipTier(approvalFromBond(-3)), "disliked");
});

test("standing gives a bounded modifier to that character's social checks", () => {
  assert.equal(approvalRollModifier(0), 0);
  assert.equal(approvalRollModifier(50), 2);
  assert.equal(approvalRollModifier(APPROVAL_MAX), 4);
  assert.equal(approvalRollModifier(APPROVAL_MIN), -4);
});

test("nobody is courted into liking someone", () => {
  // Enough approval for the rung is not enough on its own: the tier gate
  // sits underneath it, so a disliked character cannot start a romance.
  const disliked = canAdvanceRomance("none", "interested", -40, "active");
  assert.equal(disliked.ok, false);
  assert.match(disliked.reason, /do not even like them/);
  assert.ok(tierIndex(friendshipTier(ROMANCE_THRESHOLD.interested)) >= tierIndex(ROMANCE_MIN_TIER));
});

test("the romance ladder moves one rung at a time, with the feeling behind it", () => {
  assert.equal(nextRomanceStage("none"), "interested");
  assert.equal(nextRomanceStage("married"), null);
  const skipping = canAdvanceRomance("interested", "married", 100, "active");
  assert.equal(skipping.ok, false);
  assert.match(skipping.reason, /one step at a time/);
  const early = canAdvanceRomance("courting", "together", ROMANCE_THRESHOLD.together - 1, "active");
  assert.equal(early.ok, false);
  assert.match(early.reason, /needs approval 70/);
  assert.deepEqual(canAdvanceRomance("courting", "together", ROMANCE_THRESHOLD.together, "active"), {
    ok: true,
    target: "together",
  });
  assert.equal(canAdvanceRomance("interested", "courting", 90, "ended").ok, false);
});

test("consent is automatic well past the bar and a real question at it", () => {
  const certain = consentCheck(ROMANCE_THRESHOLD.together + 10, "together", 0, 1);
  assert.equal(certain.accepted, true);
  assert.equal(certain.automatic, true);
  const refused = consentCheck(ROMANCE_THRESHOLD.together, "together", 0, 5);
  assert.equal(refused.accepted, false);
  assert.equal(refused.automatic, false);
  assert.equal(consentCheck(ROMANCE_THRESHOLD.together, "together", 0, 15).accepted, true);
  // Warmth tips a marginal proposal.
  assert.equal(consentCheck(ROMANCE_THRESHOLD.betrothed, "betrothed", -2, 12).accepted, false);
  assert.equal(consentCheck(ROMANCE_THRESHOLD.betrothed, "betrothed", 2, 12).accepted, true);
});

test("feelings can slip back a rung, but promises do not", () => {
  assert.equal(demoteRomance("together", ROMANCE_THRESHOLD.together - 5), "together");
  assert.equal(demoteRomance("together", 45), "courting");
  assert.equal(demoteRomance("together", -50), "none");
  assert.equal(demoteRomance("betrothed", -100), "betrothed");
  assert.equal(demoteRomance("married", -100), "married");
});

test("beat counters bump and halve", () => {
  const once = bumpBeatCount({}, "mercy");
  assert.deepEqual(once, { mercy: 1 });
  assert.deepEqual(bumpBeatCount(once, "mercy"), { mercy: 2 });
  assert.deepEqual(decayBeatCounts({ mercy: 3, gift: 1 }), { mercy: 1 });
  assert.deepEqual(decayBeatCounts({ mercy: 1 }), {});
});

test("memories are bounded, trimmed, and keep the newest", () => {
  let memories = [];
  for (let index = 0; index < MEMORY_LIMIT + 4; index += 1) {
    memories = addMemory(memories, { kind: "moment", text: `beat ${index}`, at: "" });
  }
  assert.equal(memories.length, MEMORY_LIMIT);
  assert.equal(memories.at(-1).text, `beat ${MEMORY_LIMIT + 3}`);
  assert.equal(addMemory([], { kind: "m", text: "x".repeat(500), at: "" })[0].text.length, 160);
  assert.deepEqual(addFlag(["married"], "married"), ["married"]);
});

test("a soured companion earns an explicit walk-out warning", () => {
  assert.equal(souredNote("neutral", "companion", "Sera"), null);
  assert.equal(souredNote("friendly", "companion", "Sera"), null);
  assert.match(souredNote("disliked", "companion", "Sera"), /close to walking/);
  assert.match(souredNote("hostile", "companion", "Sera"), /dismiss_companion/);
  // An NPC is not in the party, so the note is about favors, not leaving.
  assert.match(souredNote("hostile", "npc", "Sera"), /wants nothing to do with them/);
});

test("absence pulls at the story only for bonds with weight behind them", () => {
  assert.equal(longingNote("Sera", "Kara", REAPPEAR_AFTER - 1, 90, "together"), null);
  // A passing acquaintance does not chase anyone across the map.
  assert.equal(longingNote("Sera", "Kara", 9, 20, "none"), null);
  assert.match(longingNote("Sera", "Kara", REAPPEAR_AFTER, 70, "none"), /Sera/);
  assert.match(longingNote("Sera", "Kara", REAPPEAR_AFTER, 55, "courting"), /Kara/);
});

test("the roster line is readable and bounded", () => {
  const line = relationshipFragment({
    characterName: "Kara",
    subjectName: "Sera",
    subjectKind: "companion",
    approval: 72,
    romance: "betrothed",
    status: "parted",
    apartChapters: 2,
    memories: Array.from({ length: 8 }, (_, index) => ({
      kind: "moment",
      text: `a long remembered evening number ${index} that went on and on`,
      at: "",
    })),
  });
  assert.match(line, /Kara and Sera/);
  assert.match(line, /close/);
  assert.match(line, /betrothed/);
  assert.match(line, /apart from the party for 2 chapters/);
  assert.ok(line.length <= 420, `roster line too long: ${line.length}`);

  // A hostile companion's line carries the warning.
  const soured = relationshipFragment({
    characterName: "Kara",
    subjectName: "Grix",
    subjectKind: "companion",
    approval: -70,
    romance: "none",
    status: "active",
    apartChapters: 0,
    memories: [],
  });
  assert.match(soured, /close to walking/);
  assert.equal(ROMANCE_STAGES[0], "none");
});

console.log(`\ntest-relationships: ${passed} passed`);
