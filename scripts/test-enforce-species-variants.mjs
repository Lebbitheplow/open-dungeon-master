// A species of the DM's own whose player picks a package (issue #538): a
// Scalekin, part dragon, whose player picks its draconic ancestry. The two
// ancestries are this table's own: Ashen (+1 Constitution, resists fire,
// breathes fire in a 15 ft. cone against a Dexterity save) and Mirrorscale
// (+1 Wisdom, resists psychic damage, breathes it in a 5 by 30 ft. line
// against a Wisdom save, knows Insight and Draconic).
//
// Through the real routes and a real database:
//   the workshop keeps a choice whole and refuses one past its limits;
//   a character made on Ashen holds exactly Ashen's grants, and an edit to
//   Mirrorscale holds exactly Mirrorscale's, with nothing of Ashen left;
//   a pick the species does not offer, a pick left open, and a pick on a
//   species with no choice are refused;
//   an option removed in the workshop leaves a stored character playing as
//   it was made, while its next edit is asked for a pick that exists;
//   at the table the breath is spent as the option says, comes back on a
//   short rest, and grows with the level;
//   a Workshop bundle and a character file carry the species and the pick.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { openCreation, PORTRAIT } from "./lib/enforce-creation.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { openBuilder } from "./lib/enforce-builder.mjs";

const { test, finish } = suite("test-enforce-species-variants");
const { world, call, libraryRoute, characters } = await openCreation();
const builder = await openBuilder();
const homebrewRoute = await world.route("homebrew");
const homebrewEntry = await world.route("homebrew/[id]");
const characterRoute = await world.route("characters/[characterId]");
const importRoute = await world.route("characters/import");
const { packRaceOptions } = await import("../src/lib/content/race-options.ts");
const { withSpeciesVariant } = await import("../src/lib/content/species-variants.ts");
const { listHomebrew } = await import("../src/lib/db/homebrew.ts");
const { pcResistances } = await import("../src/lib/dm/pc-defenses.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { readBundle } = await import("../src/lib/workshop/bundle.ts");
const { buildCharacterBundle } = await import("../src/lib/character-bundle.ts");
const { characterFileShelf } = await import("../src/lib/db/character-file.ts");

const owner = world.owner;
const ASHEN = {
  name: "Ashen",
  description: "Grey scales, and a breath of cinders.",
  asi: { con: 1 },
  resistances: ["fire"],
  breath: { damageType: "fire", save: "dex", shape: "cone" },
};
const MIRRORSCALE = {
  name: "Mirrorscale",
  asi: { wis: 1 },
  resistances: ["psychic"],
  skills: ["insight"],
  languages: ["Draconic"],
  breath: { damageType: "psychic", save: "wis", shape: "line" },
};
const MOONSTONE = { id: "moonstone", name: "Moonstone", asi: { cha: 1 }, resistances: ["radiant"] };
const scalekin = (options) => ({
  desc: "Folk with a dragon somewhere in the family.",
  size: "Medium",
  speed: { walk: 30 },
  asi: [{ attributes: ["Strength"], value: 2 }],
  languages: ["Common"],
  traits: "**_Scaled Hide._** Your scales turn the first blow of a fight.",
  variants: { label: "Draconic ancestry", options },
});
const BASE = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
const names = (sheet) => (sheet.features ?? []).map((feature) => feature.name);
const raceNames = (sheet) => (sheet.features ?? []).filter((feature) => feature.source === "race").map((feature) => feature.name);

async function brew(name, data, user = owner) {
  world.signIn(user);
  return call(homebrewRoute, "POST", { kind: "race", name, data });
}

// The species as the builder's list offers it.
function raceOf(entry) {
  const id = `homebrew:${entry.id}`;
  return packRaceOptions([{ slug: id, name: entry.name, documentSlug: "homebrew", document: "Homebrew", data: entry.data }], [id])[0];
}

// A level 1 soldier fighter on the option, built by the builder's own code
// with the race read as the wizard reads it (CharacterBuilder.tsx).
function built(entry, variant) {
  const result = builder.build({
    race: withSpeciesVariant(raceOf(entry), variant),
    class: "fighter",
    background: "soldier",
    scores: BASE,
    chosenSkills: ["acrobatics", "perception"],
    stylePicks: ["defense"],
    racialVariant: variant,
  });
  assert.equal(result.blocker, null, result.blocker?.message);
  return { ...result.sheet, portrait: PORTRAIT };
}

let species;
let hero;

await test("the workshop keeps a choice of two options, ids made from their names; one of seventeen is refused and nothing is kept", async () => {
  const saved = await brew("Scalekin", scalekin([ASHEN, MIRRORSCALE]));
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  species = saved.json.entry;
  assert.deepEqual(species.data.variants.options.map((option) => option.id), ["ashen", "mirrorscale"]);
  assert.deepEqual(species.data.variants.options[1].skills, ["insight"]);
  const before = listHomebrew(owner.id, "race").length;
  const crowded = await brew("Crowdkin", scalekin(Array.from({ length: 17 }, (_, at) => ({ name: `Scale ${at + 1}` }))));
  assert.equal(crowded.status, 400);
  assert.match(crowded.json.error, /A choice holds 2 to 16 options; this one has 17\./);
  assert.equal(listHomebrew(owner.id, "race").length, before, "a refused species was kept");
});

await test("a character made on Ashen holds Ashen's record, resistance and breath, +1 Constitution, and resists fire", async () => {
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built(species, "ashen") });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  hero = made.json.character;
  assert.deepEqual(raceNames(hero.sheet), ["Scaled Hide", "Draconic ancestry (Ashen)", "Fire Resistance", "Breath Weapon (fire, 15 ft. cone, DEX save)"]);
  assert.equal(hero.sheet.racialChoices.variant, "ashen");
  assert.equal(hero.sheet.abilities.str, 17);
  assert.equal(hero.sheet.abilities.con, 14);
  assert.equal(hero.sheet.abilities.wis, 10);
  assert.match(pcResistances(hero.sheet), /\bfire\b/);
});

