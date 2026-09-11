// Boots a built server twice (once as a world an app hosts, once as a server
// someone runs) against throwaway databases and checks the sign-up rules
// over HTTP, the way the apps and the browser form actually meet them:
//
//   device world   first account free; every later one needs a live room
//                  code and nothing else; signups report open and forced
//   normal server  closed refuses even a room code; invite-only takes a
//                  live room code or an account invite; open still refuses
//                  a room code that names no table
//
// Usage: node scripts/smoke-signup.mjs [built checkout dir]
// The directory must hold a completed `next build` (defaults to this repo).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const buildDir = path.resolve(process.argv[2] ?? repo);
if (!fs.existsSync(path.join(buildDir, ".next", "BUILD_ID"))) {
  console.error(`No completed build at ${buildDir}. Run next build there first.`);
  process.exit(1);
}

const cleanup = [];
function fail(message) {
  console.error(`FAIL: ${message}`);
  for (const fn of cleanup.splice(0)) {
    try {
      fn();
    } catch {
      // Best effort on the way out.
    }
  }
  process.exit(1);
}
const ok = (message) => console.log(`ok: ${message}`);
const assert = (condition, message) => {
  if (!condition) fail(message);
};

async function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen({ host: "127.0.0.1", port: 0 }, () => {
      const chosen = probe.address().port;
      probe.close(() => resolve(chosen));
    });
  });
}

