// A race that lets the player choose several cantrips (a homebrew species
// may offer up to three; src/lib/homebrew/race-data.ts) grants every one of
// them. Before, the sheet carried one pick: the builder, the legality check
// and the stored sheet each kept a single name, so a species offering three
// was admitted with one and the two others were lost (audit WA-01).
//
// Checked here: the legality check at every door (src/lib/srd/sheet-legality.ts
// and src/lib/srd/legality/racial-cantrips.ts), the builder's picks, gate,
// reconcile and fill, a saved draft from before the change, the level-up's
// count of free cantrips, the Homebrew rename, and the route a character
// takes to the table.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-racial-cantrip-count");
const creation = await openCreation();
const builder = await openBuilder();
const { legalizeSheet } = await import("../src/lib/srd/sheet-legality.ts");
const { bundledPrices } = await import("../src/lib/srd/starting-wealth.ts");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { bundledSubclassName } = await import("../src/lib/srd/features.ts");
const { namedRacialCantrips, racialCantripsOf } = await import("../src/lib/srd/racial-cantrips.ts");
const { freeCantripCount } = await import("../src/lib/srd/free-cantrips.ts");
const { freeCantripsIn } = await import("../src/app/campaigns/[campaignId]/level-up-preview.ts");
const { renameSheetRefs, renamerOf, sheetRefNames } = await import("../src/lib/homebrew/sheet-refs.ts");
const { reconcilePicks } = await import("../src/app/characters/builder/reconcile.ts");
const { ancestryBlocks } = await import("../src/app/characters/builder/submit.ts");
const { migrateDraftFields } = await import("../src/app/characters/builder/builderDraft.ts");
const { fillRound } = await import("../src/app/characters/builder/quickBuild.ts");
const { racialCantripsDue } = await import("../src/app/characters/builder/levelUpSections.ts");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");

const classOf = (id) => builder.classes.find((entry) => entry.id === id) ?? null;
const backgroundOf = (id) => builder.backgrounds.find((entry) => entry.id === id) ?? null;
const highElf = builder.races.find((entry) => entry.id === "high_elf");
// The high elf, offering `count` wizard cantrips: the shape a homebrew
// species with a cantrip choice reaches the builder and the server in.
const elf = (count) => ({ ...highElf, cantripChoice: { list: "wizard", count } });
const PICKS = ["Prestidigitation", "Ray of Frost", "Shocking Grasp"];
const CLASS_CANTRIPS = ["Fire Bolt", "Light", "Mage Hand"];

function built(fields) {
  const out = builder.build(fields);
  assert.equal(out.blocker, null, out.blocker?.message);
  return out.sheet;
}

const wizard = (race, picks, fields = {}) =>
  built({
    race,
    class: "wizard",
    background: "sage",
    chosenSkills: ["investigation", "medicine"],
    bonusLanguages: ["Dwarvish", "Giant", "Orc"],
    racialCantrips: picks,
    cantrips: CLASS_CANTRIPS,
    spells: ["Magic Missile", "Shield", "Mage Armor", "Detect Magic", "Sleep", "Burning Hands"],
    bookPrepared: ["Magic Missile", "Shield"],
    ...fields,
  });

const fighter = (race, picks, fields = {}) =>
  built({
    race,
    class: "fighter",
    background: "soldier",
    chosenSkills: ["acrobatics", "survival"],
    stylePicks: ["defense"],
    bonusLanguages: ["Dwarvish"],
    racialCantrips: picks,
    ...fields,
  });

