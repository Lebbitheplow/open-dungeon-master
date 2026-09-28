// Speech-to-text fallbacks against real servers booted from a built
// checkout: a world with no engine at all, a world that falls back to
// OpenAI (a local mock stands in, so nothing is billed), and a world that
// installs the built-in Whisper and transcribes with it. STT_URL=off keeps
// every world away from any Whisper service on this machine.
//
// Not part of npm test: it downloads the 76 MB model into the build's
// models/speech on first run and needs speech audio to transcribe.
//
// Usage: node scripts/smoke-speech.mjs [built checkout dir]
//   SPEECH_WAV   16 kHz mono WAV of someone speaking (the transcription check)
//   SPEECH_WEBM  any Opus/WebM recording (the "wrong format" check)
//   SPEECH_EXPECT a word the transcript must contain (default "silver")
//   KEEP_MODEL=1 leave the downloaded model in place afterwards
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const buildDir = path.resolve(process.argv[2] ?? process.cwd());
const wavPath = process.env.SPEECH_WAV ?? "/tmp/stt-bench/say16.wav";
const webmPath = process.env.SPEECH_WEBM ?? "/tmp/stt-bench/say.webm";
const expected = (process.env.SPEECH_EXPECT ?? "silver").toLowerCase();
const modelDir = path.join(buildDir, "models", "speech");
const cleanup = [];

function ok(message) {
  console.log(`ok  ${message}`);
}

function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function boot(extraEnv) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-speech-"));
  const child = spawn(path.join(buildDir, "node_modules", ".bin", "next"), ["start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: buildDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      SQLITE_DB_PATH: path.join(dataDir, "smoke.sqlite"),
      DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      ODM_DEVICE_WORLD: "1",
      STT_URL: "off",
      OPENAI_API_KEY: "",
      OPENAI_IMAGE_API_KEY: "",
      OPENAI_COMPAT_API_KEY: "",
      ...extraEnv,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  cleanup.push(() => child.kill("SIGKILL"));
  cleanup.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  };
  // A device world's first account is its host and admin.
  const registered = await request(origin, "/api/auth/register", null, { method: "POST", json: { username: "host", password: "host-pass-123" } });
  assert.ok(registered.status < 300, `register returned ${registered.status}`);
  const grant = await request(origin, "/api/auth/token", null, { method: "POST", json: { username: "host", password: "host-pass-123" } });
  assert.ok(grant.body?.token, `token mint returned ${grant.status}`);
  return { origin, stop, token: grant.body.token };
}

async function request(origin, pathname, token, { method = "GET", json, form } = {}) {
  const res = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: json ? JSON.stringify(json) : form,
    signal: AbortSignal.timeout(180_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function audioForm(file, type, name) {
  const form = new FormData();
  form.set("audio", new Blob([fs.readFileSync(file)], { type }), name);
  return form;
}

// Stands in for api.openai.com and remembers what it was sent.
async function openAiMock() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString("latin1") });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: " words from the mock " }));
    });
  });
  const port = await freePort();
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  cleanup.push(() => server.close());
  return { baseUrl: `http://127.0.0.1:${port}/v1`, seen };
}