async function boot(extraEnv) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-signup-"));
  const child = spawn(
    path.join(buildDir, "node_modules", ".bin", "next"),
    ["start", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: buildDir,
      env: {
        ...process.env,
        NODE_ENV: "production",
        SQLITE_DB_PATH: path.join(dataDir, "smoke.sqlite"),
        DB_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
        ODM_DEVICE_WORLD: "",
        ...extraEnv,
      },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  cleanup.push(() => child.kill("SIGKILL"));
  cleanup.push(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const deadline = Date.now() + 120_000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    if (child.exitCode !== null) fail(`server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000) });
      healthy = res.ok;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!healthy) fail("server never became healthy");
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    const killer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(killer);
  };
  return { origin, stop };
}

async function json(origin, pathname, token, init = {}) {
  const res = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const post = (origin, pathname, body, token) =>
  json(origin, pathname, token, { method: "POST", body: JSON.stringify(body) });
const patch = (origin, pathname, body, token) =>
  json(origin, pathname, token, { method: "PATCH", body: JSON.stringify(body) });

async function tokenFor(origin, username, password) {
  const grant = await post(origin, "/api/auth/token", { username, password });
  assert(grant.status === 200 && grant.body?.token, `token mint for ${username} returned ${grant.status}`);
  return grant.body.token;
}

async function makeCampaign(origin, token, title) {
  const created = await post(origin, "/api/campaigns", { title }, token);
  assert(created.status === 201, `campaign create returned ${created.status}`);
  return created.body.campaign;
}

try {
  // ---- a world one of the apps hosts ----
  const world = await boot({ ODM_DEVICE_WORLD: "1" });
  const providers = await json(world.origin, "/api/auth/providers");
  assert(providers.body?.deviceWorld === true, "the world does not report deviceWorld");
  assert(providers.body?.signupMode === "open", `a device world reports signups ${providers.body?.signupMode}`);

  const first = await post(world.origin, "/api/auth/register", { username: "host", password: "host-pass-123" });
  assert(first.status === 201, `the host's own account returned ${first.status}`);
  ok("device world: the first account (the host) needs no code");
  const hostToken = await tokenFor(world.origin, "host", "host-pass-123");
  const settings = await json(world.origin, "/api/admin/settings", hostToken);
  assert(settings.body?.config?.signupModeForced === true, "the admin panel is not told signups are forced open");
  ok("device world: the admin settings say the signup rule is the app's, not the host's");

  const stranger = await post(world.origin, "/api/auth/register", { username: "stranger", password: "stranger-pass-1" });
  assert(stranger.status === 403, `a stranger with no code got ${stranger.status}`);
  assert(/room code/i.test(stranger.body?.error ?? ""), `unhelpful refusal: ${stranger.body?.error}`);
  ok("device world: an account with no room code is refused, and told what the door is");

  const campaign = await makeCampaign(world.origin, hostToken, "The Hollow Crown");
  const guest = await post(world.origin, "/api/auth/register", {
    username: "wren",
    password: "minted-by-the-app-1",
    joinCode: campaign.inviteCode.toLowerCase(),
  });
  assert(guest.status === 201, `a guest with a live code got ${guest.status}: ${JSON.stringify(guest.body)}`);
  const guestToken = await tokenFor(world.origin, "wren", "minted-by-the-app-1");
  const seated = await post(world.origin, "/api/campaigns/join", { inviteCode: campaign.inviteCode }, guestToken);
  assert(seated.status === 200, `the guest could not take the seat: ${seated.status}`);
  ok("device world: a name and a live room code make the account and seat the player");

  const bogus = await post(world.origin, "/api/auth/register", {
    username: "nobody",
    password: "nobody-pass-123",
    joinCode: "ZZZZ9999",
  });
  assert(bogus.status === 403, `a code that names no table got ${bogus.status}`);
  ok("device world: a code that names no table is refused");

  const ended = await makeCampaign(world.origin, hostToken, "Long Over");
  const closed = await patch(world.origin, `/api/campaigns/${ended.id}`, { status: "ended" }, hostToken);
  assert(closed.status === 200, `ending a campaign returned ${closed.status}`);
  const late = await post(world.origin, "/api/auth/register", {
    username: "latecomer",
    password: "latecomer-pass-1",
    joinCode: ended.inviteCode,
  });
  assert(late.status === 403, `an ended campaign's code still made an account (${late.status})`);
  assert(/ended/i.test(late.body?.error ?? ""), `unhelpful refusal: ${late.body?.error}`);
  ok("device world: a code from an ended campaign is not a standing invitation");
  await world.stop();

  // ---- a server someone runs ----
  const server = await boot({});
  const admin = await post(server.origin, "/api/auth/register", { username: "admin", password: "admin-pass-123" });
  assert(admin.status === 201, `admin account returned ${admin.status}`);
  const adminToken = await tokenFor(server.origin, "admin", "admin-pass-123");
  const live = await makeCampaign(server.origin, adminToken, "Open Table");

  const shut = await patch(server.origin, "/api/admin/settings", { signupMode: "closed" }, adminToken);
  assert(shut.status === 200, `closing signups returned ${shut.status}`);
  const refused = await post(server.origin, "/api/auth/register", {
    username: "hopeful",
    password: "hopeful-pass-123",
    joinCode: live.inviteCode,
  });
  assert(refused.status === 403 && /disabled/i.test(refused.body?.error ?? ""), `closed signups took a room code (${refused.status})`);
  ok("normal server: closed means closed, room code or not");

  await patch(server.origin, "/api/admin/settings", { signupMode: "invite" }, adminToken);
  const bare = await post(server.origin, "/api/auth/register", { username: "bare", password: "bare-pass-1234" });
  assert(bare.status === 403 && /invite code/i.test(bare.body?.error ?? ""), `invite-only let a stranger in (${bare.status})`);
  const vouched = await post(server.origin, "/api/auth/register", {
    username: "vouched",
    password: "vouched-pass-123",
    joinCode: live.inviteCode,
  });
  assert(vouched.status === 201, `a live room code did not vouch on an invite-only server (${vouched.status})`);
  ok("normal server: invite-only refuses a stranger and takes a live room code as vouching");

  await patch(server.origin, "/api/admin/settings", { signupMode: "open" }, adminToken);
  const wrongTable = await post(server.origin, "/api/auth/register", {
    username: "lost",
    password: "lost-pass-12345",
    joinCode: "ZZZZ9999",
  });
  assert(wrongTable.status === 403, `an open server made an account for a code that names no table (${wrongTable.status})`);
  const plain = await post(server.origin, "/api/auth/register", { username: "plain", password: "plain-pass-1234" });
  assert(plain.status === 201, `open signups refused a plain account (${plain.status})`);
  ok("normal server: open takes anyone, but a room code that names no table is still refused");
  const modes = await json(server.origin, "/api/admin/settings", adminToken);
  assert(modes.body?.config?.signupModeForced === false, "a real server reports its signup rule as forced");
  await server.stop();

  console.log("SIGNUP SMOKE PASS");
} finally {
  for (const fn of cleanup.splice(0)) {
    try {
      fn();
    } catch {
      // Best effort on the way out.
    }
  }
}
