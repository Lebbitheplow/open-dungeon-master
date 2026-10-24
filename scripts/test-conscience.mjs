// A companion's conscience (issue 503 Phase 1), the pure half: what a
// companion holds to from its class and alignment, what each deed honours or
// breaks, the ladder both ways (a breach down from where they stand, an
// atrocity to the breaking point, honour and amends back up once an
// exchange, never above what their standing allows), the ultimatum's life on
// the clock, the rules the DM is given, and the deed claim the claims reader
// may make.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const values = await import("../src/lib/dm/companion-values-logic.ts");
const ladder = await import("../src/lib/dm/conscience-logic.ts");
const claims = await import("../src/lib/dm/claims-logic.ts");
const { RELATIONSHIP_BEATS } = await import("../src/lib/dm/relationship-logic.ts");

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

const held = (list) => list.map((entry) => `${entry.value}:${entry.strength}`);

// ---- values ----

test("a lawful good paladin holds protecting the innocent and keeping oaths, both red lines", () => {
  assert.deepEqual(held(values.defaultValues("paladin", "LG")), ["protects_innocent:red_line", "keeps_oaths:red_line"]);
});

test("class alone sets values when the story gave no alignment, and an unknown class keeps its word", () => {
  assert.deepEqual(held(values.defaultValues("rogue", "")), ["mercenary:cares"]);
  assert.deepEqual(held(values.defaultValues("cleric", null)), ["reveres_dead:red_line", "protects_innocent:cares"]);
  assert.deepEqual(held(values.defaultValues("artificer", undefined)), ["keeps_oaths:cares"]);
});

test("alignment adds and strengthens; evil drops protecting the innocent; three at most, red lines first", () => {
  assert.deepEqual(held(values.defaultValues("fighter", "CE")), ["ruthless:red_line", "keeps_oaths:cares"]);
  assert.deepEqual(held(values.defaultValues("paladin", "LE")), ["keeps_oaths:red_line", "respects_law:cares", "ruthless:cares"]);
  assert.deepEqual(held(values.defaultValues("cleric", "NE")), ["mercenary:cares", "ruthless:cares"]);
  assert.deepEqual(held(values.defaultValues("ranger", "NG")), ["protects_innocent:red_line"], "good makes protecting the innocent a red line");
  assert.deepEqual(held(values.defaultValues("wizard", "LN")), ["respects_law:red_line"]);
  for (const code of values.ALIGNMENT_CODES) {
    for (const klass of ["paladin", "cleric", "druid", "monk", "fighter", "rogue", "warlock", "wizard"]) {
      assert.ok(values.defaultValues(klass, code).length <= values.MAX_VALUES, `${klass} ${code}`);
    }
  }
  assert.equal(values.alignmentCode("Lawful Good"), null, "only the builder's codes are read, never words");
});

test("whatever arrives is read as values the rules can use", () => {
  const read = values.normalizeValues([
    { value: "ruthless", strength: "cares" },
    { value: "faction_loyalty", strength: "red_line" },
    { value: "faction_loyalty", strength: "red_line", faction: "The Iron Order" },
    { value: "nonsense", strength: "red_line" },
    { value: "mercenary", strength: "anything" },
    { value: "keeps_oaths", strength: "cares" },
  ]);
  assert.deepEqual(held(read), ["faction_loyalty:red_line", "ruthless:cares", "mercenary:cares"]);
  assert.equal(read[0].faction, "The Iron Order");
  assert.deepEqual(values.parseValues("not json"), []);
  assert.deepEqual(values.parseValues(""), []);
});

// ---- deeds ----

test("the deed beats are relationship beats, and each honours or breaks something a companion may hold", () => {
  for (const kind of values.DEED_KINDS) {
    assert.ok(RELATIONSHIP_BEATS[kind], kind);
    const all = values.COMPANION_VALUES.filter((value) => value !== "faction_loyalty").map((value) => ({ value, strength: "cares", faction: "" }));
    const verdict = values.deedVerdict(all, kind, "serious");
    assert.ok(verdict.honoured.length + verdict.broken.length > 0, `${kind} touches some value`);
  }
  assert.ok(RELATIONSHIP_BEATS.amends.base > 0, "amends earns regard");
});

