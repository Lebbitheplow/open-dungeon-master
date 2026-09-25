// Edits change exactly what their caller sent. zod 4 fills a .default() for
// every absent key even under .partial(), so an update parsed on its own
// used to write a full object of defaults over the stored one: one settings
// toggle reset the table's safety tools and handed a human-run table to the
// AI, a ruleset rename wiped its rules, and a lobby "edit character" erased
// progress synced back from play. Each case seeds non-default values first,
// then calls the real route handler (register-routes.mjs) against a real
// encrypted throwaway database. Also pinned: creates still fill defaults,
// and whole values (a shop's stock, a library sheet, a homebrew body)
// still replace whole. And one bad stored field now falls back alone
// rather than taking every stored setting with it.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-partial-updates-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

// Rulesets re-embed house rules; a fixed vector keeps the model off disk.
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { getGlobalConfig, saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createCharacter, getCharacter } = await import("../src/lib/db/characters.ts");
const { getSheetForUser } = await import("../src/lib/db/sheets.ts");
const { gameSettingsSchema, normalizeGameSettings } = await import(
  "../src/lib/schemas/game-settings.ts"
);
const { adaptSheetToLevel } = await import("../src/lib/characters/adapt.ts");
const { buildBuilderResult } = await import("../src/app/characters/builder/submit.ts");

const route = (name) => import(`../src/app/api/${name}/route.ts`);
const campaignsRoute = await route("campaigns");
const joinRoute = await route("campaigns/join");
const settingsRoute = await route("campaigns/[campaignId]/settings");
const rulesetsRoute = await route("rulesets");
const rulesetRoute = await route("rulesets/[rulesetId]");
const sheetRoute = await route("campaigns/[campaignId]/sheet");
const shopsRoute = await route("campaigns/[campaignId]/shops");
const shopRoute = await route("campaigns/[campaignId]/shops/[shopId]");
const charactersRoute = await route("characters");
const characterRoute = await route("characters/[characterId]");
const homebrewRoute = await route("homebrew");
const homebrewEntryRoute = await route("homebrew/[id]");

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

// Setup calls only need to have worked; creates answer 201.
function succeeded(response) {
  assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.json));
  return response;
}

const omit = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
const withoutStamp = (object) => omit(object, "updatedAt");

// Every character arrives with a portrait: a missing one queues a render
// that would outlive this run's database.
const PORTRAIT = { url: "/uploads/mira.png" };

const CUSTOM_SETTINGS = {
  campaignLength: "epic",
  dicePolicy: "real_allowed",
  ttsEnabled: false,
  ttsVoice: "am_adam",
  mapsEnabled: false,
  worldSimulation: false,
  dmAssist: { monsters: false, narration: false, cover: false },
  safety: { xCard: false, lines: ["spiders"], veils: ["gore"], boundaries: "mature" },
  voice: { rules: { proximity: false, hearingRangeFeet: 60, sayRange: true } },
};

async function newCampaign(gameSettings, startingLevel) {
  as(lead);
  const created = await call(campaignsRoute, "POST", {
    title: "Table",
    gameSettings,
    ...(startingLevel ? { startingLevel } : {}),
  });
  succeeded(created);
  return created.json.campaign.id;
}

async function joinAs(user, campaignId) {
  as(user);
  const joined = await call(joinRoute, "POST", { inviteCode: getCampaignById(campaignId).inviteCode });
  succeeded(joined);
}

const storedSettingsJson = (campaignId) =>
  db.prepare("SELECT game_settings_json AS json FROM campaigns WHERE id = ?").get(campaignId).json;
const lastSeq = (campaignId) =>
  db.prepare("SELECT COALESCE(MAX(seq), 0) AS seq FROM campaign_events WHERE campaign_id = ?").get(campaignId).seq;
const eventsSince = (campaignId, seq) =>
  db
    .prepare("SELECT type, payload_json FROM campaign_events WHERE campaign_id = ? AND seq > ? ORDER BY seq")
    .all(campaignId, seq);