async function edit(sheet) {
  world.signIn(owner);
  return call(characterRoute, "PATCH", { level: 1, sheet }, { characterId: hero.id });
}

await test("an edit to Mirrorscale leaves nothing of Ashen: no fire resistance or fire breath, and +1 Wisdom, Insight and Draconic instead", async () => {
  const edited = await edit(built(species, "mirrorscale"));
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const sheet = edited.json.character.sheet;
  assert.deepEqual(raceNames(sheet), ["Scaled Hide", "Draconic ancestry (Mirrorscale)", "Psychic Resistance", "Breath Weapon (psychic, 5 by 30 ft. line, WIS save)"]);
  assert.doesNotMatch(pcResistances(sheet), /\bfire\b/);
  assert.equal(sheet.abilities.con, 13);
  assert.equal(sheet.abilities.wis, 11);
  assert.ok(sheet.proficiencies.skills.includes("insight"));
  assert.ok(sheet.proficiencies.languages.includes("Draconic"));
  // And back: Mirrorscale's Insight and Draconic go with it, though the
  // stored character held them.
  const back = await edit(built(species, "ashen"));
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.ok(!back.json.character.sheet.proficiencies.skills.includes("insight"), "Insight stayed after Mirrorscale was given up");
  assert.ok(!back.json.character.sheet.proficiencies.languages.includes("Draconic"), "Draconic stayed after Mirrorscale was given up");
  assert.equal(back.json.character.sheet.abilities.con, 14);
  assert.equal(back.json.character.sheet.abilities.wis, 10);
});

await test("a pick the species does not offer, a pick left open, and a pick on a species with no choice are refused", async () => {
  world.signIn(owner);
  const ashen = built(species, "ashen");
  const injected = await call(libraryRoute, "POST", { level: 1, sheet: { ...ashen, racialChoices: { ...ashen.racialChoices, variant: "amethyst" } } });
  assert.equal(injected.status, 400);
  assert.ok(injected.json.problems.includes('"amethyst" is not a draconic ancestry the Scalekin offers; pick one of Ashen, Mirrorscale.'), injected.json.problems.join(" | "));
  const open = await call(libraryRoute, "POST", { level: 1, sheet: { ...ashen, racialChoices: { ...ashen.racialChoices, variant: "" } } });
  assert.equal(open.status, 400);
  assert.ok(open.json.problems.includes("A Scalekin chooses a draconic ancestry: one of Ashen, Mirrorscale."), open.json.problems.join(" | "));
  const human = builder.build({ race: "human", class: "fighter", background: "soldier", scores: BASE, chosenSkills: ["acrobatics", "perception"], stylePicks: ["defense"], bonusLanguages: ["Giant"] });
  assert.equal(human.blocker, null, human.blocker?.message);
  const stray = await call(libraryRoute, "POST", { level: 1, sheet: { ...human.sheet, portrait: PORTRAIT, racialChoices: { ...human.sheet.racialChoices, variant: "ashen" } } });
  assert.equal(stray.status, 400);
  assert.ok(stray.json.problems.includes('The Human offers no choice like "ashen"; remove it.'), stray.json.problems.join(" | "));
});

