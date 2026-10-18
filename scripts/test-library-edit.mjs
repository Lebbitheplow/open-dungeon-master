// Issue 229: the library's own build editor and "Duplicate and edit". Driven
// through the real routes against a real encrypted throwaway database, with
// the builder's real output (submit.ts), the way the edit page sends it:
// a stored character opens at its own level, saves to the same entry, keeps
// its experience in step with its level, its multiclass split and what play
// granted; a copy is edited without touching its original; a refused save
// changes nothing; campaign copies keep their own sheets while the next join
// takes the edit; and who plays them changes only while no table holds one.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { standInStoryteller } from "./lib/stand-in-storyteller.mjs";

// An AI-run table through the routes needs a storyteller set up (the routes
// refuse one otherwise, and seat a person when none is named); this one never
// answers.
standInStoryteller();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-library-edit-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { createCharacter, experienceAtLevel, getCharacter } = await import("../src/lib/db/characters.ts");
const { getSheetForUser } = await import("../src/lib/db/sheets.ts");
const { buildBuilderResult } = await import("../src/app/characters/builder/submit.ts");
const { storedLevelRange } = await import("../src/app/characters/builder/useBuilderState.ts");
const { unofferedPicks } = await import("../src/app/characters/builder/unoffered.ts");

const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const characterRoute = await route("characters/[characterId]");
const cloneRoute = await route("characters/[characterId]/clone");
const campaignsRoute = await route("campaigns");
const joinRoute = await route("campaigns/join");
const sheetRoute = await route("campaigns/[campaignId]/sheet");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const db = getDatabase();
const lead = createUser("lead", "x", { isAdmin: true });
const player = createUser("player", "x");
const stranger = createUser("stranger", "x");

function as(user) {
  globalThis.__odmTestToken = mintSession(user.id).token;
}

async function call(mod, method, body, params = {}) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

function succeeded(response) {
  assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.json));
  return response;
}

// A fighter the way the builder writes one: no picks left open, nothing the
// rules would refuse at any level from 1 to 8.
const FIGHTER = {
  name: "Brann",
  race: "human",
  class: "fighter",
  subclass: "",
  background: "soldier",
  alignment: "LN",
  abilities: { str: 16, dex: 12, con: 15, int: 10, wis: 12, cha: 9 },
  maxHp: 12,
  ac: 16,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "intimidation", "perception", "survival"],
    expertise: [],
    languages: ["common", "dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  gold: 10,
  copper: 0,
  feats: [],
  features: [{ name: "Blessing of the Raven Queen", source: "story" }],
  asiChoices: [],
  spellcasting: null,
  portrait: { url: "/uploads/brann.png" },
  notes: "Owes the ferryman.",
  backstory: "Veteran of the border war.",
};

// The builder's output for a stored character, as the edit page submits it.
function builderEdit(initial, level, overrides = {}) {
  const state = {
    name: initial.name,
    subclass: initial.subclass,
    alignment: initial.alignment,
    gender: "",
    appearance: "",
    acOverride: null,
    portrait: initial.portrait,
    gold: initial.gold,
    feats: initial.feats ?? [],
    stylePicks: [],
    optionPicks: [],
    racialAsi: [],
    racialSkills: [],
    racialTool: "",
    racialCantrip: "",
    backstory: initial.backstory,
    spells: [],
    spellWarningAck: true,
    ...overrides,
  };
  const derived = {
    abilities: initial.abilities,
    preview: { maxHp: initial.maxHp, proficiencies: initial.proficiencies },
    effectiveLevel: level,
    activeAsiChoices: [],
    ac: initial.ac,
    fullEquipment: (initial.equipment ?? []).map(({ name, qty }) => ({ name, qty })),
    styleSlots: 0,
  };
  return buildBuilderResult({
    state,
    derived,
    race: { id: "human", speed: 30 },
    klass: { id: "fighter", hitDie: 10, spellAbility: null },
    background: { id: "soldier" },
    initial,
  });
}

async function save(id, result, extra = {}) {
  return call(characterRoute, "PATCH", { level: result.level, sheet: result.sheet, ...extra }, { characterId: id });
}

async function newCampaign(startingLevel) {
  as(lead);
  const created = succeeded(await call(campaignsRoute, "POST", { title: "Table", gameSettings: {}, startingLevel }));
  return created.json.campaign.id;
}

async function join(characterId, startingLevel) {
  const campaignId = await newCampaign(startingLevel);
  as(player);
  succeeded(await call(joinRoute, "POST", { inviteCode: getCampaignById(campaignId).inviteCode }));
  succeeded(await call(sheetRoute, "POST", { libraryCharacterId: characterId }, { campaignId }));
  return campaignId;
}

