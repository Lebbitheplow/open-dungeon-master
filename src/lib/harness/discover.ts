// Finding an agent program on this machine. The server is rarely started from
// the admin's own shell: a systemd unit hands it PATH=/usr/bin:/bin, and a
// desktop app started from the launcher inherits the desktop's, so a program
// installed to ~/.local/bin is invisible to a plain PATH lookup. The order is
// the admin's explicit path, then PATH, then the login shell's PATH, then the
// folders the installers actually use.

import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HarnessAvailability } from "./types.ts";

const isWindows = process.platform === "win32";

// Where the vendors' installers and the common package managers put binaries.
export function knownInstallDirs(home: string, platform: string = process.platform): string[] {
  // Joined with the separator of the platform asked about, not the host's,
  // so the answer is the same wherever it is computed.
  const p = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") {
    const appData = process.env.APPDATA || p.join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || p.join(home, "AppData", "Local");
    return [
      p.join(appData, "npm"),
      p.join(localAppData, "Programs", "claude"),
      p.join(home, ".local", "bin"),
      p.join(home, ".bun", "bin"),
      p.join(home, ".opencode", "bin"),
      p.join(home, ".grok", "bin"),
      p.join(localAppData, "Microsoft", "WinGet", "Links"),
      p.join(home, "scoop", "shims"),
    ];
  }
  return [
    p.join(home, ".local", "bin"),
    p.join(home, ".claude", "local"),
    p.join(home, ".npm-global", "bin"),
    p.join(home, ".bun", "bin"),
    p.join(home, ".opencode", "bin"),
    p.join(home, ".grok", "bin"),
    p.join(home, ".cargo", "bin"),
    p.join(home, ".volta", "bin"),
    p.join(home, "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/home/linuxbrew/.linuxbrew/bin",
  ];
}

// nvm and fnm keep one bin folder per Node version; the newest is the one a
// login shell would pick.
function nodeManagerDirs(home: string): string[] {
  const out: string[] = [];
  for (const base of [path.join(home, ".nvm", "versions", "node"), path.join(home, ".local", "share", "fnm", "node-versions")]) {
    try {
      const entries = readdirSync(base);
      entries
        .sort()
        .reverse()
        .forEach((entry) => {
          out.push(path.join(base, entry, "bin"), path.join(base, entry, "installation", "bin"));
        });
    } catch {
      // No such manager.
    }
  }
  return out;
}

function executable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) {
      return false;
    }
    if (!isWindows) {
      accessSync(file, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function candidatesIn(dir: string, name: string): string[] {
  if (!isWindows) {
    return [path.join(dir, name)];
  }
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return [path.join(dir, name), ...exts.map((ext) => path.join(dir, name + ext.toLowerCase()))];
}

type LoginPathCache = { value: string; at: number };
declare global {
  var __odmLoginShellPath: LoginPathCache | undefined;
}

// The PATH an interactive login shell would have. Cached for ten minutes;
// a shell that hangs on a prompt is cut off after three seconds.
export async function loginShellPath(): Promise<string> {
  if (isWindows) {
    return "";
  }
  const cached = globalThis.__odmLoginShellPath;
  if (cached && Date.now() - cached.at < 10 * 60_000) {
    return cached.value;
  }
  const shell = process.env.SHELL || (existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh");
  const value = await new Promise<string>((resolve) => {
    // Its own session, with no terminal: an interactive shell takes the
    // terminal it shares for job control, and a second one started meanwhile
    // (every program is probed at once) stops the server with SIGTTIN.
    const child = spawn(shell, ["-ilc", 'printf "__ODM_PATH__%s__ODM_END__" "$PATH"'], {
      env: { HOME: os.homedir(), USER: process.env.USER ?? "", SHELL: shell, TERM: "dumb" } as unknown as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    const answer = () => {
      const match = /__ODM_PATH__([\s\S]*?)__ODM_END__/.exec(stdout);
      resolve(match ? match[1] : "");
    };
    // Whatever arrived by then is the answer: something the profile started
    // can hold the pipe open long after the shell is done.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      answer();
    }, 3_000);
    child.on("close", () => {
      clearTimeout(timer);
      answer();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
  globalThis.__odmLoginShellPath = { value, at: Date.now() };
  return value;
}

// The PATH a program is started with: the folder it was found in first, then
// the login shell's PATH, so its own helpers (node, git) resolve the way they
// do in the admin's terminal.
export async function childPath(binary: string): Promise<string> {
  const parts = [path.dirname(binary), await loginShellPath(), process.env.PATH ?? ""]
    .join(path.delimiter)
    .split(path.delimiter)
    .filter(Boolean);
  return [...new Set(parts)].join(path.delimiter);
}

export async function findBinary(names: readonly string[], explicit = ""): Promise<string | null> {
  const home = os.homedir();
  if (explicit.trim()) {
    const resolved = path.resolve(explicit.trim().replace(/^~(?=$|[\\/])/, home));
    return executable(resolved) ? resolved : null;
  }
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    ...(await loginShellPath()).split(path.delimiter),
    ...knownInstallDirs(home),
    ...nodeManagerDirs(home),
  ].filter(Boolean);
  for (const dir of [...new Set(dirs)]) {
    for (const name of names) {
      for (const candidate of candidatesIn(dir, name)) {
        if (executable(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

// Why a program could not run here even if it were installed. A container
// cannot start programs on its host, and a Flatpak or Snap app is sandboxed
// away from them; the admin page says so instead of reporting "not found".
export function hostAvailability(deviceWorldOnPhone = false): HarnessAvailability {
  if (deviceWorldOnPhone) {
    return "phone";
  }
  if (process.env.FLATPAK_ID || process.env.SNAP) {
    return "sandboxed-package";
  }
  if (process.env.ODM_IN_CONTAINER === "1" || existsSync("/.dockerenv")) {
    return "container";
  }
  try {
    if (/docker|containerd|kubepods/.test(readFileSync("/proc/1/cgroup", "utf8"))) {
      return "container";
    }
  } catch {
    // Not Linux, or no procfs.
  }
  return "ok";
}

// A .cmd shim on Windows cannot be started without a shell, and a shell would
// re-parse every argument. npm's shims name the real script on their last
// line; running that script with node skips the shell entirely.
export function resolveWindowsShim(binary: string): { command: string; prefix: string[] } {
  if (!isWindows || !/\.(cmd|bat)$/i.test(binary)) {
    return { command: binary, prefix: [] };
  }
  try {
    const text = readFileSync(binary, "utf8");
    const match = /"%(?:~dp0|dp0%)\\?([^"%]+\.(?:js|cjs|mjs))"/i.exec(text) ?? /"([^"]+\.(?:js|cjs|mjs))"/i.exec(text);
    if (match) {
      const script = path.resolve(path.dirname(binary), match[1].replace(/^\\/, ""));
      if (existsSync(script)) {
        return { command: process.execPath, prefix: [script] };
      }
    }
    const exe = /"%(?:~dp0|dp0%)\\?([^"%]+\.exe)"/i.exec(text);
    if (exe) {
      return { command: path.resolve(path.dirname(binary), exe[1].replace(/^\\/, "")), prefix: [] };
    }
  } catch {
    // Fall through to the shim itself.
  }
  return { command: binary, prefix: [] };
}
