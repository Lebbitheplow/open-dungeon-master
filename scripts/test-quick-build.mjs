// The quick-build engine (src/app/characters/builder/quickBuild.ts): the
// quiz's four answers and "Fill what's left" both end in a character the
// builder's own save check passes and the server stores, and a fill never
// changes a pick the player made.
//
// The builder runs without a browser (scripts/lib/enforce-builder.mjs): each
// round reads what useBuilderDerived made of the fields, as the wizard
// does between renders, and the finished sheet goes through the real
// library route.
import assert from "node:assert/strict";
import { hasPack } from "./lib/enforce-world.mjs";
import { openCreation, PORTRAIT } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const quick = await import("../src/app/characters/builder/quickBuild.ts");
const { QUIZ_ROLES, QUIZ_METHODS, QUIZ_SOURCES, QUIZ_OUTSIDE, asksSource, suggestBuilds, fillRound, FILL_ROUNDS } = quick;

const builder = await openBuilder();
const { call, libraryRoute, world, player } = await openCreation();
world.signIn(player);
const offered = { classes: builder.classes, races: builder.races, backgrounds: builder.backgrounds };
const contentRoute = await world.route("content/[kind]");

// The spells the spell step offers a class (src/components/sheet/
// useSpellPool.ts): the content route, page by page, as the browser asks.
const pools = new Map();
async function spellPool(classSlug, maxLevel) {
  const key = `${classSlug}:${maxLevel}`;
  if (!classSlug) return [];
  if (!pools.has(key)) {
    const rows = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const params = new URLSearchParams({ class: classSlug, level: String(maxLevel), limit: "100", offset: String(offset) });
      const response = await contentRoute.GET(new Request(`http://test/api/content/spells?${params}`), { params: Promise.resolve({ kind: "spells" }) });
      const page = (await response.json()).results ?? [];
      rows.push(...page.map((row) => ({ name: row.name, level: Number(row.level ?? 0) })));
      if (page.length < 100) break;
    }
    pools.set(key, rows);
  }
  return pools.get(key);
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// A fixed sequence, so a failing build names the same character every run.
function seeded(seed = 7) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

const EMPTY_SCORES = { str: null, dex: null, con: null, int: null, wis: null, cha: null };

// A fresh builder's fields: nothing picked.
function fresh(fields = {}) {
  return builder.stateOf({ name: "", raceId: "", classId: "", backgroundId: "", scores: EMPTY_SCORES, rollSlots: EMPTY_SCORES, toolPicks: [], ...fields });
}

function derive(fields) {
  return builder.build({ race: fields.raceId, class: fields.classId, background: fields.backgroundId, ...fields });
}

// Every round the wizard would run: fill, re-derive, until a round fills
// nothing. Returns the fields and every pick the engine read back.
async function runFill(start, { answers, only, rng = seeded() } = {}) {
  let fields = start;
  const filled = [];
  for (let round = 0; round < FILL_ROUNDS; round += 1) {
    const { derived } = derive(fields);
    const race = builder.races.find((entry) => entry.id === fields.raceId);
    const klass = builder.classes.find((entry) => entry.id === fields.classId);
    const background = builder.backgrounds.find((entry) => entry.id === fields.backgroundId);
    const pool = derived.casts ? await spellPool(derived.spellSearchClass, derived.maxSpellLevel) : [];
    const step = fillRound({ fields, derived, race, klass, background, offered, answers, only, rng, spellPool: pool });
    if (!step.filled.length) break;
    fields = { ...fields, ...step.patch };
    filled.push(...step.filled);
  }
  return { fields, filled };
}

async function saves(fields, label) {
  const built = derive(fields);
  assert.equal(built.blocker, null, `${label}: the builder's save check refused it: ${JSON.stringify(built.blocker)}`);
  const made = await call(libraryRoute, "POST", { level: built.level, sheet: { ...built.sheet, portrait: PORTRAIT } });
  assert.ok(made.status < 400, `${label}: the server refused it (${made.status}): ${JSON.stringify(made.json)}`);
  return built;
}

