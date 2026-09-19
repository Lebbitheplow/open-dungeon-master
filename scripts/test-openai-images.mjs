// Which key the OpenAI images backend spends, and which keys it refuses to.
//
// A bring-your-own-key table pastes one OpenAI key into its story's Text
// Model panel; images are a second API on that same account, so the picture
// path borrows it rather than asking for it twice. The borrow is gated on the
// host, and that gate is the whole safety property: a key minted for
// llama.cpp, LM Studio or OpenRouter must never be posted to api.openai.com.
//
// Local image generation is not touched by any of this — ComfyUI stays ready
// with no key at all — so that is asserted too.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-openai-images-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
// A developer's own shell must not decide the result of these assertions.
for (const name of [
  "OPENAI_API_KEY",
  "OPENAI_IMAGE_API_KEY",
  "OPENAI_IMAGE_BASE_URL",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPAT_BASE_URL",
]) {
  delete process.env[name];
}

register("./lib/register-alias.mjs", import.meta.url);

const { openAiImagesConfigured } = await import("../src/lib/openai-images.ts");
const { imageProducerReady } = await import("../src/lib/image-generate.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { imagesAvailable } = await import("../src/lib/capabilities.ts");
const { maskStorySettings } = await import("../src/lib/db/settings.ts");
const { DEFAULT_STORY_SETTINGS } = await import("../src/lib/defaults.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const story = (imageBackend, customBaseUrl, customApiKey) => ({
  imageBackend,
  customBaseUrl,
  customApiKey,
});

test("with nothing configured the OpenAI backend has no producer", () => {
  assert.equal(openAiImagesConfigured(), false);
  assert.equal(imageProducerReady(story("openai", "", "")), false);
});

test("ComfyUI is ready without any key, exactly as before", () => {
  assert.equal(imageProducerReady(story("comfyui", "", "")), true);
  // The FLUX workers still have no producer here; their own process drives them.
  assert.equal(imageProducerReady(story("mflux-hs", "", "")), false);
  assert.equal(imageProducerReady(story("sdnq-hs", "", "")), false);
});

test("a story whose text model IS OpenAI lends its key to the pictures", () => {
  assert.equal(
    imageProducerReady(story("openai", "https://api.openai.com/v1", "sk-test")),
    true,
  );
});

test("a key for anything that is not OpenAI is never borrowed", () => {
  for (const url of [
    "http://127.0.0.1:8001/v1",
    "https://openrouter.ai/api/v1",
    "https://api.openai.com.evil.example/v1",
    "https://example.com/openai.com/v1",
    "",
  ]) {
    assert.equal(
      imageProducerReady(story("openai", url, "sk-test")),
      false,
      `${url || "(blank)"} lent its key to OpenAI`,
    );
  }
});

test("a subdomain of openai.com still counts as OpenAI", () => {
  assert.equal(
    imageProducerReady(story("openai", "https://eu.api.openai.com/v1", "sk-test")),
    true,
  );
});

test("a blank key on an OpenAI backend lends nothing", () => {
  assert.equal(imageProducerReady(story("openai", "https://api.openai.com/v1", "   ")), false);
});

test("the server-wide text backend lends its key too, on the same gate", () => {
  saveGlobalConfig({ text: { customBaseUrl: "http://127.0.0.1:8001/v1", customApiKey: "sk-local" } });
  assert.equal(openAiImagesConfigured(), false, "a local server's key reached OpenAI");

  saveGlobalConfig({ text: { customBaseUrl: "https://api.openai.com/v1", customApiKey: "sk-admin" } });
  assert.equal(openAiImagesConfigured(), true);
});

test("an explicit image key beats the borrowed one", () => {
  // Both are set now; the deliberate choice must win over the inferred one.
  saveGlobalConfig({ images: { openaiApiKey: "sk-images" } });
  assert.equal(openAiImagesConfigured(), true);
  saveGlobalConfig({ images: { openaiApiKey: "" } });
  saveGlobalConfig({ text: { customBaseUrl: "", customApiKey: "" } });
  assert.equal(openAiImagesConfigured(), false);
});

// The producer-side gate the map and portrait routes ask before promising a
// picture. It normally describes the SERVER's default backend; a campaign on
// its own OpenAI key has to be able to answer for itself, or a
// bring-your-own-key host refuses renders it can pay for.
async function asyncTest(name, fn) {
  await fn();
  passed += 1;
}

await asyncTest("a campaign on its own OpenAI key satisfies the render gate", async () => {
  assert.equal(
    await imagesAvailable({
      imageBackend: "openai",
      customBaseUrl: "https://api.openai.com/v1",
      customApiKey: "sk-test",
    }),
    true,
  );
});

// These two compare against the no-argument answer rather than a literal,
// because the fallback is the SERVER's backend and a dev machine may well
// have ComfyUI running. What is being asserted is that no shortcut is taken.
await asyncTest("a key that is not OpenAI's takes no shortcut", async () => {
  const serverWide = await imagesAvailable();
  assert.equal(
    await imagesAvailable({
      imageBackend: "openai",
      customBaseUrl: "https://openrouter.ai/api/v1",
      customApiKey: "sk-or-test",
    }),
    serverWide,
  );
  assert.equal(
    await imagesAvailable({ imageBackend: "openai", customBaseUrl: "", customApiKey: "" }),
    serverWide,
  );
});

await asyncTest("a self-hosted backend still answers to the probe, not the key", async () => {
  // ComfyUI must never shortcut: "ready" for it means something is listening,
  // which only the capability probe knows.
  assert.equal(
    await imagesAvailable({
      imageBackend: "comfyui",
      customBaseUrl: "https://api.openai.com/v1",
      customApiKey: "sk-test",
    }),
    await imagesAvailable(),
  );
});

test("the masked settings tell the panel whether THIS campaign can render", () => {
  const byok = maskStorySettings({
    ...DEFAULT_STORY_SETTINGS,
    imageBackend: "openai",
    customBaseUrl: "https://api.openai.com/v1",
    customApiKey: "sk-test",
  });
  assert.equal(byok.imagesReady, true);
  assert.equal(byok.hasCustomApiKey, true);
  // Masking still never hands back a key.
  assert.equal("customApiKey" in byok, false);

  const keyless = maskStorySettings({
    ...DEFAULT_STORY_SETTINGS,
    imageBackend: "openai",
    customBaseUrl: "http://127.0.0.1:8001/v1",
    customApiKey: "sk-local",
  });
  assert.equal(keyless.imagesReady, false);

  // A self-hosted backend is reported ready; its liveness is the probe's job.
  assert.equal(maskStorySettings({ ...DEFAULT_STORY_SETTINGS }).imagesReady, true);
});

removeTempDir(dir);
console.log(`test-openai-images: ${passed} passed`);