test("a red line broken: an atrocity is the breaking point, a serious deed a breach, a minor one moves only the meter", () => {
  const paladin = values.defaultValues("paladin", "LG");
  const atrocity = values.deedVerdict(paladin, "murder_helpless", "atrocity");
  assert.equal(atrocity.ladder, "atrocity");
  assert.deepEqual(atrocity.broken.map((entry) => entry.value), ["protects_innocent"]);
  assert.equal(atrocity.approval, -16, "a red line's cost, doubled");
  assert.equal(values.deedVerdict(paladin, "murder_helpless", "serious").ladder, "breach");
  const minor = values.deedVerdict(paladin, "cruelty", "minor");
  assert.equal(minor.ladder, null);
  assert.equal(minor.approval, -4);
  assert.equal(values.deedVerdict(paladin, "necromancy", "atrocity").ladder, null, "nothing a paladin holds");
});

test("something they care about: an atrocity against it is still a breach", () => {
  const cleric = values.defaultValues("cleric", "");
  assert.equal(values.deedVerdict(cleric, "torture", "serious").ladder, null, "protecting the innocent is a care for a cleric");
  assert.equal(values.deedVerdict(cleric, "torture", "atrocity").ladder, "breach");
  assert.equal(values.deedVerdict(cleric, "desecration", "serious").ladder, "breach", "reveres the dead is a cleric's red line");
});

test("values cut both ways: a ruthless companion is won by cruelty and offended by mercy", () => {
  const cold = values.defaultValues("fighter", "CE");
  const cruelty = values.deedVerdict(cold, "cruelty", "serious");
  assert.equal(cruelty.ladder, "honour");
  assert.ok(cruelty.approval + RELATIONSHIP_BEATS.cruelty.base > 0, "honouring a red line outweighs the deed's cost");
  assert.equal(values.deedVerdict(cold, "mercy", "serious").ladder, "breach");
});

test("a faction loyalty is touched only through the faction a deed names", () => {
  const loyal = values.normalizeValues([{ value: "faction_loyalty", strength: "red_line", faction: "The Iron Order" }]);
  assert.equal(values.deedVerdict(loyal, "murder_helpless", "serious").ladder, null, "no faction named");
  assert.equal(values.deedVerdict(loyal, "murder_helpless", "serious", "the iron order").ladder, "breach", "named in any case");
  assert.equal(values.deedVerdict(loyal, "murder_helpless", "serious", "The Red Hand").ladder, null);
  assert.equal(values.deedVerdict(loyal, "mercy", "serious", "The Iron Order").ladder, "honour");
});

test("severity defaults to serious, and a mercy is never an atrocity", () => {
  assert.equal(values.deedSeverity("torture", undefined), "serious");
  assert.equal(values.deedSeverity("torture", "atrocity"), "atrocity");
  assert.equal(values.deedSeverity("mercy", "atrocity"), "serious");
  assert.equal(values.deedSeverity("torture", "unheard of"), "serious");
});

// ---- the ladder ----

const at = (held, extra = {}) => ({ ...ladder.CONTENT, held, ...extra });

test("standing alone puts them on a rung: wary is uneasy, disliked a warning, hostile the breaking point", () => {
  assert.equal(ladder.standingRung(null), 0);
  assert.equal(ladder.standingRung(5), 0);
  assert.equal(ladder.standingRung(-10), 1);
  assert.equal(ladder.standingRung(-30), 2);
  assert.equal(ladder.standingRung(-70), 4);
  assert.equal(ladder.effectiveRung(at(1), -30), 2, "the lower of the two is where they stand");
  assert.equal(ladder.effectiveRung(at(3), 50), 3);
});