// Every quiz path: each job, each way, each source where it is asked, each
// life outside a fight.
const paths = [];
for (const role of QUIZ_ROLES) {
  for (const method of QUIZ_METHODS) {
    const sources = asksSource(method.id) ? QUIZ_SOURCES.map((source) => source.id) : [undefined];
    for (const source of sources) {
      paths.push({ role: role.id, method: method.id, source, outside: QUIZ_OUTSIDE[paths.length % QUIZ_OUTSIDE.length].id });
    }
  }
}

await test("every quiz path suggests two different characters", () => {
  for (const answers of paths) {
    const seeds = suggestBuilds(answers, offered);
    assert.equal(seeds.length, 2, JSON.stringify(answers));
    assert.notEqual(seeds[0].classId, seeds[1].classId, JSON.stringify(answers));
  }
});

await test("the first question is the playstyle picker's, in its words", async () => {
  const { PLAYSTYLES } = await import("../src/app/characters/builder/playstyles.ts");
  assert.deepEqual(QUIZ_ROLES.map((role) => [role.id, role.label]), PLAYSTYLES.map((style) => [style.id, style.label]));
  assert.deepEqual(QUIZ_ROLES.map((role) => role.label), [
    "Hold the line, take the hits",
    "Deal the damage",
    "Keep everyone alive",
    "Help the team, control the battlefield",
    "Scout, sneak, solve problems",
  ]);
  // Each with the gamer's word for it, as the design names them.
  assert.deepEqual(QUIZ_ROLES.map((role) => role.tag), ["Tank", "DPS", "Healer", "Support / Control", "Utility"]);
});

await test("the answers lead to the class they describe", () => {
  const first = (answers) => suggestBuilds(answers, offered)[0].classId;
  assert.equal(first({ role: "healer", method: "magic", source: "faith", outside: "lore" }), "cleric");
  assert.equal(first({ role: "dps", method: "magic", source: "bargain", outside: "talk" }), "warlock");
  assert.equal(first({ role: "support", method: "magic", source: "music", outside: "talk" }), "bard");
  assert.equal(first({ role: "support", method: "magic", source: "study", outside: "lore" }), "wizard");
  assert.equal(first({ role: "tank", method: "weapons", outside: "door" }), "fighter");
  assert.equal(first({ role: "utility", method: "weapons", outside: "explore" }), "rogue");
});

await test("the species' bonus fits the class", () => {
  const seed = suggestBuilds({ role: "support", method: "magic", source: "study", outside: "lore" }, offered)[0];
  const race = builder.races.find((entry) => entry.id === seed.raceId);
  assert.ok((race.asi.int ?? 0) > 0 || race.asiChoice, `${seed.raceId} raises no Intelligence`);
  const fighter = suggestBuilds({ role: "tank", method: "weapons", outside: "door" }, offered)[0];
  const fighterRace = builder.races.find((entry) => entry.id === fighter.raceId);
  assert.ok((fighterRace.asi.str ?? 0) > 0, `${fighter.raceId} raises no Strength`);
});

await test("the last answer picks the background", () => {
  assert.equal(suggestBuilds({ role: "dps", method: "weapons", outside: "lore" }, offered)[0].backgroundId, "sage");
  assert.equal(suggestBuilds({ role: "dps", method: "weapons", outside: "door" }, offered)[0].backgroundId, "soldier");
});

for (const level of [1, 5]) {
  await test(`every quiz path builds a level ${level} character the builder and the server accept`, async () => {
    for (const answers of paths) {
      for (const seed of suggestBuilds(answers, offered)) {
        const label = `${JSON.stringify(answers)} ${seed.classId}/${seed.raceId}/${seed.backgroundId} at ${level}`;
        const { fields } = await runFill(fresh({ level, raceId: seed.raceId, classId: seed.classId, backgroundId: seed.backgroundId }), { answers });
        await saves(fields, label);
      }
    }
  });
}

