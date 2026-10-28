// A run on opencode 2.x (src/lib/harness/adapters/opencode.ts), end to end
// against a stand-in for its server (scripts/lib/fake-opencode-server.mjs)
// that answers the routes the adapter uses as 2.0.27 does and records what it
// is asked: which config the run hands opencode, and which model a session is
// created on.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const { opencodeAdapter } = await import("../src/lib/harness/adapters/opencode.ts");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-opencode-run-test-"));
const home = path.join(dir, "home");
const adminConfigDir = path.join(home, ".config", "opencode");
fs.mkdirSync(adminConfigDir, { recursive: true });
const scenarioFile = path.join(dir, "scenario.json");
const log = path.join(dir, "requests.log");
const env = { PATH: process.env.PATH ?? "", HOME: home, ODM_FAKE_OPENCODE: scenarioFile, ODM_FAKE_OPENCODE_LOG: log };

const server = fileURLToPath(new URL("./lib/fake-opencode-server.mjs", import.meta.url));
const program = path.join(dir, "opencode");
fs.writeFileSync(
  program,
  `#!/bin/sh
case "$1" in
  --version) echo "2.0.27"; exit 0 ;;
  serve) exec "${process.execPath}" "${server}" "$@" ;;
esac
exit 1
`,
);
fs.chmodSync(program, 0o755);

