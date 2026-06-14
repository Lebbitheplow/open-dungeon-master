#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, "..");
const isWindows = process.platform === "win32";

function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function firstExisting(paths) {
  return paths.find((candidate) => candidate && existsSync(candidate));
}

function available(command, args = []) {
  const result = spawnSync(command, [...args, "--version"], {
    stdio: "ignore",
    shell: false,
  });
  return !result.error && result.status === 0;
}

function fallbackPython() {
  if (process.env.PYTHON) {
    return { command: process.env.PYTHON, prefixArgs: [] };
  }
  if (isWindows) {
    if (available("python")) {
      return { command: "python", prefixArgs: [] };
    }
    if (available("py", ["-3"])) {
      return { command: "py", prefixArgs: ["-3"] };
    }
    return { command: "python", prefixArgs: [] };
  }
  return { command: "python3", prefixArgs: [] };
}

const ultraRepo = path.resolve(
  expandHome(process.env.ULTRA_FAST_IMAGE_GEN_DIR || path.join(os.homedir(), "ultra-fast-image-gen")),
);

const venvPython = firstExisting(
  isWindows
    ? [
        process.env.ULTRA_FAST_IMAGE_GEN_PYTHON && expandHome(process.env.ULTRA_FAST_IMAGE_GEN_PYTHON),
        path.join(ultraRepo, ".venv", "Scripts", "python.exe"),
        path.join(ultraRepo, "venv", "Scripts", "python.exe"),
      ]
    : [
        process.env.ULTRA_FAST_IMAGE_GEN_PYTHON && expandHome(process.env.ULTRA_FAST_IMAGE_GEN_PYTHON),
        path.join(ultraRepo, ".venv", "bin", "python"),
        path.join(ultraRepo, "venv", "bin", "python"),
      ],
);

const env = {
  ...process.env,
  ULTRA_FAST_IMAGE_GEN_DIR: ultraRepo,
};

const fallback = fallbackPython();
const command = venvPython || fallback.command;
const args = venvPython ? [] : [...fallback.prefixArgs];

if (venvPython) {
  env.ULTRA_FAST_IMAGE_GEN_PYTHON = venvPython;
}

args.push(path.join(appRoot, "image_server", "optimized_image_server.py"));

const child = spawn(command, args, {
  cwd: appRoot,
  env,
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`Failed to start image server with ${command}: ${error.message}`);
  process.exit(1);
});
