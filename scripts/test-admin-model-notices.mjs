// Admin > Images and Admin > Speech say when a backend has no model picked,
// since none is named in code and it then paints, reads aloud or hears
// nothing (PR 298's upgrade left such servers silent with no word of why).
// The panels are rendered from the real settings route's answer; Vitest
// transforms the TSX and stands in for the admin check, as in
// test-comfy-preset.mjs.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

vi.mock("@/lib/admin-api", () => ({
  requireAdmin: async () => ({ isAdmin: true }),
  isErrorResponse: (value) => value instanceof Response,
}));
vi.mock("@/lib/image-backend-rescue", () => ({ rescueStrandedCampaigns: async () => [] }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-admin-model-notices-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
for (const name of ["OPENAI_IMAGE_MODEL", "TTS_MODEL", "TTS_BASE_URL", "TTS_PROVIDER"]) {
  delete process.env[name];
}

const { GET } = await import("../src/app/api/admin/settings/route.ts");
const { AdminImagesSection } = await import("../src/app/admin/AdminImagesSection.tsx");
const { AdminSpeechSection } = await import("../src/app/admin/AdminSpeechSection.tsx");
const { modelNotes } = await import("../src/app/admin/BuiltinSpeechCard.tsx");

test("the admin panels say when no model is picked", async () => {
  const { config, envDefaults } = await (await GET()).json();
  const images = (patch, env = envDefaults) =>
    renderToStaticMarkup(
      React.createElement(AdminImagesSection, {
        images: { ...config.images, ...patch },
        env,
        harness: config.harness,
        phoneWorld: false,
        openaiKey: "",
        onImages: () => {},
        onOpenaiKey: () => {},
      }),
    );
  const painted = /No model is picked, so nothing is painted until you pick one\./;
  assert.match(images({ defaultBackend: "openai", openaiModel: "" }), painted, "OpenAI pictures with no model say nothing about it");
  assert.doesNotMatch(images({ defaultBackend: "openai", openaiModel: "my-painter" }), painted);
  assert.doesNotMatch(images({ defaultBackend: "openai", openaiModel: "" }, { ...envDefaults, openaiImageModel: "env-painter" }), painted, "OPENAI_IMAGE_MODEL counts");

  const speech = (patch, env = envDefaults) =>
    renderToStaticMarkup(
      React.createElement(AdminSpeechSection, {
        speech: { ...config.speech, ...patch },
        env,
        apiKey: "",
        openaiSpeechBaseUrl: "https://api.openai.com/v1",
        onSpeech: () => {},
        onApiKey: () => {},
      }),
    );
  const spoken = /No narration model is picked, so nothing is read aloud until you pick one\./;
  assert.match(speech({ ttsProvider: "openai", ttsBaseUrl: "", ttsModel: "" }), spoken, "OpenAI narration with no model says nothing about it");
  assert.doesNotMatch(speech({ ttsProvider: "openai", ttsBaseUrl: "", ttsModel: "my-voice" }), spoken);
  assert.doesNotMatch(speech({ ttsProvider: "openai", ttsBaseUrl: "", ttsModel: "" }, { ...envDefaults, ttsModel: "env-voice" }), spoken, "TTS_MODEL counts");
  assert.doesNotMatch(speech({ ttsProvider: "kokoro", ttsModel: "" }), spoken, "Kokoro sends its own model");
  // A server of the host's own may run its only model: nothing is said
  // before its list has answered.
  assert.doesNotMatch(speech({ ttsProvider: "openai", ttsBaseUrl: "http://127.0.0.1:8000/v1", ttsModel: "" }), spoken);
  console.log("ok - the admin panels say when no model is picked");
// The first settings read opens the database: well under a second on Linux,
// past vitest's five-second default on the Windows runner (PR 534's smoke).
}, 60_000);

test("the dictation card reads an older host's status, which has no model fields", () => {
  const builtin = { model: "whisper", downloadMb: 76, installed: false, status: "idle", progress: 0, error: "" };
  assert.deepEqual(modelNotes({ active: "none", builtin }), { whisper: false, openai: false });
  assert.deepEqual(modelNotes(null), { whisper: false, openai: false });
  assert.deepEqual(modelNotes({ active: "none", builtin, whisper: { needsModel: true }, openai: { needsModel: false } }), { whisper: true, openai: false });
  assert.deepEqual(modelNotes({ active: "none", builtin, whisper: { needsModel: false }, openai: { needsModel: true } }), { whisper: false, openai: true });
  removeTempDir(dir);
  console.log("ok - the dictation card reads an older host's status");
});
