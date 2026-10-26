// The app in people's hands runs the builder of the server it was built
// with: client 0.21.2 compiles the 0.30.2 pages, and a host on this release
// is what it talks to. That builder has no picker for a workshop species'
// choice of packages (issue #538) and one cantrip picker however many a
// species offers (audit WA-01), so its sheets carry neither
// racialChoices.variant nor racialChoices.cantrips. Those sheets were
// refused for picks the page could not make: a Scalekin could not be made or
// edited from the app at all, nor a species offering three cantrips.
//
// Checked here, with the request shape the 0.30.2 builder sends
// (origin/main src/app/characters/builder/submit.ts, racialChoices of asi,
// skills, cantrip, tool, ancestry):
//   one made in the library or at the table is admitted, its pick owed, and
//   today's builder is still refused for leaving the same pick open;
//   an edit of a hero today's builder made on Ashen keeps Ashen, its +1 and
//   its resistance;
//   a species offering three cantrips is admitted with the one the old page
//   names, two owed, and an edit keeps the three a hero holds;
//   a sheet that names both fields is judged as before.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation, PORTRAIT } from "./lib/enforce-creation.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-older-builder-sheets");
const { world, call, libraryRoute, atTable, campaignId, player } = await openCreation();
const builder = await openBuilder();
const homebrewRoute = await world.route("homebrew");
const characterRoute = await world.route("characters/[characterId]");
const previewRoute = await world.route("campaigns/[campaignId]/sheet/preview");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { withSpeciesVariant } = await import("../src/lib/content/species-variants.ts");
const { pcResistances } = await import("../src/lib/dm/pc-defenses.ts");
const { legalizeSheet } = await import("../src/lib/srd/sheet-legality.ts");
const { olderBuilderOf } = await import("../src/lib/srd/legality/older-builder.ts");
const { bundledPrices } = await import("../src/lib/srd/starting-wealth.ts");
const { checklistSpell } = await import("../src/lib/srd/spell-lists.ts");
const { bundledSubclassName } = await import("../src/lib/srd/features.ts");

const owner = world.owner;
const BASE = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const ASHEN = { name: "Ashen", asi: { con: 1 }, resistances: ["fire"], breath: { damageType: "fire", save: "dex", shape: "cone" } };
const MIRRORSCALE = { name: "Mirrorscale", asi: { wis: 1 }, resistances: ["psychic"], skills: ["insight"], languages: ["Draconic"] };
const raceNames = (sheet) => (sheet.features ?? []).filter((feature) => feature.source === "race").map((feature) => feature.name);

// The racialChoices the 0.30.2 builder writes (submit.ts lines 669-676 at
// v0.30.2): no variant, one cantrip.
function olderShape(sheet) {
  const { asi = [], skills = [], cantrip = "", tool = "", ancestry = "", featAbility } = sheet.racialChoices ?? {};
  return {
    ...sheet,
    portrait: sheet.portrait || PORTRAIT,
    racialChoices: { asi, skills, cantrip, tool, ancestry, ...(featAbility ? { featAbility } : {}) },
  };
}

let species;
// The species as the builder's list offers it, and as the 0.30.2 builder
// read it: the same row with no choice on it.
function raceOf(entry) {
  const id = `homebrew:${entry.id}`;
  return packRaceOptions([{ slug: id, name: entry.name, documentSlug: "homebrew", document: "Homebrew", data: entry.data }], [id])[0];
}
function olderRaceOf(entry) {
  const race = { ...raceOf(entry) };
  delete race.variants;
  return race;
}

const fighterOn = (race, variant) => {
  const out = builder.build({
    race,
    class: "fighter",
    background: "soldier",
    scores: BASE,
    chosenSkills: ["acrobatics", "perception"],
    stylePicks: ["defense"],
    ...(variant ? { racialVariant: variant } : {}),
  });
  assert.equal(out.blocker, null, out.blocker?.message);
  return { ...out.sheet, portrait: PORTRAIT };
};

await test("the workshop keeps a Scalekin whose player picks Ashen or Mirrorscale", async () => {
  world.signIn(owner);
  const saved = await call(homebrewRoute, "POST", {
    kind: "race",
    name: "Scalekin",
    data: {
      desc: "Folk with a dragon somewhere in the family.",
      size: "Medium",
      speed: { walk: 30 },
      asi: [{ attributes: ["Strength"], value: 2 }],
      languages: ["Common"],
      traits: "**_Scaled Hide._** Your scales turn the first blow of a fight.",
      variants: { label: "Draconic ancestry", options: [ASHEN, MIRRORSCALE] },
    },
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  species = saved.json.entry;
});

await test("the 0.30.2 builder's Scalekin is made in the library with its ancestry owed, as the base species", async () => {
  const sent = olderShape(fighterOn(olderRaceOf(species)));
  assert.deepEqual(olderBuilderOf(sent), { variant: true, cantrips: true });
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: sent });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const sheet = made.json.character.sheet;
  assert.equal(sheet.racialChoices.variant, "");
  assert.equal(sheet.racialChoices.variantGrants, undefined);
  assert.deepEqual(raceNames(sheet), ["Scaled Hide"]);
  assert.equal(sheet.abilities.str, 17);
  assert.equal(sheet.abilities.con, 13);
});

await test("today's builder leaving the same pick open is still refused", async () => {
  const today = fighterOn(withSpeciesVariant(raceOf(species), "ashen"), "ashen");
  assert.equal(olderBuilderOf(today), null, "today's builder sends both fields");
  world.signIn(owner);
  const open = await call(libraryRoute, "POST", { level: 1, sheet: { ...today, racialChoices: { ...today.racialChoices, variant: "" } } });
  assert.equal(open.status, 400);
  assert.ok(open.json.problems.includes("A Scalekin chooses a draconic ancestry: one of Ashen, Mirrorscale."), open.json.problems.join(" | "));
});

