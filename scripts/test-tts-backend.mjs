// The narration backend (issues 88 and 89): which server a passage goes to,
// which voice it asks for, what the table is told when it fails, and that a
// failure is published with its reason instead of vanishing. Runs against a
// stand-in speech server on a loopback port.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-tts-backend-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
for (const key of ["KOKORO_URL", "TTS_PROVIDER", "TTS_BASE_URL", "TTS_MODEL", "TTS_API_KEY", "TTS_VOICE", "OPENAI_API_KEY", "OPENAI_IMAGE_API_KEY"]) {
  delete process.env[key];
}
const previousCwd = process.cwd();
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const backendLib = await import("../src/lib/tts-backend.ts");
const {
  resolveTtsBackend,
  v1Root,
  parseVoiceList,
  labelVoices,
  fallbackVoices,
  effectiveVoice,
  describeSpeechFailure,
  upstreamDetail,
  speechTimeoutMs,
  SPEECH_TIMEOUT_FLOOR_MS,
  SPEECH_TIMEOUT_CEILING_MS,
  synthesizeSpeech,
  narrationModel,
  serverVoices,
  ttsBackend,
  SpeechHttpError,
  SpeechEmptyError,
} = backendLib;
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const {
  enqueueNarrationAudio,
  takeNarrationFailure,
  narrationAudioPath,
  voicePreviewName,
  isPreviewableVoice,
  narrationOvertaken,
  setNarrationStaleMsForTests,
} = await import("../src/lib/tts.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { speechProbeUrl, backendPlace } = await import("../src/lib/capabilities.ts");
const { forgetSoleModelsForTests } = await import("../src/lib/model-registry/discovery.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const blank = { provider: "", kokoroUrl: "", openaiUrl: "", model: "", apiKey: "", voice: "", sharedOpenAiKey: "" };

await test("an untouched server is Kokoro at the shipped address", () => {
  const backend = resolveTtsBackend(blank);
  assert.deepEqual(backend, { provider: "kokoro", v1: "http://127.0.0.1:8880/v1", model: "kokoro", apiKey: "", defaultVoice: "af_heart" });
});

await test("a Kokoro address is used as given, with or without /v1", () => {
  assert.equal(resolveTtsBackend({ ...blank, kokoroUrl: "http://nas:8880/" }).v1, "http://nas:8880/v1");
  assert.equal(v1Root("http://nas:8880/v1/"), "http://nas:8880/v1");
  assert.equal(v1Root("https://example.org/speech/v2"), "https://example.org/speech/v2");
});

await test("an OpenAI-kind server never falls back to the Kokoro address", () => {
  const backend = resolveTtsBackend({ ...blank, provider: "openai", kokoroUrl: "http://nas:8880" });
  assert.equal(backend.v1, "https://api.openai.com/v1");
  assert.equal(backend.model, "", "no model is named for the admin");
  assert.equal(backend.defaultVoice, "alloy");
});

await test("the shared OpenAI key is lent to api.openai.com and to nobody else", () => {
  assert.equal(resolveTtsBackend({ ...blank, provider: "openai", sharedOpenAiKey: "sk-shared" }).apiKey, "sk-shared");
  const local = resolveTtsBackend({ ...blank, provider: "openai", openaiUrl: "http://10.0.0.5:8000", sharedOpenAiKey: "sk-shared" });
  assert.equal(local.apiKey, "");
  assert.equal(local.v1, "http://10.0.0.5:8000/v1");
  assert.equal(local.model, "");
  assert.equal(resolveTtsBackend({ ...blank, provider: "openai", model: " my-tts " }).model, "my-tts", "a picked model is sent as picked");
  assert.equal(resolveTtsBackend({ ...blank, provider: "openai", apiKey: "sk-own", sharedOpenAiKey: "sk-shared" }).apiKey, "sk-own");
});

await test("off is off, and anything unknown is Kokoro", () => {
  assert.equal(resolveTtsBackend({ ...blank, provider: "off" }).provider, "off");
  assert.equal(resolveTtsBackend({ ...blank, provider: "banana" }).provider, "kokoro");
});

await test("voice lists are read in the shapes servers send them", () => {
  assert.deepEqual(parseVoiceList({ voices: ["af_heart", "af_bella", "af_heart"] }), ["af_heart", "af_bella"]);
  assert.deepEqual(parseVoiceList({ voices: [{ id: "alloy" }, { name: "echo" }, { voice_id: "nova" }, 7, null] }), ["alloy", "echo", "nova"]);
  assert.deepEqual(parseVoiceList({ data: [{ id: "one" }] }), ["one"]);
  assert.deepEqual(parseVoiceList(["x"]), ["x"]);
  assert.deepEqual(parseVoiceList(null), []);
  assert.deepEqual(parseVoiceList({ voices: "nope" }), []);
});

await test("known voices keep their friendly names and come first", () => {
  const labelled = labelVoices(["zz_new", "af_heart", "bm_fable"]);
  assert.deepEqual(labelled.map((voice) => voice.id), ["af_heart", "bm_fable", "zz_new"]);
  assert.equal(labelled[0].label, "Heart (warm female)");
  assert.equal(labelled[2].label, "zz_new");
});

await test("a silent server falls back to what its kind ships", () => {
  assert.ok(fallbackVoices({ provider: "kokoro", v1: "http://x/v1" }).includes("af_heart"));
  assert.ok(fallbackVoices({ provider: "openai", v1: "https://api.openai.com/v1" }).includes("alloy"));
  assert.deepEqual(fallbackVoices({ provider: "openai", v1: "http://10.0.0.5/v1" }), []);
});

await test("a Kokoro voice on a server without it becomes the default voice", () => {
  const openai = { provider: "openai", defaultVoice: "alloy" };
  assert.equal(effectiveVoice("af_heart", openai, ["alloy", "echo"]), "alloy");
  // The server really has it (Kokoro behind the OpenAI kind): left alone.
  assert.equal(effectiveVoice("af_heart", openai, ["af_heart"]), "af_heart");
  // A custom voice is the server's to understand.
  assert.equal(effectiveVoice("af_heart(30)+af_bella(70)", openai, ["alloy"]), "af_heart(30)+af_bella(70)");
  assert.equal(effectiveVoice("david attenborough, but more dramatic", openai, []), "david attenborough, but more dramatic");
  assert.equal(effectiveVoice("", openai, []), "alloy");
  // Kokoro itself is always sent what was asked.
  assert.equal(effectiveVoice("am_adam", { provider: "kokoro", defaultVoice: "af_heart" }, []), "am_adam");
});

await test("a failure is described in words, without the key", () => {
  const kokoro = { provider: "kokoro", v1: "http://127.0.0.1:8880/v1" };
  const openai = { provider: "openai", v1: "https://api.openai.com/v1" };
  assert.equal(describeSpeechFailure(new TypeError("fetch failed"), kokoro), "The Kokoro speech server could not be reached at 127.0.0.1:8880.");
  assert.match(describeSpeechFailure(new SpeechHttpError(401, "Incorrect API key provided: sk-abc"), openai), /refused the API key \(HTTP 401\)\.$/);
  assert.ok(!describeSpeechFailure(new SpeechHttpError(401, "Incorrect API key provided: sk-abc"), openai).includes("sk-abc"));
  assert.equal(describeSpeechFailure(new SpeechHttpError(400, "Voice 'af_heart' not found"), openai), "The speech server answered HTTP 400: Voice 'af_heart' not found.");
  assert.match(describeSpeechFailure(new SpeechHttpError(404, ""), kokoro), /no speech endpoint at http:\/\/127\.0\.0\.1:8880\/v1\/audio\/speech/);
  assert.match(describeSpeechFailure(new SpeechEmptyError(), kokoro), /without any audio/);
  const timeout = new Error("timed out");
  timeout.name = "TimeoutError";
  assert.match(describeSpeechFailure(timeout, kokoro), /took too long/);
});

await test("only one sentence of an upstream error is repeated", () => {
  assert.equal(upstreamDetail(JSON.stringify({ error: { message: "No such model" } })), "No such model");
  assert.equal(upstreamDetail(JSON.stringify({ detail: "voice missing" })), "voice missing");
  assert.equal(upstreamDetail("<html><body>502 Bad Gateway</body></html>"), "");
  assert.equal(upstreamDetail("x".repeat(500)).length, 160);
});

await test("the probe and the place follow the backend", () => {
  assert.equal(speechProbeUrl({ provider: "kokoro", v1: "http://127.0.0.1:8880/v1" }), "http://127.0.0.1:8880/health");
  assert.equal(speechProbeUrl({ provider: "openai", v1: "http://10.0.0.5:8000/v1" }), "http://10.0.0.5:8000/v1/models");
  assert.equal(speechProbeUrl({ provider: "openai", v1: "https://api.openai.com/v1" }), "");
  assert.equal(speechProbeUrl({ provider: "off", v1: "http://127.0.0.1:8880/v1" }), "");
  assert.equal(backendPlace("http://127.0.0.1:8880/v1"), "local");
  assert.equal(backendPlace("http://192.168.1.20:8880"), "local");
  assert.equal(backendPlace("http://host.docker.internal:8880"), "local");
  assert.equal(backendPlace("http://nas:8880"), "local");
  assert.equal(backendPlace("https://api.openai.com/v1"), "api.openai.com");
  assert.equal(backendPlace("http://172.32.0.1"), "172.32.0.1");
});

await test("a preview clip is named for the server, the model and the voice", () => {
  const a = voicePreviewName("af_heart", { v1: "http://a/v1", model: "kokoro" });
  assert.match(a, /^[0-9a-f]{32}\.mp3$/);
  assert.notEqual(a, voicePreviewName("af_heart", { v1: "http://b/v1", model: "kokoro" }));
  assert.notEqual(a, voicePreviewName("af_heart", { v1: "http://a/v1", model: "other" }));
  assert.match(voicePreviewName("../../etc/passwd", { v1: "http://a/v1", model: "kokoro" }), /^[0-9a-f]{32}\.mp3$/);
  assert.equal(isPreviewableVoice("af_heart(30)+af_bella(70)"), true);
  assert.equal(isPreviewableVoice(""), false);
  assert.equal(isPreviewableVoice("a\nb"), false);
  assert.equal(isPreviewableVoice("x".repeat(121)), false);
});

await test("a speech request's patience grows with the passage, between a floor and a ceiling", () => {
  assert.equal(SPEECH_TIMEOUT_FLOOR_MS, 30_000);
  assert.equal(SPEECH_TIMEOUT_CEILING_MS, 60_000);
  assert.equal(speechTimeoutMs(0), 30_000);
  assert.equal(speechTimeoutMs(-5), 30_000);
  // The longest passage of the 2026-10-19 session took 9 s on OpenAI.
  assert.ok(speechTimeoutMs(950) > 45_000 && speechTimeoutMs(950) < 60_000);
  assert.ok(speechTimeoutMs(400) < speechTimeoutMs(800));
  assert.equal(speechTimeoutMs(100_000), 60_000);
});

await test("a passage is skipped only when it is stale, overtaken, and nobody asked for it by name", () => {
  assert.equal(narrationOvertaken(25_000, true, false), true);
  assert.equal(narrationOvertaken(5_000, true, false), false, "ordinary play reads every passage");
  assert.equal(narrationOvertaken(25_000, false, false), false, "the newest passage is always read");
  assert.equal(narrationOvertaken(25_000, true, true), false, "a replay is always read");
});

// ---- a stand-in speech server ----

const seen = [];
let mode = "ok";
// Requests the stand-in is sitting on, dropped at the end.
const hung = [];
// What the stand-in lists at /v1/models; null answers 404, as Kokoro does.
let listedModels = null;
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    seen.push({ url: request.url, auth: request.headers.authorization ?? "", body: body ? JSON.parse(body) : null });
    if (request.url === "/v1/models" && listedModels) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data: listedModels.map((id) => ({ id })) }));
      return;
    }
    if (request.url === "/v1/audio/voices") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ voices: ["af_heart", "narrator_one"] }));
      return;
    }
    if (request.url === "/v1/audio/speech") {
      if (mode === "stall" || mode === "stall-once") {
        if (mode === "stall-once") {
          mode = "ok";
        }
        hung.push(response);
        return;
      }
      if (mode === "slow") {
        setTimeout(() => {
          response.writeHead(200, { "Content-Type": "audio/mpeg" });
          response.end(Buffer.from("ID3-fake-mpeg"));
        }, 300);
        return;
      }
      if (mode === "refuse") {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Voice not found" } }));
        return;
      }
      if (mode === "empty") {
        response.writeHead(200, { "Content-Type": "audio/mpeg" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "audio/mpeg" });
      response.end(Buffer.from("ID3-fake-mpeg"));
      return;
    }
    response.writeHead(404);
    response.end();
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

await test("speech is asked of the configured server, with its model, voice and key", async () => {
  saveGlobalConfig({ speech: { ttsProvider: "openai", ttsBaseUrl: base, ttsModel: "my-tts", ttsApiKey: "sk-local", ttsVoice: "narrator_one" } });
  const backend = ttsBackend();
  assert.equal(backend.v1, `${base}/v1`);
  const audio = await synthesizeSpeech("Hello there.", "narrator_one", 1.2, backend);
  assert.equal(audio.toString(), "ID3-fake-mpeg");
  const call = seen.filter((entry) => entry.url === "/v1/audio/speech").at(-1);
  assert.equal(call.auth, "Bearer sk-local");
  assert.deepEqual(call.body, { model: "my-tts", voice: "narrator_one", input: "Hello there.", response_format: "mp3", speed: 1.2 });
});

await test("with no model picked, narration is refused naming Admin > Speech, and no speech is asked for", async () => {
  for (const ttsBaseUrl of ["https://api.openai.com/v1", base]) {
    saveGlobalConfig({ speech: { ttsProvider: "openai", ttsBaseUrl, ttsModel: "", ttsApiKey: "sk-local", ttsVoice: "narrator_one" } });
    const backend = ttsBackend();
    const before = seen.filter((entry) => entry.url === "/v1/audio/speech").length;
    const realFetch = globalThis.fetch;
    let outside = 0;
    globalThis.fetch = async (url, init) => {
      if (!String(url).startsWith(base)) {
        outside += 1;
        return new Response("{}", { status: 500 });
      }
      return realFetch(url, init);
    };
    try {
      await assert.rejects(synthesizeSpeech("Hello there.", "narrator_one", 1, backend), (error) => {
        assert.match(describeSpeechFailure(error, backend), /No narration model is picked.*Admin > Speech/);
        return true;
      });
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(outside, 0, `a request went to ${ttsBaseUrl}`);
    assert.equal(seen.filter((entry) => entry.url === "/v1/audio/speech").length, before, "the speech server was asked anyway");
  }
  saveGlobalConfig({ speech: { ttsProvider: "openai", ttsBaseUrl: base, ttsModel: "my-tts", ttsApiKey: "sk-local", ttsVoice: "narrator_one" } });
});

await test("the server's own voice list is what pickers are offered", async () => {
  const { ids, listed } = await serverVoices(ttsBackend(), true);
  assert.deepEqual(ids, ["af_heart", "narrator_one"]);
  assert.equal(listed, true);
});

await test("a Kokoro voice the server lacks is swapped for the default before it is sent", async () => {
  await synthesizeSpeech("Hi.", "bm_fable", 1, ttsBackend());
  assert.equal(seen.filter((entry) => entry.url === "/v1/audio/speech").at(-1).body.voice, "narrator_one");
  await synthesizeSpeech("Hi.", "af_heart", 1, ttsBackend());
  assert.equal(seen.filter((entry) => entry.url === "/v1/audio/speech").at(-1).body.voice, "af_heart");
});

// The events a table would be sent, read off the bus as the SSE chunks the
// browser gets.
const owner = createUser("narrator-host", "x", { isAdmin: true });
const CAMP = createCampaign(owner.id, { title: "Narration", description: "", theme: "high-fantasy", maxPlayers: 4, startingLevel: 1, difficulty: "normal" }).id;
const events = [];
const unsubscribe = subscribe(CAMP, (chunk) => {
  const type = /^event: (.+)$/m.exec(chunk)?.[1];
  const data = /^data: (.+)$/m.exec(chunk)?.[1];
  events.push({ type, payload: data ? JSON.parse(data) : null });
});

await test("a passage that renders is saved and announced", async () => {
  mode = "ok";
  await enqueueNarrationAudio(CAMP, "msg-ok", "The door opens.", [], "narrator_one");
  assert.ok(fs.existsSync(narrationAudioPath(CAMP, "msg-ok")));
  assert.equal(takeNarrationFailure("msg-ok"), null);
  assert.ok(events.some((event) => event.type === "tts_ready" && event.payload.messageId === "msg-ok"));
});

await test("a passage the server refuses is published as failed, with the reason", async () => {
  mode = "refuse";
  events.length = 0;
  await enqueueNarrationAudio(CAMP, "msg-bad", "The door stays shut.", [], "narrator_one");
  assert.ok(!fs.existsSync(narrationAudioPath(CAMP, "msg-bad")));
  const failed = events.find((event) => event.type === "media_status" && event.payload.state === "failed")?.payload;
  assert.ok(failed, "a failed media_status was published");
  assert.equal(failed.kind, "tts");
  assert.equal(failed.targetId, "msg-bad");
  assert.equal(failed.reason, "The speech server answered HTTP 400: Voice not found.");
  assert.equal(takeNarrationFailure("msg-bad"), "The speech server answered HTTP 400: Voice not found.");
  assert.equal(takeNarrationFailure("msg-bad"), null);
});

await test("an empty answer is a failure too, not a silent empty file", async () => {
  mode = "empty";
  await enqueueNarrationAudio(CAMP, "msg-empty", "Silence.", [], "narrator_one");
  assert.ok(!fs.existsSync(narrationAudioPath(CAMP, "msg-empty")));
  assert.match(takeNarrationFailure("msg-empty") ?? "", /without any audio/);
});

await test("a passage with no narration model picked is published as failed, saying where to pick one", async () => {
  saveGlobalConfig({ speech: { ttsProvider: "openai", ttsBaseUrl: base, ttsModel: "" } });
  const before = seen.filter((entry) => entry.url === "/v1/audio/speech").length;
  await enqueueNarrationAudio(CAMP, "msg-unpicked", "The bell tolls.", [], "narrator_one");
  assert.match(takeNarrationFailure("msg-unpicked") ?? "", /Admin > Speech/);
  assert.equal(seen.filter((entry) => entry.url === "/v1/audio/speech").length, before);
  saveGlobalConfig({ speech: { ttsModel: "my-tts" } });
});

await test("a server of the host's own that lists one model runs it for a blank field; one with several, and OpenAI, do not", async () => {
  mode = "ok";
  const speech = () => seen.filter((entry) => entry.url === "/v1/audio/speech");
  saveGlobalConfig({ speech: { ttsProvider: "openai", ttsBaseUrl: base, ttsModel: "", ttsApiKey: "sk-local", ttsVoice: "narrator_one" } });
  forgetSoleModelsForTests();
  listedModels = ["only-voice"];
  assert.equal(await narrationModel(ttsBackend()), "only-voice");
  await synthesizeSpeech("Hi.", "narrator_one", 1, ttsBackend());
  assert.equal(speech().at(-1).body.model, "only-voice", "the server's only model is asked for");
  assert.equal(seen.filter((entry) => entry.url === "/v1/models").at(-1).auth, "Bearer sk-local", "listed with the server's own key");
  // A passage is published with the model that read it.
  await enqueueNarrationAudio(CAMP, "msg-sole", "The bell tolls.", [], "narrator_one");
  assert.equal(takeNarrationFailure("msg-sole"), null);
  assert.equal(speech().at(-1).body.model, "only-voice");

  forgetSoleModelsForTests();
  listedModels = ["voice-a", "voice-b"];
  const before = speech().length;
  await assert.rejects(synthesizeSpeech("Hi.", "narrator_one", 1, ttsBackend()), /No narration model is picked/);
  assert.equal(speech().length, before, "two models and none picked: nothing is asked for");

  // OpenAI lists dozens: nothing is taken from its list, and it is not asked.
  saveGlobalConfig({ speech: { ttsBaseUrl: "https://api.openai.com/v1" } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("OpenAI was asked for its models");
  try {
    assert.equal(await narrationModel(ttsBackend()), "");
  } finally {
    globalThis.fetch = realFetch;
  }
  listedModels = null;
  forgetSoleModelsForTests();
  saveGlobalConfig({ speech: { ttsBaseUrl: base, ttsModel: "my-tts" } });
});

await test("Kokoro still sends its own model name", async () => {
  mode = "ok";
  const kokoro = resolveTtsBackend({ ...blank, provider: "kokoro", kokoroUrl: base });
  await synthesizeSpeech("Hi.", "af_heart", 1, kokoro);
  assert.equal(seen.filter((entry) => entry.url === "/v1/audio/speech").at(-1).body.model, "kokoro");
});

const speechCalls = () => seen.filter((entry) => entry.url === "/v1/audio/speech").length;

await test("a speech request that stalls is asked once more, and the second answer is used", async () => {
  mode = "stall-once";
  const before = speechCalls();
  const audio = await synthesizeSpeech("The stall clears.", "narrator_one", 1, ttsBackend(), { timeoutMs: 200 });
  assert.equal(audio.toString(), "ID3-fake-mpeg");
  assert.equal(speechCalls() - before, 2);
});

await test("a speech request that stalls twice fails as too slow, after exactly two tries", async () => {
  mode = "stall";
  const before = speechCalls();
  const backend = ttsBackend();
  await assert.rejects(synthesizeSpeech("Still stuck.", "narrator_one", 1, backend, { timeoutMs: 150 }), (error) => {
    assert.match(describeSpeechFailure(error, backend), /took too long/);
    return true;
  });
  assert.equal(speechCalls() - before, 2);
  mode = "ok";
});

await test("a refusal is not retried", async () => {
  mode = "refuse";
  const before = speechCalls();
  await assert.rejects(synthesizeSpeech("No.", "narrator_one", 1, ttsBackend()), SpeechHttpError);
  assert.equal(speechCalls() - before, 1);
  mode = "ok";
});

await test("a passage whose speech times out twice still tells the table why", async () => {
  events.length = 0;
  const realFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith("/audio/speech")) {
      asked += 1;
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }
    return realFetch(url, init);
  };
  try {
    await enqueueNarrationAudio(CAMP, "msg-stalled", "The provider is asleep.", [], "narrator_one");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(asked, 2, "one try and one retry");
  const failed = events.find((event) => event.type === "media_status" && event.payload.targetId === "msg-stalled" && event.payload.state === "failed");
  assert.ok(failed, "a failed media_status was published");
  assert.equal(failed.payload.reason, "The speech server took too long to answer.");
  assert.equal(takeNarrationFailure("msg-stalled"), "The speech server took too long to answer.");
});

await test("narration that fell behind skips to the newest passage instead of reading the backlog", async () => {
  mode = "slow";
  events.length = 0;
  setNarrationStaleMsForTests(100);
  try {
    const first = enqueueNarrationAudio(CAMP, "msg-lag-1", "The first passage, already being read.", [], "narrator_one");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const middle = enqueueNarrationAudio(CAMP, "msg-lag-2", "A passage the story has moved past.", [], "narrator_one");
    const newest = enqueueNarrationAudio(CAMP, "msg-lag-3", "The scene as it stands now.", [], "narrator_one");
    await Promise.all([first, middle, newest]);
  } finally {
    setNarrationStaleMsForTests(undefined);
  }
  assert.ok(fs.existsSync(narrationAudioPath(CAMP, "msg-lag-1")));
  assert.ok(!fs.existsSync(narrationAudioPath(CAMP, "msg-lag-2")), "the overtaken passage was not rendered");
  assert.ok(fs.existsSync(narrationAudioPath(CAMP, "msg-lag-3")));
  const statuses = (id) => events.filter((event) => event.type === "media_status" && event.payload.targetId === id).map((event) => event.payload.state);
  assert.deepEqual(statuses("msg-lag-2"), ["queued", "skipped"], "a skip is not announced as a failure");
  assert.ok(events.some((event) => event.type === "tts_ready" && event.payload.messageId === "msg-lag-3"));
});

await test("a passage asked for by name is read even when narration has fallen behind", async () => {
  mode = "slow";
  setNarrationStaleMsForTests(100);
  try {
    const first = enqueueNarrationAudio(CAMP, "msg-ask-1", "Someone is talking.", [], "narrator_one");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const asked = enqueueNarrationAudio(CAMP, "msg-ask-2", "Read me again, please.", [], "narrator_one", null, { onDemand: true });
    const newest = enqueueNarrationAudio(CAMP, "msg-ask-3", "And the story goes on.", [], "narrator_one");
    await Promise.all([first, asked, newest]);
  } finally {
    setNarrationStaleMsForTests(undefined);
  }
  assert.ok(fs.existsSync(narrationAudioPath(CAMP, "msg-ask-2")));
  assert.ok(fs.existsSync(narrationAudioPath(CAMP, "msg-ask-3")));
  mode = "ok";
});

await test("a server that is not there says where it was looked for", async () => {
  mode = "ok";
  saveGlobalConfig({ speech: { ttsProvider: "kokoro", kokoroUrl: "http://127.0.0.1:9", ttsModel: "", ttsApiKey: "", ttsVoice: "" } });
  await enqueueNarrationAudio(CAMP, "msg-gone", "Nobody home.", [], "af_heart");
  assert.equal(takeNarrationFailure("msg-gone"), "The Kokoro speech server could not be reached at 127.0.0.1:9.");
});

await test("narration switched off asks for nothing and announces nothing", async () => {
  saveGlobalConfig({ speech: { ttsProvider: "off" } });
  events.length = 0;
  const before = seen.length;
  await enqueueNarrationAudio(CAMP, "msg-off", "Not a word.", [], "af_heart");
  assert.equal(seen.length, before);
  assert.equal(events.length, 0);
});

unsubscribe?.();
for (const response of hung) {
  response.destroy();
}
server.closeAllConnections?.();
await new Promise((resolve) => server.close(resolve));
process.chdir(previousCwd);
removeTempDir(dir);
console.log(`\n${passed} narration backend checks passed`);
