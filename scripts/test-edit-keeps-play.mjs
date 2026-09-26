// The follow-up to test-partial-updates.mjs: more edits that lost what they
// did not touch, each driven through the real route handler against a real
// encrypted throwaway database. An agent's one-rule change reset the rest of
// its group; the lobby's "edit character" at a lower table de-levelled the
// library character, and at any table dropped what play granted it (story
// boons, feats, the background's feature, an item's attunement); "save this
// table's rules" saved an empty ruleset; one bad field blanked a plugin
// draft; a rename cleared a roll table's drawn results; the prep panel's
// save cleared a fight's map seed; an edit asked again for the ability
// score improvements a hero took in play, which its scores already carry;
// and "save to library" and a campaign's end wrote a lower table's level
// over the library character's own (issue #36).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-edit-keeps-play-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

// House rules and rulesets re-embed; a fixed vector keeps the model off disk.
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const { z } = await import("zod");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { setHouseRules } = await import("../src/lib/db/rules.ts");
const { createCharacter, getCharacter, syncProgressToLibrary } = await import(
  "../src/lib/db/characters.ts"
);
const { getSheetForUser } = await import("../src/lib/db/sheets.ts");
const { getRollTable } = await import("../src/lib/db/roll-tables.ts");
const { getPackDraft, savePackDraft } = await import("../src/lib/db/world-pack-drafts.ts");
const { worldPackDraftSchema } = await import("../src/lib/worlds/draft.ts");
const { layOver, parseKeepingValid } = await import("../src/lib/schemas/parse-keeping-valid.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { abilitiesBlocker, buildBuilderResult } = await import("../src/app/characters/builder/submit.ts");
const { asiSlotsTakenInPlay } = await import("../src/lib/srd/asi.ts");

const route = (name) => import(`../src/app/api/${name}/route.ts`);
const campaignsRoute = await route("campaigns");
const joinRoute = await route("campaigns/join");
const settingsRoute = await route("campaigns/[campaignId]/settings");
const rulesetsRoute = await route("rulesets");
const rulesetRoute = await route("rulesets/[rulesetId]");
const sheetRoute = await route("campaigns/[campaignId]/sheet");
const syncRoute = await route("campaigns/[campaignId]/sheet/sync");
const campaignRoute = await route("campaigns/[campaignId]");
const tablesRoute = await route("campaigns/[campaignId]/dm/roll-tables");
const tableRoute = await route("campaigns/[campaignId]/dm/roll-tables/[tableId]");
const rollRoute = await route("campaigns/[campaignId]/dm/roll-tables/[tableId]/roll");
const templatesRoute = await route("campaigns/[campaignId]/dm/encounter-templates");
const templateRoute = await route("campaigns/[campaignId]/dm/encounter-templates/[templateId]");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const db = getDatabase();
const lead = createUser("lead", "x", { isAdmin: true });
const player = createUser("player", "x");

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

async function newCampaign(gameSettings = {}, startingLevel) {
  as(lead);
  const created = await call(campaignsRoute, "POST", {
    title: "Table",
    gameSettings,
    ...(startingLevel ? { startingLevel } : {}),
  });
  return succeeded(created).json.campaign.id;
}

const GRITTY = {
  flanking: true,
  criticalFumbles: false,
  encumbrance: true,
  lingeringInjuries: false,
  powerfulCritical: false,
  criticalDamageMods: false,
  ammunition: false,
  restVariant: "gritty",
};

// ---- groups sent in part ----

await test("an agent's one-rule change keeps the group's other rules", async () => {
  const campaignId = await newCampaign({ variantRules: GRITTY });
  succeeded(await call(settingsRoute, "PATCH", { variantRules: { ammunition: true } }, { campaignId }));
  assert.deepEqual(getCampaignById(campaignId).gameSettings.variantRules, { ...GRITTY, ammunition: true });

  const ruleset = succeeded(
    await call(rulesetsRoute, "POST", { name: "Gritty", variantRules: GRITTY }),
  ).json.ruleset;
  const edited = await call(rulesetRoute, "PATCH", { variantRules: { flanking: false } }, { rulesetId: ruleset.id });
  assert.deepEqual(edited.json.ruleset.variantRules, { ...ruleset.variantRules, flanking: false });
  assert.equal(edited.json.ruleset.variantRules.restVariant, "gritty");
});

await test("an overlay never takes a prototype from the body", () => {
  const merged = layOver({ dmMode: "ai" }, JSON.parse('{"__proto__": {"polluted": true}, "ttsEnabled": true}'));
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(merged.polluted, undefined);
  assert.deepEqual(merged, { dmMode: "ai", ttsEnabled: true });
});

await test("a stored value pruning cannot heal reads as the defaults instead of throwing", () => {
  const schema = z.object({ inner: z.object({ x: z.string() }).default({ x: "d" }), keep: z.number().default(1) });
  assert.deepEqual(parseKeepingValid(schema, { inner: { x: 5 }, keep: 2 }), { inner: { x: "d" }, keep: 1 });
});

// ---- "save this table's rules" ----

await test("saving a table's rules to the library captures them", async () => {
  const campaignId = await newCampaign({ variantRules: GRITTY });
  setHouseRules(campaignId, "No long rests in dungeons.");
  const captured = await call(rulesetsRoute, "POST", { name: "Table rules", captureFrom: campaignId });
  assert.equal(captured.status, 201, JSON.stringify(captured.json));
  assert.deepEqual(captured.json.ruleset.variantRules, getCampaignById(campaignId).gameSettings.variantRules);
  assert.equal(captured.json.ruleset.variantRules.restVariant, "gritty");
  assert.equal(captured.json.ruleset.houseRulesText, "No long rests in dungeons.");
});

// ---- the workshop's plugin draft ----

await test("a plugin draft with one field this build rejects keeps the rest", async () => {
  const campaignId = await newCampaign();
  const draft = worldPackDraftSchema.parse({ name: "Ashlands", hooks: ["The bell tolls twice."], baseGenre: "dark_fantasy" });
  savePackDraft(campaignId, draft);
  db.prepare("UPDATE world_pack_drafts SET draft_json = ? WHERE campaign_id = ?").run(
    JSON.stringify({ ...draft, baseGenre: "retired_genre" }),
    campaignId,
  );
  const read = getPackDraft(campaignId, "dark_fantasy").draft;
  assert.equal(read.name, "Ashlands");
  assert.deepEqual(read.hooks, ["The bell tolls twice."]);
  assert.notEqual(read.baseGenre, "retired_genre");
});

// ---- the DM's prep ----

await test("renaming a roll table keeps what was drawn; new rows clear it", async () => {
  const campaignId = await newCampaign({ dmMode: "human" });
  const text = "1 Gold\n2 Gem\n3 Map";
  const table = succeeded(
    await call(tablesRoute, "POST", { name: "Loot", text, noReplacement: true }, { campaignId }),
  ).json.table;
  const params = { campaignId, tableId: table.id };
  succeeded(await call(rollRoute, "POST", {}, params));
  assert.equal(getRollTable(table.id).drawn.length, 1);

  // The editor resends the rows with every save.
  succeeded(await call(tableRoute, "PATCH", { name: "Loot II", text, noReplacement: true }, params));
  assert.equal(getRollTable(table.id).name, "Loot II");
  assert.equal(getRollTable(table.id).drawn.length, 1);

  succeeded(await call(tableRoute, "PATCH", { name: "Loot II", text: `${text}\n4 Key`, noReplacement: true }, params));
  assert.deepEqual(getRollTable(table.id).drawn, []);
});

await test("saving a prepared fight from the panel keeps its generated map", async () => {
  const campaignId = await newCampaign({ dmMode: "human" });
  const map = { seed: 4242, theme: "forest", ambient: "dim", width: 20, height: 16 };
  const created = succeeded(
    await call(templatesRoute, "POST", { name: "Ambush", enemies: "goblin x2", map }, { campaignId }),
  ).json.template;
  // Exactly what DmEncounterPrepPanel sends: the map's id and nothing else.
  const saved = await call(
    templateRoute,
    "PATCH",
    { name: "Ambush", enemies: "goblin x3", battlefield: "", notes: "", map: { mapId: null }, extras: created.extras },
    { campaignId, templateId: created.id },
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json.template.map, { mapId: null, ...map });

  const cleared = await call(templateRoute, "PATCH", { map: null }, { campaignId, templateId: created.id });
  assert.equal(cleared.json.template.map.seed, null);
});

// ---- the lobby's "edit character" ----

// A level 8 fighter as a finished campaign leaves it in the library.
const PLAYED = {
  name: "Brann",
  race: "human",
  class: "fighter",
  subclass: "champion",
  background: "soldier",
  alignment: "N",
  gender: "",
  appearance: "",
  abilities: { str: 18, dex: 12, con: 16, int: 10, wis: 12, cha: 8 },
  maxHp: 76,
  ac: 18,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 8, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "intimidation"],
    expertise: [],
    languages: ["common"],
    tools: [],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [
    { name: "Longsword", qty: 1, equipped: true },
    { name: "Ring of Protection", qty: 1, attuned: true, equipped: true },
    { name: "Ornate silver ring", qty: 1, identified: false, weight: 0.1 },
  ],
  gold: 412,
  copper: 31,
  feats: ["Alert"],
  features: [
    { name: "Blessing of the Raven Queen", source: "story" },
    { name: "Alert", source: "feat" },
    { name: "Military Rank", source: "background" },
  ],
  asiChoices: [],
  spellcasting: null,
  portrait: { url: "/uploads/brann.png" },
  notes: "Swore an oath to the ferryman.",
  backstory: "Veteran of the border war.",
};

