// The research desk: the comparison table, the calculators, and the grounded
// answer's ranking and citation check.
//
// The calculators are assembly over SRD modules that already have their own
// suites, so what is worth asserting here is that the assembly is faithful:
// the numbers agree with the modules they came from, and a bad input falls
// back rather than silently becoming zero. The desk half is where the real
// claims are, and the load-bearing one is that a citation the desk never
// supplied does not survive to a person.
// See docs/workshop-plan.md phase 8.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { CALCULATORS, calculatorById, runCalculator } = await import(
  "../src/lib/reference/calculators.ts"
);
const { buildCompare, MAX_COMPARE } = await import("../src/lib/reference/compare.ts");
const {
  checkCitations,
  clampDeskQuestion,
  deskTerms,
  DESK_QUESTION_MAX,
  parseDeskJson,
  renderEvidence,
  scoreSource,
  selectEvidence,
} = await import("../src/lib/reference/desk-logic.ts");
const { evaluateEncounter, thresholdsForParty } = await import(
  "../src/lib/srd/encounter-math.ts"
);
const { treasureTierForCr } = await import("../src/lib/srd/treasure.ts");
const { paceSpeed, forcedMarchSaveDc } = await import("../src/lib/srd/travel.ts");
const { carryMultiplier } = await import("../src/lib/srd/encumbrance.ts");
const { deriveCr } = await import("../src/lib/bestiary/derive-cr.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function run(id, input) {
  const calculator = calculatorById(id);
  return calculator.run({ ...calculator.defaults, ...input });
}

function part(result, label) {
  return result.parts.find((entry) => entry.label === label);
}

// ---- calculators ----

test("every calculator runs on its own defaults", () => {
  for (const calculator of CALCULATORS) {
    const result = calculator.run(calculator.defaults);
    assert.ok(result.headline, `${calculator.id} produced no headline`);
    assert.ok(result.parts.length, `${calculator.id} produced no parts`);
    for (const entry of result.parts) {
      assert.ok(entry.label, `${calculator.id} has a part with no label`);
      assert.ok(entry.value !== undefined, `${calculator.id} has a part with no value`);
    }
  }
});

test("every calculator field has a default, and every default names a field", () => {
  for (const calculator of CALCULATORS) {
    const keys = new Set(calculator.fields.map((field) => field.key));
    for (const field of calculator.fields) {
      assert.ok(
        calculator.defaults[field.key] !== undefined,
        `${calculator.id}.${field.key} has no default`,
      );
    }
    for (const key of Object.keys(calculator.defaults)) {
      assert.ok(keys.has(key), `${calculator.id} defaults name a missing field ${key}`);
    }
  }
});

test("a choice field's default is one of its options", () => {
  for (const calculator of CALCULATORS) {
    for (const field of calculator.fields) {
      if (field.kind !== "choice") {
        continue;
      }
      const values = field.options.map((option) => option.value);
      assert.ok(
        values.includes(String(calculator.defaults[field.key])),
        `${calculator.id}.${field.key} defaults outside its options`,
      );
    }
  }
});

test("an unknown calculator is refused rather than guessed at", () => {
  const result = runCalculator("nope", {});
  assert.ok(result.error);
});

test("the encounter budget agrees with the engine's own evaluation", () => {
  const result = run("encounter-budget", {
    partySize: 4,
    partyLevel: 5,
    monsterCount: 3,
    monsterCr: "2",
  });
  const levels = [5, 5, 5, 5];
  const expected = evaluateEncounter(levels, [2, 2, 2]);
  assert.equal(part(result, "Raw XP").value, expected.totalXp.toLocaleString());
  assert.equal(part(result, "Adjusted XP").value, expected.adjustedXp.toLocaleString());
  const thresholds = thresholdsForParty(levels);
  assert.match(part(result, "Thresholds").value, new RegExp(thresholds.deadly.toLocaleString()));
});

