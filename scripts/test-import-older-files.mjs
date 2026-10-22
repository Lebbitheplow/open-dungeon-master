// Issue #430: a character file made before a rule asked for a pick.
//
// Feats came to ask for their picks in 0.24.9 (Linguist's three languages,
// Skill Expert's skill and expertise), subclasses later (a Lore bard's three
// skills, issue 251). The import door held a file to the same rule, so a
// character exported from an older release could not move to a newer one:
// "Linguist: pick 3 languages." A file that names a pick is still judged by
// it; one that names none is let in without it, and the importer is told
// what is still to choose. The builder asks for it when the character is
// next opened there.
//
// The same gap came from play: a level-up applied a feat's picks to the
// sheet and never recorded them, so a feat taken at a table went home and
// to a file looking unpicked, and the builder asked for it again. The table
// sheet keeps the picks now, and the library sync carries them home.
import assert from "node:assert/strict";
import { suite } from "./lib/enforce-harness.mjs";
import { XP_BY_LEVEL, patchSheetAs } from "./lib/enforce-srd-progression.mjs";

const { test, finish } = suite("test-import-older-files");

const { openCreation } = await import("./lib/enforce-creation.mjs");
const { openBuilder, standardScores } = await import("./lib/enforce-builder.mjs");
const { subclassGrants } = await import("../src/lib/srd/subclass-training.ts");
const { textKey } = await import("../src/lib/language/text-logic.ts");
const creation = await openCreation();
const { world } = creation;
const builder = await openBuilder();
const importRoute = await world.route("characters/import");
const exportRoute = await world.route("characters/[characterId]/export");
const libraryOne = await world.route("characters/[characterId]");
const characters = await import("../src/lib/db/characters.ts");

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const fileOf = (sheet, level = 1) => ({
  kind: "odm.character",
  version: 1,
  exportedAt: "2026-10-01T00:00:00.000Z",
  name: sheet.name,
  level,
  sheet: { ...sheet, portrait: null },
  portrait: { name: "face", type: "image/png", dataUrl: PIXEL },
});

async function importAs(user, bundle) {
  world.signIn(user);
  const response = await importRoute.POST(
    new Request("http://test/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bundle) }),
  );
  return { status: response.status, json: await response.json() };
}

// A file as an older release wrote it: the same sheet with no recorded picks
// and none of what they granted, which the older builder never applied.
function asOlderFile(sheet, granted) {
  const { featChoices: _dropped, ...rest } = sheet;
  void _dropped;
  const drop = (list = [], gone = []) => list.filter((entry) => !gone.some((name) => name.toLowerCase() === entry.toLowerCase()));
  return {
    ...rest,
    proficiencies: {
      ...rest.proficiencies,
      languages: drop(rest.proficiencies.languages, granted.languages),
      skills: drop(rest.proficiencies.skills, granted.skills),
      expertise: drop(rest.proficiencies.expertise, granted.expertise),
    },
  };
}

const importer = world.addUser("importer");

const variantHuman = (fields) =>
  builder.build({
    name: "Erevis",
    race: "variant_human",
    class: "rogue",
    background: "criminal",
    scores: standardScores(["dex", "int", "con", "wis", "cha", "str"]),
    racialAsi: ["dex", "int"],
    racialSkills: ["athletics"],
    chosenSkills: ["acrobatics", "investigation", "perception", "sleight_of_hand"],
    expertisePicks: ["stealth", "perception"],
    bonusLanguages: ["Giant"],
    ...fields,
  });

await test("A Variant Human rogue with Linguist from before feats asked for their picks comes in without the languages, and the importer is told what is still to choose", async () => {
  const made = variantHuman({ feats: ["Linguist"], featChoices: { linguist: { languages: ["Dwarvish", "Elvish", "Orc"] } } });
  assert.equal(made.blocker, null, made.blocker?.message);
  const older = asOlderFile(made.sheet, { languages: ["Dwarvish", "Elvish", "Orc"] });
  const arrived = await importAs(importer, fileOf(older));
  assert.equal(arrived.status, 201, JSON.stringify(arrived.json));
  assert.deepEqual(arrived.json.owed, ["Linguist: pick 3 languages."]);
  const stored = characters.getCharacter(arrived.json.character.id);
  for (const language of ["Dwarvish", "Elvish", "Orc"]) {
    assert.equal(stored.sheet.proficiencies.languages.includes(language), false, `${language} came in with no pick behind it`);
  }
  assert.ok(stored.sheet.feats.includes("Linguist"));
});

await test("Skill Expert from before the picks comes in the same way, owing its skill and its expertise", async () => {
  const made = variantHuman({
    name: "Brannoc",
    feats: ["Skill Expert"],
    racialAsi: ["dex", "con"],
    featChoices: { "skill expert": { skills: ["insight"], expertise: ["insight"] } },
    featAbility: "int",
  });
  assert.equal(made.blocker, null, made.blocker?.message);
  const older = asOlderFile(made.sheet, { skills: ["insight"], expertise: ["insight"] });
  const arrived = await importAs(importer, fileOf(older));
  assert.equal(arrived.status, 201, JSON.stringify(arrived.json));
  assert.equal(arrived.json.owed.length, 1);
  assert.match(arrived.json.owed[0], /^Skill Expert: pick 1 skill, expertise in 1 skill\.$/);
});

await test("A pick the file names is still judged: a Linguist language the character already speaks is refused, as the builder refuses it", async () => {
  const made = variantHuman({ name: "Edited", feats: ["Linguist"], featChoices: { linguist: { languages: ["Dwarvish", "Elvish", "Orc"] } } });
  const edited = { ...made.sheet, featChoices: { linguist: { languages: ["Common", "Elvish", "Orc"] } } };
  const refused = await importAs(importer, fileOf(edited));
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /already speaks Common/);
});

