// The admin's Server log (issue #383, src/lib/server-log.ts): the server's
// console kept in memory, read from Admin > Server log. What must hold: every
// console line is kept in order and still printed, keys and tokens never
// reach the page (by shape, by the environment's own secrets, and by the
// keys saved in the admin panel), the buffer keeps only its newest lines,
// and only an admin can read it.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-server-log");

process.env.TEST_SERVICE_TOKEN = "env-secret-value-12345";
const log = await import("../src/lib/server-log.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

// What the console printed, so the test can show the original still runs.
const printed = [];
const realError = console.error;
const realLog = console.log;
console.error = (...args) => printed.push(["error", args.join(" ")]);
console.log = (...args) => printed.push(["log", args.join(" ")]);
log.installServerLog();
log.installServerLog();

await test("Console lines are kept in order with their level, and the console still prints each one once.", () => {
  const before = log.readServerLog().latestSeq;
  console.log("[dm] campaign abc: a line");
  console.error("[dm] campaign abc: an error", new Error("boom"));
  const page = log.readServerLog({ after: before });
  assert.equal(page.entries.length, 2);
  assert.equal(page.entries[0].level, "info");
  assert.equal(page.entries[0].text, "[dm] campaign abc: a line");
  assert.equal(page.entries[1].level, "error");
  assert.match(page.entries[1].text, /an error Error: boom/);
  assert.equal(printed.filter(([, text]) => text.includes("campaign abc")).length, 2, "installing twice printed lines twice, or not at all");
});

await test("Keys and tokens are cut out by shape and by the environment's own secret values.", () => {
  const before = log.readServerLog().latestSeq;
  console.log("Authorization: Bearer abcdef0123456789xyz");
  console.log('{"apiKey":"llama-local-key-777","model":"qwen"}');
  console.log("calling https://example.test/v1?key=AIzaSecretValue&x=1 with sk-or-v1-0123456789abcdefABCDEF");
  console.log("the service answered with env-secret-value-12345 inside");
  const text = log.readServerLog({ after: before }).entries.map((entry) => entry.text).join("\n");
  for (const secret of ["abcdef0123456789xyz", "llama-local-key-777", "AIzaSecretValue", "sk-or-v1-0123456789abcdefABCDEF", "env-secret-value-12345"]) {
    assert.ok(!text.includes(secret), `"${secret}" reached the log:\n${text}`);
  }
  assert.match(text, /"model":"qwen"/, "the rest of the line went too");
});

await test("A key saved in the admin panel after the line was written is cut out when the log is read.", () => {
  const before = log.readServerLog().latestSeq;
  console.warn("the backend rejected plainkeyvalue99887766 for that model");
  saveGlobalConfig({ text: { customApiKey: "plainkeyvalue99887766" } });
  const secrets = log.secretValuesIn({ text: { customApiKey: "plainkeyvalue99887766", customModel: "qwen3.6-35b" } });
  assert.deepEqual(secrets, ["plainkeyvalue99887766"], "a model name was taken for a secret");
  const [entry] = log.readServerLog({ after: before, secrets }).entries;
  assert.equal(entry.level, "warn");
  assert.ok(!entry.text.includes("plainkeyvalue99887766"), entry.text);
});

await test("Only the newest lines are kept, and a very long line is cut.", () => {
  for (let index = 0; index < log.SERVER_LOG_CAPACITY + 50; index += 1) {
    log.recordServerLog("debug", [`filler ${index}`]);
  }
  const page = log.readServerLog();
  assert.equal(page.entries.length, log.SERVER_LOG_CAPACITY);
  assert.equal(page.entries.at(-1).text, `filler ${log.SERVER_LOG_CAPACITY + 49}`);
  assert.equal(page.firstSeq, page.entries[0].seq);
  log.recordServerLog("info", ["x".repeat(10_000)]);
  assert.ok(log.readServerLog({ limit: 1 }).entries[0].text.length < 4_100);
});

await test("Admins read the log and download it as a file; anyone else is refused.", async () => {
  const world = await openWorld();
  const route = await world.route("admin/logs");
  const stranger = world.addUser("player");
  world.signIn(stranger);
  const refused = await route.GET(new Request("http://test/api/admin/logs"));
  assert.ok(refused.status === 401 || refused.status === 403, `a player read the server log (${refused.status})`);

  getDatabase().prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(world.owner.id);
  world.signIn(world.owner);
  console.log("[test] a line for the admin");
  const page = await (await route.GET(new Request("http://test/api/admin/logs?after=0"))).json();
  assert.ok(page.entries.some((entry) => entry.text === "[test] a line for the admin"));
  const file = await route.GET(new Request("http://test/api/admin/logs?format=text"));
  assert.match(file.headers.get("content-disposition") ?? "", /attachment; filename="odm-server-log-/);
  assert.match(await file.text(), /INFO  \[test\] a line for the admin/);
});

console.error = realError;
console.log = realLog;
finish();