test("a single big monster and a swarm of the same XP are priced differently", () => {
  // The multiplier is the whole point of the DMG's adjusted XP, so a
  // calculator that lost it would still look plausible while being useless.
  const solo = run("encounter-budget", { monsterCount: 1, monsterCr: "5" });
  const swarm = run("encounter-budget", { monsterCount: 8, monsterCr: "1" });
  assert.equal(part(solo, "Multiplier").value, "x1");
  assert.notEqual(part(swarm, "Multiplier").value, "x1");
});

test("a party of two is priced harder than a party of five for the same fight", () => {
  const small = run("encounter-budget", { partySize: 2, monsterCount: 4, monsterCr: "1" });
  const large = run("encounter-budget", { partySize: 5, monsterCount: 4, monsterCr: "1" });
  const smallMultiplier = Number(part(small, "Multiplier").value.slice(1));
  const largeMultiplier = Number(part(large, "Multiplier").value.slice(1));
  assert.ok(smallMultiplier > largeMultiplier);
});

test("treasure tiers follow the module that owns them", () => {
  for (const [cr, tier] of [
    [1, 1],
    [7, 2],
    [13, 3],
    [20, 4],
  ]) {
    assert.equal(treasureTierForCr(cr), tier);
    const result = run("treasure", { cr: String(cr) });
    assert.equal(part(result, "Tier").value, `Tier ${tier}`);
  }
});

test("individual treasure is a tenth of a hoard and carries no items", () => {
  const hoard = run("treasure", { cr: "13", kind: "hoard" });
  const individual = run("treasure", { cr: "13", kind: "individual" });
  const gold = (result) => Number(result.headline.replace(/[^0-9]/g, ""));
  assert.equal(gold(hoard), gold(individual) * 10);
  assert.equal(part(individual, "Magic items").value, "none");
  assert.notEqual(part(hoard, "Magic items").value, "none");
});

test("travel distance divides by the pace the PHB prints", () => {
  const result = run("travel", { miles: 48, pace: "normal", hours: 8 });
  assert.equal(paceSpeed("normal").milesPerHour, 3);
  // 3 miles an hour over 8 hours is 24 a day, so 48 miles is two days.
  assert.equal(result.headline, "2 days");
  assert.equal(part(result, "Covered a day").value, "24 miles");
});

test("a fast pace costs passive Perception and a slow one buys stealth", () => {
  assert.match(part(run("travel", { pace: "fast" }), "Watch").value, /-5/);
  assert.match(part(run("travel", { pace: "slow" }), "Watch").value, /stealth/);
});

test("a long day reports the forced march and its rising DC", () => {
  const result = run("travel", { hours: 11 });
  const forced = part(result, "Forced march");
  assert.equal(forced.value, "3 extra hours");
  assert.match(forced.detail, new RegExp(`DC ${forcedMarchSaveDc(3)}`));
  // An eight-hour day is not a forced march and should not claim to be.
  assert.equal(part(run("travel", { hours: 8 }), "Forced march"), undefined);
});

test("the spell DC is 8 plus proficiency plus the modifier", () => {
  const result = run("spell-dc", { abilityScore: 18, level: 9, bonus: 0 });
  // A score of 18 is +4; level 9 is proficiency +4. 8 + 4 + 4 = 16.
  assert.equal(result.headline, "DC 16");
  assert.equal(part(result, "Ability modifier").value, "+4");
  assert.equal(part(result, "Proficiency").value, "+4");
  assert.equal(part(result, "Spell attack").value, "+8");
});

test("a spell DC reads back onto the difficulty ladder", () => {
  assert.equal(part(run("spell-dc", { abilityScore: 10, level: 1 }), "On the ladder").value, "easy");
  assert.equal(
    part(run("spell-dc", { abilityScore: 20, level: 17, bonus: 3 }), "On the ladder").value,
    "hard",
  );
});