// The builder's real output, seeded the way useBuilderState seeds itself
// from the stored sheet: gear as names and counts, an unpinned AC left free.
function builderEdit(initial, level, overrides = {}) {
  const state = {
    name: initial.name,
    subclass: initial.subclass,
    alignment: initial.alignment,
    gender: "",
    appearance: "",
    acOverride: initial.acOverride ? initial.ac : null,
    portrait: initial.portrait,
    gold: initial.gold,
    feats: initial.feats ?? [],
    stylePicks: [],
    optionPicks: [],
    racialAsi: [],
    racialSkills: [],
    racialTool: "",
    racialCantrip: "",
    backstory: "Veteran of the border war, now a ferryman's sworn blade.",
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
    background: { id: overrides.background ?? "soldier" },
    initial,
  });
}

async function joinWith(sheet, level, startingLevel) {
  const library = createCharacter(player.id, level, sheet);
  const campaignId = await newCampaign({}, startingLevel);
  as(player);
  succeeded(await call(joinRoute, "POST", { inviteCode: getCampaignById(campaignId).inviteCode }));
  succeeded(await call(sheetRoute, "POST", { libraryCharacterId: library.id }, { campaignId }));
  return { library, campaignId };
}

await test("a lobby edit at a table of another level changes that table's copy only", async () => {
  const { library, campaignId } = await joinWith(PLAYED, 8, 3);
  const opened = await call(sheetRoute, "GET", undefined, { campaignId });
  assert.equal(opened.json.libraryLevel, 8);
  const before = getCharacter(library.id);

  // The builder rebuilds at the table's level, exactly as the page drives it.
  const result = builderEdit(before.sheet, 3);
  const edited = await call(sheetRoute, "PUT", { editLibraryCharacterId: library.id, sheet: result.sheet }, { campaignId });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  const after = getCharacter(library.id);
  assert.equal(after.level, 8);
  assert.deepEqual(after.sheet, before.sheet);
  const sheet = getSheetForUser(campaignId, player.id);
  assert.equal(sheet.level, 3);
  assert.match(sheet.backstory, /sworn blade/);
  assert.equal(sheet.libraryCharacterId, library.id);
});