await test("every class fills to a legal character at levels 1, 3, 8 and 12", async () => {
  for (const klass of builder.classes) {
    for (const level of [1, 3, 8, 12]) {
      const { fields } = await runFill(fresh({ level, classId: klass.id }));
      await saves(fields, `${klass.id} at ${level}`);
    }
  }
});

// Without the content pack the server judges spells by the bundled
// checklist (src/lib/characters/catalog.ts spellFactsFor), which carries
// three 1st-level artificer spells; a level 3 artificer may prepare four.
// The server holds a caster to at most its count, so three save; the
// builder asks for no more than exist, and says why on the spell step.
await test("a level 3 artificer takes the three spells there are, is told why, and saves", async () => {
  const { spellShortageLines } = await import("../src/app/characters/builder/spellSupply.ts");
  const { fields } = await runFill(fresh({ level: 3, classId: "artificer" }));
  const built = derive(fields);
  const count = built.derived.spellAdvice.count;
  assert.ok(count > 3, `a level 3 artificer prepares ${count}`);
  assert.equal(built.derived.spellSupply.spells, 3);
  if (hasPack) {
    // The content pack's artificer list is long enough: the fill takes the
    // whole count from it, every pick on the list the step offers, and the
    // step (which counts that list) says nothing is missing.
    const { spellSupplyOf } = await import("../src/app/characters/builder/spellSupply.ts");
    const pool = await spellPool("artificer", built.derived.maxSpellLevel);
    const onList = new Set(pool.map((spell) => spell.name));
    assert.equal(fields.spells.length, count);
    assert.deepEqual(fields.spells.filter((name) => !onList.has(name)), []);
    const shown = spellShortageLines({
      className: "artificer",
      supply: spellSupplyOf(pool, built.derived.maxSpellLevel, []),
      cantripCap: built.derived.cantripAdvice,
      listCap: count,
      listVerb: "prepare",
      maxSpellLevel: built.derived.maxSpellLevel,
    });
    assert.deepEqual(shown, []);
    await saves(fields, "artificer at 3, with the pack");
    return;
  }
  assert.deepEqual([...fields.spells].sort(), ["Absorb Elements", "Caustic Brew", "Snare"]);
  const lines = spellShortageLines({
    className: "artificer",
    supply: built.derived.spellSupply,
    cantripCap: built.derived.cantripAdvice,
    listCap: built.derived.spellAdvice.count,
    listVerb: "prepare",
    maxSpellLevel: built.derived.maxSpellLevel,
  });
  assert.deepEqual(lines, [
    `This server's spell list has only 3 artificer spells, and you may prepare ${count}. Take all 3; the ${count - 3 === 1 ? "missing one does" : `${count - 3} missing ones do`} not stop you saving.`,
    "Whoever runs this server can add more by installing the content pack.",
  ]);
  await saves(fields, "artificer at 3");
});

await test("the shortage reads plainly for one, none, and cantrips", async () => {
  const { spellShortageLines } = await import("../src/app/characters/builder/spellSupply.ts");
  const base = { className: "artificer", cantripCap: 2, listCap: 4, listVerb: "prepare", maxSpellLevel: 2 };
  assert.deepEqual(spellShortageLines({ ...base, supply: { cantrips: 7, spells: 9 } }), []);
  assert.equal(
    spellShortageLines({ ...base, supply: { cantrips: 1, spells: 9 } })[0],
    "This server's spell list has only 1 artificer cantrip, and you may know 2. Take it; the missing one does not stop you saving.",
  );
  assert.equal(
    spellShortageLines({ ...base, supply: { cantrips: 7, spells: 0 } })[0],
    "This server's spell list has no artificer spells up to level 2, and you may prepare 4. The 4 missing ones do not stop you saving.",
  );
});