test("carrying capacity is Strength times fifteen, scaled by size", () => {
  assert.equal(run("carrying", { strength: 16, size: "medium" }).headline, "240 lb");
  assert.equal(carryMultiplier("large"), 2);
  assert.equal(run("carrying", { strength: 16, size: "large" }).headline, "480 lb");
  assert.equal(run("carrying", { strength: 16, size: "tiny" }).headline, "120 lb");
});

test("coins weigh fifty to the pound", () => {
  assert.equal(part(run("carrying", { coins: 500 }), "Coins").value, "10 lb");
});

test("a missing input falls back rather than becoming zero", () => {
  // The bug this guards is the one monster-draft.ts hit: null, undefined and
  // "" all coerce to 0, so a boundary that trusts Number() turns a blank
  // Strength field into a character who can carry nothing.
  for (const bad of [null, undefined, "", "  ", "abc", NaN]) {
    const result = run("carrying", { strength: bad });
    assert.equal(result.headline, "210 lb", `strength ${String(bad)} did not fall back to 14`);
  }
});

test("an out-of-range input is clamped, not passed through", () => {
  assert.equal(run("carrying", { strength: 900 }).headline, "450 lb");
  assert.equal(run("carrying", { strength: -5 }).headline, "15 lb");
});

// ---- compare ----

function monster(overrides = {}) {
  return {
    ac: 13,
    maxHp: 30,
    dexMod: 1,
    speed: "30 ft.",
    attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", type: "slashing" }],
    traits: [],
    resist: "",
    immune: "",
    vulnerable: "",
    conditionImmune: "",
    cr: 1,
    xp: 200,
    attacksPerTurn: 1,
    size: "medium",
    ...overrides,
  };
}

function homebrewSubject(name, stats) {
  return { slug: `homebrew:${name}`, name, source: "homebrew", data: { stats } };
}

function spellSubject(name, data) {
  return { slug: name.toLowerCase(), name, source: "open5e", data };
}

test("comparing fewer than two things is refused", () => {
  const result = buildCompare("monsters", [homebrewSubject("Lone", monster())]);
  assert.ok(result.error);
});

test("comparing more than the column limit is refused", () => {
  const subjects = Array.from({ length: MAX_COMPARE + 1 }, (_unused, index) =>
    homebrewSubject(`M${index}`, monster()),
  );
  const result = buildCompare("monsters", subjects);
  assert.ok(result.error);
  assert.match(result.error, new RegExp(String(MAX_COMPARE)));
});

test("identical monsters differ on nothing", () => {
  const table = buildCompare("monsters", [
    homebrewSubject("A", monster()),
    homebrewSubject("B", monster()),
  ]);
  assert.equal(table.differingRows, 0);
  assert.ok(table.rows.every((row) => row.differs === false));
});

test("a differing stat is marked and an agreeing one is not", () => {
  const table = buildCompare("monsters", [
    homebrewSubject("Tough", monster({ maxHp: 90 })),
    homebrewSubject("Frail", monster({ maxHp: 12 })),
  ]);
  const hp = table.rows.find((row) => row.label === "Hit points");
  const ac = table.rows.find((row) => row.label === "Armour class");
  assert.equal(hp.differs, true);
  assert.equal(ac.differs, false);
  assert.equal(hp.cells[0].text, "90");
  assert.equal(hp.cells[1].text, "12");
});

test("every row has one cell per column", () => {
  const table = buildCompare("monsters", [
    homebrewSubject("A", monster()),
    homebrewSubject("B", monster({ ac: 18 })),
    homebrewSubject("C", monster({ ac: 11 })),
  ]);
  assert.equal(table.columns.length, 3);
  for (const row of table.rows) {
    assert.equal(row.cells.length, 3, `${row.label} has ${row.cells.length} cells for 3 columns`);
  }
});