await test("a lobby edit at a table of the same level still updates the library", async () => {
  const { library, campaignId } = await joinWith(PLAYED, 8, 8);
  const result = builderEdit(getCharacter(library.id).sheet, 8);
  succeeded(await call(sheetRoute, "PUT", { editLibraryCharacterId: library.id, sheet: result.sheet }, { campaignId }));
  const after = getCharacter(library.id);
  assert.equal(after.level, 8);
  assert.match(after.sheet.backstory, /sworn blade/);
});

await test("a lobby edit keeps what play granted and what play set on the gear", async () => {
  const { library, campaignId } = await joinWith(PLAYED, 8, 8);
  const result = builderEdit(getCharacter(library.id).sheet, 8);
  succeeded(
    await call(sheetRoute, "PUT", { editLibraryCharacterId: library.id, sheet: result.sheet }, { campaignId }),
  );
  const stored = getCharacter(library.id).sheet;
  for (const sheet of [stored, getSheetForUser(campaignId, player.id)]) {
    const names = sheet.features.map((feature) => feature.name);
    for (const kept of ["Blessing of the Raven Queen", "Alert", "Military Rank"]) {
      assert.ok(names.includes(kept), `${kept} missing from ${names.join(", ")}`);
    }
    const ring = sheet.equipment.find((item) => item.name === "Ring of Protection");
    assert.equal(ring.attuned, true);
    assert.equal(ring.equipped, true);
    assert.equal(sheet.equipment.find((item) => item.name === "Ornate silver ring").identified, false);
    assert.equal(sheet.acOverride, false);
  }
  assert.equal(stored.copper, 31);
  assert.equal(stored.notes, PLAYED.notes);
});

