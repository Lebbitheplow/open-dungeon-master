// Who may claim a fresh server's first account, which becomes its admin
// (src/lib/setup-code.ts). An empty database proves nothing about who is
// asking, so the claim takes a one-time code the operator reads in the
// server log. The HTTP side, the form and the device-world exemption over
// a real server, is scripts/smoke-signup.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-setup-code-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
delete process.env.ODM_SETUP_CODE;
delete process.env.ODM_DEVICE_WORLD;

register("./lib/register-alias.mjs", import.meta.url);

const { announceSetupCode, claimFirstAdmin, currentSetupCode, needsSetup, setupCodeMatches } = await import(
  "../src/lib/setup-code.ts"
);
const { countUsers, getUserByUsername } = await import("../src/lib/db/users.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const banner = () => {
  const lines = [];
  announceSetupCode((line) => lines.push(line));
  return lines.join("\n");
};

let code = "";

test("a fresh server needs setup and mints one code, kept across calls", () => {
  assert.equal(countUsers(), 0);
  assert.equal(needsSetup(), true);
  code = currentSetupCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(currentSetupCode(), code, "the code changed between calls");
});

test("the startup banner shows the code to the operator", () => {
  assert.ok(banner().includes(code));
});

test("the code is matched loosely in form, never in content", () => {
  assert.equal(setupCodeMatches(code), true);
  assert.equal(setupCodeMatches(code.toLowerCase()), true);
  assert.equal(setupCodeMatches(code.replaceAll("-", " ")), true);
  assert.equal(setupCodeMatches(`${code.slice(0, -1)}${code.endsWith("A") ? "B" : "A"}`), false);
  assert.equal(setupCodeMatches(""), false);
  assert.equal(setupCodeMatches(undefined), false);
});

test("a wrong code claims nothing", () => {
  assert.equal(claimFirstAdmin("squatter", "x$y", "AAAA-BBBB-CCCC-DDDD"), null);
  assert.equal(claimFirstAdmin("squatter", "x$y", undefined), null);
  assert.equal(countUsers(), 0);
  assert.equal(getUserByUsername("squatter"), null);
});

test("the right code makes the first account an admin", () => {
  const user = claimFirstAdmin("owner", "x$y", code);
  assert.ok(user);
  assert.equal(user.isAdmin, true);
  assert.equal(getUserByUsername("owner").isAdmin, true);
});

test("the code is spent: a replay claims nothing and the server stops asking", () => {
  assert.equal(claimFirstAdmin("second", "x$y", code), null);
  assert.equal(countUsers(), 1);
  assert.equal(needsSetup(), false);
  assert.equal(banner(), "", "the banner still prints after the admin exists");
});

test("ODM_SETUP_CODE is the operator's own code, and the banner does not echo it", () => {
  // A server whose admin has not signed up yet, with a code chosen in .env.
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "odm-setup-code-env-"));
  try {
    const script = `
      const { register } = await import("node:module");
      register("./lib/register-alias.mjs", ${JSON.stringify(new URL(".", import.meta.url).href)});
      const m = await import(${JSON.stringify(new URL("../src/lib/setup-code.ts", import.meta.url).href)});
      const lines = [];
      m.announceSetupCode((line) => lines.push(line));
      console.log(JSON.stringify({
        code: m.currentSetupCode(),
        right: m.setupCodeMatches("my-own-code"),
        minted: m.setupCodeMatches("AAAA-BBBB-CCCC-DDDD"),
        echoed: lines.join("\\n").includes("my-own-code"),
        admin: m.claimFirstAdmin("owner", "x$y", "MY OWN CODE")?.isAdmin ?? null,
      }));
    `;
    const output = spawnNode(script, {
      SQLITE_DB_PATH: path.join(fresh, "env.sqlite"),
      DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      ODM_SETUP_CODE: "my-own-code",
    });
    assert.deepEqual(JSON.parse(output), { code: "my-own-code", right: true, minted: false, echoed: false, admin: true });
  } finally {
    removeTempDir(fresh);
  }
});

test("a device world never asks: its app makes the host's account", () => {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "odm-setup-code-device-"));
  try {
    const script = `
      const { register } = await import("node:module");
      register("./lib/register-alias.mjs", ${JSON.stringify(new URL(".", import.meta.url).href)});
      const m = await import(${JSON.stringify(new URL("../src/lib/setup-code.ts", import.meta.url).href)});
      const lines = [];
      m.announceSetupCode((line) => lines.push(line));
      console.log(JSON.stringify({ needs: m.needsSetup(), banner: lines.length }));
    `;
    const output = spawnNode(script, {
      SQLITE_DB_PATH: path.join(fresh, "device.sqlite"),
      DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      ODM_DEVICE_WORLD: "1",
    });
    assert.deepEqual(JSON.parse(output), { needs: false, banner: 0 });
  } finally {
    removeTempDir(fresh);
  }
});

// A second process for each environment, since the database path and the
// device-world flag are read once per process.
function spawnNode(script, env) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split("\n").pop();
}

removeTempDir(dir);
console.log(`test-setup-code: ${passed} passed`);
