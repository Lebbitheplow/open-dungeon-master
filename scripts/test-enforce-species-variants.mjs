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
//   a Workshop bundle and a character file carry the species and the pick,
//   and a pregen whose species a bundle could not bring stays behind with it;
//   an option the workshop removes or changes takes what it gave off at the
//   next edit, the +1 included, read from the sheet's own record of it;
//   an edit's stored scores are read with the stored character's own picks;
//   a replacement skill left replacing nothing is not sent;
//   a choice the table would run as one of its own features is refused.
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
  assert.equal(first.result.damage, "2d6");
  assert.equal(first.result.type, "fire");
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
  assert.equal(sixth.result.damage, "3d6");
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
  // A species this server refuses is named, not dropped in silence, and the
  // pregen on it stays behind with it, named too: it could not be seated.
  const broken = { ...bundle, homebrew: bundle.homebrew.map((entry) => (entry.kind === "race" ? { ...entry, data: scalekin(Array.from({ length: 17 }, (_, at) => ({ name: `Scale ${at + 1}` }))) } : entry)) };
  const toldUser = world.addUser("told");
  const told = importWorkshopBundle(toldUser.id, broken);
  assert.ok(!("error" in told), told.error);
  assert.ok(told.shelf.refused.some((line) => /^species Scalekin did not come: A choice holds 2 to 16 options; this one has 17\.$/.test(line)), JSON.stringify(told.shelf.refused));
  assert.ok(told.shelf.refused.includes("pregen Cinder did not come: its species, Scalekin, was refused here."), JSON.stringify(told.shelf.refused));
  assert.ok(!characters.listCharactersForUser(toldUser.id).some((character) => character.name === "Cinder"), "a pregen landed on a species that did not");
  // Nor is it pointed at the importer's own Scalekin, which has other rules.
  const rival = world.addUser("own-scalekin");
  assert.equal((await brew("Scalekin", scalekin([{ ...MIRRORSCALE, id: "mirrorscale" }, MOONSTONE]), rival)).status, 201);
  const ownTold = importWorkshopBundle(rival.id, broken);
  assert.ok(ownTold.shelf.refused.includes("pregen Cinder did not come: its species, Scalekin, was refused here."), JSON.stringify(ownTold.shelf.refused));
  assert.ok(!characters.listCharactersForUser(rival.id).some((character) => character.name === "Cinder"));
  // A choice the table would run as one of its own features is refused on
  // arrival as it is at a save.
  const clashing = { ...bundle, homebrew: bundle.homebrew.map((entry) => (entry.kind === "race" ? { ...entry, data: { ...entry.data, variants: { ...entry.data.variants, label: "Second Wind" } } } : entry)) };
  const warned = importWorkshopBundle(world.addUser("warned").id, clashing);
  assert.ok(warned.shelf.refused.some((line) => /^species Scalekin did not come: The table would read the choice's label, "Second Wind", as Second Wind, a feature it runs/.test(line)), JSON.stringify(warned.shelf.refused));
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

// A library character of its own on a species of its own, made on
// Mirrorscale, and an edit of it as the builder sends one.
async function madeOn(name, options, variant) {
  const saved = await brew(name, scalekin(options));
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: built(saved.json.entry, variant) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return { entry: saved.json.entry, character: made.json.character };
}
async function editOf(character, sheet) {
  world.signIn(owner);
  return call(characterRoute, "PATCH", { level: 1, sheet }, { characterId: character.id });
}
const MIRRORSCALE_GAVE = { asi: { wis: 1 }, skills: ["insight"], tools: [], languages: ["Draconic"] };

await test("the sheet records what its option gave, written by the server: a record the request sends is not read", async () => {
  const saved = await brew("Gleamkin", scalekin([ASHEN, MIRRORSCALE]));
  world.signIn(owner);
  const sheet = built(saved.json.entry, "mirrorscale");
  const forged = { ...sheet, racialChoices: { ...sheet.racialChoices, variantGrants: { asi: {}, skills: [], tools: [], languages: [] } } };
  const made = await call(libraryRoute, "POST", { level: 1, sheet: forged });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual(made.json.character.sheet.racialChoices.variantGrants, MIRRORSCALE_GAVE);
});

await test("an option the workshop removes takes its grants off at the next edit: its +1 is no base score, and its skill and language go", async () => {
  const { entry, character } = await madeOn("Glintkin", [ASHEN, MIRRORSCALE], "mirrorscale");
  assert.equal(character.sheet.abilities.wis, 11);
  world.signIn(owner);
  const removed = await call(homebrewEntry, "PATCH", { data: { ...entry.data, variants: { label: "Draconic ancestry", options: [entry.data.variants.options[0], MOONSTONE] } } }, { id: entry.id });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  const ashen = built(removed.json.entry, "ashen");
  // Mirrorscale's +1 Wisdom sent back as a base score, with Ashen's +1
  // Constitution on top: one point too many.
  const inflated = await editOf(character, { ...ashen, abilities: { ...ashen.abilities, wis: 11 } });
  assert.equal(inflated.status, 400, JSON.stringify(inflated.json.character?.sheet.abilities));
  assert.match(inflated.json.problems.join(" | "), /Before the race's increase the ability scores are 15, 14, 13, 12, 11, 8\./);
  const honest = await editOf(character, ashen);
  assert.equal(honest.status, 200, JSON.stringify(honest.json));
  const sheet = honest.json.character.sheet;
  assert.equal(sheet.abilities.wis, 10);
  assert.equal(sheet.abilities.con, 14);
  assert.ok(!sheet.proficiencies.skills.includes("insight"), "Mirrorscale's Insight stayed after the option was removed");
  assert.ok(!sheet.proficiencies.languages.includes("Draconic"), "Mirrorscale's Draconic stayed after the option was removed");
  assert.deepEqual(sheet.racialChoices.variantGrants, { asi: { con: 1 }, skills: [], tools: [], languages: [] });
});

await test("an option the author changes under the same id takes off what it gave then, and the edit holds what it gives now", async () => {
  const { entry, character } = await madeOn("Shimmerkin", [ASHEN, MIRRORSCALE], "mirrorscale");
  // Mirrorscale now raises Charisma and trains Arcana, still as "mirrorscale".
  const changed = { ...entry.data.variants.options[1], asi: { cha: 1 }, skills: ["arcana"] };
  world.signIn(owner);
  const patched = await call(homebrewEntry, "PATCH", { data: { ...entry.data, variants: { label: "Draconic ancestry", options: [entry.data.variants.options[0], changed] } } }, { id: entry.id });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  const kept = built(patched.json.entry, "mirrorscale");
  const inflated = await editOf(character, { ...kept, abilities: { ...kept.abilities, wis: 11 } });
  assert.equal(inflated.status, 400, "the old +1 Wisdom was kept as a base score");
  const honest = await editOf(character, kept);
  assert.equal(honest.status, 200, JSON.stringify(honest.json));
  const sheet = honest.json.character.sheet;
  assert.equal(sheet.abilities.wis, 10);
  assert.equal(sheet.abilities.cha, 9);
  assert.ok(!sheet.proficiencies.skills.includes("insight"), "Insight stayed after Mirrorscale stopped giving it");
  assert.ok(sheet.proficiencies.skills.includes("arcana"));
  assert.ok(sheet.proficiencies.languages.includes("Draconic"));
});

await test("an edit's stored scores are read with the stored character's own racial picks: a moved pick is no free point, and an honest move is kept", async () => {
  const data = { ...scalekin([ASHEN, MIRRORSCALE]), asi: [{ attributes: ["Charisma"], value: 2 }, { attributes: ["Any"], value: 1 }, { attributes: ["Any"], value: 1 }] };
  const saved = await brew("Halfkin", data);
  assert.equal(saved.status, 201, JSON.stringify(saved.json));
  // Six rolls this server never saw: a 16 is no point buy.
  const ROLLED = { str: 16, dex: 13, con: 12, int: 11, wis: 10, cha: 9 };
  const rolled = (variant, racialAsi) => {
    const result = builder.build({
      race: withSpeciesVariant(raceOf(saved.json.entry), variant),
      class: "fighter",
      background: "soldier",
      method: "roll",
      scores: ROLLED,
      racialAsi,
      chosenSkills: ["acrobatics", "perception"],
      stylePicks: ["defense"],
      racialVariant: variant,
    });
    assert.equal(result.blocker, null, result.blocker?.message);
    return { ...result.sheet, portrait: PORTRAIT };
  };
  // Stored as it was made: Ashen, the +1s of the player's choice on
  // Strength and Dexterity.
  const stored = characters.createCharacter(owner.id, 1, rolled("ashen", ["str", "dex"]));
  assert.deepEqual(stored.sheet.abilities, { str: 17, dex: 14, con: 13, int: 11, wis: 10, cha: 11 });
  // Mirrorscale, the +1s moved to Strength and Constitution: the same rolls.
  const honest = rolled("mirrorscale", ["str", "con"]);
  // The Dexterity point the old pick gave, kept as a base score.
  const cheat = await editOf(stored, { ...honest, abilities: { ...honest.abilities, dex: honest.abilities.dex + 1 } });
  assert.equal(cheat.status, 400, `a point too many: ${JSON.stringify(cheat.json.character?.sheet.abilities)}`);
  const moved = await editOf(stored, honest);
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
  assert.deepEqual(moved.json.character.sheet.abilities, { str: 17, dex: 13, con: 13, int: 11, wis: 11, cha: 11 });
});

await test("a replacement skill left over from an option that no longer repeats the background's skill is not sent, and the character is admitted", async () => {
  // Mirrorscale's Insight and the acolyte's repeat; Perception is picked in
  // its place. Then Ashen, which gives no Insight.
  const sheetOf = (variant) =>
    builder.build({
      race: withSpeciesVariant(raceOf(species), variant),
      class: "fighter",
      background: "acolyte",
      scores: BASE,
      chosenSkills: ["acrobatics", "athletics"],
      stylePicks: ["defense"],
      racialVariant: variant,
      repeatSkills: ["perception"],
      bonusLanguages: ["Giant", "Elvish"],
    });
  assert.ok(sheetOf("mirrorscale").sheet.proficiencies.skills.includes("perception"));
  const ashen = sheetOf("ashen");
  assert.equal(ashen.blocker, null, ashen.blocker?.message);
  assert.ok(!ashen.sheet.proficiencies.skills.includes("perception"), "the replacement was sent with nothing to replace");
  world.signIn(owner);
  const made = await call(libraryRoute, "POST", { level: 1, sheet: { ...ashen.sheet, portrait: PORTRAIT } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
});

await test("the workshop refuses a choice the table would run as one of its own features, at a new save and an edit, and names it", async () => {
  const before = listHomebrew(owner.id, "race").length;
  const second = await brew("Windkin", { ...scalekin([ASHEN, MIRRORSCALE]), variants: { label: "Second Wind", options: [ASHEN, MIRRORSCALE] } });
  assert.equal(second.status, 400);
  assert.equal(second.json.error, `The table would read the choice's label, "Second Wind", as Second Wind, a feature it runs, and give it to every character who picks an option. Call the choice something else, such as Bloodline or Lineage.`);
  const winged = await brew("Wingkin", scalekin([ASHEN, { name: "Dragon Wings" }]));
  assert.equal(winged.status, 400);
  assert.match(winged.json.error, /"Draconic ancestry \(Dragon Wings\)", the feature Dragon Wings writes on a sheet, as a flying speed/);
  assert.equal(listHomebrew(owner.id, "race").length, before, "a refused species was kept");
  world.signIn(owner);
  const relabelled = await call(homebrewEntry, "PATCH", { data: { ...species.data, variants: { ...species.data.variants, label: "Dwarven Resilience" } } }, { id: species.id });
  assert.equal(relabelled.status, 400);
  assert.match(relabelled.json.error, /as Dwarven Resilience, a feature it runs/);
  assert.equal(listHomebrew(owner.id, "race").find((entry) => entry.id === species.id).data.variants.label, "Draconic ancestry");
});

finish();