await test("a lobby edit lets go of what the edit itself removed", async () => {
  const initial = createCharacter(player.id, 8, PLAYED).sheet;
  const sheet = builderEdit(initial, 8, { feats: [], background: "sage" }).sheet;
  const names = sheet.features.map((feature) => feature.name);
  assert.ok(names.includes("Blessing of the Raven Queen"));
  assert.ok(!names.includes("Alert"));
  assert.ok(!names.includes("Military Rank"));
});

await test("editing a library sheet saved before multiclassing does not throw", () => {
  const legacy = { ...PLAYED };
  delete legacy.classes;
  delete legacy.hitDicePools;
  delete legacy.features;
  delete legacy.equipment;
  const sheet = builderEdit(legacy, 8).sheet;
  assert.equal(sheet.notes, PLAYED.notes);
});

await test("improvements a hero took in play are not asked for again", () => {
  // Created at 1, levelled to 8 at the table: two slots earned, none recorded.
  assert.deepEqual(asiSlotsTakenInPlay([4, 8], 0, 8), [true, true]);
  // Built at 4 with its pick recorded, then levelled to 8 in play.
  assert.deepEqual(asiSlotsTakenInPlay([4, 8], 1, 8), [false, true]);
  // At a table above the level it reached, the new slot is still a pick.
  assert.deepEqual(asiSlotsTakenInPlay([4, 8], 0, 5), [true, false]);
  // A new character took nothing in play.
  assert.deepEqual(asiSlotsTakenInPlay([4, 8], 0, 0), [false, false]);

  const derived = {
    abilities: PLAYED.abilities,
    asiSlotLevels: [4, 8],
    activeAsiChoices: [null, null],
    asiTakenInPlay: [true, true],
  };
  assert.equal(abilitiesBlocker(derived), null);
  assert.equal(
    abilitiesBlocker({ ...derived, asiTakenInPlay: [true, false] }),
    "Resolve your level 8 ability score improvement first.",
  );
  // Nothing is added for them: the scores that already carry them are kept.
  const sheet = builderEdit(PLAYED, 8).sheet;
  assert.deepEqual(sheet.abilities, PLAYED.abilities);
  assert.deepEqual(sheet.asiChoices, []);
});

// ---- the library copy ----

await test("copper earned in play reaches the library", async () => {
  const { library, campaignId } = await joinWith(PLAYED, 8, 8);
  const sheet = getSheetForUser(campaignId, player.id);
  db.prepare("UPDATE character_sheets SET copper = ? WHERE id = ?").run(77, sheet.id);
  syncProgressToLibrary(sheet.id);
  assert.equal(getCharacter(library.id).sheet.copper, 77);
});

// ---- a lower table never de-levels the library (issue #36) ----

// The campaign copy as a level 3 one-shot leaves it: played from the level 8
// hero's joining adaptation, with the loot, coin and notes the table gave it
// and a level-up it earned on the way. None of the level-bound fields may
// reach the library; everything the table handed out does.
function playedAtLowerTable(sheet) {
  db.prepare(
    `UPDATE character_sheets SET level = ?, xp = ?, max_hp = ?, gold = ?, copper = ?,
       equipment_json = ?, notes = ?, backstory = ?, portrait_json = ?, features_json = ?,
       abilities_json = ?
     WHERE id = ?`,
  ).run(
    4,
    2700,
    31,
    900,
    12,
    JSON.stringify([...sheet.equipment, { name: "Ferryman's lantern", qty: 1 }]),
    "Paid the ferryman. The lantern lights the dead road.",
    "Veteran of the border war; crossed the drowned river once.",
    JSON.stringify({ url: "/uploads/brann-lantern.png" }),
    JSON.stringify(sheet.features.filter((feature) => feature.source !== "story")),
    JSON.stringify({ ...sheet.abilities, str: 12 }),
    sheet.id,
  );
  return getSheetForUser(sheet.campaignId, sheet.userId);
}