try {
  if (!process.env.KEEP_MODEL) fs.rmSync(modelDir, { recursive: true, force: true });

  // ---- no engine at all ----
  {
    const world = await boot({});
    const caps = await request(world.origin, "/api/capabilities", world.token);
    assert.deepEqual(caps.body?.stt, { configured: false, backend: "none", wantsWav: false });
    ok("no Whisper, no model, no key: capabilities say nobody listens");
    const stt = await request(world.origin, "/api/stt", world.token, { method: "POST", form: audioForm(webmPath, "audio/webm", "speech.webm") });
    assert.equal(stt.status, 503);
    assert.match(stt.body?.error ?? "", /Admin > Speech/);
    ok("/api/stt answers 503 and points at Admin > Speech");
    await world.stop();
  }

  // ---- OpenAI on the server's key ----
  {
    const mock = await openAiMock();
    const world = await boot({ OPENAI_API_KEY: "sk-smoke-not-real", OPENAI_IMAGE_BASE_URL: mock.baseUrl });
    const caps = await request(world.origin, "/api/capabilities", world.token);
    assert.deepEqual(caps.body?.stt, { configured: true, backend: "openai", wantsWav: false });
    ok("an OpenAI key and nothing else: capabilities pick OpenAI");
    const stt = await request(world.origin, "/api/stt", world.token, { method: "POST", form: audioForm(webmPath, "audio/webm", "speech.webm") });
    assert.equal(stt.status, 200);
    assert.equal(stt.body?.text, "words from the mock");
    const sent = mock.seen.at(-1);
    assert.equal(sent?.url, "/v1/audio/transcriptions");
    assert.equal(sent?.auth, "Bearer sk-smoke-not-real");
    assert.match(sent?.body ?? "", /gpt-4o-mini-transcribe/);
    assert.match(sent?.body ?? "", /filename="speech\.webm"/);
    ok("/api/stt forwards the recording to OpenAI with the key and model, and trims the words");
    await world.stop();
  }

  // ---- the built-in engine ----
  {
    const world = await boot({ OPENAI_API_KEY: "sk-smoke-not-real", OPENAI_IMAGE_BASE_URL: "http://127.0.0.1:9/v1" });
    const before = await request(world.origin, "/api/admin/speech", world.token);
    assert.equal(before.status, 200);
    assert.equal(before.body?.active, "openai");
    if (!process.env.KEEP_MODEL || !before.body?.builtin?.installed) {
      assert.equal(before.body?.builtin?.installed, false);
    }
    const started = await request(world.origin, "/api/admin/speech", world.token, { method: "POST" });
    assert.ok(["installing", "ready"].includes(started.body?.builtin?.status), `install began as ${started.body?.builtin?.status}`);
    let progressSeen = 0;
    let status = started.body;
    const deadline = Date.now() + 10 * 60_000;
    while (status?.builtin?.status === "installing" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      status = (await request(world.origin, "/api/admin/speech", world.token)).body;
      progressSeen = Math.max(progressSeen, status?.builtin?.progress ?? 0);
    }
    assert.equal(status?.builtin?.status, "ready", `install ended as ${status?.builtin?.status}: ${status?.builtin?.error}`);
    assert.equal(status?.builtin?.installed, true);
    assert.equal(status?.active, "builtin");
    ok(`the model installs with progress (last seen ${Math.round(progressSeen * 100)}%) and takes over from OpenAI`);
    const caps = await request(world.origin, "/api/capabilities", world.token);
    assert.deepEqual(caps.body?.stt, { configured: true, backend: "builtin", wantsWav: true });
    ok("capabilities ask the page for WAV");
    const wrong = await request(world.origin, "/api/stt", world.token, { method: "POST", form: audioForm(webmPath, "audio/webm", "speech.webm") });
    assert.equal(wrong.status, 415);
    ok("a raw recording is refused with a reload hint, not misread");
    const began = Date.now();
    const stt = await request(world.origin, "/api/stt", world.token, { method: "POST", form: audioForm(wavPath, "audio/wav", "speech.wav") });
    assert.equal(stt.status, 200, JSON.stringify(stt.body));
    assert.ok(stt.body?.text?.toLowerCase().includes(expected), `transcript: ${stt.body?.text}`);
    ok(`the built-in engine wrote it down in ${Date.now() - began} ms: "${stt.body.text}"`);
    await world.stop();

    // A restart finds the model on disk with no download.
    const again = await boot({});
    const after = await request(again.origin, "/api/admin/speech", again.token);
    assert.equal(after.body?.builtin?.installed, true);
    assert.equal(after.body?.active, "builtin");
    ok("after a restart the installed model is found and used");
    await again.stop();
  }
  console.log("SPEECH SMOKE PASS");
} catch (error) {
  console.error("SPEECH SMOKE FAIL:", error?.message ?? error);
  process.exitCode = 1;
} finally {
  for (const step of cleanup.reverse()) {
    try {
      step();
    } catch {
      // Best effort.
    }
  }
  if (!process.env.KEEP_MODEL) fs.rmSync(modelDir, { recursive: true, force: true });
}