await test("a stored character opens at its own level, not at 1", () => {
  assert.deepEqual(storedLevelRange(undefined, undefined), { storedLevel: 1, levelFloor: 1, levelLocked: false });
  // Made in the library at 5 with its improvement recorded: free to move.
  const recorded = { ...FIGHTER, asiChoices: [{ mode: "asi", abilities: { str: 2 } }] };
  assert.deepEqual(storedLevelRange(recorded, 5), { storedLevel: 5, levelFloor: 1, levelLocked: false });
  // Levelled in play to 8: two improvements in its scores and none recorded.
  assert.deepEqual(storedLevelRange(FIGHTER, 8), { storedLevel: 8, levelFloor: 8, levelLocked: false });
  // Split between classes: the level stays.
  const split = { ...FIGHTER, classes: [{ id: "fighter", subclass: "", level: 3 }, { id: "wizard", subclass: "", level: 2 }] };
  assert.deepEqual(storedLevelRange(split, 5), { storedLevel: 5, levelFloor: 5, levelLocked: true });
});

await test("a race, class or background the builder cannot offer is named, never swapped in silence", () => {
  const races = [{ id: "aasimar", name: "Aasimar" }, { id: "human", name: "Human" }];
  const classes = [{ id: "barbarian", name: "Barbarian" }, { id: "fighter", name: "Fighter" }];
  const backgrounds = [{ id: "acolyte", name: "Acolyte" }, { id: "soldier", name: "Soldier" }];
  const stored = { ...FIGHTER, race: "table-ghoulkin", background: "table-gravedigger" };
  const state = { raceId: stored.race, classId: stored.class, backgroundId: stored.background };
  const missing = unofferedPicks(stored, state, races, classes, backgrounds);
  // A missing race and a missing background both show as not chosen: no
  // list row stands in for either.
  assert.equal(missing.length, 2);
  assert.ok(missing.every((entry) => !("standIn" in entry)));
  assert.match(missing[1].what, /table gravedigger/);
  assert.match(missing[0].what, /table ghoulkin/);
  // Picked on purpose, it is the player's choice.
  assert.deepEqual(unofferedPicks(stored, { ...state, raceId: "human", backgroundId: "soldier" }, races, classes, backgrounds), []);
  assert.deepEqual(unofferedPicks(FIGHTER, { raceId: "human", classId: "fighter", backgroundId: "soldier" }, races, classes, backgrounds), []);
});

await test("a new library character edits in place and the edit survives a reload", async () => {
  const library = createCharacter(player.id, 1, FIGHTER);
  as(player);
  const before = getCharacter(library.id);
  const result = builderEdit(before.sheet, 1, { name: "Brann Ashvale", backstory: "Left the border war behind." });
  const saved = succeeded(await save(library.id, result));
  assert.equal(saved.json.character.id, library.id);
  assert.deepEqual(saved.json.character.campaigns, []);
  const reloaded = succeeded(await call(characterRoute, "GET", undefined, { characterId: library.id })).json.character;
  assert.equal(reloaded.name, "Brann Ashvale");
  assert.equal(reloaded.sheet.backstory, "Left the border war behind.");
  assert.equal(reloaded.level, 1);
  assert.equal(reloaded.xp, before.xp);
  // What the builder has no step for comes through the edit.
  assert.ok(reloaded.sheet.features.some((feature) => feature.name === "Blessing of the Raven Queen"));
  assert.equal(reloaded.sheet.notes, FIGHTER.notes);
  assert.equal(reloaded.sheet.portrait.url, FIGHTER.portrait.url);
  // The gaming set the soldier picked answers "one gaming set": an edit
  // keeps the pick and never writes the grant's own words back beside it.
  assert.deepEqual([...reloaded.sheet.proficiencies.tools].map((tool) => tool.toLowerCase()).sort(), ["dice set", "vehicles (land)"]);
  const again = succeeded(await save(library.id, builderEdit(reloaded.sheet, 1))).json.character;
  assert.ok(!again.sheet.proficiencies.tools.some((tool) => /gaming set/i.test(tool) && !/dice/i.test(tool)), again.sheet.proficiencies.tools.join(", "));
  // A sheet an earlier edit already wrote the words onto loses them here.
  const marked = createCharacter(player.id, 1, {
    ...FIGHTER,
    proficiencies: { ...FIGHTER.proficiencies, tools: ["dice set", "one gaming set", "vehicles (land)"] },
  });
  const healed = succeeded(await save(marked.id, builderEdit(getCharacter(marked.id).sheet, 1))).json.character;
  assert.deepEqual([...healed.sheet.proficiencies.tools].map((tool) => tool.toLowerCase()).sort(), ["dice set", "vehicles (land)"]);
});

await test("Duplicate and edit changes the copy and leaves the original as it was", async () => {
  const original = createCharacter(player.id, 3, { ...FIGHTER, name: "Original" });
  as(player);
  const copy = succeeded(await call(cloneRoute, "POST", undefined, { characterId: original.id })).json.character;
  assert.notEqual(copy.id, original.id);
  assert.deepEqual(copy.campaigns, []);
  assert.equal(copy.level, 3);
  const untouched = getCharacter(original.id);
  succeeded(await save(copy.id, builderEdit(copy.sheet, 3, { backstory: "A road not taken." })));
  assert.equal(getCharacter(copy.id).sheet.backstory, "A road not taken.");
  assert.deepEqual(getCharacter(original.id), untouched);
});

