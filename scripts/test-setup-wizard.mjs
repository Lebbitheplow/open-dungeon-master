// The guided setup (src/app/setup): how the scan reads what answers on this
// machine (src/lib/setup/discovery-logic.ts), what each answer writes
// (src/lib/setup/patches.ts), the model listing against a real HTTP server
// (src/lib/setup/discovery.ts), and the wizard's own finished/dismissed
// state (src/lib/setup/state.ts).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-setup-wizard-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const logic = await import("../src/lib/setup/discovery-logic.ts");
const patches = await import("../src/lib/setup/patches.ts");
const { listModels } = await import("../src/lib/setup/discovery.ts");
const { getSetupState, markSetup, setupNudgeWanted } = await import("../src/lib/setup/state.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

try {
  await test("base URLs come out as scheme, host, port and /v1 whatever was pasted", () => {
    assert.equal(logic.normalizeBaseUrl("127.0.0.1:8001"), "http://127.0.0.1:8001/v1");
    assert.equal(logic.normalizeBaseUrl("http://127.0.0.1:8001/"), "http://127.0.0.1:8001/v1");
    assert.equal(logic.normalizeBaseUrl("http://127.0.0.1:8001/v1/"), "http://127.0.0.1:8001/v1");
    assert.equal(logic.normalizeBaseUrl("http://127.0.0.1:8001/v1/chat/completions"), "http://127.0.0.1:8001/v1");
    assert.equal(logic.normalizeBaseUrl("https://openrouter.ai/api/v1/models"), "https://openrouter.ai/api/v1");
    assert.equal(logic.normalizeBaseUrl("   "), "");
    assert.equal(logic.modelsUrl("http://box:1234"), "http://box:1234/v1/models");
  });

  await test("the scan looks at the Docker host from inside a container, and never at its own port", () => {
    assert.deepEqual(logic.scanHosts(false), ["127.0.0.1"]);
    assert.deepEqual(logic.scanHosts(true), ["host.docker.internal", "127.0.0.1"]);
    assert.ok(logic.textPorts("3005").some((entry) => entry.port === 8001));
    assert.ok(!logic.textPorts("8080").some((entry) => entry.port === 8080));
    assert.ok(!logic.textPorts(8000).some((entry) => entry.port === 8000));
    assert.equal(logic.textPorts(undefined)[0].port, 8001, "ODM's documented llama-server comes first");
  });

  await test("a 401 is a server wanting its key; a 403 is somebody else (AirPlay on 5000)", () => {
    assert.equal(logic.readModelsAnswer(200), "found");
    assert.equal(logic.readModelsAnswer(401), "needs-key");
    assert.equal(logic.readModelsAnswer(403), "absent");
    assert.equal(logic.readModelsAnswer(404), "absent");
    assert.equal(logic.readModelsAnswer(0), "absent");
  });

  await test("the program is named by its models' owner, else by its port", () => {
    const list = (owner) => ({ data: [{ id: "m", owned_by: owner }] });
    assert.equal(logic.identifyTextServer(list("llamacpp"), "openai-compatible"), "llama.cpp");
    assert.equal(logic.identifyTextServer(list("library"), "llama.cpp"), "ollama");
    assert.equal(logic.identifyTextServer(list("vllm"), "llama.cpp"), "vllm");
    assert.equal(logic.identifyTextServer(list("organization_owner"), "llama.cpp"), "lm-studio");
    assert.equal(logic.identifyTextServer(list("someone"), "koboldcpp"), "koboldcpp");
    assert.equal(logic.identifyTextServer(null, "jan"), "jan");
  });

  await test("only storyteller models are listed: no embeddings, speech, pictures or tool-less models", () => {
    const models = logic.readModelList({
      data: [
        { id: "gpt-5.1" },
        { id: "text-embedding-3-small" },
        { id: "whisper-1" },
        { id: "tts-1" },
        { id: "gpt-image-1" },
        { id: "dall-e-3" },
        { id: "omni-moderation-latest" },
        { id: "gpt-4o-realtime-preview" },
        { id: "gpt-4o-mini-transcribe" },
        { id: "nomic-embed-text:latest" },
        { id: "qwen3.6-35b" },
        { id: "qwen3.6-35b" },
        { id: "eclipse-7b" },
      ],
    });
    assert.deepEqual(
      models.map((model) => model.id),
      ["gpt-5.1", "qwen3.6-35b", "eclipse-7b"],
    );
    const routed = logic.readModelList({
      data: [
        { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", context_length: 1000000, supported_parameters: ["tools", "temperature"] },
        { id: "some/no-tools", name: "No tools", supported_parameters: ["temperature"] },
      ],
    });
    assert.deepEqual(routed, [{ id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash", context: 1000000 }]);
  });

  await test("the documented default is preselected, then the provider's choice, then the first listed", () => {
    const listed = (ids) => ids.map((id) => ({ id, label: id }));
    assert.equal(logic.recommendedModel(listed(["gemma4-26b", "qwen3.6-35b"])), "qwen3.6-35b");
    assert.equal(logic.recommendedModel(listed(["gemma4-26b", "qwen3.6-35b-code"])), "qwen3.6-35b-code");
    assert.equal(logic.recommendedModel(listed(["gemma4-26b"])), "gemma4-26b");
    assert.equal(logic.recommendedModel(listed(["gpt-4o", "gpt-5.1", "gpt-5.4-mini"]), logic.keyProvider("openai").preferred), "gpt-5.1");
    assert.equal(logic.recommendedModel([], ["x"]), "");
  });

  await test("a pasted key names its provider when it can", () => {
    assert.equal(logic.providerForKey("sk-or-v1-abcdef0123456789abcdef"), "openrouter");
    assert.equal(logic.providerForKey("sk-proj-abcdefghijklmnop0123"), "openai");
    assert.equal(logic.providerForKey("sk-abcdefghijklmnopqrstu"), "openai");
    assert.equal(logic.providerForKey("gsk_whatever"), null);
    assert.equal(logic.providerForKey(""), null);
  });

  await test("a saved key is only ever offered back to the host it was saved for", () => {
    const saved = { savedKey: "sk-saved", savedBaseUrl: "https://api.openai.com/v1" };
    assert.equal(logic.keyForListing({ ...saved, typed: "", baseUrl: "https://api.openai.com/v1" }), "sk-saved");
    assert.equal(logic.keyForListing({ ...saved, typed: "", baseUrl: "api.openai.com" }), "sk-saved");
    assert.equal(logic.keyForListing({ ...saved, typed: "", baseUrl: "https://evil.example/v1" }), "");
    assert.equal(logic.keyForListing({ ...saved, typed: "", baseUrl: "http://127.0.0.1:8001/v1" }), "");
    assert.equal(logic.keyForListing({ ...saved, typed: "sk-new", baseUrl: "https://evil.example/v1" }), "sk-new");
    assert.equal(logic.keyForListing({ savedKey: "", savedBaseUrl: "", typed: "", baseUrl: "" }), "");
  });

  await test("ComfyUI checkpoints and Kokoro voices are read from their own answers", () => {
    assert.deepEqual(
      logic.readComfyCheckpoints({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [["a.safetensors", "b.ckpt"], {}] } } } }),
      ["a.safetensors", "b.ckpt"],
    );
    assert.deepEqual(logic.readComfyCheckpoints({}), []);
    assert.deepEqual(logic.readKokoroVoices({ voices: ["af_heart", "bm_george", 3] }), ["af_heart", "bm_george"]);
    assert.deepEqual(logic.readKokoroVoices(null), []);
  });

  await test("each storyteller answer writes the admin panel's own fields", () => {
    assert.deepEqual(patches.storyPatch({ kind: "none" }), { patch: { text: { provider: "none" } } });
    assert.deepEqual(
      patches.storyPatch({ kind: "local", baseUrl: "127.0.0.1:8001", model: " qwen3.6-35b ", apiKey: "" }),
      { patch: { text: { provider: "custom", customBaseUrl: "http://127.0.0.1:8001/v1", customModel: "qwen3.6-35b", customApiKey: "" } } },
    );
    assert.deepEqual(
      patches.storyPatch({ kind: "key", provider: "openai", baseUrl: "https://ignored.example", model: "gpt-5.1", apiKey: "sk-x" }),
      { patch: { text: { provider: "custom", customBaseUrl: "https://api.openai.com/v1", customModel: "gpt-5.1", customApiKey: "sk-x" } } },
    );
    // A blank key keeps the saved one for the host it was saved for...
    const kept = patches.storyPatch(
      { kind: "key", provider: "openrouter", baseUrl: "", model: "google/gemini-3.5-flash", apiKey: "  " },
      "https://openrouter.ai/api/v1",
    );
    assert.equal("customApiKey" in kept.patch.text, false);
    assert.equal(kept.patch.text.customBaseUrl, "https://openrouter.ai/api/v1");
    // ...and clears it when the storyteller moves to another host, so an
    // OpenAI key never rides along to every turn on a local llama-server.
    const moved = patches.storyPatch(
      { kind: "local", baseUrl: "http://127.0.0.1:8001", model: "qwen3.6-35b", apiKey: "" },
      "https://api.openai.com/v1",
    );
    assert.equal(moved.patch.text.customApiKey, "");
    assert.equal(
      patches.storyPatch({ kind: "local", baseUrl: "127.0.0.1:8001", model: "q", apiKey: "" }, "http://127.0.0.1:8001/v1").patch.text.customApiKey,
      undefined,
    );
    assert.deepEqual(
      patches.storyPatch({ kind: "key", provider: "other", baseUrl: "https://api.groq.com/openai/v1", model: "m", apiKey: "k" }).patch.text.customBaseUrl,
      "https://api.groq.com/openai/v1",
    );
    assert.deepEqual(patches.storyPatch({ kind: "agent", id: "claude", model: "sonnet", utilityModel: "haiku" }), {
      patch: { harness: { id: "claude", model: "sonnet", utilityModel: "haiku" }, text: { provider: "harness" } },
    });
    assert.ok("error" in patches.storyPatch({ kind: "local", baseUrl: "", model: "m", apiKey: "" }));
    assert.ok("error" in patches.storyPatch({ kind: "local", baseUrl: "http://x:1", model: " ", apiKey: "" }));
  });

  await test("pictures, narration, name and joining patches", () => {
    assert.deepEqual(patches.picturesPatch({ kind: "comfyui", url: "http://127.0.0.1:8188/", checkpoint: "a.safetensors" }), {
      images: { defaultBackend: "comfyui", comfyUrl: "http://127.0.0.1:8188", comfyCheckpoint: "a.safetensors" },
    });
    assert.deepEqual(patches.picturesPatch({ kind: "openai", apiKey: "" }), { images: { defaultBackend: "openai", openaiBaseUrl: "" } });
    assert.equal(patches.picturesPatch({ kind: "openai", apiKey: "sk-i" }).images.openaiApiKey, "sk-i");
    assert.deepEqual(patches.picturesPatch({ kind: "agent" }), { images: { defaultBackend: "harness" } });
    assert.deepEqual(patches.picturesPatch({ kind: "none" }), { images: { defaultBackend: "", comfyUrl: "" } });
    assert.deepEqual(patches.narrationPatch({ kind: "kokoro", url: "http://127.0.0.1:8880/", voice: "af_heart" }), {
      speech: { ttsProvider: "kokoro", kokoroUrl: "http://127.0.0.1:8880", ttsVoice: "af_heart" },
    });
    assert.equal("ttsApiKey" in patches.narrationPatch({ kind: "openai", apiKey: "" }).speech, false);
    assert.deepEqual(patches.narrationPatch({ kind: "off" }), { speech: { ttsProvider: "off" } });
    assert.deepEqual(patches.joiningPatch({ signupMode: "invite", publicUrl: "https://keep.example/" }), {
      signupMode: "invite",
      publicUrl: "https://keep.example",
    });
    assert.deepEqual(patches.namePatch("  The Keep "), { serverName: "The Keep" });
    assert.deepEqual(
      patches.mergePatches(patches.narrationPatch({ kind: "off" }), { speech: { sttUrl: "off" } }, { text: { provider: "none" } }),
      { speech: { ttsProvider: "off", sttUrl: "off" }, text: { provider: "none" } },
    );
  });

  await test("the model listing reads a real server: a list, a key it wants, a key it refuses, silence", async () => {
    const seen = [];
    const server = http.createServer((request, response) => {
      seen.push({ url: request.url, auth: request.headers.authorization ?? "" });
      const send = (status, body) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.url === "/open/v1/models") return send(200, { data: [{ id: "qwen3.6-35b", owned_by: "llamacpp" }, { id: "nomic-embed" }] });
      if (request.url === "/empty/v1/models") return send(200, { data: [{ id: "text-embedding-3-large" }] });
      if (request.url === "/locked/v1/models") {
        return request.headers.authorization === "Bearer right" ? send(200, { data: [{ id: "gemma4-26b" }] }) : send(401, { error: "no" });
      }
      send(404, {});
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const open = await listModels(`${base}/open`, "");
      assert.equal(open.ok, true);
      assert.deepEqual(open.models.map((model) => model.id), ["qwen3.6-35b"]);
      assert.equal(open.recommended, "qwen3.6-35b");
      assert.equal(open.baseUrl, `${base}/open/v1`);

      const empty = await listModels(`${base}/empty`, "");
      assert.equal(empty.ok, false);
      assert.match(empty.error, /no chat models/);

      const wants = await listModels(`${base}/locked/v1`, "");
      assert.equal(wants.ok, false);
      assert.equal(wants.needsKey, true);
      assert.match(wants.error, /wants an API key/);

      const wrong = await listModels(`${base}/locked/v1`, "wrong");
      assert.match(wrong.error, /turned the key down/);

      const right = await listModels(`${base}/locked/v1/chat/completions`, "right");
      assert.equal(right.ok, true);
      assert.equal(right.recommended, "gemma4-26b");
      assert.equal(seen.at(-1).auth, "Bearer right");

      const missing = await listModels(`${base}/nothing`, "");
      assert.match(missing.error, /answered 404/);
    } finally {
      server.close();
    }
    const silent = await listModels("http://127.0.0.1:9", "");
    assert.equal(silent.ok, false);
    assert.match(silent.error, /Nothing answered/);
    assert.match((await listModels("", "")).error, /Enter the server's address/);
  });

  await test("the wizard's finished and dismissed marks, and when the home screen offers it", () => {
    assert.deepEqual(getSetupState(), { finishedAt: "", dismissedAt: "" });
    const base = { isAdmin: true, deviceWorld: false, state: getSetupState(), storyWorking: false };
    assert.equal(setupNudgeWanted(base), true);
    assert.equal(setupNudgeWanted({ ...base, isAdmin: false }), false);
    assert.equal(setupNudgeWanted({ ...base, deviceWorld: true }), false);
    assert.equal(setupNudgeWanted({ ...base, storyWorking: true }), false);
    const finished = markSetup("finished");
    assert.ok(finished.finishedAt);
    assert.equal(setupNudgeWanted({ ...base, state: getSetupState() }), false);
    markSetup("open");
    assert.deepEqual(getSetupState(), { finishedAt: "", dismissedAt: "" });
    markSetup("dismissed");
    assert.ok(getSetupState().dismissedAt);
    assert.equal(setupNudgeWanted({ ...base, state: getSetupState() }), false);
  });

  console.log(`\n${passed} setup wizard checks passed`);
} finally {
  removeTempDir(dir);
}
