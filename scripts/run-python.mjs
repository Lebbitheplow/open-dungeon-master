#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";

const scriptArgs = process.argv.slice(2);
if (!scriptArgs.length) {
  console.error("Usage: node scripts/run-python.mjs <script.py> [args...]");
  process.exit(1);
}

function available(command, args = []) {
  const result = spawnSync(command, [...args, "--version"], {
    stdio: "ignore",
    shell: false,
  });
  return !result.error && result.status === 0;
}

function selectPython() {
  if (process.env.PYTHON) {
    return { command: process.env.PYTHON, prefixArgs: [] };
  }
  if (process.platform === "win32") {
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

const python = selectPython();
const args = [...python.prefixArgs, ...scriptArgs];

const child = spawn(python.command, args, {
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
  console.error(`Failed to run Python with ${python.command}: ${error.message}`);
  process.exit(1);
});