await test("the spell step's fill offers only spells the server takes, for every caster", async () => {
  const { spellOnSavedList } = await import("../src/app/characters/builder/spellSupply.ts");
  for (const klass of builder.classes) {
    for (const level of [1, 3, 5]) {
      const { fields: built } = await runFill(fresh({ level, classId: klass.id }));
      const { derived } = derive(built);
      if (!derived.casts) continue;
      // The step's button on an empty spell list.
      const empty = { ...built, cantrips: [], spells: [], bookPrepared: [] };
      const pool = await spellPool(derived.spellSearchClass, derived.maxSpellLevel);
      const fill = quick.fillSpells({ fields: empty, derived: derive(empty).derived, klass, spellPool: pool });
      const picked = [...(fill?.patch.cantrips ?? []), ...(fill?.patch.spells ?? [])];
      const rule = { third: klass.casterType === "none", spellClass: derived.spellSearchClass, spellPool: pool };
      assert.deepEqual(picked.filter((name) => !spellOnSavedList(name, rule)), [], `${klass.id} at ${level}`);
      await saves({ ...empty, ...(fill?.patch ?? {}) }, `${klass.id} at ${level}, filled on the spell step`);
    }
  }
});

await test("the artificer's suggestions the bundled list refuses are neither starred nor filled", async () => {
  const { spellOnSavedList } = await import("../src/app/characters/builder/spellSupply.ts");
  const rule = { third: false, spellClass: "artificer", spellPool: await spellPool("artificer", 1) };
  for (const name of ["Guidance", "Mending", "Cure Wounds", "Faerie Fire"]) {
    assert.equal(spellOnSavedList(name, rule), false, name);
    assert.equal(spellOnSavedList(name, { ...rule, spellPool: undefined }), false, `${name} without the pool`);
  }
  assert.equal(spellOnSavedList("Absorb Elements", rule), true);
  // The step reads the same rule for its stars, its tiles and its button.
  const fs = await import("node:fs");
  const step = fs.readFileSync(new URL("../src/app/characters/builder/steps/SpellsGearStep.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(step, /starterCantrips = \(starters\?\.cantrips \?\? \[\]\)\.filter\(\(entry\) => spellOnSavedList\(entry\.n, listRule\)\)/);
  assert.match(step, /const fill = fillSpells\(/);
  assert.doesNotMatch(step, /starters\.(cantrips|spells)\s*\.map/, "the step reads its starters without the rule");
  assert.match(step, /data-spell-shortage/);
});

await test("a fill from nothing picks a class, species, background, name and scores", async () => {
  const { fields, filled } = await runFill(fresh());
  assert.ok(fields.classId && fields.raceId && fields.backgroundId && fields.name.trim());
  assert.ok(Object.values(fields.scores).every((score) => typeof score === "number"));
  const targets = new Set(filled.map((pick) => pick.target));
  for (const target of ["class", "race", "background", "name", "scores", "classSkills"]) {
    assert.ok(targets.has(target), `nothing read back for ${target}`);
  }
  await saves(fields, "from nothing");
});

await test("a fill never changes a pick the player made", async () => {
  const mine = fresh({
    level: 4,
    name: "Odile",
    raceId: "half_elf",
    classId: "rogue",
    chosenSkills: ["investigation"],
    racialAsi: ["", "int"],
    bonusLanguages: ["Dwarvish"],
    expertisePicks: ["investigation"],
    method: "pointbuy",
    scores: { str: 8, dex: 15, con: 14, int: 15, wis: 10, cha: 8 },
  });
  const { fields } = await runFill(mine);
  assert.equal(fields.name, "Odile");
  assert.equal(fields.raceId, "half_elf");
  assert.equal(fields.classId, "rogue");
  assert.equal(fields.method, "pointbuy");
  assert.deepEqual(fields.scores, mine.scores);
  assert.ok(fields.chosenSkills.includes("investigation"));
  assert.equal(fields.chosenSkills[0], "investigation");
  assert.equal(fields.racialAsi[1], "int");
  assert.equal(fields.bonusLanguages[0], "Dwarvish");
  assert.equal(fields.expertisePicks[0], "investigation");
  // And what it left open, it filled.
  assert.ok(fields.backgroundId);
  assert.equal(fields.chosenSkills.length, 4);
  assert.ok(fields.asiChoices[0], "the level 4 improvement is filled");
  await saves(fields, "kept picks");
});

await test("Undo puts back exactly what was there", async () => {
  const before = fresh({ level: 3, classId: "wizard", name: "Pell" });
  const snapshot = structuredClone(before);
  const { fields } = await runFill(before);
  assert.notDeepEqual(fields, snapshot);
  // The builder's Undo is restoreDraft(snapshot): every field the fill
  // wrote was blank in the snapshot, and the snapshot is untouched.
  assert.deepEqual(before, snapshot, "the fill must not mutate the fields it was handed");
  for (const key of quick.changedFields(snapshot, fields)) {
    const was = snapshot[key];
    const blank =
      was === "" || was === null || (Array.isArray(was) && was.every((entry) => !entry)) ||
      (typeof was === "object" && was !== null && Object.values(was).every((entry) => entry === null)) ||
      key === "method" || key === "featChoices";
    assert.ok(blank, `the fill wrote over ${key}: ${JSON.stringify(was)}`);
  }
});

await test("Undo from a reopened read-back leaves a pick changed since", async () => {
  const before = fresh({ level: 1, classId: "fighter" });
  const { fields: after } = await runFill(before);
  // The player keeps the fill, then changes the race and the class skills.
  const now = { ...after, raceId: "halfling", chosenSkills: ["acrobatics", "history"] };
  const undo = quick.undoFill(before, after, now);
  assert.ok(!("raceId" in undo), "the race the player chose stays");
  assert.ok(!("chosenSkills" in undo), "the skills the player chose stay");
  assert.equal(undo.backgroundId, "", "the background the fill picked goes");
  assert.equal(undo.name, "", "the name the fill rolled goes");
  assert.ok(!("classId" in undo), "the class was the player's before the fill");
  // Straight after a fill, Undo is the whole of it.
  assert.deepEqual({ ...after, ...quick.undoFill(before, after, after) }, before);
});

await test("Pick for me on the subclass card fills only the subclass", async () => {
  const start = fresh({ level: 3, classId: "fighter", raceId: "human", backgroundId: "soldier" });
  const { fields, filled } = await runFill(start, { only: ["subclass"] });
  assert.ok(fields.subclass, "a subclass is picked");
  assert.deepEqual(fields.chosenSkills, [], "no class skills were picked");
  assert.deepEqual(fields.scores, EMPTY_SCORES, "no scores were placed");
  assert.ok(filled.every((pick) => pick.target === "subclass"));
});

await test("Pick for me on an improvement card takes the numbers, never a feat", async () => {
  const start = fresh({ level: 8, classId: "fighter", raceId: "human", backgroundId: "soldier", scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 } });
  const { fields, filled } = await runFill(start, { only: ["asi"] });
  assert.equal(fields.asiChoices.filter(Boolean).length, 3, "a fighter improves at 4, 6 and 8");
  assert.ok(fields.asiChoices.every((choice) => choice.mode !== "feat"));
  assert.equal(fields.asiChoices[0].mode, "plus2");
  assert.equal(fields.asiChoices[0].ability, "str");
  assert.ok(filled.every((pick) => pick.target === "asi"));
  assert.equal(fields.subclass, "", "the subclass row stays blank");
});

await test("the DM's quick companion: a party that needs a healer gets a legal healer at the table's level", async () => {
  const answers = { role: "healer", method: "magic", source: "nature", outside: "explore" };
  const [seed] = suggestBuilds(answers, offered);
  assert.equal(seed.classId, "druid");
  const { fields } = await runFill(fresh({ level: 6, raceId: seed.raceId, classId: seed.classId, backgroundId: seed.backgroundId }), { answers });
  const built = await saves(fields, "companion");
  assert.equal(built.level, 6);
  assert.ok(built.sheet.spellcasting.prepared.length + built.sheet.spellcasting.known.length > 0);
});

world.close?.();
console.log(`\n${passed} passed`);