await test("at the table the 0.30.2 builder's Scalekin takes its seat, and the confirm sheet before it says it may", async () => {
  const sent = olderShape(fighterOn(olderRaceOf(species)));
  world.signIn(player);
  const preview = await call(previewRoute, "POST", { sheet: sent }, { campaignId });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.preview.ok, true, preview.json.preview.problems?.join(" | "));
  const seated = await atTable(sent);
  assert.equal(seated.status, 201, seated.error);
  // A table's sheet keeps the race's features, not its picks.
  assert.deepEqual(raceNames(seated.sheet), ["Scaled Hide"]);
});

await test("the 0.30.2 builder's edit of a hero made on Ashen keeps Ashen, its +1 Constitution and its fire resistance", async () => {
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: fighterOn(withSpeciesVariant(raceOf(species), "ashen"), "ashen") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const hero = made.json.character;
  assert.equal(hero.sheet.abilities.con, 14);
  // The old builder sends the stored character back rebuilt, its scores as
  // stored and no variant, with a new name typed in.
  const edited = await call(characterRoute, "PATCH", { level: 1, sheet: olderShape({ ...hero.sheet, name: "Cinder Reborn" }) }, { characterId: hero.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const sheet = edited.json.character.sheet;
  assert.equal(sheet.name, "Cinder Reborn");
  assert.equal(sheet.racialChoices.variant, "ashen");
  assert.equal(sheet.abilities.con, 14);
  assert.ok(raceNames(sheet).includes("Draconic ancestry (Ashen)"), raceNames(sheet).join(", "));
  assert.match(pcResistances(sheet), /\bfire\b/);
});

// ---- a species offering three cantrips ----

const classOf = (id) => builder.classes.find((entry) => entry.id === id) ?? null;
const backgroundOf = (id) => builder.backgrounds.find((entry) => entry.id === id) ?? null;
const highElf = builder.races.find((entry) => entry.id === "high_elf");
const elf3 = { ...highElf, cantripChoice: { list: "wizard", count: 3 } };
const PICKS = ["Prestidigitation", "Ray of Frost", "Shocking Grasp"];

function judge(sheet, overrides = {}) {
  return legalizeSheet(sheet, {
    door: "table",
    level: 1,
    hpMethod: "average",
    startingWealth: "equipment",
    classOf,
    race: { ...elf3, feats: 0 },
    background: backgroundOf(sheet.background),
    baseline: null,
    abilityPool: null,
    wealthRoll: null,
    priceOf: bundledPrices,
    spellOf: checklistSpell,
    featOf: () => null,
    subclassOffered: (classId, name) => Boolean(bundledSubclassName(classId, name)),
    rollDie: () => 3,
    olderBuilder: olderBuilderOf(sheet),
    ...overrides,
  });
}

const fighter = (picks, race = elf3) => {
  const out = builder.build({
    race,
    class: "fighter",
    background: "soldier",
    chosenSkills: ["acrobatics", "survival"],
    stylePicks: ["defense"],
    bonusLanguages: ["Dwarvish"],
    racialCantrips: picks,
  });
  assert.equal(out.blocker, null, out.blocker?.message);
  return out.sheet;
};

await test("the 0.30.2 builder's one pick for a species offering three is admitted, the other two owed", () => {
  // The 0.30.2 builder asks for one cantrip whatever the count, as a
  // one-cantrip race is asked today.
  const sent = olderShape(fighter([PICKS[0]], { ...highElf, cantripChoice: { list: "wizard", count: 1 } }));
  assert.equal(sent.racialChoices.cantrip, PICKS[0]);
  const judged = judge(sent);
  assert.deepEqual(judged.problems, []);
  assert.deepEqual(judged.sheet.racialChoices.cantrips, [PICKS[0]]);
  assert.ok((judged.owed ?? []).some((line) => /pick 2 wizard cantrips/.test(line)), (judged.owed ?? []).join(" | "));
  // Today's builder naming one of three is refused, as it was.
  const today = { ...sent, racialChoices: { ...sent.racialChoices, cantrips: [PICKS[0]] } };
  const refused = judge(today, { olderBuilder: null });
  assert.ok(refused.problems.some((problem) => /learns 3 wizard cantrips of the player's choice; this sheet names 1/.test(problem)), refused.problems.join(" | "));
});

await test("the 0.30.2 builder's edit keeps the three cantrips a hero holds, with the first one swapped when the player changed it", () => {
  const stored = judge(fighter(PICKS), { olderBuilder: null });
  assert.deepEqual(stored.problems, []);
  assert.deepEqual(stored.sheet.racialChoices.cantrips, PICKS);
  const edit = { door: "library", baseline: { sheet: stored.sheet, level: 1 } };
  const kept = judge(olderShape(stored.sheet), edit);
  assert.deepEqual(kept.problems, []);
  assert.deepEqual(kept.sheet.racialChoices.cantrips, PICKS);
  const swapped = olderShape(stored.sheet);
  swapped.racialChoices.cantrip = "Light";
  swapped.features = swapped.features.map((feature) => (feature.name === `Racial cantrip: ${PICKS[0]}` ? { ...feature, name: "Racial cantrip: Light" } : feature));
  const changed = judge(swapped, edit);
  assert.deepEqual(changed.problems, []);
  assert.deepEqual(changed.sheet.racialChoices.cantrips, ["Light", PICKS[1], PICKS[2]]);
});

await finish();
