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
const voice = await import("../src/lib/dm/conscience-voice-logic.ts");
const { voicedByServer } = await import("../src/lib/dm/ooc-question.ts");
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
  assert.equal(ladder.stepLadder(at(0), "breach", 0, 1, "cruelty by Kael").held, 1);
  assert.equal(ladder.stepLadder(at(1), "breach", -30, 1, "x").held, 3, "standing already held them at a warning");
  assert.equal(ladder.stepLadder(at(4), "breach", 0, 1, "x").held, 4, "nothing past the breaking point");
  const atrocity = ladder.stepLadder(at(0), "atrocity", 80, 1, "the killing of someone helpless by Kael");
  assert.equal(atrocity.held, 4);
  assert.equal(atrocity.cause, "the killing of someone helpless by Kael");
  assert.equal(ladder.stepLadder(at(2), null, 0, 1, "x").held, 2, "a deed nothing they hold cares about moves no rung");
});

test("honour climbs one rung, once a day of the campaign's clock, never past what their standing allows (issue 563)", () => {
  const day = ladder.clockDay(3 * 1440 + 600);
  assert.equal(day, 3, "the day an instant falls on");
  assert.equal(ladder.clockDay(3 * 1440 + 1439), 3, "the same day until midnight");
  const up = ladder.stepLadder(at(3), "honour", 0, day, "amends made by Kael");
  assert.equal(up.held, 2);
  assert.equal(up.climbedDay, 3);
  assert.equal(ladder.stepLadder(up, "honour", 0, day, "again").held, 2, "amends again the same day climbs no further");
  assert.equal(ladder.stepLadder(up, "honour", 0, day + 1, "the next day").held, 1, "the next day climbs again");
  assert.equal(ladder.stepLadder(at(0), "honour", 0, day, "x").held, 0, "content stays content");
  const held = ladder.stepLadder(at(2), "honour", -70, day, "x");
  assert.equal(ladder.effectiveRung(held, -70), 4, "a companion who is hostile stays at the breaking point");
  // A row written before the day was kept reads as never climbed.
  assert.equal(ladder.parseConscience(JSON.stringify({ held: 2, shown: 2, climbedTurn: "t1" })).climbedDay, -1);
  assert.equal(ladder.parseConscience(JSON.stringify({ held: 2, shown: 2, climbedDay: 7 })).climbedDay, 7);
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

// ---- issue 563 ----

test("every value has deeds that honour it: the dead laid to rest, captives freed, a wrongdoer handed to the law", () => {
  const red = (value) => [{ value, strength: "red_line", faction: "" }];
  assert.equal(values.deedVerdict(red("reveres_dead"), "laid_to_rest", "serious").ladder, "honour");
  assert.equal(values.deedVerdict(red("hates_tyranny"), "freed_captives", "serious").ladder, "honour");
  assert.equal(values.deedVerdict(red("protects_innocent"), "freed_captives", "serious").ladder, "honour");
  assert.equal(values.deedVerdict(red("respects_law"), "upheld_law", "serious").ladder, "honour");
  assert.ok(values.deedVerdict(red("respects_law"), "upheld_law", "serious").approval > 0);
  // A mercenary sees a ransom walk away.
  const mercenary = values.deedVerdict([{ value: "mercenary", strength: "cares", faction: "" }], "freed_captives", "serious");
  assert.equal(mercenary.broken.length, 1);
  assert.ok(mercenary.approval < 0);
  for (const value of ["respects_law", "reveres_dead", "hates_tyranny"]) {
    assert.ok(
      values.DEED_KINDS.some((deed) => values.deedVerdict(red(value), deed, "serious").ladder === "honour"),
      `${value} has a deed that honours it`,
    );
  }
  for (const deed of ["laid_to_rest", "freed_captives", "upheld_law"]) {
    assert.ok(values.isDeedKind(deed));
    assert.equal(values.deedSeverity(deed, "atrocity"), "serious", "a kindness is never an atrocity");
    assert.ok(RELATIONSHIP_BEATS[deed].base > 0, `${deed} earns regard`);
  }
  // Freeing a faction's people honours a loyalty to it, as a mercy does.
  const loyal = [{ value: "faction_loyalty", strength: "cares", faction: "the Free Towns" }];
  assert.equal(values.deedVerdict(loyal, "freed_captives", "serious", "The Free Towns").ladder, "honour");
  assert.equal(values.deedVerdict(loyal, "torture", "serious", "The Free Towns").broken.length, 1);
});

test("one ceiling rule: a Turn table never holds the companion itself back; every other table does (issue 563)", () => {
  assert.equal(ladder.ceilingHoldsCompanion("turn"), false);
  for (const setting of ["off", "talk", "leave"]) {
    assert.equal(ladder.ceilingHoldsCompanion(setting), true);
  }
  assert.equal(ladder.settingOf({ relationships: "off", companionConscience: "turn" }), "off", "no relationships, no conscience");
  assert.equal(ladder.settingOf({ relationships: "on" }), "leave", "Leave is the default");
  assert.equal(ladder.settingOf({ relationships: "on", companionConscience: "turn" }), "turn");
});

test("the rules name who stood by, that nobody knows an alignment, and where a slip-away comes from", () => {
  const leave = ladder.conscienceRules("leave", true, values.DEED_KINDS);
  assert.match(leave, /stood by in witnesses/);
  assert.match(leave, /in objected/);
  assert.match(leave, /No NPC or companion knows anyone's alignment/);
  assert.match(leave, /take_rest/);
  assert.match(leave, /move_party naming who goes/);
  const talk = ladder.conscienceRules("talk", true, values.DEED_KINDS);
  assert.ok(!/take_rest/.test(talk), "a table that keeps its companions has nobody slipping away");
  const off = ladder.conscienceRules("off", false, values.DEED_KINDS);
  assert.match(off, /No NPC or companion knows anyone's alignment/, "every table with relationships is told");
});

test("the claims reader knows the honouring deeds", () => {
  for (const deed of ["laid_to_rest", "freed_captives", "upheld_law"]) {
    assert.match(claims.readerSystem([], false), new RegExp(deed));
  }
});

// ---- said at the table (issue 615) ----

const SEREN = { name: "Seren Vale", ids: ["sheet-seren", "npc-seren"] };
const said = (content, speech = [], speaker = null) => ({ content, speech, speaker });
const by = (line, speaker = { kind: "pc", id: "sheet-seren", name: "Seren Vale" }) => ({ line, speaker });
const STOP = new Set(["the", "you", "and", "before", "with"]);
const DEMAND = { rung: "ultimatum", condition: "Free the captives you took", due: 1140 };

test("an ultimatum is said when the companion speaks most of its key words, or a paragraph naming them holds two thirds", () => {
  assert.deepEqual(voice.keyWords("Free the captives you took", STOP), ["free", "captives", "took"]);
  const spoken = said('Seren rounds on Kael. "Free those captives, or I go," she says.', [by("Free those captives, or I go")]);
  assert.equal(voice.voicedIn(DEMAND, SEREN, spoken, STOP), true, "two of three key words in her own line");
  const byId = said('"Free the captives."', [by("Free the captives.", { kind: "pc", id: "sheet-seren", name: "someone" })]);
  assert.equal(voice.voicedIn(DEMAND, SEREN, byId, STOP), true, "her line by her sheet's id");
  const narrated = said("Seren demands that the captives Kael took go free by nightfall.");
  assert.equal(voice.voicedIn(DEMAND, SEREN, narrated, STOP), true, "a paragraph naming her with the demand in it");
  const shortName = said("Vale demands the captives you took go free.");
  assert.equal(voice.voicedIn(DEMAND, SEREN, shortName, STOP), true, "one word of a longer name, written as a name");
});

test("an ultimatum is not said by silence, by another's line, by an unattributed quote, or by her speaking of something else", () => {
  assert.equal(voice.voicedIn(DEMAND, SEREN, said("The cellar door creaks in the wind."), STOP), false, "silent");
  assert.equal(voice.voicedIn(DEMAND, SEREN, said('A voice in the dark: "Free the captives you took."'), STOP), false, "a quote nobody is tagged with");
  const other = said('"Free the captives you took," Kael mutters.', [by("Free the captives you took", { kind: "pc", id: "sheet-kael", name: "Kael" })]);
  assert.equal(voice.voicedIn(DEMAND, SEREN, other, STOP), false, "someone else's line");
  const elsewhere = said('"The road is long," Seren says.', [by("The road is long")]);
  assert.equal(voice.voicedIn(DEMAND, SEREN, elsewhere, STOP), false, "she spoke, but not of it");
  const thin = said("Seren looks at the captives.");
  assert.equal(voice.voicedIn(DEMAND, SEREN, thin, STOP), false, "a paragraph naming her with too little of it");
});

test("the rule reads stored speech, so another table language is read alike", () => {
  const italian = { rung: "ultimatum", condition: "Liberate i prigionieri entro il tramonto" };
  const stop = new Set(["il", "i", "prima", "del", "entro"]);
  const line = said("«Liberate i prigionieri prima del tramonto», dice Seren.", [by("Liberate i prigionieri prima del tramonto")]);
  assert.equal(voice.voicedIn(italian, SEREN, line, stop), true);
  assert.equal(voice.voicedIn(italian, SEREN, said("La porta della cantina scricchiola."), stop), false);
});

test("a demand with no key word to read is said when she speaks; a warning when she speaks; open unease when she speaks or is named", () => {
  const bare = { rung: "ultimatum", condition: "Do it now" };
  assert.deepEqual(voice.keyWords("Do it now", STOP), []);
  assert.equal(voice.voicedIn(bare, SEREN, said('"Now," Seren says.', [by("Now")]), STOP), true);
  assert.equal(voice.voicedIn(bare, SEREN, said("Seren waits."), STOP), false);
  const warning = { rung: "warning" };
  assert.equal(voice.voicedIn(warning, SEREN, said("Seren glares."), STOP), false, "a warning is said aloud");
  assert.equal(voice.voicedIn(warning, SEREN, said('"Enough."', [by("Enough.")]), STOP), true);
  assert.equal(voice.voicedIn(warning, SEREN, said("Enough.", [], { kind: "pc", id: "sheet-seren", name: "Seren Vale" }), STOP), true, "the whole message spoken as her");
  assert.equal(voice.voicedIn({ rung: "uneasy" }, SEREN, said("Seren looks away from the fire."), STOP), true, "open unease shown");
  assert.equal(voice.voicedIn({ rung: "uneasy" }, SEREN, said("The fire burns low."), STOP), false);
});

test("temperament decides unease: composure 1 or more keeps it in", () => {
  assert.equal(voice.concealsUnease({ composure: 1 }), true);
  assert.equal(voice.concealsUnease({ composure: 3 }), true);
  assert.equal(voice.concealsUnease({ composure: 0 }), false);
  assert.equal(voice.concealsUnease({ composure: -2 }), false);
  assert.equal(voice.concealsUnease(null), false);
  assert.match(ladder.rungGuidance("uneasy", "leave", true), /keep it in: play them as content/);
  assert.match(ladder.rungGuidance("uneasy", "leave"), /let their discomfort show/);
});

test("what a move owes the table: unease by temperament, a warning and an ultimatum always, the breaking point only at Talk", () => {
  const base = { ...ladder.CONTENT, cause: "cruelty by Kael" };
  const open = voice.afterMove(base, 0, 1, "leave", { keepsItIn: false, ultimatumSet: false });
  assert.deepEqual(open.owed, { rung: "uneasy", cause: "cruelty by Kael" });
  const kept = voice.afterMove(base, 0, 1, "leave", { keepsItIn: true, ultimatumSet: false });
  assert.equal(kept.owed, null);
  assert.deepEqual(kept.concealed, { noticedBy: [], pending: true });
  assert.equal(voice.afterMove(kept, 0, 2, "leave", { keepsItIn: true, ultimatumSet: false }).owed.rung, "warning", "a warning is said whatever the temper");
  assert.equal(voice.afterMove(kept, 0, 2, "leave", { keepsItIn: true, ultimatumSet: false }).concealed, null);
  const terms = { ...base, ultimatum: { condition: "Free them", set: 0, due: 600, eventId: "" } };
  assert.deepEqual(voice.afterMove(terms, 2, 3, "turn", { keepsItIn: false, ultimatumSet: true }).owed, { rung: "ultimatum", condition: "Free them", due: 600, cause: "cruelty by Kael" });
  assert.deepEqual(voice.afterMove(base, 3, 4, "talk", { keepsItIn: false, ultimatumSet: false, lapsed: "Free them" }).owed, { rung: "breaking", condition: "Free them", cause: "cruelty by Kael" });
  assert.equal(voice.afterMove(base, 3, 4, "leave", { keepsItIn: false, ultimatumSet: false }).owed, null, "the server's departure line says it");
  const secret = voice.afterMove({ ...base, causeSecret: true }, 0, 2, "leave", { keepsItIn: false, ultimatumSet: false });
  assert.deepEqual(secret.owed, { rung: "warning" }, "a secret cause is never carried into the line");
  const heard = voice.heard({ ...terms, told: 2, owed: { rung: "ultimatum" } });
  assert.equal(heard.told, 3);
  assert.equal(heard.owed, null);
  const down = voice.afterMove({ ...heard, owed: { rung: "warning" } }, 3, 1, "leave", { keepsItIn: false, ultimatumSet: false });
  assert.equal(down.told, 1, "what the table heard follows the rung down");
  assert.equal(down.owed, null, "nothing is owed on the way back up");
  assert.equal(ladder.defaultCondition("talk with Thorne by the fire", true), "Make amends, and never again");
});

test("the companion's own line: the issue's shape for an ultimatum, a plain line for the rest", () => {
  assert.equal(voice.fallbackLine({ rung: "ultimatum", condition: "Free the prisoners" }, "by nightfall"), "Free the prisoners. By nightfall, or I am done with this company.");
  assert.equal(voice.fallbackLine({ rung: "ultimatum", condition: 'Swear off the "knife".' }, "within 3 days"), "Swear off the 'knife'. Within 3 days, or I am done with this company.", "quotation marks never break the line");
  assert.match(voice.fallbackLine({ rung: "warning", cause: "torture by Kael" }, ""), /^Torture by Kael: I will not stand for it again\./);
  assert.match(voice.fallbackLine({ rung: "warning" }, ""), /It stops now\.$/);
  assert.match(voice.fallbackLine({ rung: "breaking", condition: "Free them" }, ""), /^The time I gave you is gone\. I can no longer stand with this company\. I stay/);
  assert.match(voice.fallbackLine({ rung: "uneasy", cause: "cruelty by Kael" }, ""), /^Cruelty by Kael\. I do not like it/);
  for (const owed of [{ rung: "ultimatum", condition: "x" }, { rung: "warning" }, { rung: "breaking" }, { rung: "uneasy" }]) {
    assert.doesNotMatch(voice.fallbackLine(owed, "by nightfall"), /[\u2013\u2014"]/, "no dashes of that kind, no quotation marks");
  }
  const morning = 600; // day 0, 10:00
  assert.equal(voice.dueSpoken(morning, 19 * 60), "by nightfall");
  assert.equal(voice.dueSpoken(morning, 1440 + 9 * 60), "by tomorrow morning");
  assert.equal(voice.dueSpoken(22 * 60, 1440 + 2 * 60), "before this night is out", "past midnight is still tonight");
  assert.equal(voice.dueSpoken(morning, morning + 3 * 1440), "within 3 days");
  assert.equal(voice.dueSpoken(morning, morning), "now");
});

test("each seat sees what its characters know: the truth for the storyteller, what was said for a player, unease kept in to whoever noticed", () => {
  const storyteller = { storyteller: true, characterIds: [] };
  const kael = { storyteller: false, characterIds: ["kael"] };
  const brin = { storyteller: false, characterIds: ["brin"] };
  const unsaid = { ...ladder.CONTENT, held: 3, told: 1, owed: { rung: "ultimatum" }, ultimatum: { condition: "Free them", set: 0, due: 600, eventId: "" } };
  assert.deepEqual(voice.viewFor(storyteller, unsaid, 3), { rung: "ultimatum", terms: true, unheard: true, hidden: false, noticedBy: [], noticed: false });
  assert.deepEqual(voice.viewFor(kael, unsaid, 3), { rung: "uneasy", terms: false, unheard: false, hidden: false, noticedBy: [], noticed: false }, "the table heard unease and nothing since");
  assert.equal(voice.viewFor(kael, { ...unsaid, told: 3, owed: null }, 3).terms, true, "the terms once they were said");
  const keptIn = { ...ladder.CONTENT, held: 1, concealed: { noticedBy: ["kael"], pending: false } };
  assert.deepEqual(voice.viewFor(storyteller, keptIn, 1), { rung: "uneasy", terms: false, unheard: false, hidden: true, noticedBy: ["kael"], noticed: false });
  assert.deepEqual(voice.viewFor(kael, keptIn, 1), { rung: "uneasy", terms: false, unheard: false, hidden: false, noticedBy: [], noticed: true });
  assert.equal(voice.viewFor(brin, keptIn, 1).rung, "content", "one who did not notice sees nothing");
  const plan = { ...ladder.CONTENT, held: 4, told: 2 };
  assert.equal(voice.viewFor(kael, plan, 4).rung, "warning", "a breaking point held as a plan was never said");
});

test("a row from before issue 615 reads as heard as far as it settled, owing nothing", () => {
  const old = ladder.parseConscience(JSON.stringify({ held: 2, shown: 2, ultimatum: null, climbedDay: 3, cause: "cruelty by Kael" }));
  assert.equal(old.told, 2);
  assert.equal(old.owed, null);
  assert.equal(old.concealed, null);
  assert.equal(old.causeSecret, false);
  const round = ladder.parseConscience(JSON.stringify({ ...ladder.CONTENT, held: 3, shown: 3, told: 1, owed: { rung: "ultimatum", condition: "Free them", due: 99 }, concealed: { noticedBy: ["a", 7], pending: true }, causeSecret: true }));
  assert.equal(round.told, 1);
  assert.deepEqual(round.owed, { rung: "ultimatum", condition: "Free them", due: 99 });
  assert.deepEqual(round.concealed, { noticedBy: ["a"], pending: true });
  assert.equal(round.causeSecret, true);
  assert.equal(ladder.parseConscience(JSON.stringify({ held: 1, owed: { rung: "shouting" } })).owed, null, "an unknown rung owes nothing");
});

test("a companion's line the server posted is not the narration a reroll, a continue or an X-card means", () => {
  const line = [{ line: "Enough.", speaker: { kind: "pc", id: "s", name: "Seren" } }];
  assert.equal(voicedByServer({ authorType: "dm", userId: null, speech: line }), true);
  assert.equal(voicedByServer({ authorType: "dm", userId: null, dmTurnId: "t1", speech: line }), false, "the AI's own passage");
  assert.equal(voicedByServer({ authorType: "dm", userId: "gm", speech: line }), false, "a person's passage");
  assert.equal(voicedByServer({ authorType: "dm", userId: null, speech: [] }), false, "a passage nobody speaks in");
});

console.log(`test-conscience: ${passed} passed`);
