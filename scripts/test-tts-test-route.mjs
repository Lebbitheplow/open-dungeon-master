// "Hear a sample" in the apps' Settings posts {} to /api/admin/tts-test to
// hear what is saved (the client's shared/world-media.ts). A missing
// provider used to reach ttsBackend as "", which reads as Kokoro, so a world
// saved on an OpenAI-compatible server sampled Kokoro instead, and one saved
// Off still answered with audio (audit 2026-10-26 F08). Two stand-in speech
// servers on loopback ports tell apart which one was asked; Vitest stands in
// for the admin check, as in test-admin-model-notices.mjs.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, test, vi } from "vitest";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

vi.mock("@/lib/admin-api", () => ({
  requireAdmin: async () => ({ isAdmin: true }),
  isErrorResponse: (value) => value instanceof Response,
}));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-tts-test-route-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
for (const key of ["KOKORO_URL", "TTS_PROVIDER", "TTS_BASE_URL", "TTS_MODEL", "TTS_API_KEY", "TTS_VOICE", "OPENAI_API_KEY"]) {
  delete process.env[key];
}

const { POST } = await import("../src/app/api/admin/tts-test/route.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");

// One speech server per name, counting the passages each was asked for.
const asked = [];
function speechServer(name) {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      if (request.url === "/v1/audio/voices") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ voices: ["af_heart", "narrator_one"] }));
        return;
      }
      if (request.url === "/v1/audio/speech") {
        asked.push(name);
        response.writeHead(200, { "Content-Type": "audio/mpeg" });
        response.end(Buffer.from(`ID3-${name}`));
        return;
      }
      response.writeHead(404).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, server }));
  });
}

const kokoro = await speechServer("kokoro");
const compatible = await speechServer("compatible");

// The body the apps' Settings send.
async function sample(body = {}) {
  asked.length = 0;
  const response = await POST(
    new Request("http://localhost/api/admin/tts-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return response.json();
}

const saved = (speech) =>
  saveGlobalConfig({
    speech: { kokoroUrl: kokoro.url, ttsBaseUrl: compatible.url, ttsModel: "", ttsApiKey: "", ttsVoice: "", ...speech },
  });

afterAll(async () => {
  for (const { server } of [kokoro, compatible]) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  removeTempDir(dir);
});

test("a saved OpenAI-compatible server is the one sampled", async () => {
  saved({ ttsProvider: "openai", ttsModel: "my-tts", ttsVoice: "narrator_one" });
  const answer = await sample();
  assert.equal(answer.ok, true, answer.error);
  assert.deepEqual(asked, ["compatible"]);
  assert.equal(Buffer.from(answer.audio.split(",")[1], "base64").toString(), "ID3-compatible");
});

test("saved Kokoro is the one sampled", async () => {
  saved({ ttsProvider: "kokoro" });
  const answer = await sample();
  assert.equal(answer.ok, true, answer.error);
  assert.deepEqual(asked, ["kokoro"]);
});

test("narration saved off says so and asks nobody, with a Kokoro answering", async () => {
  saved({ ttsProvider: "off" });
  const answer = await sample();
  assert.equal(answer.ok, false);
  assert.match(answer.error, /switched off/);
  assert.deepEqual(asked, []);
});

test("a blank provider from a form is the saved one too", async () => {
  saved({ ttsProvider: "openai", ttsModel: "my-tts", ttsVoice: "narrator_one" });
  const answer = await sample({ provider: "" });
  assert.equal(answer.ok, true, answer.error);
  assert.deepEqual(asked, ["compatible"]);
});

test("a provider the admin form picked but has not saved still wins", async () => {
  saved({ ttsProvider: "off" });
  const answer = await sample({ provider: "kokoro" });
  assert.equal(answer.ok, true, answer.error);
  assert.deepEqual(asked, ["kokoro"]);
});
