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
const { comfyFromScan, picturesBlocker } = await import("../src/app/setup/draft.ts");
const { getSetupState, markSetup, setupNudgeWanted } = await import("../src/lib/setup/state.ts");
const suggest = await import("../src/lib/setup/suggest.ts");

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

  await test("the first chat model listed is preselected until the catalog ranks the list; no model is named", () => {
    const listed = (ids) => ids.map((id) => ({ id, label: id }));
    // No model is named in code: the server's own first chat model, until
    // the setup route ranks the list with the catalog.
    assert.equal(logic.recommendedModel(listed(["gemma4-26b", "qwen3.6-35b"])), "gemma4-26b");
    assert.equal(logic.recommendedModel(listed(["gpt-4o", "gpt-5.1", "gpt-5.4-mini"])), "gpt-4o");
    assert.equal(logic.recommendedModel([]), "");
    assert.equal("preferred" in logic.keyProvider("openai"), false, "no preferred ids to go stale");
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

  await test("a loader's file list is read in both of ComfyUI's formats", () => {
    // Both ways ComfyUI declares a file list: [names, options] and its newer
    // ["COMBO", { options }].
    assert.deepEqual(logic.readComfyFiles({ UNETLoader: { input: { required: { unet_name: [["a.safetensors"], {}] } } } }, "UNETLoader", "unet_name"), ["a.safetensors"]);
    assert.deepEqual(
      logic.readComfyFiles({ CLIPLoader: { input: { required: { clip_name: ["COMBO", { options: ["b.safetensors", 4] }] } } } }, "CLIPLoader", "clip_name"),
      ["b.safetensors"],
    );
    assert.deepEqual(logic.readComfyFiles({ VAELoader: {} }, "VAELoader", "vae_name"), []);
    assert.deepEqual(logic.readComfyFiles(null, "VAELoader", "vae_name"), []);

  });

  // A catalog model as ComfyUI's status check reports it (src/lib/comfyui.ts).
  const report = (id, { missing = [], verdict } = {}) => ({
    id, files: {}, missing, downloadGb: 0, needGb: null, fits: null,
    verified: verdict ? { verdict, seconds: { square: 10, landscape: 8 } } : null,
  });
  const found = (checkpoints, models) => ({ url: "http://127.0.0.1:8188", checkpoints, models, hardware: null });

  await test("the scan fills an open ComfyUI choice only when it is obvious: the measured recommendation, or the one thing there", () => {
    const blank = { url: "", checkpoint: "", preset: "checkpoint" };
    // Only a catalog model installed: that model.
    assert.deepEqual(comfyFromScan(blank, found([], [report("z_turbo")])), { url: "http://127.0.0.1:8188", checkpoint: "", preset: "z_turbo" });
    // Only a checkpoint: that checkpoint.
    assert.deepEqual(comfyFromScan(blank, found(["sdxl.safetensors"], [])), { url: "http://127.0.0.1:8188", checkpoint: "sdxl.safetensors", preset: "checkpoint" });
    // A checkpoint and an unmeasured model, or two checkpoints: nothing is taken for being first.
    assert.deepEqual(comfyFromScan(blank, found(["sdxl.safetensors"], [report("z_turbo")])), { url: "http://127.0.0.1:8188", checkpoint: "", preset: "checkpoint" });
    assert.deepEqual(comfyFromScan(blank, found(["a.safetensors", "b.safetensors"], [])), { url: "http://127.0.0.1:8188", checkpoint: "", preset: "checkpoint" });
    // A model this hardware failed to run is not a choice at all.
    assert.equal(comfyFromScan(blank, found(["sdxl.safetensors"], [report("z_turbo", { verdict: "fails" })])).checkpoint, "sdxl.safetensors");
    // A model this hardware was measured recommending is the obvious pick.
    assert.equal(
      comfyFromScan(blank, found(["sdxl.safetensors"], [report("qwen_image_21_turbo", { verdict: "recommended" }), report("z_turbo")])).preset,
      "qwen_image_21_turbo",
    );
    // A recommendation the ComfyUI lacks the files for is not picked.
    assert.equal(comfyFromScan(blank, found(["sdxl.safetensors"], [report("flux2_klein_4b", { verdict: "recommended", missing: [{}] })])).preset, "checkpoint");
    // A saved model stays while its files are there, and falls back when they are not.
    assert.equal(comfyFromScan({ ...blank, preset: "z_turbo" }, found(["sdxl.safetensors"], [report("z_turbo")])).preset, "z_turbo");
    assert.equal(comfyFromScan({ ...blank, preset: "z_turbo" }, found([], [report("z_turbo", { missing: [{}] })])).preset, "checkpoint");
    // A checkpoint the admin chose is never swapped for a recommendation.
    assert.equal(
      comfyFromScan({ ...blank, checkpoint: "mine.safetensors" }, found(["sdxl.safetensors"], [report("qwen_image_21_turbo", { verdict: "recommended" })])).preset,
      "checkpoint",
    );
  });

  await test("the pictures step holds Continue until a model is picked, for ComfyUI as for OpenAI", () => {
    const draft = (pictures, patch = {}) => ({
      pictures,
      comfy: { url: "http://127.0.0.1:8188", checkpoint: "", preset: "checkpoint" },
      picturesKey: "",
      picturesModel: "",
      ...patch,
    });
    const input = { agentVerified: false, storyIsOpenAi: false, openaiKeySaved: true, envImageModel: "", comfyOffers: true };
    const pickComfy = "Pick the image model, or choose another answer.";
    // Two checkpoints found and none picked (comfyFromScan takes neither):
    // nothing would be painted, so the step says so.
    assert.equal(picturesBlocker(draft("comfyui"), input), pickComfy);
    assert.equal(picturesBlocker(draft("comfyui", { comfy: { url: "http://127.0.0.1:8188", checkpoint: "a.safetensors", preset: "checkpoint" } }), input), null);
    assert.equal(picturesBlocker(draft("comfyui", { comfy: { url: "http://127.0.0.1:8188", checkpoint: "", preset: "z_turbo" } }), input), null, "a catalog model needs no checkpoint");
    // A ComfyUI that offers nothing to pick, or has not answered, is left to the admin panel.
    assert.equal(picturesBlocker(draft("comfyui"), { ...input, comfyOffers: false }), null);
    assert.equal(picturesBlocker(draft("comfyui", { comfy: { url: " ", checkpoint: "", preset: "checkpoint" } }), input), "Type where ComfyUI runs, or choose another answer.");
    // OpenAI's blockers, unchanged.
    assert.equal(picturesBlocker(draft("openai"), input), "Pick the picture model, or choose another answer.");
    assert.equal(picturesBlocker(draft("openai"), { ...input, envImageModel: "env-painter" }), null);
    assert.equal(picturesBlocker(draft("openai", { picturesModel: "my-painter" }), { ...input, openaiKeySaved: false }), "Paste an OpenAI key, or choose another answer.");
    assert.equal(picturesBlocker(draft("agent"), input), "Paint a test map first: the tables only get a painter that works.");
    assert.equal(picturesBlocker(draft("none"), input), null);
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
    // The server's own Ollama runs on the Ollama provider, which sends the
    // window with every call; its OpenAI-style endpoint would run Ollama's
    // 4K default on a 16 GB card. The custom fields are left as they were.
    assert.deepEqual(
      patches.storyPatch({ kind: "local", baseUrl: "http://127.0.0.1:11434/v1", model: " gpt-oss:20b ", apiKey: "", ollama: true }, "https://api.openai.com/v1"),
      { patch: { text: { provider: "local", localTextModel: "gpt-oss:20b" } } },
    );
    assert.ok("error" in patches.storyPatch({ kind: "local", baseUrl: "http://127.0.0.1:11434/v1", model: " ", apiKey: "", ollama: true }));
    assert.equal(
      patches.storyPatch({ kind: "local", baseUrl: "http://127.0.0.1:11434/v1", model: "gpt-oss:20b", apiKey: "", ollama: false }).patch.text.provider,
      "custom",
      "an Ollama the server's provider cannot reach stays on its OpenAI-style address",
    );
  });

  await test("a found Ollama is the server's own when the addresses match", () => {
    assert.equal(logic.sameServer("http://127.0.0.1:11434/v1", "http://127.0.0.1:11434"), true);
    assert.equal(logic.sameServer("http://127.0.0.1:11434/v1", "http://localhost:11434/"), true, "localhost is 127.0.0.1");
    assert.equal(logic.sameServer("http://host.docker.internal:11434/v1", "http://host.docker.internal:11434"), true);
    assert.equal(logic.sameServer("http://127.0.0.1:11434/v1", "http://host.docker.internal:11434"), false);
    assert.equal(logic.sameServer("http://127.0.0.1:11434/v1", "http://127.0.0.1:8001"), false);
    assert.equal(logic.sameServer("", ""), false);
  });

  await test("pictures, narration, name and joining patches", () => {
    assert.deepEqual(patches.picturesPatch({ kind: "comfyui", url: "http://127.0.0.1:8188/", checkpoint: "a.safetensors" }), {
      images: { defaultBackend: "comfyui", comfyUrl: "http://127.0.0.1:8188", comfyCheckpoint: "a.safetensors", comfyWorkflowPreset: "checkpoint" },
    });
    assert.deepEqual(patches.picturesPatch({ kind: "comfyui", url: "http://127.0.0.1:8188", checkpoint: "a.safetensors", preset: "z_turbo" }).images, {
      defaultBackend: "comfyui", comfyUrl: "http://127.0.0.1:8188", comfyCheckpoint: "a.safetensors", comfyWorkflowPreset: "z_turbo",
    });
    assert.deepEqual(patches.picturesPatch({ kind: "openai", apiKey: "", model: " my-painter " }), { images: { defaultBackend: "openai", openaiBaseUrl: "", openaiModel: "my-painter" } });
    assert.equal(patches.picturesPatch({ kind: "openai", apiKey: "sk-i", model: "my-painter" }).images.openaiApiKey, "sk-i");
    assert.deepEqual(patches.picturesPatch({ kind: "agent" }), { images: { defaultBackend: "harness" }, harness: { images: "native" } });
    assert.deepEqual(patches.picturesPatch({ kind: "none" }), { images: { defaultBackend: "", comfyUrl: "" } });
    assert.deepEqual(patches.narrationPatch({ kind: "kokoro", url: "http://127.0.0.1:8880/", voice: "af_heart" }), {
      speech: { ttsProvider: "kokoro", kokoroUrl: "http://127.0.0.1:8880", ttsVoice: "af_heart" },
    });
    assert.equal("ttsApiKey" in patches.narrationPatch({ kind: "openai", apiKey: "", model: "my-voice" }).speech, false);
    assert.equal(patches.narrationPatch({ kind: "openai", apiKey: "", model: "my-voice" }).speech.ttsModel, "my-voice", "the picked narration model is saved");
    assert.deepEqual(patches.dictationPatch({ whisperModel: " large-v3 " }), { speech: { sttModel: "large-v3" } }, "only the model the step asked for");
    assert.deepEqual(patches.dictationPatch({ openaiModel: "my-ears" }), { speech: { sttOpenaiModel: "my-ears" } });
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

  // The media steps suggest what is already set up: a painting agent that
  // narrates paints too, an OpenAI story key covers pictures and voice, and
  // a ComfyUI or Kokoro already running here is free. "None" and "off" are
  // never filled in for the admin, since saving them is a deliberate choice.
  await test("the media steps suggest reusing what the storyteller already set up", () => {
    const none = { story: "", agentId: "", storyIsOpenAi: false, comfyFound: false, kokoroFound: false };
    const codex = suggest.suggestPictures({ ...none, story: "agent", agentId: "codex" });
    assert.equal(codex.pick, "agent");
    assert.match(codex.reason, /^Codex narrates your tables, and it can paint too/);
    assert.equal(suggest.suggestPictures({ ...none, story: "agent", agentId: "grok" }).pick, "agent");
    assert.notEqual(suggest.suggestPictures({ ...none, story: "agent", agentId: "claude" }).pick, "agent", "Claude Code has no image tool");
    assert.equal(suggest.suggestPictures({ ...none, story: "agent", agentId: "claude", comfyFound: true }).pick, "comfyui");
    assert.equal(suggest.suggestPictures({ ...none, story: "key", storyIsOpenAi: true, comfyFound: true }).pick, "openai", "the key beats a second service");
    assert.equal(suggest.suggestPictures(none).pick, "none");
    assert.equal(suggest.suggestNarration({ ...none, storyIsOpenAi: true }).pick, "openai");
    assert.equal(suggest.suggestNarration({ ...none, kokoroFound: true }).pick, "kokoro");
    assert.equal(suggest.suggestNarration({ ...none, story: "agent", agentId: "codex" }).pick, "off", "no agent reads aloud");
    assert.equal(suggest.fillsStep("agent"), true);
    assert.equal(suggest.fillsStep("none"), false);
    assert.equal(suggest.fillsStep("off"), false);
  });

  await test("skipping or leaving a media step unanswered writes nothing over a service", () => {
    const wizard = fs.readFileSync(new URL("../src/app/setup/SetupWizard.tsx", import.meta.url), "utf8");
    assert.match(wizard, /if \(draft\.pictures === ""\) return null;/, "unanswered pictures save nothing");
    assert.match(wizard, /: draft\.narration === "off"\s*\? narrationPatch\(\{ kind: "off" \}\)\s*: null;/, "only a chosen Text only saves narration off");
    for (const key of ["pictures", "voice", "players"]) {
      assert.match(wizard, new RegExp(`onClick: \\(\\) => skip\\("${key}"\\)`), `${key} can be skipped`);
    }
    assert.match(wizard, /label: "Save and finish later"/);
    // skip() puts the step back to the saved answer and saves nothing.
    const skipBody = wizard.slice(wizard.indexOf("function skip("), wizard.indexOf("async function finishLater"));
    assert.doesNotMatch(skipBody, /patch\(/, "skip never PATCHes");
  });

  console.log(`\n${passed} setup wizard checks passed`);
} finally {
  removeTempDir(dir);
}