// The legality check alone, against the race given (src/lib/srd/legality/types.ts).
function judge(sheet, race, overrides = {}) {
  return legalizeSheet(sheet, {
    door: "table",
    level: 1,
    hpMethod: "average",
    startingWealth: "equipment",
    classOf,
    race: { ...race, feats: 0 },
    background: backgroundOf(sheet.background),
    baseline: null,
    abilityPool: null,
    wealthRoll: null,
    priceOf: bundledPrices,
    spellOf: checklistSpell,
    featOf: () => null,
    subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)),
    rollDie: () => 3,
    ...overrides,
  });
}
const libraryEdit = (sheet) => ({ door: "library", baseline: { sheet, level: 1 } });
const withPicks = (sheet, choices) => ({ ...sheet, racialChoices: { asi: [], skills: [], tool: "", ...choices } });
const countProblem = (problems) => problems.find((problem) => /learns \d+ wizard cantrips? of the player's choice/.test(problem));
const racialFeatures = (sheet) => sheet.features.filter((feature) => /^racial cantrip:/i.test(feature.name)).map((feature) => feature.name);

// ---- the legality check ----

await test("a race offering one, two or three cantrips is admitted with that many, and the sheet keeps them all", () => {
  for (const count of [1, 2, 3]) {
    const picks = PICKS.slice(0, count);
    const caster = judge(wizard(elf(count), picks), elf(count));
    assert.deepEqual(caster.problems, [], `wizard, ${count}`);
    assert.deepEqual(caster.sheet.racialChoices.cantrips, picks);
    assert.equal(caster.sheet.racialChoices.cantrip, picks[0], "the first pick, for an older server");
    // The class's three and the race's, none counted against the class.
    assert.deepEqual([...caster.sheet.spellcasting.cantrips].sort(), [...CLASS_CANTRIPS, ...picks].sort());

    const blade = judge(fighter(elf(count), picks), elf(count));
    assert.deepEqual(blade.problems, [], `fighter, ${count}`);
    assert.deepEqual(racialFeatures(blade.sheet), picks.map((name) => `Racial cantrip: ${name}`));
    assert.deepEqual(blade.sheet.racialChoices.cantrips, picks);
  }
});

await test("the table and the library refuse one too few, one too many, a repeat and a cantrip off the race's list", () => {
  const legal = fighter(elf(3), PICKS);
  const cases = [
    ["one too few", { cantrips: PICKS.slice(0, 2) }, /learns 3 wizard cantrips of the player's choice; this sheet names 2/],
    ["one too many", { cantrips: [...PICKS, "Light"] }, /learns 3 wizard cantrips of the player's choice; this sheet names 4/],
    ["a repeat", { cantrips: ["Fire Bolt", "fire bolt", "Light"] }, /cantrips are different spells; fire bolt is named twice/],
    ["off the list", { cantrips: ["Sacred Flame", "Light", "Mage Hand"] }, /Sacred Flame is not a wizard cantrip/],
  ];
  for (const [label, choices, refusal] of cases) {
    for (const door of [{ door: "table" }, { door: "library" }, libraryEdit(legal)]) {
      const out = judge(withPicks(legal, choices), elf(3), door);
      assert.ok(out.problems.some((problem) => refusal.test(problem)), `${label} at ${door.door}${door.baseline ? " (edit)" : ""}: ${out.problems}`);
    }
  }
  // A wizard's off-list pick is judged with its own lists.
  const caster = judge(withPicks(wizard(elf(1), ["Prestidigitation"]), { cantrips: ["Sacred Flame"] }), elf(1));
  assert.ok(caster.problems.some((problem) => /Sacred Flame is not a wizard cantrip/.test(problem)), caster.problems);
});

await test("a file that names too few owes the rest; a stored character's picks are its own; the engine is not held to the count", () => {
  const short = withPicks(fighter(elf(3), PICKS), { cantrips: ["Prestidigitation"] });
  const imported = judge(short, elf(3), { door: "import" });
  assert.equal(countProblem(imported.problems), undefined, imported.problems);
  assert.ok((imported.owed ?? []).some((line) => /pick 2 wizard cantrips/.test(line)), JSON.stringify(imported.owed));
  // A repeat in a file is still refused.
  const twice = judge(withPicks(short, { cantrips: ["Light", "light"] }), elf(3), { door: "import" });
  assert.ok(twice.problems.some((problem) => /named twice/.test(problem)), twice.problems);

  const stored = judge(short, elf(3), { door: "stored" });
  assert.equal(stored.problems.filter((problem) => /cantrip/i.test(problem)).length, 0, stored.problems);
  assert.deepEqual(stored.sheet.racialChoices.cantrips, ["Prestidigitation"]);

  const engine = judge(short, elf(3), { door: "engine" });
  assert.equal(countProblem(engine.problems), undefined, engine.problems);
});

await test("a sheet written with one pick in `cantrip` still reads: a high elf keeps it, a three-cantrip species asks for the rest", () => {
  const old = { cantrip: "Prestidigitation" };
  const highElfWizard = withPicks(wizard(elf(1), ["Prestidigitation"]), old);
  const out = judge(highElfWizard, elf(1));
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.sheet.racialChoices.cantrips, ["Prestidigitation"]);
  assert.equal(out.sheet.racialChoices.cantrip, "Prestidigitation");

  const threeOffered = withPicks(fighter(elf(3), PICKS), old);
  const edited = judge(threeOffered, elf(3), libraryEdit(threeOffered));
  assert.match(countProblem(edited.problems) ?? "", /this sheet names 1/);
  const kept = judge(threeOffered, elf(3), { door: "stored" });
  assert.equal(countProblem(kept.problems), undefined, kept.problems);
});

// ---- the builder ----

await test("the picks are read back from either shape, and a draft saved before the list keeps its pick", () => {
  assert.deepEqual(racialCantripsOf({ cantrip: "Light" }), ["Light"]);
  assert.deepEqual(racialCantripsOf({ cantrip: "Light", cantrips: ["Fire Bolt", "Light"] }), ["Fire Bolt", "Light"]);
  assert.deepEqual(racialCantripsOf({ cantrip: "", cantrips: [] }), []);
  assert.deepEqual(racialCantripsOf({ cantrips: ["Fire Bolt", "fire bolt "] }), ["Fire Bolt"]);
  assert.deepEqual(namedRacialCantrips({ cantrips: ["Fire Bolt", "fire bolt "] }), ["Fire Bolt", "fire bolt"]);
  assert.deepEqual(racialCantripsOf(null), []);

  const migrated = migrateDraftFields({ name: "Ilvane", racialCantrip: "Light" });
  assert.deepEqual(migrated.racialCantrips, ["Light"]);
  assert.ok(!("racialCantrip" in migrated), "the old field is left behind");
  assert.deepEqual(migrateDraftFields({ name: "Ilvane", racialCantrip: "" }).racialCantrips, []);
  const current = { name: "Ilvane", racialCantrips: ["Fire Bolt", "Light"] };
  assert.deepEqual(migrateDraftFields(current), current);
});

await test("reconcile keeps as many different picks as the race offers, and a new race clears them", () => {
  const context = { race: elf(3), klass: classOf("wizard"), background: backgroundOf("sage"), level: 1 };
  const kept = reconcilePicks({ racialCantrips: ["Fire Bolt", "fire bolt", "Light", "Mage Hand", "Shocking Grasp"] }, context);
  assert.deepEqual(kept.picks.racialCantrips, ["Fire Bolt", "Light", "Mage Hand"]);
  assert.deepEqual(kept.drops.map((drop) => drop.value), ["Shocking Grasp"]);
  // The race's picks are not the class's: they leave the class list.
  const apart = reconcilePicks({ racialCantrips: ["Light"], cantrips: ["Light", "Fire Bolt"] }, context);
  assert.deepEqual(apart.picks.cantrips, ["Fire Bolt"]);

  const halfElf = builder.races.find((entry) => entry.id === "half_elf");
  const cleared = reconcilePicks({ racialCantrips: ["Fire Bolt", "Light"] }, { ...context, race: halfElf });
  assert.deepEqual(cleared.picks.racialCantrips, []);
  assert.deepEqual(cleared.drops.filter((drop) => drop.target === "racialCantrip").length, 2);
});

await test("the ancestry step asks until every cantrip is picked", () => {
  const owed = (picks, race = elf(3)) =>
    ancestryBlocks(builder.stateOf({ racialCantrips: picks, bonusLanguages: ["Dwarvish"] }), race, backgroundOf("soldier"))
      .filter((block) => block.target === "racialCantrip")
      .map((block) => block.message);
  const name = highElf.name;
  assert.deepEqual(owed([]), [`Pick 3 simple spells your ${name} can cast at will (cantrips).`]);
  assert.deepEqual(owed(["Light"]), [`Pick 2 more simple spells your ${name} can cast at will (cantrips).`]);
  assert.deepEqual(owed(["Light", "Fire Bolt"]), [`Pick 1 more simple spell your ${name} can cast at will (cantrip).`]);
  assert.deepEqual(owed(["Light", "light", "Fire Bolt"]), [`Pick 1 more simple spell your ${name} can cast at will (cantrip).`]);
  assert.deepEqual(owed(PICKS), []);
  // One cantrip reads as it always has.
  assert.deepEqual(owed([], elf(1)), [`Pick the simple spell your ${name} can cast at will (cantrip).`]);
  assert.deepEqual(owed(["Light"], elf(1)), []);
});

await test("Choose for me fills every cantrip the race offers, each different and none the class already took", () => {
  const offered = { classes: builder.classes, races: builder.races, backgrounds: builder.backgrounds, recommended: new Set() };
  const round = (racialCantrips) => {
    const fields = builder.stateOf({ raceId: "high_elf", classId: "wizard", backgroundId: "sage", cantrips: CLASS_CANTRIPS, racialCantrips, toolPicks: [] });
    const { derived } = builder.build({ ...fields, race: elf(3), class: "wizard", background: "sage" });
    return fillRound({
      fields, derived, race: elf(3), klass: classOf("wizard"), background: backgroundOf("sage"),
      offered, only: ["racialCantrip"], rng: () => 0.5,
    });
  };
  const fresh = round([]).patch.racialCantrips;
  assert.equal(fresh.length, 3, JSON.stringify(fresh));
  assert.equal(new Set(fresh.map((name) => name.toLowerCase())).size, 3, "a cantrip was picked twice");
  assert.ok(!fresh.some((name) => CLASS_CANTRIPS.includes(name)), `a class cantrip was taken: ${fresh}`);
  const topped = round(["Prestidigitation"]).patch.racialCantrips;
  assert.equal(topped[0], "Prestidigitation", "the player's pick stays first");
  assert.equal(new Set(topped).size, 3);
});

await test("the library's level-up sheet asks for the race's cantrips a stored character came short of", () => {
  assert.equal(racialCantripsDue({ cantrip: "Light" }, 3, new Set()), true);
  assert.equal(racialCantripsDue({ cantrips: PICKS }, 3, new Set()), false);
  assert.equal(racialCantripsDue({ cantrips: PICKS }, 3, new Set(["racialCantrip"])), true);
  assert.equal(racialCantripsDue({ cantrip: "" }, 0, new Set()), false);
});

// ---- the level-up's count and the Homebrew rename ----

await test("a level-up leaves every held racial pick out of the class's count", () => {
  const sheet = (racialChoices) => ({
    race: "homebrew:spark",
    level: 2,
    racialChoices,
    spellcasting: { ability: "int", slots: {}, prepared: [], known: [], cantrips: [...CLASS_CANTRIPS, ...PICKS] },
  });
  // Named picks count without the race's row (a lookup that knows only the
  // bundled races reads 0), and the same as the row's count with it.
  assert.equal(freeCantripCount(sheet({ cantrips: PICKS }), 0), 3);
  assert.equal(freeCantripCount(sheet({ cantrips: PICKS }), 3), 3);
  // A pick the sheet no longer holds is not free.
  assert.equal(freeCantripCount(sheet({ cantrips: [...PICKS.slice(0, 2), "Chill Touch"] }), 0), 2);
  assert.equal(freeCantripCount(sheet({ cantrip: "Prestidigitation" }), 1), 1);
});

await test("a Homebrew rename carries the list, the single pick and a non-caster's feature", () => {
  const sheet = {
    racialChoices: { cantrip: "Old Bolt", cantrips: ["Old Bolt", "Light"] },
    features: [{ name: "Racial cantrip: Old Bolt", source: "story" }, { name: "Racial cantrip: Light", source: "story" }],
  };
  assert.deepEqual(sheetRefNames(sheet).spell.sort(), ["Light", "Old Bolt"]);
  const { sheet: renamed, changed } = renameSheetRefs(sheet, renamerOf([{ kind: "spell", from: "Old Bolt", to: "New Bolt" }]));
  assert.equal(changed, true);
  assert.equal(renamed.racialChoices.cantrip, "New Bolt");
  assert.deepEqual(renamed.racialChoices.cantrips, ["New Bolt", "Light"]);
  assert.deepEqual(renamed.features.map((feature) => feature.name), ["Racial cantrip: New Bolt", "Racial cantrip: Light"]);
});

// ---- the route ----

// A species saved in the workshop, offering three wizard cantrips, as the
// builder reads it. A table reads its owner's workshop and the library its
// own player's, so each saves one.
const homebrew = await creation.world.route("homebrew");
async function sparkbornOf(user) {
  creation.world.signIn(user);
  const saved = await homebrew.POST(
    new Request("http://test/", {
      method: "POST",
      body: JSON.stringify({
        kind: "race",
        name: "Sparkborn",
        data: {
          asi: [{ attributes: ["Intelligence"], value: 2 }, { attributes: ["Dexterity"], value: 1 }],
          speed: { walk: 30 },
          size: "Medium",
          languages: ["Common"],
          traits: "**_Spark._** Three small spells come to you as easily as breath.",
          cantripChoice: { list: "wizard", count: 3 },
        },
      }),
    }),
  );
  const body = await saved.json();
  assert.equal(saved.status, 201, JSON.stringify(body));
  const id = `homebrew:${body.entry.id}`;
  return packRaceOptions([{ slug: id, name: "Sparkborn", documentSlug: "homebrew", document: "Homebrew", data: body.entry.data }], [id])[0];
}
const sparkborn = await sparkbornOf(creation.world.owner);
const ownSparkborn = await sparkbornOf(creation.player);

await test("a Sparkborn fighter with three cantrips joins at the table and through the library, with all three", async () => {
  assert.deepEqual(sparkborn.cantripChoice, { list: "wizard", count: 3 });
  const sheet = fighter(sparkborn, PICKS, { bonusLanguages: [] });
  // The table's copy keeps the features; the library's keeps the picks.
  const at = await creation.atTable(sheet);
  assert.equal(at.status, 201, at.error);
  assert.deepEqual(racialFeatures(at.sheet), PICKS.map((name) => `Racial cantrip: ${name}`));
  const through = await creation.throughLibrary(fighter(ownSparkborn, PICKS, { bonusLanguages: [] }), 1);
  assert.ok(through.status < 300, through.error);
  assert.deepEqual(through.character.sheet.racialChoices.cantrips, PICKS);
  assert.equal(through.character.sheet.racialChoices.cantrip, PICKS[0]);
  assert.deepEqual(racialFeatures(through.sheet), PICKS.map((name) => `Racial cantrip: ${name}`));

  // The sheet the bug let through: three offered, one named.
  const short = await creation.atTable(withPicks(sheet, { cantrip: "Prestidigitation" }));
  assert.equal(short.status, 400);
  assert.match(short.error, /learns 3 wizard cantrips/);
});

await test("a Sparkborn wizard knows its class's three cantrips and the race's three", async () => {
  const at = await creation.atTable(
    wizard(sparkborn, PICKS, { bonusLanguages: ["Dwarvish", "Giant"], bookPrepared: ["Magic Missile", "Shield", "Sleep"] }),
  );
  assert.equal(at.status, 201, at.error);
  assert.deepEqual([...at.sheet.spellcasting.cantrips].sort(), [...CLASS_CANTRIPS, ...PICKS].sort());

  // Its level-up: a table's sheet keeps no racial picks, so the dialog asks
  // the route how many the species gave, and leaves those three out of the
  // class's count as the server does. With the bundled races alone it read
  // none, and offered three fewer new cantrips than the level allows.
  assert.equal(at.sheet.racialChoices ?? null, null, "the table's sheet keeps the features, not the picks");
  const levelUp = await creation.world.route("campaigns/[campaignId]/sheet/level-up");
  creation.world.signIn(creation.player);
  const options = await creation.call(levelUp, "GET", undefined, { campaignId: creation.campaignId });
  assert.equal(options.status, 200, JSON.stringify(options.json));
  assert.equal(options.json.racialCantripChoice, 3);
  const held = at.sheet.spellcasting.cantrips;
  assert.equal(freeCantripsIn(at.sheet, held, options.json.racialCantripChoice), 3);
  assert.equal(freeCantripsIn(at.sheet, held), 0, "the bundled races know no Sparkborn");
});

finish();
