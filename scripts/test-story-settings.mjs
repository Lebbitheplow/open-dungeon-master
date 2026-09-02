// Per-campaign story settings: the normalize/merge path a PATCH travels, and
// the two boundaries that must never carry a backend key (the masked GET and
// the campaign snapshot). Runs against a throwaway encrypted database with
// the real modules (workshop-integration pattern).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-story-settings-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { maskStorySettings, normalizeSettings, scrubStorySettings } = await import(
  "../src/lib/db/settings.ts"
);
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, publicCampaign, updateStorySettings } = await import(
  "../src/lib/db/campaigns.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const defaults = normalizeSettings({});

test("invalid enums are coerced back to the configured defaults", () => {
  const merged = normalizeSettings({
    textProvider: "banana",
    utilityProvider: "banana",
    imageBackend: "dalle",
    imageMode: "turbo",
    aspect: "wide",
    proseSize: "epic",
  });
  assert.equal(merged.textProvider, defaults.textProvider);
  assert.equal(merged.utilityProvider, defaults.utilityProvider);
  assert.equal(merged.imageBackend, defaults.imageBackend);
  assert.equal(merged.imageMode, defaults.imageMode);
  assert.equal(merged.aspect, defaults.aspect);
  assert.equal(merged.proseSize, defaults.proseSize);
});

test("strings are trimmed and capped, and non-strings become empty", () => {
  const merged = normalizeSettings({
    customBaseUrl: `  ${"u".repeat(600)}  `,
    customModel: "  m1  ",
    customApiKey: "k".repeat(500),
    utilityModel: 42,
  });
  assert.equal(merged.customBaseUrl.length, 500);
  assert.equal(merged.customModel, "m1");
  assert.equal(merged.customApiKey.length, 400);
  assert.equal(merged.utilityModel, "");
});

test("merging an empty string clears a stored key", () => {
  const before = normalizeSettings({ customApiKey: "sk-live" });
  assert.equal(before.customApiKey, "sk-live");
  const cleared = normalizeSettings({ ...before, customApiKey: "" });
  assert.equal(cleared.customApiKey, "");
});

test("the mask swaps both keys for booleans and keeps every other field", () => {
  const settings = normalizeSettings({ customApiKey: "sk-live", utilityApiKey: "" });
  const masked = maskStorySettings(settings);
  assert.equal("customApiKey" in masked, false);
  assert.equal("utilityApiKey" in masked, false);
  assert.equal(masked.hasCustomApiKey, true);
  assert.equal(masked.hasUtilityApiKey, false);
  // Field-for-field: everything that is not a key survives untouched, so the
  // panel edits exactly what the DM loop reads.
  for (const [key, value] of Object.entries(settings)) {
    if (key === "customApiKey" || key === "utilityApiKey") {
      continue;
    }
    assert.deepEqual(masked[key], value, key);
  }
});

test("the scrub blanks only the keys", () => {
  const settings = normalizeSettings({ customApiKey: "sk-live", utilityApiKey: "uk-live" });
  const scrubbed = scrubStorySettings(settings);
  assert.equal(scrubbed.customApiKey, "");
  assert.equal(scrubbed.utilityApiKey, "");
  assert.deepEqual(
    { ...scrubbed, customApiKey: settings.customApiKey, utilityApiKey: settings.utilityApiKey },
    settings,
  );
});

const lead = createUser("lead", "x");
const campaign = createCampaign(lead.id, {
  title: "Test Table",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});

test("updateStorySettings merges: undefined keeps, empty string clears", () => {
  let saved = updateStorySettings(campaign.id, { customApiKey: "sk-table", proseSize: "large" });
  assert.equal(saved.customApiKey, "sk-table");
  assert.equal(saved.proseSize, "large");

  // A patch that never mentions the key leaves it alone.
  saved = updateStorySettings(campaign.id, { world: "A drowned coastline." });
  assert.equal(saved.customApiKey, "sk-table");
  assert.equal(saved.world, "A drowned coastline.");
  assert.equal(getCampaignById(campaign.id).settings.customApiKey, "sk-table");

  saved = updateStorySettings(campaign.id, { customApiKey: "" });
  assert.equal(saved.customApiKey, "");
});

test("updateStorySettings refuses an invalid enum from a stale client", () => {
  const saved = updateStorySettings(campaign.id, { imageBackend: "dalle" });
  assert.equal(saved.imageBackend, defaults.imageBackend);
});

test("updateStorySettings returns null for a missing campaign", () => {
  assert.equal(updateStorySettings("nope", { proseSize: "tiny" }), null);
});

test("the snapshot never carries a key the database still holds", () => {
  updateStorySettings(campaign.id, { customApiKey: "sk-table", utilityApiKey: "uk-table" });
  const stored = getCampaignById(campaign.id);
  assert.equal(stored.settings.customApiKey, "sk-table");
  const shared = publicCampaign(stored);
  assert.equal(shared.settings.customApiKey, "");
  assert.equal(shared.settings.utilityApiKey, "");
  assert.equal("dmOutline" in shared, false);
  assert.equal("storyArc" in shared, false);
  // The scrub must not have written through to the stored campaign.
  assert.equal(getCampaignById(campaign.id).settings.customApiKey, "sk-table");
});

console.log(`story settings: ${passed} tests passed`);