// ---- game settings ----

await test("a one-field settings edit changes only that field", async () => {
  const stored = normalizeGameSettings(CUSTOM_SETTINGS);
  for (const patch of [
    { ttsEnabled: true },
    { dicePolicy: "digital_only" },
    { ttsVoice: "af_heart" },
    { dmAssist: { ...stored.dmAssist, monsters: true } },
    { safety: { ...stored.safety, lines: [] } },
  ]) {
    const campaignId = await newCampaign(CUSTOM_SETTINGS);
    const before = getCampaignById(campaignId).gameSettings;
    const response = await call(settingsRoute, "PATCH", patch, { campaignId });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    const after = getCampaignById(campaignId).gameSettings;
    assert.deepEqual(after, { ...before, ...patch }, JSON.stringify(patch));
    assert.deepEqual(response.json.gameSettings, after);
    if (!("safety" in patch)) {
      assert.deepEqual(after.safety, before.safety);
    }
    assert.equal(after.campaignLength, "epic");
    assert.equal(after.dicePolicy, "dicePolicy" in patch ? "digital_only" : "real_allowed");
    assert.equal(after.ttsVoice, "ttsVoice" in patch ? "af_heart" : "am_adam");
  }
});

await test("an unrelated toggle leaves a human-run table with its DM", async () => {
  const campaignId = await newCampaign({ ...CUSTOM_SETTINGS, dmMode: "human" });
  const before = getCampaignById(campaignId);
  assert.equal(before.dmUserId, lead.id);
  const seq = lastSeq(campaignId);
  const response = await call(settingsRoute, "PATCH", { ttsEnabled: true }, { campaignId });
  assert.equal(response.status, 200);
  const after = getCampaignById(campaignId);
  assert.equal(after.gameSettings.dmMode, "human");
  assert.equal(after.dmUserId, lead.id);
  assert.deepEqual(
    eventsSince(campaignId, seq).map((event) => event.type),
    ["campaign_updated"],
  );

  // Sending a different mode still hands the table over, and says so.
  const handover = await call(settingsRoute, "PATCH", { dmMode: "ai" }, { campaignId });
  assert.equal(handover.status, 200);
  const handed = getCampaignById(campaignId);
  assert.equal(handed.gameSettings.dmMode, "ai");
  assert.equal(handed.dmUserId, null);
  const seat = eventsSince(campaignId, seq).find((event) => event.type === "dm_seat_changed");
  assert.deepEqual(JSON.parse(seat.payload_json), { seat: "dm", userId: null });
  assert.equal(handed.gameSettings.ttsVoice, "am_adam");
});

await test("settings: an invalid value and a player are refused as before", async () => {
  const campaignId = await newCampaign(CUSTOM_SETTINGS);
  const stored = storedSettingsJson(campaignId);
  const invalid = await call(settingsRoute, "PATCH", { dicePolicy: "loaded" }, { campaignId });
  assert.deepEqual(invalid, { status: 400, json: { error: "Invalid game settings." } });
  await joinAs(player, campaignId);
  const refused = await call(settingsRoute, "PATCH", { ttsEnabled: true }, { campaignId });
  assert.equal(refused.status, 403);
  assert.equal(storedSettingsJson(campaignId), stored);
});

await test("a campaign created with empty settings still gets every default", async () => {
  const campaignId = await newCampaign({});
  assert.deepEqual(getCampaignById(campaignId).gameSettings, gameSettingsSchema.parse({}));
});

// ---- rulesets ----

const RULESET = {
  name: "Gritty",
  description: "Hard travel",
  variantRules: {
    flanking: true,
    criticalFumbles: false,
    encumbrance: true,
    lingeringInjuries: false,
    powerfulCritical: false,
    criticalDamageMods: false,
    ammunition: true,
    restVariant: "gritty",
  },
  houseRulesText: "No long rests in dungeons.",
  homebrewIds: ["homebrew-1"],
};