await test("A file made today imports with nothing owed", async () => {
  const made = variantHuman({ name: "Today", feats: ["Linguist"], featChoices: { linguist: { languages: ["Dwarvish", "Elvish", "Orc"] } } });
  const arrived = await importAs(importer, fileOf(made.sheet));
  assert.equal(arrived.status, 201, JSON.stringify(arrived.json));
  assert.equal(arrived.json.owed, undefined);
});

await test("A Lore bard from before subclasses asked for their skills comes in owing them", async () => {
  const grant = subclassGrants([{ id: "bard", subclass: "College of Lore", level: 3 }]).find((entry) => entry.spec.skills > 0);
  assert.ok(grant, "the Lore bard's skill grant");
  const key = textKey(grant.name);
  const made = builder.build({
    name: "Corwen",
    race: "human",
    class: "bard",
    subclass: "College of Lore",
    level: 3,
    background: "entertainer",
    scores: standardScores(["cha", "dex", "con", "wis", "int", "str"]),
    chosenSkills: ["persuasion", "insight", "deception"],
    expertisePicks: ["persuasion", "deception"],
    bonusLanguages: ["Giant"],
    cantrips: ["Vicious Mockery", "Minor Illusion"],
    spells: ["Healing Word", "Faerie Fire", "Thunderwave", "Dissonant Whispers", "Heroism", "Suggestion"],
    featChoices: { [key]: { skills: ["arcana", "history", "nature"] } },
  });
  assert.equal(made.blocker, null, made.blocker?.message);
  const older = asOlderFile(made.sheet, { skills: ["arcana", "history", "nature"] });
  const arrived = await importAs(importer, fileOf(older, 3));
  assert.equal(arrived.status, 201, JSON.stringify(arrived.json));
  assert.ok(arrived.json.owed?.some((line) => line.startsWith(grant.name)), JSON.stringify(arrived.json.owed));
});

await test("A feat taken at a level-up goes home with its picks: the table records them, the library keeps them, the file says so, and the builder's edit takes the character as it is", async () => {
  // A level 3 fighter brought from the library to a table, levelled to 4
  // there with Linguist.
  const base = builder.build({
    name: "Hale",
    race: "human",
    class: "fighter",
    background: "soldier",
    level: 3,
    subclass: "Champion",
    chosenSkills: ["acrobatics", "perception"],
    stylePicks: ["defense"],
    bonusLanguages: ["Giant"],
    scores: standardScores(["str", "con", "dex", "wis", "int", "cha"]),
  });
  assert.equal(base.blocker, null, base.blocker?.message);
  // A table that starts at 3, so the hero sits down at its own level.
  const table = await openCreation({ campaign: { startingLevel: 3 } });
  const seated = await table.throughLibrary(base.sheet, 3);
  assert.equal(seated.status, 201, seated.error);
  let owed = XP_BY_LEVEL[3];
  while (owed > 0) {
    const amount = Math.min(20000, owed);
    await table.world.invoke("award_xp", { characterIds: [seated.sheet.id], amount, reason: "earned" });
    owed -= amount;
  }
  const before = table.world.sheet(seated.sheet.id);
  const leveled = await patchSheetAs(table.world, table.sheetRoute, table.player, {
    characterId: before.id,
    level: 4,
    levelUpClass: "fighter",
    asiChoices: [{ mode: "feat", feat: "Linguist" }],
    featChoices: { linguist: { languages: ["Dwarvish", "Elvish", "Orc"] } },
  });
  assert.equal(leveled.status, 200, JSON.stringify(leveled.json));
  const after = table.world.sheet(before.id);
  assert.deepEqual(after.featChoices?.linguist, { languages: ["Dwarvish", "Elvish", "Orc"] });
  // Home to the library, with the picks.
  const home = characters.syncProgressToLibrary(after.id);
  assert.equal(home.level, 4);
  assert.deepEqual(home.sheet.featChoices?.linguist, { languages: ["Dwarvish", "Elvish", "Orc"] });
  // Its file says the picks were made: nothing owed on the other side.
  table.world.signIn(table.player);
  const file = await exportRoute.GET(new Request("http://test/"), { params: Promise.resolve({ characterId: home.id }) });
  const bundle = JSON.parse(await file.text());
  assert.match(bundle.appVersion ?? "", /^\d+\.\d+\.\d+/, "the file names the release that wrote it");
  const arrived = await importAs(importer, bundle);
  assert.equal(arrived.status, 201, JSON.stringify(arrived.json));
  assert.equal(arrived.json.owed, undefined);
  const copy = characters.getCharacter(arrived.json.character.id);
  for (const language of ["Dwarvish", "Elvish", "Orc"]) {
    assert.ok(copy.sheet.proficiencies.languages.includes(language));
  }
  assert.equal(copy.sheet.proficiencies.languages.length, home.sheet.proficiencies.languages.length, "no language twice");
  // The builder's edit door takes it back unchanged rather than asking for
  // three more languages.
  table.world.signIn(table.player);
  const edit = await libraryOne.PATCH(
    new Request("http://test/", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: 4, sheet: { ...home.sheet, portrait: home.sheet.portrait ?? { url: "/uploads/enforce-creation.png" } } }),
    }),
    { params: Promise.resolve({ characterId: home.id }) },
  );
  const edited = await edit.json();
  assert.equal(edit.status, 200, JSON.stringify(edited));
});

finish();
