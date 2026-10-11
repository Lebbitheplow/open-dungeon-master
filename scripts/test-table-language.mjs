// The table language: the game setting that names the language a table
// plays in, and the directive that tells the model calls writing for people
// to use it. The setting goes through the real routes (register-routes.mjs)
// against a real encrypted throwaway database; the directive is checked in
// the DM's system prompt, where an English table must read exactly as it
// did before the setting existed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-table-language-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { buildDmSystem } = await import("../src/lib/dm/prompt.ts");
const { languageDirective } = await import("../src/lib/dm/table-language-logic.ts");
const { TABLE_LANGUAGES } = await import("../src/lib/schemas/game-settings-options.ts");

// A URL, not a template literal: Vitest would read the literal as a one-level
// glob, which the nested route paths below never match.
const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const campaignsRoute = await route("campaigns");
const joinRoute = await route("campaigns/join");
const settingsRoute = await route("campaigns/[campaignId]/settings");

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

async function newCampaign(gameSettings) {
  as(lead);
  const created = await call(campaignsRoute, "POST", { title: "Table", gameSettings });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.campaign.id;
}

// ---- the setting ----

await test("a new campaign plays in English unless it says otherwise", async () => {
  assert.equal(getCampaignById(await newCampaign({})).gameSettings.tableLanguage, "english");
  assert.equal(getCampaignById(await newCampaign({ tableLanguage: "italian" })).gameSettings.tableLanguage, "italian");
});

await test("a campaign stored before the setting existed reads as English", async () => {
  const campaignId = await newCampaign({ tableLanguage: "german" });
  const stored = JSON.parse(
    db.prepare("SELECT game_settings_json AS json FROM campaigns WHERE id = ?").get(campaignId).json,
  );
  delete stored.tableLanguage;
  db.prepare("UPDATE campaigns SET game_settings_json = ? WHERE id = ?").run(JSON.stringify(stored), campaignId);
  assert.equal(getCampaignById(campaignId).gameSettings.tableLanguage, "english");
});

await test("the lead changes the language; any other value is refused and so is a player", async () => {
  const campaignId = await newCampaign({});
  const changed = await call(settingsRoute, "PATCH", { tableLanguage: "french" }, { campaignId });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  assert.equal(getCampaignById(campaignId).gameSettings.tableLanguage, "french");

  for (const tableLanguage of ["klingon", "it", "French", ""]) {
    const refused = await call(settingsRoute, "PATCH", { tableLanguage }, { campaignId });
    assert.deepEqual(refused, { status: 400, json: { error: "Invalid game settings." } }, tableLanguage);
  }

  as(player);
  const joined = await call(joinRoute, "POST", { inviteCode: getCampaignById(campaignId).inviteCode });
  assert.ok(joined.status < 300, JSON.stringify(joined.json));
  const forbidden = await call(settingsRoute, "PATCH", { tableLanguage: "spanish" }, { campaignId });
  assert.equal(forbidden.status, 403);
  assert.equal(getCampaignById(campaignId).gameSettings.tableLanguage, "french");
});

// ---- the directive ----

await test("English has no directive; every other language names itself", () => {
  assert.equal(languageDirective("english"), "");
  for (const language of TABLE_LANGUAGES.filter((entry) => entry !== "english")) {
    const directive = languageDirective(language);
    const name = language[0].toUpperCase() + language.slice(1);
    assert.ok(directive.startsWith(`TABLE LANGUAGE: The players read ${name}.`), language);
  }
  // What the engine matches stays as it is, and the wording fits every prose
  // call, not only the DM turn's prompt with its GAME STATE.
  const italian = languageDirective("italian");
  assert.match(italian, /every listed value and JSON key, written exactly as listed/);
  assert.match(italian, /English rules name/);
  assert.ok(!italian.includes("GAME STATE"));
});

await test("the DM's system prompt carries the directive, and an English one reads as before", async () => {
  const english = getCampaignById(await newCampaign({}));
  const italian = { ...english, gameSettings: { ...english.gameSettings, tableLanguage: "italian" } };
  const englishPrompt = buildDmSystem(english);
  const italianPrompt = buildDmSystem(italian);
  assert.ok(!englishPrompt.includes("TABLE LANGUAGE"));
  assert.equal(italianPrompt, `${englishPrompt}\n\n${languageDirective("italian")}`);
});

console.log(`\n${passed} table language tests passed`);
process.chdir(os.tmpdir());
removeTempDir(dir);