await test("with Ashen removed in the workshop the stored character still enters play as made, and its next edit is asked for an ancestry that exists", async () => {
  world.signIn(owner);
  const ashen = species.data.variants.options[0];
  const removed = await call(homebrewEntry, "PATCH", { data: { ...species.data, variants: { label: "Draconic ancestry", options: [species.data.variants.options[1], MOONSTONE] } } }, { id: species.id });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  const stored = characters.getCharacter(hero.id);
  const entering = characters.admitLibraryCharacter(stored, world.campaign(), owner.id, 1);
  assert.equal(entering.ok, true, entering.problems?.join(" | "));
  assert.ok(names(entering.sheet).includes("Fire Resistance"));
  assert.equal(entering.sheet.racialChoices.variant, "ashen");
  assert.match(pcResistances(entering.sheet), /\bfire\b/);
  const refused = await edit(stored.sheet);
  assert.equal(refused.status, 400);
  assert.ok(refused.json.problems.includes('"ashen" is not a draconic ancestry the Scalekin offers; pick one of Mirrorscale, Moonstone.'), refused.json.problems.join(" | "));
  // Ashen comes back for the rest of the suite.
  const restored = await call(homebrewEntry, "PATCH", { data: { ...species.data, variants: { label: "Draconic ancestry", options: [ashen, species.data.variants.options[1]] } } }, { id: species.id });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
});

await test("at the table Ashen's breath is fire against a Dexterity save at 2d6, comes back on a short rest, and is 3d6 at 6th level with the features kept", async () => {
  const table = await openWorld();
  const admitted = characters.admitLibraryCharacter(characters.getCharacter(hero.id), table.campaign(), owner.id, 1);
  assert.equal(admitted.ok, true, admitted.problems?.join(" | "));
  const seated = table.addHero({ ...admitted.sheet, name: "Cinder", level: 5 });
  const breathe = () => table.invoke("use_resource", { characterId: seated.id, resource: "Breath Weapon" });
  const first = await breathe();
  assert.equal(first.ok, true, first.error);
  assert.equal(first.result.dice, "2d6");
  assert.equal(first.result.damageType, "fire");
  assert.equal(first.result.saveAbility, "dex");
  assert.equal(first.result.area, "15 ft. cone");
  // 8 + Constitution 14 (+2) + proficiency at 5th (+3).
  assert.equal(first.result.dc, 13);
  const again = await breathe();
  assert.equal(again.ok, false, "a second breath before a rest");
  const rested = await table.invoke("take_rest", { kind: "short", characterIds: [seated.id] });
  assert.equal(rested.ok, true, rested.error);
  assert.equal((await breathe()).ok, true, "the breath did not come back on a short rest");
  // A level up in play regrants the class's features and keeps the race's.
  table.patch(seated.id, { xp: 355000 });
  table.signIn(table.owner);
  const sheetRoute = await table.route("campaigns/[campaignId]/sheet");
  const leveled = await sheetRoute.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify({ level: 6, levelUpClass: "fighter" }) }),
    { params: Promise.resolve({ campaignId: table.campaignId }) },
  );
  assert.equal(leveled.status, 200, JSON.stringify(await leveled.json()));
  const sheet = table.sheet(seated.id);
  assert.equal(sheet.level, 6);
  for (const name of ["Draconic ancestry (Ashen)", "Fire Resistance", "Breath Weapon (fire, 15 ft. cone, DEX save)"]) {
    assert.ok(names(sheet).includes(name), `${name} was lost at 6th level: ${names(sheet).join(", ")}`);
  }
  await table.invoke("take_rest", { kind: "short", characterIds: [seated.id] });
  const sixth = await breathe();
  assert.equal(sixth.ok, true, sixth.error);
  assert.equal(sixth.result.dice, "3d6");
  table.close();
});

const manifest = (name) => ({ name, blurb: "A test adventure.", inspiredBy: "Original work", shelf: "all" });
function bundleWith(pregen) {
  const workshop = createWorkshop(owner.id, { title: "Scalekin Hills" });
  characters.createCharacter(owner.id, 1, pregen, "pc", workshop.id);
  const exported = exportWorkshopBundle(workshop.id, manifest("Scalekin Hills"));
  assert.ok(!("error" in exported), exported.error);
  const round = readBundle(JSON.stringify(exported.bundle));
  assert.ok(!("error" in round), round.error);
  return round.bundle;
}

