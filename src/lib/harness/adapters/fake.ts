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
//   { "paint": [1536, 1024] }               paint a picture that size (a real
//                                           PNG), when its image tool is on

import { readFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import type { HarnessAdapter, HarnessErrorKind, HarnessStartOptions } from "../types.ts";

type Step =
  | { text: string }
  | { call: string; args?: Record<string, unknown> }
  | { parallel: Array<{ call: string; args?: Record<string, unknown> }> }
  | { fail: HarnessErrorKind; message?: string }
  | { wait: number }
  | { paint: [number, number] };

// A real, decodable PNG of one flat colour: what a picture run hands back.
export function fakePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x7a)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
      if ("paint" in step) {
        log("paint", step.paint);
        if (options.images) {
          options.onEvent({ type: "image", bytes: fakePng(step.paint[0], step.paint[1]), mime: "image/png" });
        }
        continue;
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
