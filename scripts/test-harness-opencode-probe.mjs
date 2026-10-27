// opencode before 2.x had another server API and no way to keep the admin's
// plugins out of ODM's run (src/lib/harness/adapters/opencode.ts): it shows
// as installed but unsupported, with its version and the way to 2.x, and a
// run on it stops before any session or prompt. A stub program stands in for
// opencode 1.x, its server answering as 1.19 does: the session list, a route
// both versions have, with JSON, and the routes only 2.x has, ODM's agent
// among them, with its web app's page.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const { opencodeAdapter } = await import("../src/lib/harness/adapters/opencode.ts");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-opencode-probe-test-"));
const log = path.join(dir, "calls.log");
const env = { PATH: process.env.PATH ?? "", HOME: dir, ODM_STUB_LOG: log };

let passed = 0;
async function test(name, fn) {
  // The stub is a shell script; the adapter's Windows path is spawnProgram's,
  // which the harness suites already run there.
  if (process.platform === "win32") {
    console.log(`skip: ${name} (Windows)`);
    return;
  }
  fs.rmSync(log, { force: true });
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const webApp = path.join(dir, "web-app.mjs");
fs.writeFileSync(
  webApp,
  `import fs from "node:fs";
import http from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
http
  .createServer((req, res) => {
    fs.appendFileSync(process.env.ODM_STUB_LOG, \`request \${req.method} \${req.url}\\n\`);
    if (req.method === "GET" && req.url.startsWith("/api/session?")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [], cursor: { next: null } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>opencode</title>");
  })
  .listen(port, "127.0.0.1", () => console.log(\`opencode server listening on http://127.0.0.1:\${port}\`));
`,
);
const program = path.join(dir, "opencode");
fs.writeFileSync(
  program,
  `#!/bin/sh
case "$1" in
  --version) echo "version" >> "$ODM_STUB_LOG"; echo "1.18.30"; exit 0 ;;
  serve) echo "serve" >> "$ODM_STUB_LOG"; exec "${process.execPath}" "${webApp}" "$@" ;;
esac
echo "other $1" >> "$ODM_STUB_LOG"
exit 1
`,
);
fs.chmodSync(program, 0o755);

const logged = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : []);

await test("opencode 1.x is installed but unsupported, with its version and the way to 2.x", async () => {
  const status = await opencodeAdapter.probe(program, env);
  assert.equal(status.installed, true);
  assert.equal(status.version, "1.18.30");
  assert.deepEqual(status.models, []);
  assert.equal(
    status.message,
    "opencode 1.18.30 is installed; Open Game Master drives opencode 2.x. Upgrade with `opencode upgrade --major` (opencode 1.19 or later), or install it with `curl -fsSL https://opencode.ai/v2/install | bash`.",
    "plain `opencode upgrade` keeps 1.19 on 1.x",
  );
  assert.deepEqual(logged(), ["version"], "nothing but --version ran");
  assert.equal(opencodeAdapter.installHintWindows, "npm install -g @opencode/cli", "npm's opencode-ai is 1.x");
  assert.deepEqual(opencodeAdapter.binaryNames, ["opencode2", "opencode"], "opencode2 is 2.x wherever it is");
});

await test("a run on opencode 1.x stops at ODM's agent, before any session or prompt", async () => {
  const heard = [];
  await assert.rejects(
    opencodeAdapter.start({
      binary: program,
      system: "SYS",
      model: "",
      effort: "",
      mcp: null,
      cwd: dir,
      env,
      onEvent: (event) => heard.push(event),
    }),
    /drives opencode 2\.x\. Upgrade with `opencode upgrade --major`/,
  );
  const requests = logged().filter((line) => line.startsWith("request "));
  assert.ok(requests.includes("request GET /api/agent/odm-dm"), "refused at the agent, which 1.x answers with its web app");
  assert.ok(!requests.some((line) => /^request POST \/api\/session/.test(line)), "no session, so no prompt");
  assert.deepEqual(
    logged().filter((line) => !line.startsWith("request ")),
    ["serve"],
    "the run starts the server and nothing else, no --version",
  );
});

removeTempDir(dir);
console.log(`opencode probe: ${passed} checks passed`);