async function newRuleset() {
  as(lead);
  const created = await call(rulesetsRoute, "POST", RULESET);
  succeeded(created);
  return created.json.ruleset;
}

await test("a one-field ruleset edit changes only that field", async () => {
  for (const patch of [
    { name: "Gritty II" },
    { description: "Harder travel" },
    { variantRules: { ...RULESET.variantRules, flanking: false, restVariant: "heroic" } },
    { houseRulesText: "Also no potions." },
    { homebrewIds: [] },
  ]) {
    const before = await newRuleset();
    const response = await call(rulesetRoute, "PATCH", patch, { rulesetId: before.id });
    assert.equal(response.status, 200, JSON.stringify(response.json));
    assert.deepEqual(withoutStamp(response.json.ruleset), withoutStamp({ ...before, ...patch }));
  }
});

await test("rulesets: an invalid value and another user are refused as before", async () => {
  const ruleset = await newRuleset();
  const invalid = await call(rulesetRoute, "PATCH", { name: "" }, { rulesetId: ruleset.id });
  assert.deepEqual(invalid, { status: 400, json: { error: "Invalid change." } });
  as(stranger);
  const refused = await call(rulesetRoute, "PATCH", { name: "Mine" }, { rulesetId: ruleset.id });
  assert.deepEqual(refused, { status: 404, json: { error: "Ruleset not found." } });
});

await test("a ruleset created without a description still gets the empty default", async () => {
  as(lead);
  const created = await call(rulesetsRoute, "POST", omit(RULESET, "description"));
  assert.equal(created.json.ruleset.description, "");
});

// ---- the lobby's "edit character" ----

// A fighter 3 / wizard 2 as syncProgressToLibrary leaves it after a campaign.
const SYNCED = {
  name: "Mira",
  race: "human",
  class: "fighter",
  subclass: "champion",
  background: "soldier",
  alignment: "N",
  gender: "",
  appearance: "",
  abilities: { str: 16, dex: 12, con: 14, int: 13, wis: 10, cha: 8 },
  maxHp: 38,
  ac: 16,
  acOverride: true,
  speed: 30,
  hitDice: { die: "d10", total: 5, spent: 0 },
  classes: [
    { id: "fighter", subclass: "champion", level: 3 },
    { id: "wizard", subclass: "", level: 2 },
  ],
  hitDicePools: [
    { classId: "fighter", die: "d10", total: 3, spent: 0 },
    { classId: "wizard", die: "d6", total: 2, spent: 0 },
  ],
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "perception"],
    expertise: [],
    languages: ["common"],
    tools: [],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1 }],
  gold: 212,
  copper: 57,
  feats: [],
  features: [],
  asiChoices: [],
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 3, used: 0 } },
    prepared: ["shield"],
    known: [],
    casters: [{ classId: "wizard", ability: "int", known: [], prepared: ["shield"] }],
  },
  portrait: PORTRAIT,
  notes: "Owes the Thieves' Guild 40 gp. Sister is in Neverwinter.",
  backstory: "Deserter.",
};

// The builder's real output, seeded the way useBuilderState seeds itself
// from the stored sheet, at the campaign's level and with a chosen class.
function builderEdit(level, klass) {
  const state = {
    name: SYNCED.name,
    subclass: klass.id === SYNCED.class ? "battle-master" : "",
    alignment: SYNCED.alignment,
    gender: "",
    appearance: "",
    acOverride: SYNCED.ac,
    portrait: SYNCED.portrait,
    gold: SYNCED.gold,
    feats: [],
    stylePicks: [],
    optionPicks: [],
    racialAsi: [],
    racialSkills: [],
    racialTool: "",
    racialCantrip: "",
    backstory: SYNCED.backstory,
    spells: [],
    spellWarningAck: true,
  };
  const derived = {
    abilities: SYNCED.abilities,
    preview: { maxHp: SYNCED.maxHp, proficiencies: SYNCED.proficiencies },
    effectiveLevel: level,
    activeAsiChoices: [],
    ac: SYNCED.ac,
    fullEquipment: SYNCED.equipment,
    styleSlots: 0,
  };
  return buildBuilderResult({
    state,
    derived,
    race: { id: "human", speed: 30 },
    klass,
    background: { id: "soldier" },
    initial: SYNCED,
  }).sheet;
}
const FIGHTER = { id: "fighter", hitDie: 10, spellAbility: null };
const WIZARD = { id: "wizard", hitDie: 6, spellAbility: "int" };