await test("a Workshop bundle carries the species and the pick to a new owner, beside one of that name with other options, and says what it cannot bring", async () => {
  const pregen = { ...characters.getCharacter(hero.id).sheet, name: "Cinder" };
  const bundle = bundleWith(pregen);
  assert.ok(bundle.homebrew.some((entry) => entry.kind === "race" && entry.name === "Scalekin"), "the bundle left the species behind");
  const fresh = world.addUser("fresh");
  const landed = importWorkshopBundle(fresh.id, bundle);
  assert.ok(!("error" in landed), landed.error);
  const arrived = listHomebrew(fresh.id, "race").find((entry) => entry.name === "Scalekin");
  assert.deepEqual(arrived.data.variants.options.map((option) => option.id), ["ashen", "mirrorscale"]);
  const cinder = characters.listCharactersForUser(fresh.id).find((character) => character.name === "Cinder");
  assert.equal(cinder.sheet.race, `homebrew:${arrived.id}`);
  assert.equal(cinder.sheet.racialChoices.variant, "ashen");
  // Someone whose own Scalekin offers other ancestries keeps it, and the
  // arrival lands beside it under the bundle's name with Ashen still on offer.
  const keeper = world.addUser("keeper");
  const own = await brew("Scalekin", scalekin([{ ...MIRRORSCALE, id: "mirrorscale" }, MOONSTONE]), keeper);
  assert.equal(own.status, 201, JSON.stringify(own.json));
  const beside = importWorkshopBundle(keeper.id, bundle);
  assert.ok(beside.shelf.renamed.some((line) => line.includes("Scalekin [Scalekin Hills]")), beside.shelf.renamed.join(" | "));
  const copy = listHomebrew(keeper.id, "race").find((entry) => entry.name === "Scalekin [Scalekin Hills]");
  assert.deepEqual(copy.data.variants.options.map((option) => option.id), ["ashen", "mirrorscale"]);
  const theirs = characters.listCharactersForUser(keeper.id).find((character) => character.name === "Cinder");
  assert.equal(theirs.sheet.race, `homebrew:${copy.id}`);
  const entering = characters.admitLibraryCharacter(theirs, null, keeper.id, 1);
  assert.equal(entering.ok, true, entering.problems?.join(" | "));
  // A species this server refuses is named, not dropped in silence.
  const broken = { ...bundle, homebrew: bundle.homebrew.map((entry) => (entry.kind === "race" ? { ...entry, data: scalekin(Array.from({ length: 17 }, (_, at) => ({ name: `Scale ${at + 1}` }))) } : entry)) };
  const told = importWorkshopBundle(world.addUser("told").id, broken);
  assert.ok(!("error" in told), told.error);
  assert.ok(told.shelf.refused.some((line) => /^species Scalekin did not come: A choice holds 2 to 16 options; this one has 17\.$/.test(line)), JSON.stringify(told.shelf.refused));
});

// A one-pixel PNG: the file brings its own face, so none is painted.
const FACE = {
  name: "face",
  type: "image/png",
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
};
// A file is posted as it is: its sheet carries no portrait of its own.
async function importFile(file) {
  const response = await importRoute.POST(new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(file) }));
  return { status: response.status, json: await response.json() };
}

await test("a character file carries the species and the pick to another account; a file naming an ancestry the species lacks is refused", async () => {
  const character = characters.getCharacter(hero.id);
  const file = { ...(await buildCharacterBundle(character, async () => null, new Date(), "test", characterFileShelf(owner.id, character.sheet))), portrait: FACE };
  assert.ok((file.homebrew ?? []).some((entry) => entry.kind === "race" && entry.name === "Scalekin"), "the file left the species behind");
  const stranger = world.addUser("stranger");
  world.signIn(stranger);
  const imported = await importFile(file);
  assert.equal(imported.status, 201, JSON.stringify(imported.json));
  const sheet = imported.json.character.sheet;
  assert.equal(sheet.racialChoices.variant, "ashen");
  assert.ok(names(sheet).includes("Draconic ancestry (Ashen)"));
  assert.match(pcResistances(sheet), /\bfire\b/);
  const ghost = { ...file, name: "Ghost", sheet: { ...file.sheet, name: "Ghost", racialChoices: { ...file.sheet.racialChoices, variant: "ghost" } } };
  const refused = await importFile(ghost);
  assert.equal(refused.status, 400);
  assert.match(refused.json.problems.join(" | "), /"ghost" is not a draconic ancestry the Scalekin offers; pick one of Ashen, Mirrorscale\./);
});

finish();
