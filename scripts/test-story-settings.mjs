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

const { maskStorySettings, normalizeSettings, scrubStorySettings, withoutAdminOnlyFields } = await import(
  "../src/lib/db/settings.ts"
);
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { storyContextTokens } = await import("../src/lib/model-client.ts");
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

// An admin: only an admin's campaign keeps backend addresses and keys of its
// own, which is what the next tests store and scrub.
const lead = createUser("lead", "x", { isAdmin: true });
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

test("a campaign on an OpenAI key packs against a real window, not the 16K stand-in", () => {
  const openai = { textProvider: "custom", localTextModel: "", customBaseUrl: "https://api.openai.com/v1" };
  assert.equal(storyContextTokens({ ...openai, customModel: "gpt-5.1" }), 128_000);
  assert.equal(storyContextTokens({ ...openai, customModel: "gpt-3.5-turbo" }), 16_385);
  // Any other endpoint still gets the conservative default until it is probed.
  assert.equal(
    storyContextTokens({ ...openai, customBaseUrl: "http://127.0.0.1:9/v1", customModel: "m" }),
    16_384,
  );
  process.env.OPENAI_COMPAT_CONTEXT = "200000";
  assert.equal(storyContextTokens({ ...openai, customModel: "gpt-5.1" }), 200_000, "the operator's number wins");
  delete process.env.OPENAI_COMPAT_CONTEXT;
});

// A world an app hosts: the backend is the device's, chosen once in the app's
// Story AI screen, and every campaign follows it. The campaign above was
// created before the key existed, which is exactly the case that used to
// leave a player pasting the key into each campaign.
test("on a device world every campaign follows the device's Story AI", () => {
  updateStorySettings(campaign.id, {
    textProvider: "custom",
    customBaseUrl: "http://127.0.0.1:8001/v1",
    customModel: "old-local-model",
    customApiKey: "sk-table",
    imageBackend: "comfyui",
    proseSize: "small",
    autoImages: true,
  });
  saveGlobalConfig({
    text: {
      provider: "custom",
      customBaseUrl: "https://api.openai.com/v1",
      customModel: "gpt-5.1",
      customApiKey: "sk-device",
      utilityProvider: "custom",
      utilityBaseUrl: "https://api.openai.com/v1",
      utilityModel: "gpt-5-mini",
      utilityApiKey: "sk-device",
    },
    images: { defaultBackend: "openai", openaiApiKey: "sk-device" },
  });

  // A server somebody administers keeps the campaign's own backend.
  let settings = getCampaignById(campaign.id).settings;
  assert.equal(settings.customModel, "old-local-model");
  assert.equal(settings.customApiKey, "sk-table");
  assert.equal(maskStorySettings(settings).deviceManaged, false);

  process.env.ODM_DEVICE_WORLD = "1";
  try {
    settings = getCampaignById(campaign.id).settings;
    assert.equal(settings.textProvider, "custom");
    assert.equal(settings.customBaseUrl, "https://api.openai.com/v1");
    assert.equal(settings.customModel, "gpt-5.1");
    assert.equal(settings.utilityModel, "gpt-5-mini");
    assert.equal(settings.imageBackend, "openai");
    // The device's key is attached at request time, never copied into a
    // campaign, and a key an older build stored there is not used.
    assert.equal(settings.customApiKey, "");
    assert.equal(settings.utilityApiKey, "");
    // What the campaign tunes for itself stays its own.
    assert.equal(settings.proseSize, "small");
    assert.equal(settings.autoImages, true);
    const masked = maskStorySettings(settings);
    assert.equal(masked.deviceManaged, true);
    assert.equal(masked.imagesReady, true, "the device key covers pictures");

    // A stale client cannot move a campaign off the device's backend.
    const patched = updateStorySettings(campaign.id, { customModel: "sneaky", proseSize: "large" });
    assert.equal(patched.customModel, "gpt-5.1");
    assert.equal(patched.proseSize, "large");

    // Changing Story AI on the device reaches the campaign with no edit to it.
    saveGlobalConfig({ text: { provider: "none" } });
    assert.equal(getCampaignById(campaign.id).settings.textProvider, "none");
  } finally {
    delete process.env.ODM_DEVICE_WORLD;
  }
});