let lastCampaignId = null;
async function editInLobby(startingLevel, sheet) {
  const library = createCharacter(player.id, 5, SYNCED);
  const campaignId = await newCampaign({}, startingLevel);
  lastCampaignId = campaignId;
  await joinAs(player, campaignId);
  const joined = await call(sheetRoute, "POST", { libraryCharacterId: library.id }, { campaignId });
  succeeded(joined);
  const edited = await call(sheetRoute, "PUT", { editLibraryCharacterId: library.id, sheet }, { campaignId });
  succeeded(edited);
  return getCharacter(library.id).sheet;
}

await test("a lobby edit keeps the progress the builder does not edit", async () => {
  const after = await editInLobby(5, builderEdit(5, FIGHTER));
  assert.equal(after.notes, SYNCED.notes);
  assert.equal(after.copper, 57);
  assert.deepEqual(after.classes, [
    { id: "fighter", subclass: "battle-master", level: 3 },
    { id: "wizard", subclass: "", level: 2 },
  ]);
  assert.deepEqual(after.hitDicePools, SYNCED.hitDicePools);
  assert.deepEqual(after.spellcasting, SYNCED.spellcasting);
});

// A table of another level gets its own copy, shed as joining sheds it;
// the library character keeps its level 5 split.
await test("a lobby edit at a lower level sheds multiclass levels as joining would", async () => {
  const library = await editInLobby(3, builderEdit(3, FIGHTER));
  assert.deepEqual(library.classes, SYNCED.classes);
  const table = getSheetForUser(lastCampaignId, player.id);
  const adapted = adaptSheetToLevel(SYNCED, 5, 3);
  // Shed to one class, which a campaign sheet stores as no class list.
  assert.deepEqual(table.classes, []);
  assert.equal(table.class, "fighter");
  assert.equal(table.subclass, "battle-master");
  assert.equal(table.level, 3);
  assert.deepEqual(table.hitDicePools, adapted.hitDicePools);
  assert.deepEqual(table.spellcasting.casters, []);
  assert.equal(table.notes, SYNCED.notes);
});

await test("a lobby edit to another class starts over single-class", async () => {
  const after = await editInLobby(5, builderEdit(5, WIZARD));
  assert.deepEqual(after.classes, []);
  assert.equal(after.hitDicePools, null);
  assert.equal(after.spellcasting.casters, undefined);
  assert.equal(after.notes, SYNCED.notes);
  assert.equal(after.copper, 57);
});

// ---- nothing sent, nothing changed ----

await test("an empty edit changes nothing", async () => {
  const campaignId = await newCampaign(CUSTOM_SETTINGS);
  const settingsJson = storedSettingsJson(campaignId);
  succeeded(await call(settingsRoute, "PATCH", {}, { campaignId }));
  assert.equal(storedSettingsJson(campaignId), settingsJson);

  const ruleset = await newRuleset();
  const response = await call(rulesetRoute, "PATCH", {}, { rulesetId: ruleset.id });
  assert.deepEqual(withoutStamp(response.json.ruleset), withoutStamp(ruleset));
});

// ---- whole-value replacements, by contract ----

// A group sent in part keeps the members it leaves out, the way an agent
// through the MCP bridge sends one rule; the panels send the whole group,
// which lands the same.
await test("a nested settings group sent in part keeps its other members", async () => {
  const campaignId = await newCampaign(CUSTOM_SETTINGS);
  const before = getCampaignById(campaignId).gameSettings;
  const patch = { dmAssist: { monsters: true } };
  succeeded(await call(settingsRoute, "PATCH", patch, { campaignId }));
  assert.deepEqual(getCampaignById(campaignId).gameSettings, {
    ...before,
    dmAssist: { ...before.dmAssist, monsters: true },
  });
});