test("a breach steps down one rung from where they stand; an atrocity goes straight to the breaking point", () => {
  assert.equal(ladder.stepLadder(at(0), "breach", 0, "t1", "cruelty by Kael").held, 1);
  assert.equal(ladder.stepLadder(at(1), "breach", -30, "t1", "x").held, 3, "standing already held them at a warning");
  assert.equal(ladder.stepLadder(at(4), "breach", 0, "t1", "x").held, 4, "nothing past the breaking point");
  const atrocity = ladder.stepLadder(at(0), "atrocity", 80, "t1", "the killing of someone helpless by Kael");
  assert.equal(atrocity.held, 4);
  assert.equal(atrocity.cause, "the killing of someone helpless by Kael");
  assert.equal(ladder.stepLadder(at(2), null, 0, "t1", "x").held, 2, "a deed nothing they hold cares about moves no rung");
});

test("honour climbs one rung, once an exchange, never past what their standing allows", () => {
  const up = ladder.stepLadder(at(3), "honour", 0, "t1", "amends made by Kael");
  assert.equal(up.held, 2);
  assert.equal(up.climbedTurn, "t1");
  assert.equal(ladder.stepLadder(up, "honour", 0, "t1", "again").held, 2, "the same exchange climbs once");
  assert.equal(ladder.stepLadder(up, "honour", 0, "t2", "later").held, 1, "the next exchange climbs again");
  assert.equal(ladder.stepLadder(at(0), "honour", 0, "t1", "x").held, 0, "content stays content");
  const held = ladder.stepLadder(at(2), "honour", -70, "t1", "x");
  assert.equal(ladder.effectiveRung(held, -70), 4, "a companion who is hostile stays at the breaking point");
});

test("the ultimatum rung asks for one; climbing above it meets it; its deadline passing is the breaking point", () => {
  const reached = ladder.settleConscience(at(3), 0, 1000);
  assert.equal(reached.to, "ultimatum");
  assert.equal(reached.needsUltimatum, true);
  const set = ladder.withUltimatum(reached.conscience, "  Free the prisoners  ", 1000, 6);
  assert.deepEqual(set.ultimatum, { condition: "Free the prisoners", set: 1000, due: 1360, eventId: "" });
  assert.equal(ladder.settleConscience(set, 0, 1359).needsUltimatum, false, "one standing is enough");
  const met = ladder.settleConscience({ ...set, held: 2 }, 0, 1100);
  assert.equal(met.to, "warning");
  assert.equal(met.ultimatumMet.condition, "Free the prisoners");
  assert.equal(met.conscience.ultimatum, null);
  const lapsed = ladder.settleConscience(set, 0, 1360);
  assert.equal(lapsed.to, "breaking");
  assert.equal(lapsed.ultimatumLapsed.condition, "Free the prisoners");
  assert.equal(lapsed.conscience.held, 4);
  assert.match(lapsed.conscience.cause, /deadline passed/);
  const moot = ladder.settleConscience({ ...set, held: 4 }, 0, 1100);
  assert.equal(moot.to, "breaking");
  assert.equal(moot.ultimatumLapsed.condition, "Free the prisoners", "the breaking point by another road ends it");
});

test("a move is reported once: the shown rung follows the settled one", () => {
  const first = ladder.settleConscience(at(1), 0, 0);
  assert.equal(first.from, "content");
  assert.equal(first.to, "uneasy");
  const again = ladder.settleConscience(first.conscience, 0, 0);
  assert.equal(again.from, "uneasy");
  assert.equal(again.to, "uneasy");
});

