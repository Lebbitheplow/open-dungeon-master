// Reading the login shell's PATH while looking for agent programs
// (src/lib/harness/discover.ts). The shell is interactive, and an interactive
// shell sharing the server's terminal grabs it for job control: two of them
// started together (the admin panel probes every program at once) stopped a
// server run from a terminal with SIGTTIN. So the shell must run in its own
// session, lookups started together share it, and the lookup must answer
// within its three seconds whatever the profile does.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

// Windows never starts a login shell: the lookup returns early there.
if (process.platform === "win32") {
  console.log("harness discover: skipped on Windows");
  process.exit(0);
}

const { loginShellPath, findBinary } = await import("../src/lib/harness/discover.ts");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-discover-"));
const originalHome = process.env.HOME;
const originalShell = process.env.SHELL;
const bash = fs.existsSync("/bin/bash") ? "/bin/bash" : null;

let passed = 0;
async function test(name, fn, { needsBash = false } = {}) {
  if (needsBash && !bash) {
    console.log(`skip: ${name} (no /bin/bash)`);
    return;
  }
  delete globalThis.__odmLoginShellPath;
  try {
    await fn();
  } finally {
    process.env.HOME = originalHome;
    process.env.SHELL = originalShell;
  }
  passed += 1;
  console.log(`ok: ${name}`);
}

function writeExecutable(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
}

// A home whose login profile is `profile`, for a real bash.
function useBashProfile(name, profile) {
  const home = path.join(dir, name);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, ".bash_profile"), profile);
  process.env.SHELL = bash;
  process.env.HOME = home;
  return home;
}

// Signal 0 only checks: it throws ESRCH when there is no such process (for a
// negative id, no such process group).
function isRunning(id) {
  try {
    process.kill(id, 0);
  } catch {
    return false;
  }
  return true;
}

await test("lookups started together share one shell, run in its own session", async () => {
  // Answers with its pid and leaves a short sleep behind in its process
  // group, so the group can be looked up once the shell is gone.
  const shell = path.join(dir, "group-shell");
  const log = path.join(dir, "group-shell.log");
  writeExecutable(shell, `#!/bin/sh\necho run >> "${log}"\nsleep 5 >/dev/null 2>&1 &\nprintf "__ODM_PATH__%s__ODM_END__" "$$"\n`);
  process.env.SHELL = shell;
  // As the admin panel probes every program at once.
  const [first, second] = await Promise.all([
    loginShellPath(),
    loginShellPath(),
    findBinary(["odm-missing-agent"]),
    findBinary(["odm-missing-agent"]),
  ]);
  const pid = Number(first);
  assert.ok(isRunning(-pid), "the shell leads its own process group");
  process.kill(-pid, "SIGKILL");
  assert.equal(fs.readFileSync(log, "utf8"), "run\n", "one shell for all four lookups");
  assert.equal(second, first);
});

await test("a failed lookup is shared too, and retried once the ten minutes are up", async () => {
  process.env.SHELL = path.join(dir, "no-such-shell");
  assert.deepEqual(await Promise.all([loginShellPath(), loginShellPath()]), ["", ""]);
  globalThis.__odmLoginShellPath.at -= 10 * 60_000;
  const shell = path.join(dir, "retry-shell");
  const log = path.join(dir, "retry-shell.log");
  writeExecutable(shell, `#!/bin/sh\necho run >> "${log}"\nprintf "__ODM_PATH__/opt/agents/bin__ODM_END__"\n`);
  process.env.SHELL = shell;
  assert.equal(await loginShellPath(), "/opt/agents/bin");
  assert.equal(await loginShellPath(), "/opt/agents/bin");
  assert.equal(fs.readFileSync(log, "utf8"), "run\n", "the answer is reused while fresh");
});

await test(
  "a profile that hangs is cut off after three seconds",
  async () => {
    // Busy in bash itself, so the cutoff's kill ends it; it gives up on its
    // own after 10 s, in case a broken lookup never does.
    useBashProfile("hanging", "while (( SECONDS < 10 )); do :; done\n");
    // The cutoff is 3 s; waiting up to 6 s leaves slack for a slow machine
    // and fails a lookup that waits out the hang.
    const answer = await Promise.race([
      loginShellPath(),
      new Promise((resolve) => setTimeout(resolve, 6_000, "still waiting after 6 s")),
    ]);
    assert.equal(answer, "");
  },
  { needsBash: true },
);

await test(
  "a program on the profile's PATH is found, even with a background job holding the pipe",
  async () => {
    const pidFile = path.join(dir, "background-job.pid");
    const home = useBashProfile("profile-path", `PATH="$HOME/agent-bin:$PATH"\nsleep 10 &\necho $! > "${pidFile}"\n`);
    const program = path.join(home, "agent-bin", "odm-fake-agent");
    writeExecutable(program, "#!/bin/sh\n");
    const found = await findBinary(["odm-fake-agent"]);
    const job = Number(fs.readFileSync(pidFile, "utf8"));
    const survived = isRunning(job);
    if (survived) {
      // It holds the pipe open: left alone, it keeps this suite alive for its full sleep.
      process.kill(job, "SIGKILL");
    }
    assert.equal(found, program);
    assert.ok(survived, "the profile's background job is the admin's, not the lookup's to kill");
  },
  { needsBash: true },
);

await test("a shell that prints nothing yields an empty PATH", async () => {
  const silent = path.join(dir, "silent-shell");
  writeExecutable(silent, "#!/bin/sh\nexit 0\n");
  process.env.SHELL = silent;
  assert.equal(await loginShellPath(), "");
});

removeTempDir(dir);
console.log(`harness discover: ${passed} checks passed`);