test("only an admin's campaign runs on its own backend address", () => {
  const admin = createUser("backend-admin", "x", { isAdmin: true });
  const player = createUser("backend-player", "x");
  const input = { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" };
  const own = { customBaseUrl: "http://10.0.0.5:8080/v1", customApiKey: "sk-own", utilityBaseUrl: "http://10.0.0.5:8081/v1", comfyUrl: "http://10.0.0.5:8188" };
  const theirs = createCampaign(player.id, input);
  const mine = createCampaign(admin.id, input);
  // Written straight to the row, as a player could before this rule.
  updateStorySettings(theirs.id, { ...own, customModel: "their-model" });
  updateStorySettings(mine.id, own);
  const server = normalizeSettings({});
  const played = getCampaignById(theirs.id).settings;
  assert.equal(played.customBaseUrl, server.customBaseUrl);
  assert.equal(played.utilityBaseUrl, server.utilityBaseUrl);
  assert.equal(played.comfyUrl, server.comfyUrl);
  assert.equal(played.customApiKey, "", "a player's key rode along");
  assert.equal(played.customModel, "their-model", "the model stays the campaign's choice");
  const run = getCampaignById(mine.id).settings;
  assert.equal(run.customBaseUrl, own.customBaseUrl);
  assert.equal(run.comfyUrl, own.comfyUrl);
  assert.equal(run.customApiKey, "sk-own");
  assert.equal(maskStorySettings(played, player).serverManaged, true);
  assert.equal(maskStorySettings(run, admin).serverManaged, false);
});

test("a non-admin's patch loses its backend addresses and keys, nothing else", () => {
  const patch = withoutAdminOnlyFields({ ...{ customBaseUrl: "http://x", customApiKey: "k", utilityBaseUrl: "http://y", utilityApiKey: "k", comfyUrl: "http://z" }, customModel: "m", proseSize: "short" });
  assert.deepEqual(patch, { customModel: "m", proseSize: "short" });
});

// A campaign picks its own backend URL, so the server's OpenRouter key may
// only ride along to OpenRouter's own host. A URL that merely mentions
// openrouter.ai in its path, query or username used to pass a substring test
// and receive the key.
{
  const { requestCustomMessage } = await import("../src/lib/model-client.ts");
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init?.headers?.Authorization ?? "" });
    return new Response("{}", { status: 500 });
  };
  process.env.OPENROUTER_API_KEY = "sk-or-server";
  try {
    const decoys = [
      "https://evil.test/.openrouter.ai",
      "https://evil.test/.openrouter.ai/api/v1",
      "https://evil.test/v1?x=.openrouter.ai",
      "https://openrouter.ai@evil.test/v1",
      "https://openrouter.ai.evil.test/api/v1",
      // The right host, but the key would cross the network in clear text.
      "http://openrouter.ai/api/v1",
    ];
    for (const base of decoys) {
      await requestCustomMessage(base, "m", "", [{ role: "user", content: "hi" }]);
    }
    assert.equal(seen.length, decoys.length);
    for (const call of seen) {
      assert.notEqual(call.auth, "Bearer sk-or-server", `key leaked to ${call.url}`);
    }

    seen.length = 0;
    await requestCustomMessage("https://openrouter.ai/api/v1", "m", "", [{ role: "user", content: "hi" }]);
    assert.equal(seen[0].auth, "Bearer sk-or-server", "OpenRouter itself still gets the key");
    passed += 1;
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OPENROUTER_API_KEY;
  }
}

// A campaign's backend is not trusted to send the server elsewhere: a
// redirect is followed only to the same host and only when it keeps the
// POST whole, and no body is read past a ceiling.
{
  const { requestCustomMessage } = await import("../src/lib/model-client.ts");
  const realFetch = globalThis.fetch;
  const hits = [];
  const ok = () => Response.json({ choices: [{ message: { role: "assistant", content: "fine" } }] });
  const endless = () =>
    new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024).fill(120));
      },
    });
  globalThis.fetch = async (url, init) => {
    hits.push(String(url));
    assert.equal(init.redirect, "manual", "redirects are never left to fetch");
    const { hostname, pathname, protocol } = new URL(String(url));
    if (hostname === "inside.test") return ok();
    if (hostname === "away.test") {
      return new Response(null, { status: 307, headers: { location: "http://inside.test/v1/chat/completions" } });
    }
    if (hostname === "port.test" && new URL(String(url)).port === "8080") {
      return new Response(null, { status: 307, headers: { location: "http://port.test:9999/v1/chat/completions" } });
    }
    if (hostname === "port.test") return ok();
    if (hostname === "moved.test" && protocol === "http:") {
      return new Response(null, { status: 308, headers: { location: "https://moved.test/v1/chat/completions" } });
    }
    if (hostname === "moved.test") return ok();
    if (hostname === "flood.test" && pathname.startsWith("/error")) return new Response(endless(), { status: 500 });
    if (hostname === "flood.test") return new Response(endless(), { status: 200 });
    return new Response("nope", { status: 404 });
  };
  try {
    const away = await requestCustomMessage("https://away.test/v1", "m", "", [{ role: "user", content: "hi" }]);
    assert.ok(away.error, "a redirect to another host was followed");
    assert.match((await away.error.json()).error, /redirected/);
    assert.ok(!hits.some((url) => url.includes("inside.test")), "the other host was contacted");

    const port = await requestCustomMessage("http://port.test:8080/v1", "m", "", [{ role: "user", content: "hi" }]);
    assert.ok(port.error, "a redirect to another port on the same host was followed");

    const moved = await requestCustomMessage("http://moved.test/v1", "m", "", [{ role: "user", content: "hi" }]);
    assert.equal(moved.message?.content, "fine", "an https upgrade on the same host still works");

    const started = Date.now();
    const flooded = await requestCustomMessage("https://flood.test/v1", "m", "", [{ role: "user", content: "hi" }]);
    assert.ok(flooded.error, "an endless reply was accepted");
    const erred = await requestCustomMessage("https://flood.test/error/v1", "m", "", [{ role: "user", content: "hi" }]);
    assert.ok(erred.error);
    assert.ok((await erred.error.json()).detail.length <= 300);
    assert.ok(Date.now() - started < 10_000, "an endless body was read to the end");
    passed += 1;
    console.log("ok: a campaign's backend cannot redirect the server elsewhere or flood it");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(`story settings: ${passed} tests passed`);