await test("a shop's stock, a library sheet and a homebrew body still replace whole", async () => {
  const dmCampaignId = await newCampaign({ dmMode: "human" });
  const shop = await call(shopsRoute, "POST", { name: "Bent Nail", kind: "general" }, { campaignId: dmCampaignId });
  const shopParams = { campaignId: dmCampaignId, shopId: shop.json.shop.id };
  await call(shopRoute, "PATCH", { stock: [{ itemName: "Rope", qty: 3, priceCp: 100, note: "hempen" }] }, shopParams);
  const restocked = await call(shopRoute, "PATCH", { stock: [{ itemName: "Rope", qty: 2, priceCp: 100 }] }, shopParams);
  assert.deepEqual(restocked.json.shop.stock.map((item) => item.note), [""]);

  const withoutNotes = omit(SYNCED, "notes");
  const character = await call(charactersRoute, "POST", { level: 5, sheet: SYNCED });
  const replaced = await call(characterRoute, "PATCH", { level: 5, sheet: withoutNotes }, { characterId: character.json.character.id });
  assert.equal(replaced.json.character.sheet.notes, "");

  const entry = await call(homebrewRoute, "POST", { kind: "spell", name: "Frost Bite II", data: { desc: "Numbing cold.", level: 1 } });
  const fresh = await call(homebrewRoute, "POST", { kind: "spell", name: "Reference", data: { desc: "Only this." } });
  const rewritten = await call(homebrewEntryRoute, "PATCH", { data: { desc: "Only this." } }, { id: entry.json.entry.id });
  assert.deepEqual(rewritten.json.entry.data, fresh.json.entry.data);
});

// ---- one bad stored field ----

await test("one invalid stored game setting falls back alone", async () => {
  const stored = normalizeGameSettings(CUSTOM_SETTINGS);
  assert.deepEqual(normalizeGameSettings({ ...stored, presentation: "cinema" }), stored);
  assert.deepEqual(
    normalizeGameSettings({ ...stored, safety: { ...stored.safety, boundaries: "extreme" } }),
    { ...stored, safety: { ...stored.safety, boundaries: "standard" } },
  );
  assert.deepEqual(
    normalizeGameSettings({ ...stored, safety: { ...stored.safety, lines: ["x".repeat(61)] } }),
    { ...stored, safety: { ...stored.safety, lines: [] } },
  );

  const campaignId = await newCampaign(CUSTOM_SETTINGS);
  db.prepare("UPDATE campaigns SET game_settings_json = ? WHERE id = ?").run(
    JSON.stringify({ ...stored, dicePolicy: "loaded" }),
    campaignId,
  );
  assert.deepEqual(getCampaignById(campaignId).gameSettings, { ...stored, dicePolicy: "digital_only" });
});

await test("one invalid stored server setting falls back alone", async () => {
  const saved = saveGlobalConfig({
    serverName: "Hearth",
    signupMode: "invite",
    text: { provider: "custom", customBaseUrl: "http://llm.local/v1", customModel: "m" },
  });
  const corrupt = (config) =>
    db.prepare("UPDATE app_settings SET value_json = ? WHERE key = 'global_config'").run(JSON.stringify(config));

  corrupt({ ...saved, signupMode: "lottery" });
  assert.deepEqual(getGlobalConfig(), { ...saved, signupMode: "" });

  corrupt({ ...saved, harness: { ...saved.harness, effort: "turbo" } });
  const read = getGlobalConfig();
  assert.deepEqual(read, { ...saved, harness: { ...saved.harness, effort: read.harness.effort } });
  assert.notEqual(read.harness.effort, "turbo");
});

console.log(`\n${passed} partial update tests passed`);
process.chdir(os.tmpdir());
removeTempDir(dir);
