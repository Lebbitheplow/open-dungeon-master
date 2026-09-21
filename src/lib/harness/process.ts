// Starting an agent program and reading what it writes, one JSON line at a
// time. Shared by every adapter that talks over stdio.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveWindowsShim } from "./discover.ts";

export type SpawnedProgram = {
  child: ChildProcessWithoutNullStreams;
  write(line: string): void;
  kill(): void;
  stderrTail(): string;
};

export function spawnProgram(
  binary: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: Record<string, string>;
    onLine: (line: string) => void;
    onExit: (code: number | null) => void;
  },
): SpawnedProgram {
  const { command, prefix } = resolveWindowsShim(binary);
  const env = { ...options.env };
  // Inside the desktop app process.execPath is Electron itself; a shim that
  // resolves to a script has to be run by it as plain Node.
  if (command === process.execPath && process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  const child: ChildProcessWithoutNullStreams = spawn(command, [...prefix, ...args], {
    cwd: options.cwd,
    env: env as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // Its own process group, so closing the session takes any helper the
    // program started down with it.
    detached: process.platform !== "win32",
  });
  let buffer = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        options.onLine(line);
      }
      index = buffer.indexOf("\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4_000);
  });
  child.stdin.on("error", () => undefined);
  let exited = false;
  child.on("error", () => {
    if (!exited) {
      exited = true;
      options.onExit(null);
    }
  });
  child.on("exit", (code: number | null) => {
    if (buffer.trim()) {
      options.onLine(buffer.trim());
      buffer = "";
    }
    if (!exited) {
      exited = true;
      options.onExit(code);
    }
  });
  const kill = () => {
    if (child.exitCode !== null || child.killed) {
      return;
    }
    try {
      if (process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, "SIGTERM");
      } else {
        child.kill();
      }
    } catch {
      child.kill();
    }
    const timer = setTimeout(() => {
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // Already gone.
      }
    }, 3_000);
    timer.unref();
  };
  return {
    child,
    write(line: string) {
      if (child.stdin.writable) {
        child.stdin.write(line.endsWith("\n") ? line : `${line}\n`);
      }
    },
    kill,
    stderrTail: () => stderr,
  };
}

// Runs a program to completion and returns its output, for probes
// (`--version`, `auth status`). Never throws: a probe that fails is an answer.
export function runProgram(
  binary: string,
  args: readonly string[],
  env: Record<string, string>,
  timeoutMs = 10_000,
  cwd?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const { command, prefix } = resolveWindowsShim(binary);
    const childEnv = { ...env };
    if (command === process.execPath && process.versions.electron) {
      childEnv.ELECTRON_RUN_AS_NODE = "1";
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      }
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, [...prefix, ...args], {
        env: childEnv as NodeJS.ProcessEnv,
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      resolve({ code: null, stdout: "", stderr: "could not start" });
      return;
    }
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(null);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout = (stdout + String(chunk)).slice(-200_000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-20_000);
    });
    child.on("error", () => finish(null));
    child.on("exit", (code) => finish(code));
  });
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(line);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