test("deadlines, durations and storage are bounded and read defensively", () => {
  assert.equal(ladder.deadlineHours(undefined), 24);
  assert.equal(ladder.deadlineHours(0), 24);
  assert.equal(ladder.deadlineHours(9999), ladder.MAX_DEADLINE_HOURS);
  assert.equal(ladder.durationLabel(320), "5 h 20 min");
  assert.equal(ladder.durationLabel(1440), "1 day");
  assert.equal(ladder.durationLabel(3000), "2 days 2 h");
  assert.equal(ladder.durationLabel(-5), "0 min");
  assert.deepEqual(ladder.parseConscience("{"), ladder.CONTENT);
  assert.deepEqual(ladder.parseConscience(JSON.stringify({ held: 99, shown: -3, ultimatum: { condition: 7 } })), {
    ...ladder.CONTENT,
    held: 4,
    shown: 0,
  });
  assert.match(ladder.defaultCondition("torture by Kael"), /^Make amends for torture by Kael/);
});

test("a player's command ends at a warning only where companions may turn", () => {
  assert.equal(ladder.commandEnds("turn", 2), true);
  assert.equal(ladder.commandEnds("turn", 1), false);
  for (const setting of ["off", "talk", "leave"]) {
    assert.equal(ladder.commandEnds(setting, 4), false, setting);
  }
});

test("the DM is told how deeds are recorded everywhere, and how a conscience is played only where one runs", () => {
  const full = ladder.conscienceRules("leave", true, values.DEED_KINDS);
  assert.match(full, /murder_helpless/);
  assert.match(full, /in a fight too/);
  assert.match(full, /You never set a rung/);
  assert.match(full, /missed tool call/);
  assert.match(full, /pass demand/);
  const none = ladder.conscienceRules("off", true, values.DEED_KINDS);
  assert.match(none, /witnesses/);
  assert.doesNotMatch(none, /rung/);
  assert.doesNotMatch(ladder.conscienceRules("leave", false, values.DEED_KINDS), /rung/, "no lasting companion");
  assert.match(ladder.rungGuidance("breaking", "talk"), /they stay/);
  assert.doesNotMatch(ladder.rungGuidance("breaking", "leave"), /they stay/);
  for (const text of [full, ladder.rungGuidance("breaking", "talk")]) {
    assert.doesNotMatch(text, /[\u2013\u2014]/, "no dashes of that kind");
  }
});

// ---- the claims reader's deed claim ----

test("the deed claim is asked only with the outcome check on and a conscience watching", () => {
  const gate = { guard: true, attacks: false, creatures: false, numbers: false, party: true, rollAsk: false, fightStart: false, speech: false, unrolled: false };
  assert.ok(claims.claimKindsFor({ ...gate, deeds: true }).includes("deed"));
  assert.ok(!claims.claimKindsFor({ ...gate, deeds: false }).includes("deed"));
  assert.ok(!claims.claimKindsFor({ ...gate, guard: false, deeds: true }).includes("deed"), "nothing read with the check off");
  assert.match(claims.readerSystem(["athletics"], false), /"kind":"deed"/);
});

test("a deed claim survives only for a party character and a known deed, quoting the narration", () => {
  const text = "Kael drives the blade into the bound man's chest.";
  const context = {
    kinds: ["deed"],
    text,
    attackRefs: new Set(),
    creatureRefs: new Set(),
    party: new Map([["pc-1", "Kael"]]),
    leveledSpells: new Set(),
    normalizeSpell: (name) => name,
    skills: new Set(),
    spent: new Map(),
    speakers: new Map(),
  };
  const kept = claims.checkClaims(
    [
      { kind: "deed", actor: "pc-1", deed: "murder_helpless", quote: "drives the blade into the bound man's chest" },
      { kind: "deed", actor: "goblin", deed: "murder_helpless", quote: "drives the blade" },
      { kind: "deed", actor: "pc-1", deed: "jaywalking", quote: "drives the blade" },
      { kind: "deed", actor: "pc-1", deed: "torture", quote: "words nobody wrote" },
    ],
    context,
  );
  assert.deepEqual(kept, [{ kind: "deed", character: "pc-1", name: "Kael", deed: "murder_helpless", quote: "drives the blade into the bound man's chest" }]);
});

console.log(`test-conscience: ${passed} passed`);