test("the comparison carries the derived rating, not just the printed one", () => {
  // Two monsters printed at the same CR where one is plainly not: this is the
  // comparison the panel exists for, and it only works if derive-cr runs.
  const stats = monster({ maxHp: 300, ac: 19, cr: 1, attacks: [
    { name: "Slam", toHit: 9, damage: "4d10+6", type: "bludgeoning" },
  ] });
  const table = buildCompare("monsters", [
    homebrewSubject("Honest", monster()),
    homebrewSubject("Liar", stats),
  ]);
  const printed = table.rows.find((row) => row.label === "Printed rating");
  const derived = table.rows.find((row) => row.label === "Derived rating");
  assert.equal(printed.differs, false, "both are printed at CR 1");
  assert.equal(derived.differs, true, "but they are not the same fight");
  assert.equal(derived.cells[1].text, `CR ${deriveCr(stats).cr === 0.5 ? "1/2" : deriveCr(stats).cr}`);
});

test("spells compare on the fields that change how they are cast", () => {
  const table = buildCompare("spells", [
    spellSubject("Fireball", {
      level: 3,
      school: "evocation",
      casting_time: "1 action",
      range: "150 feet",
      duration: "Instantaneous",
      components: "V, S, M",
      concentration: false,
      ritual: false,
      desc: "each creature takes 8d6 fire damage",
    }),
    spellSubject("Fly", {
      level: 3,
      school: "transmutation",
      casting_time: "1 action",
      range: "Touch",
      duration: "Concentration, up to 10 minutes",
      components: "V, S, M",
      concentration: true,
      ritual: false,
      desc: "the target gains a flying speed of 60 feet",
    }),
  ]);
  const by = (label) => table.rows.find((row) => row.label === label);
  assert.equal(by("Level").differs, false, "both are level 3");
  assert.equal(by("Casting time").differs, false);
  assert.equal(by("School").differs, true);
  assert.equal(by("Concentration").cells[0].text, "no");
  assert.equal(by("Concentration").cells[1].text, "yes");
  assert.equal(by("Dice").cells[0].text, "8d6");
  assert.equal(by("Dice").cells[1].text, "none in the text");
});

test("a missing field reads as not stated rather than as blank", () => {
  const table = buildCompare("spells", [
    spellSubject("Bare", { level: 1 }),
    spellSubject("Full", { level: 1, range: "60 feet" }),
  ]);
  const range = table.rows.find((row) => row.label === "Range");
  assert.equal(range.cells[0].text, "not stated");
  assert.equal(range.cells[1].text, "60 feet");
});

// ---- the desk ----

function source(overrides = {}) {
  return {
    kind: "glossary",
    ref: "glossary:concentration",
    name: "Concentration",
    text: "Concentration ends if you cast another spell that needs concentration.",
    origin: "the rules basics",
    ...overrides,
  };
}

test("a question is clamped to a length and collapsed to one line", () => {
  assert.equal(clampDeskQuestion("  how   does\n grappling work?  "), "how does grappling work?");
  assert.equal(clampDeskQuestion("x".repeat(2_000)).length, DESK_QUESTION_MAX);
  assert.equal(clampDeskQuestion("   "), "");
});

test("search terms drop stopwords and keep the 5e ones", () => {
  const terms = deskTerms("How does the grapple save work with cover?");
  assert.ok(terms.includes("grapple"));
  assert.ok(terms.includes("save"), "save is a 5e word, not a stopword");
  assert.ok(terms.includes("cover"), "cover is a 5e word, not a stopword");
  assert.ok(!terms.includes("the"));
  assert.ok(!terms.includes("does"));
});

test("a quoted phrase survives as one term", () => {
  const terms = deskTerms('what triggers an "opportunity attack"');
  assert.ok(terms.includes("opportunity attack"));
});

test("a name match outscores a body match", () => {
  const terms = deskTerms("what does fireball do");
  const named = scoreSource(terms, source({ name: "Fireball", text: "a bright streak" }));
  const mentioned = scoreSource(terms, source({ name: "Scorching Ray", text: "unlike fireball" }));
  assert.ok(named > mentioned);
});

test("evidence with nothing in common with the question is dropped entirely", () => {
  const picked = selectEvidence("how does grappling work", [
    source({ ref: "spell:fireball", name: "Fireball", text: "a bright streak of flame" }),
  ]);
  assert.equal(picked.length, 0);
});