function assertKeptLevel(before, after, played) {
  assert.equal(after.level, 8);
  assert.equal(after.xp, before.xp);
  assert.equal(after.sheet.maxHp, before.sheet.maxHp);
  assert.deepEqual(after.sheet.abilities, before.sheet.abilities);
  assert.deepEqual(after.sheet.features, before.sheet.features);
  assert.deepEqual(after.sheet.feats, before.sheet.feats);
  assert.deepEqual(after.sheet.classes, before.sheet.classes);
  assert.deepEqual(after.sheet.hitDice, before.sheet.hitDice);
  assert.equal(after.sheet.ac, before.sheet.ac);
  assert.deepEqual(after.sheet.spellcasting, before.sheet.spellcasting);
  assert.deepEqual(after.sheet.equipment, played.equipment);
  assert.equal(after.sheet.gold, 900);
  assert.equal(after.sheet.copper, 12);
  assert.equal(after.sheet.notes, played.notes);
  assert.equal(after.sheet.backstory, played.backstory);
  assert.deepEqual(after.sheet.portrait, played.portrait);
}

await test("save to library from a lower table keeps the library's level", async () => {
  const { library, campaignId } = await joinWith(PLAYED, 8, 3);
  const before = getCharacter(library.id);
  const played = playedAtLowerTable(getSheetForUser(campaignId, player.id));
  assert.equal(played.level, 4);
  const saved = await call(syncRoute, "POST", undefined, { campaignId });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.keptLevel, 8);
  assertKeptLevel(before, getCharacter(library.id), played);
});

await test("the campaign's end keeps the library's level the same way", async () => {
  const { library, campaignId } = await joinWith(PLAYED, 8, 3);
  const before = getCharacter(library.id);
  const played = playedAtLowerTable(getSheetForUser(campaignId, player.id));
  as(lead);
  succeeded(await call(campaignRoute, "PATCH", { status: "ended" }, { campaignId }));
  assertKeptLevel(before, getCharacter(library.id), played);
});

await test("a table at or above the library's level still writes everything back", async () => {
  const { library, campaignId } = await joinWith(PLAYED, 8, 8);
  const sheet = getSheetForUser(campaignId, player.id);
  db.prepare("UPDATE character_sheets SET level = ?, xp = ?, max_hp = ? WHERE id = ?").run(
    9,
    50_000,
    80,
    sheet.id,
  );
  const saved = await call(syncRoute, "POST", undefined, { campaignId });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.keptLevel, null);
  const after = getCharacter(library.id);
  assert.equal(after.level, 9);
  assert.equal(after.xp, 50_000);
  assert.equal(after.sheet.maxHp, 80);
});

await test("a feat named in play fits a library sheet", () => {
  const feat = "Blessing of the Ferryman Who Waits Beneath the Drowned Bell Tower";
  assert.ok(feat.length > 60);
  assert.ok(createSheetSchema.safeParse({ ...PLAYED, feats: [feat] }).success);
});

await test("a multiclassed library character is stored with each class's features", () => {
  const sheet = {
    ...PLAYED,
    hitDice: { die: "d10", total: 5, spent: 0 },
    classes: [
      { id: "fighter", subclass: "champion", level: 3 },
      { id: "wizard", subclass: "", level: 2 },
    ],
    features: [],
  };
  const names = createCharacter(player.id, 5, sheet).sheet.features.map((feature) => feature.name);
  assert.ok(names.includes("Arcane Recovery"), names.join(", "));
  assert.ok(names.includes("Improved Critical"), names.join(", "));
  assert.ok(!names.includes("Extra Attack"), names.join(", "));
});

console.log(`\n${passed} edit-keeps-play tests passed`);
process.chdir(os.tmpdir());
removeTempDir(dir);
