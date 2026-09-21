// A scripted stand-in for an agent program, for tests only (HARNESS_FAKE=1).
// It behaves like a real one from ODM's side: it is handed ODM's MCP address
// and a token, it calls tools over real HTTP and waits for their answers,
// and it streams text back. The script comes from HARNESS_FAKE_SCRIPT (a
// JSON file): an array of turns, each an array of steps.
//
//   { "text": "..." }                       stream narration
//   { "call": "request_roll", "args": {} }  call one tool and wait
//   { "parallel": [ {call, args}, ... ] }   call several at once
//   { "expectError": true }                 the previous call must have failed
//   { "fail": "signed-out" }                report an error and stop
//   { "wait": 500 }                         pause, holding the session open

import { readFileSync } from "node:fs";
import type { HarnessAdapter, HarnessErrorKind, HarnessStartOptions } from "../types.ts";

type Step =
  | { text: string }
  | { call: string; args?: Record<string, unknown> }
  | { parallel: Array<{ call: string; args?: Record<string, unknown> }> }
  | { fail: HarnessErrorKind; message?: string }
  | { wait: number };

declare global {
  // What the fake saw, for the tests to assert on.
  var __odmFakeHarnessLog: Array<{ kind: string; detail: unknown }> | undefined;
}

function log(kind: string, detail: unknown) {
  if (!globalThis.__odmFakeHarnessLog) {
    globalThis.__odmFakeHarnessLog = [];
  }
  globalThis.__odmFakeHarnessLog.push({ kind, detail });
}

function loadScript(): Step[][] {
  const file = process.env.HARNESS_FAKE_SCRIPT;
  if (!file) {
    return [[{ text: "The fake Dungeon Master narrates." }]];
  }
  return JSON.parse(readFileSync(file, "utf8")) as Step[][];
}

async function rpc(url: string, token: string, id: number, method: string, params: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MCP HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  const line = text.split("\n").find((entry) => entry.startsWith("data: "));
  const body = JSON.parse(line ? line.slice(6) : text) as { result?: unknown; error?: { message?: string } };
  if (body.error) {
    throw new Error(body.error.message ?? "MCP error");
  }
  return body.result as Record<string, unknown>;
}

async function start(options: HarnessStartOptions) {
  const script = loadScript();
  let turn = 0;
  let closed = false;
  let rpcId = 1;
  // The token is logged for the tests alone (this adapter never runs outside
  // them), so they can knock on the MCP door with it from the wrong address.
  log("start", {
    system: options.system,
    model: options.model,
    mcp: Boolean(options.mcp),
    token: options.mcp?.token ?? null,
    images: options.images ?? false,
    env: options.env,
  });
  if (options.mcp) {
    await rpc(options.mcp.url, options.mcp.token, rpcId++, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "fake-harness", version: "1" },
    });
    const listed = await rpc(options.mcp.url, options.mcp.token, rpcId++, "tools/list", {});
    const names = ((listed.tools as Array<{ name: string }>) ?? []).map((tool) => tool.name);
    log("tools", names);
    options.onEvent({ type: "ready", tools: names });
  } else {
    options.onEvent({ type: "ready", tools: [] });
  }

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    if (!options.mcp) {
      throw new Error("no MCP in a completion");
    }
    const result = await rpc(options.mcp.url, options.mcp.token, rpcId++, "tools/call", { name, arguments: args });
    const text = ((result.content as Array<{ text?: string }>) ?? []).map((part) => part.text ?? "").join("");
    log("result", { name, text, isError: result.isError === true });
    return text;
  };

  const runTurn = async (prompt: string) => {
    log("prompt", prompt);
    const steps = script[Math.min(turn, script.length - 1)] ?? [];
    turn += 1;
    let narration = "";
    for (const step of steps) {
      if (closed) {
        return;
      }
      if ("wait" in step) {
        await new Promise((resolve) => setTimeout(resolve, step.wait));
        continue;
      }
      if ("fail" in step) {
        options.onEvent({ type: "error", kind: step.fail, message: step.message ?? `fake ${step.fail}` });
        return;
      }
      if ("text" in step) {
        narration += step.text;
        options.onEvent({ type: "delta", text: step.text });
        continue;
      }
      if ("call" in step) {
        log("call", { name: step.call, args: step.args ?? {} });
        await call(step.call, step.args);
        continue;
      }
      if ("parallel" in step) {
        log("parallel", step.parallel.map((entry) => entry.call));
        await Promise.all(step.parallel.map((entry) => call(entry.call, entry.args)));
      }
    }
    if (!closed) {
      options.onEvent({ type: "turn_end", text: narration });
    }
  };

  return {
    send(text: string) {
      runTurn(text).catch((error) => {
        if (!closed) {
          options.onEvent({ type: "error", kind: "crash", message: error instanceof Error ? error.message : String(error) });
        }
      });
    },
    close() {
      closed = true;
      log("close", null);
    },
  };
}

export const fakeAdapter: HarnessAdapter = {
  id: "claude",
  label: "Fake harness",
  binaryNames: ["node"],
  installHint: "",
  signInHint: "",
  lockdown: "removed",
  paints: false,
  async probe() {
    return {
      installed: true,
      version: "fake",
      auth: { state: "ready", kind: "subscription", plan: "test" },
      models: [{ id: "fake-model", label: "Fake model", contextTokens: 64_000 }],
      lockdownProven: true,
    };
  },
  start,
};