test("a house rule outranks an SRD row that scores the same", () => {
  const text = "Flanking grants advantage on melee attacks.";
  const picked = selectEvidence("does flanking grant advantage", [
    source({ kind: "glossary", ref: "glossary:flanking", name: "Flanking", text }),
    source({ kind: "ruling", ref: "ruling:abc-0", name: "Flanking", text, origin: "your house rules" }),
  ]);
  assert.equal(picked[0].kind, "ruling", "the table's own rule governs at the table");
});

test("the evidence block labels every line with the ref the model must cite", () => {
  const rendered = renderEvidence([source(), source({ ref: "ruling:abc-0", kind: "ruling" })]);
  assert.match(rendered, /\[glossary:concentration\]/);
  assert.match(rendered, /\[ruling:abc-0\]/);
});

test("the model's JSON is read through code fences and stray prose", () => {
  const parsed = parseDeskJson(
    'Sure!\n```json\n{"answer": "It ends.", "citations": [{"kind": "glossary", "ref": "glossary:concentration", "quote": "Concentration ends"}]}\n```',
  );
  assert.equal(parsed.answer, "It ends.");
  assert.equal(parsed.citations.length, 1);
});

test("an unreadable reply is null rather than a half answer", () => {
  assert.equal(parseDeskJson(""), null);
  assert.equal(parseDeskJson("I could not parse that"), null);
  assert.equal(parseDeskJson('{"answer": ""}'), null);
});

test("a citation of an unknown kind is dropped at the parse", () => {
  const parsed = parseDeskJson(
    '{"answer": "x", "citations": [{"kind": "vibes", "ref": "a", "quote": "b"}]}',
  );
  assert.equal(parsed.citations.length, 0);
});

test("a citation the desk never supplied does not survive", () => {
  // The load-bearing assertion of the whole module. A fabricated provenance
  // is worse than a wrong answer, because it looks checked.
  const supplied = [source()];
  const answer = checkCitations(
    {
      answer: "Yes.",
      citations: [
        { kind: "glossary", ref: "glossary:concentration", quote: "Concentration ends" },
        { kind: "spell", ref: "spell:invented", quote: "a spell nobody supplied" },
      ],
    },
    supplied,
  );
  assert.equal(answer.citations.length, 1);
  assert.equal(answer.citations[0].ref, "glossary:concentration");
  assert.equal(answer.grounded, true);
});

test("an answer whose every citation was invented is marked ungrounded", () => {
  const answer = checkCitations(
    { answer: "Yes.", citations: [{ kind: "spell", ref: "spell:invented", quote: "made up" }] },
    [source()],
  );
  assert.equal(answer.citations.length, 0);
  assert.equal(answer.grounded, false);
  assert.equal(answer.answer, "Yes.", "the answer itself still reaches the reader");
});

test("a surviving citation is labelled from the server's record, not the model's", () => {
  const answer = checkCitations(
    {
      answer: "Yes.",
      // The model claims the wrong kind and a name of its own invention.
      citations: [{ kind: "spell", ref: "ruling:abc-0", quote: "the quote" }],
    },
    [source({ kind: "ruling", ref: "ruling:abc-0", name: "Flanking", origin: "your house rules" })],
  );
  assert.equal(answer.citations[0].kind, "ruling");
  assert.equal(answer.citations[0].name, "Flanking");
  assert.equal(answer.citations[0].origin, "your house rules");
});

test("the same source cited twice is listed once", () => {
  const answer = checkCitations(
    {
      answer: "Yes.",
      citations: [
        { kind: "glossary", ref: "glossary:concentration", quote: "first" },
        { kind: "glossary", ref: "glossary:concentration", quote: "second" },
      ],
    },
    [source()],
  );
  assert.equal(answer.citations.length, 1);
});

console.log(`reference desk: ${passed} checks passed`);