await test("the experience follows a changed level, and a waiting level-up stays at the same level", async () => {
  const library = createCharacter(player.id, 3, FIGHTER);
  as(player);
  assert.equal(getCharacter(library.id).xp, 900);
  succeeded(await save(library.id, builderEdit(getCharacter(library.id).sheet, 5)));
  assert.equal(getCharacter(library.id).level, 5);
  assert.equal(getCharacter(library.id).xp, 6500);
  succeeded(await save(library.id, builderEdit(getCharacter(library.id).sheet, 2)));
  assert.equal(getCharacter(library.id).xp, 300);
  // Earned enough for the next level in play and not yet taken: kept.
  db.prepare("UPDATE library_characters SET xp = 3000 WHERE id = ?").run(library.id);
  succeeded(await save(library.id, builderEdit(getCharacter(library.id).sheet, 2)));
  assert.equal(getCharacter(library.id).xp, 3000);
  assert.equal(experienceAtLevel(3000, 2), 300);
  assert.equal(experienceAtLevel(3000, 4), 3000);
});

await test("a multiclass split and what play granted survive an edit at the same level", async () => {
  const split = {
    ...FIGHTER,
    abilities: { str: 16, dex: 12, con: 15, int: 14, wis: 12, cha: 9 },
    classes: [
      { id: "fighter", subclass: "Champion", level: 3 },
      { id: "wizard", subclass: "", level: 2 },
    ],
    subclass: "Champion",
    hitDice: { die: "d10", total: 5, spent: 0 },
  };
  const library = createCharacter(player.id, 5, split);
  as(player);
  const stored = getCharacter(library.id);
  const result = builderEdit(stored.sheet, 5, { backstory: "Studied the Weave between campaigns." });
  succeeded(await save(library.id, result));
  const after = getCharacter(library.id);
  assert.deepEqual(after.sheet.classes.map((entry) => [entry.id, entry.level]), [["fighter", 3], ["wizard", 2]]);
  assert.equal(after.level, 5);
  assert.equal(after.xp, stored.xp);
});

await test("a refused or unauthorized save leaves the stored character as it was", async () => {
  const library = createCharacter(player.id, 2, FIGHTER);
  const before = getCharacter(library.id);
  as(player);
  const unknown = builderEdit(before.sheet, 2);
  const refused = await save(library.id, { ...unknown, sheet: { ...unknown.sheet, class: "spellsword" } });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /spellsword/);
  assert.ok(Array.isArray(refused.json.problems));
  assert.deepEqual(getCharacter(library.id), before);

  as(stranger);
  const theirs = await save(library.id, builderEdit(before.sheet, 2, { backstory: "Stolen." }));
  assert.equal(theirs.status, 404);
  assert.deepEqual(getCharacter(library.id), before);
});

await test("campaign copies keep their own sheets and the next join takes the edit", async () => {
  const library = createCharacter(player.id, 4, FIGHTER);
  const first = await join(library.id, 4);
  const seated = getSheetForUser(first, player.id);
  as(player);
  const shown = succeeded(await call(characterRoute, "GET", undefined, { characterId: library.id })).json.character;
  assert.equal(shown.campaigns.length, 1);
  succeeded(await save(library.id, builderEdit(getCharacter(library.id).sheet, 4, { backstory: "Rewritten in the library." })));
  assert.equal(getSheetForUser(first, player.id).backstory, seated.backstory);
  const second = await join(library.id, 4);
  assert.equal(getSheetForUser(second, player.id).backstory, "Rewritten in the library.");
});

await test("who plays them changes only while no table holds a copy", async () => {
  const library = createCharacter(player.id, 1, FIGHTER);
  as(player);
  const result = builderEdit(getCharacter(library.id).sheet, 1);
  succeeded(await save(library.id, result, { role: "companion" }));
  assert.equal(getCharacter(library.id).role, "companion");
  succeeded(await save(library.id, result, { role: "pc" }));
  assert.equal(getCharacter(library.id).role, "pc");

  await join(library.id, 1);
  as(player);
  const before = getCharacter(library.id);
  const refused = await save(library.id, builderEdit(before.sheet, 1, { backstory: "Changed." }), { role: "companion" });
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /Duplicate/);
  assert.deepEqual(getCharacter(library.id), before);
  // Sent unchanged, it is no change at all.
  succeeded(await save(library.id, builderEdit(before.sheet, 1, { backstory: "Changed." }), { role: "pc" }));
  assert.equal(getCharacter(library.id).sheet.backstory, "Changed.");
});

console.log(`${passed} library edit checks passed`);
removeTempDir(dir);