let passed = 0;
async function test(name, fn) {
  // The stand-in is started by a shell script; the adapter's Windows path is
  // spawnProgram's, which the harness suites already run there.
  if (process.platform === "win32") {
    console.log(`skip: ${name} (Windows)`);
    return;
  }
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const logged = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const requests = () => logged().filter((entry) => entry.method);
const sessionCreated = () => requests().find((entry) => entry.method === "POST" && entry.url === "/api/session");

// GET /api/model on 2.0.27, trimmed: opencode's own free model, and two the
// admin set up.
const model = (providerID, id, variants = []) => ({ id, providerID, variants: variants.map((variant) => ({ id: variant })), limit: { context: 64000 } });
const EXO = model("opencode", "exo-free", ["high"]);
const ALPHA = model("alpha", "m1");
const ZETA = model("zeta", "m1", ["high"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One run: the admin's global config (as text), what opencode holds, and
// what ODM asks for. The session is closed again before it returns.
async function run({ admin = null, scenario = {}, model: chosen = "", effort = "", mcp = null, keep = false } = {}) {
  fs.rmSync(log, { force: true });
  fs.rmSync(path.join(adminConfigDir, "opencode.json"), { force: true });
  if (admin !== null) {
    fs.writeFileSync(path.join(adminConfigDir, "opencode.json"), admin);
  }
  fs.writeFileSync(scenarioFile, JSON.stringify(scenario));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-"));
  const heard = [];
  let session = null;
  let error = null;
  try {
    session = await opencodeAdapter.start({
      binary: program,
      system: "ODM-SYSTEM",
      model: chosen,
      effort,
      mcp,
      cwd,
      env,
      onEvent: (event) => heard.push(event),
    });
  } catch (caught) {
    error = caught;
  }
  const done = async () => {
    session?.close();
    // close() asks the server to interrupt and delete the session before it
    // stops it; the folder goes once it has.
    await sleep(300);
    fs.rmSync(cwd, { recursive: true, force: true });
  };
  if (!keep) {
    await done();
  }
  return { session, error, heard, cwd, done };
}

const adminConfig = {
  model: "zeta/m1",
  small_model: "alpha/m1",
  provider: { legacy: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:1/v1", apiKey: "sk-legacy" }, models: { m1: {} } } },
  providers: { zeta: { package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: "http://127.0.0.1:1/v1" }, models: { m1: {} } } },
  plugins: ["opencode-wakatime"],
  mcp: { servers: { github: { type: "remote", url: "http://127.0.0.1:1/mcp" } } },
};

await test("a run carries the admin's providers, 1.x's and 2.x's under their own keys, and their default models, and nothing else", async () => {
  const { error } = await run({ admin: JSON.stringify(adminConfig), scenario: { models: [EXO, ALPHA, ZETA], defaultModel: ZETA } });
  assert.equal(error, null);
  const { config } = logged().find((entry) => entry.start).start;
  assert.deepEqual(config.provider, adminConfig.provider, "opencode 2 converts a 1.x entry only under `provider`");
  assert.deepEqual(config.providers, adminConfig.providers);
  assert.equal(config.model, "zeta/m1");
  assert.equal(config.small_model, "alpha/m1");
  assert.equal(config.plugins, undefined);
  assert.equal(config.mcp, undefined, "a completion gets no MCP server, the admin's least of all");
  assert.equal(config.agents["odm-dm"].system, "ODM-SYSTEM");
});

await test("a run's config, a campaign-sized system prompt included, is a file only this user can read in the run's own config folder", async () => {
  // Linux refuses an environment string of 128 KiB, and Windows caps one
  // variable at 32 K characters.
  const system = `ODM-SYSTEM ${"The rules engine decides. ".repeat(8_000)}`;
  fs.rmSync(log, { force: true });
  fs.writeFileSync(scenarioFile, JSON.stringify({ models: [ALPHA] }));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-"));
  const session = await opencodeAdapter.start({ binary: program, system, model: "", effort: "", mcp: null, cwd, env, onEvent: () => undefined });
  session.close();
  await sleep(300);
  fs.rmSync(cwd, { recursive: true, force: true });
  const { start } = logged().find((entry) => entry.start);
  assert.equal(start.configInEnvironment, false, "keys carried over stay out of the environment opencode's children inherit");
  assert.equal(start.mode, 0o600);
  assert.equal(start.config.agents["odm-dm"].system, system);
  assert.ok(system.length > 128 * 1024);
});

await test("with no model chosen, a run asks for opencode's default, which is the admin's own model", async () => {
  await run({ admin: JSON.stringify(adminConfig), scenario: { models: [EXO, ALPHA, ZETA], defaultModel: ZETA } });
  assert.deepEqual(sessionCreated().body.model, { providerID: "zeta", id: "m1" });
});

await test("with no model chosen and opencode defaulting to its own free model, a run asks for the first model it can use", async () => {
  await run({ scenario: { models: [EXO, ALPHA, ZETA], defaultModel: EXO } });
  assert.deepEqual(sessionCreated().body.model, { providerID: "alpha", id: "m1" });
  await run({ scenario: { models: [EXO, ALPHA, ZETA] } });
  assert.deepEqual(sessionCreated().body.model, { providerID: "alpha", id: "m1" }, "no default at all");
});

await test("with no model a run can use, it is refused as signed out before any session", async () => {
  const { error, heard } = await run({ scenario: { models: [EXO], defaultModel: EXO } });
  assert.match(error?.message ?? "", /no model it can use outside its own app/);
  assert.deepEqual(
    heard.map((event) => event.kind),
    ["signed-out"],
  );
  assert.equal(sessionCreated(), undefined);
});

await test("a model ODM names is asked for as named, with its effort as the model's variant", async () => {
  await run({ scenario: { models: [EXO, ALPHA, ZETA], defaultModel: ALPHA }, model: "zeta/m1", effort: "high" });
  assert.deepEqual(sessionCreated().body.model, { providerID: "zeta", id: "m1", variant: "high" });
  await run({ scenario: { models: [EXO, ALPHA, ZETA], defaultModel: ZETA }, model: "zeta/m1", effort: "low" });
  assert.deepEqual(sessionCreated().body.model, { providerID: "zeta", id: "m1" }, "an effort the model lacks is not sent");
});

await test("a broken admin config fails the check and the run with its file, line and column, and none of what it holds", async () => {
  const lines = ["{", '  "providers": { "a": { "apiKey": "sk-live-SECRET1234567890", "x": undefined } }', "}"];
  const file = path.join(adminConfigDir, "opencode.json");
  const expected = `${file} could not be read: it is not valid JSON at line 2, column ${lines[1].indexOf("undefined") + 1}.`;
  fs.writeFileSync(file, lines.join("\n"));
  await assert.rejects(opencodeAdapter.probe(program, env), { message: expected });
  const { error } = await run({ admin: lines.join("\n"), scenario: { models: [ALPHA] } });
  assert.equal(error?.message, expected);
  assert.ok(!expected.includes("SECRET") && !expected.includes("undefined"));
});

await test("an admin config saved with a byte order mark is read", async () => {
  await run({ admin: `\uFEFF${JSON.stringify(adminConfig)}`, scenario: { models: [EXO, ALPHA, ZETA], defaultModel: ZETA } });
  assert.equal(logged().find((entry) => entry.start).start.config.model, "zeta/m1");
});

await test("leftover sessions are deleted at the start, and one already gone, or that cannot be deleted, never fails the run", async () => {
  const tag = { openDungeonMaster: "run" };
  const tmp = fs.realpathSync.native(os.tmpdir());
  // A folder that is still there: ODM was killed, and nothing removed it.
  const kept = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-"));
  const sessions = [
    { id: "ses_gone", title: "Open Game Master", metadata: tag, location: { directory: path.join(tmp, "odm-harness-gone0") }, time: { created: 1, updated: Date.now() } },
    { id: "ses_old", title: "Open Game Master", metadata: tag, location: { directory: kept }, time: { created: 1, updated: Date.now() - 45 * 60_000 } },
    { id: "ses_live", title: "Open Game Master", metadata: tag, location: { directory: kept }, time: { created: 1, updated: Date.now() - 60_000 } },
    { id: "ses_admin", title: "Open Game Master", location: { directory: path.join(tmp, "odm-harness-gone1") }, time: { created: 1, updated: 1 } },
  ];
  const deleted = () => requests().filter((entry) => entry.method === "DELETE").map((entry) => entry.url);
  for (const deleteStatus of [200, 404, 500]) {
    const { error, heard } = await run({ scenario: { sessions, deleteStatus, models: [ALPHA] } });
    assert.equal(error, null, `DELETE answering ${deleteStatus}`);
    assert.deepEqual(heard.map((event) => event.type), ["ready"]);
    assert.ok(sessionCreated(), "the run went on to its own session");
    const swept = deleteStatus === 500 ? ["/api/session/ses_gone"] : ["/api/session/ses_gone", "/api/session/ses_old"];
    assert.deepEqual(deleted().slice(0, swept.length), swept, `DELETE answering ${deleteStatus}`);
  }
  fs.rmSync(kept, { recursive: true, force: true });
});

await test("a frame that is not JSON, or an event short of a figure, does not end the turn's stream", async () => {
  const session = { sessionID: "ses_fake" };
  const events = [
    "not json at all",
    "null",
    { type: "session.text.delta", data: { sessionID: "ses_other", delta: "Someone else's. " } },
    { type: "session.text.delta", data: { ...session, delta: "The goblin falls." } },
    { type: "session.step.ended", data: { ...session, tokens: { input: 30, output: 5 } } },
    { type: "session.execution.succeeded", data: session },
  ];
  const { session: started, heard, done } = await run({ scenario: { models: [ALPHA], events }, keep: true });
  started.send("The goblin attacks.");
  for (let waited = 0; !heard.some((event) => event.type === "turn_end" || event.type === "error") && waited < 5_000; waited += 50) {
    await sleep(50);
  }
  await done();
  assert.deepEqual(heard.slice(1), [
    { type: "delta", text: "The goblin falls." },
    { type: "turn_end", text: "The goblin falls.", usage: { inputTokens: 30, outputTokens: 5 } },
  ]);
});

removeTempDir(dir);
console.log(`opencode run: ${passed} checks passed`);
