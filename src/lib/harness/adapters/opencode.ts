// opencode, driven through its own HTTP server (`opencode serve`).
//
// Lockdown, proven on 1.18.30: a dedicated agent whose permission ruleset
// denies "*" and allows only "odm_*", with every built-in tool switched off
// in its tool map. Asked to list files, the model answered that the only tool
// it had was odm_request_roll. The admin's own MCP servers (from their global
// config) are disconnected at start, and the same deny ruleset is set on the
// session itself.
//
// The server speaks HTTP with basic auth and streams events over SSE. Each
// run gets its own server on a free loopback port and a random password, and
// the server dies with the run.

import { randomBytes } from "node:crypto";
import net from "node:net";
import { runProgram, spawnProgram } from "../process.ts";
import type { HarnessAdapter, HarnessModel, HarnessStartOptions } from "../types.ts";

const AGENT = "odm-dm";

const BUILT_IN_TOOLS = [
  "bash",
  "edit",
  "write",
  "read",
  "grep",
  "glob",
  "list",
  "lsp",
  "patch",
  "apply_patch",
  "webfetch",
  "websearch",
  "codesearch",
  "todowrite",
  "todoread",
  "task",
  "skill",
  "question",
  "invalid",
];

// Pure, so scripts/test-harness-args.mjs can pin the lockdown.
export function opencodeConfig(options: { system: string; mcp: { url: string; token: string } | null }) {
  const tools: Record<string, boolean> = {};
  for (const name of BUILT_IN_TOOLS) {
    tools[name] = false;
  }
  tools["odm_*"] = Boolean(options.mcp);
  const permission = { "*": "deny", "odm_*": options.mcp ? "allow" : "deny" };
  return {
    autoupdate: false,
    share: "disabled",
    snapshot: false,
    permission,
    ...(options.mcp
      ? {
          mcp: {
            odm: {
              type: "remote",
              url: options.mcp.url,
              headers: { Authorization: `Bearer ${options.mcp.token}` },
              oauth: false,
              enabled: true,
              timeout: 600_000,
            },
          },
        }
      : {}),
    agent: {
      [AGENT]: {
        mode: "primary",
        description: "Open Dungeon Master",
        prompt: options.system,
        permission,
        tools,
      },
    },
  };
}

export const OPENCODE_SESSION_RULES = (mcp: boolean) => [
  { permission: "*", pattern: "*", action: "deny" },
  ...(mcp ? [{ permission: "odm_*", pattern: "*", action: "allow" }] : []),
];

// Free models opencode's own service offers refuse to answer anything that
// is not opencode's own app, so they are not offered.
export function parseOpencodeModels(output: string): HarnessModel[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[\w.-]+\/[\w.:@-]+$/.test(line))
    .filter((line) => !line.startsWith("opencode/"))
    .map((id) => ({
      id,
      label: id,
      cheap: /mini|flash|haiku|small|lite|8b|e4b|e2b/i.test(id),
    }));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function start(options: HarnessStartOptions) {
  const port = await freePort();
  const password = randomBytes(24).toString("base64url");
  const authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const base = `http://127.0.0.1:${port}`;
  let closed = false;
  let listening: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    listening = resolve;
  });
  const program = spawnProgram(options.binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--pure"], {
    cwd: options.cwd,
    env: {
      ...options.env,
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig({ system: options.system, mcp: options.mcp })),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    onLine: (line) => {
      if (/listening/i.test(line)) {
        listening();
      }
    },
    onExit: (code) => {
      if (!closed) {
        options.onEvent({ type: "error", kind: "crash", message: program.stderrTail().slice(-400) || `opencode exited (${code})` });
        options.onEvent({ type: "exit", code });
      }
    },
  });
  const startup = await Promise.race([
    ready.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 45_000)),
  ]);
  if (!startup) {
    program.kill();
    throw new Error("opencode's server did not start within 45 seconds.");
  }

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: authHeader, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`opencode ${method} ${path}: ${response.status} ${text.slice(0, 200)}`);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text;
    }
  };

  // Anything the admin's own config connected besides ODM goes.
  try {
    const servers = (await api("GET", "/mcp")) as Record<string, unknown> | null;
    for (const name of Object.keys(servers ?? {})) {
      if (name !== "odm") {
        await api("POST", `/mcp/${encodeURIComponent(name)}/disconnect`).catch(() => undefined);
      }
    }
  } catch {
    // Older servers have no MCP listing; the deny rules still hold.
  }

  const session = (await api("POST", "/session", {
    title: "Open Dungeon Master",
    permission: OPENCODE_SESSION_RULES(Boolean(options.mcp)),
  })) as { id: string };

  const partTypes = new Map<string, string>();
  let busy = false;
  const abort = new AbortController();

  const finishTurn = async () => {
    // The authoritative text is the last assistant message's text parts; the
    // stream also carries reasoning, which the players must never see.
    let text = "";
    try {
      const messages = (await api("GET", `/session/${session.id}/message`)) as Array<{
        info?: { role?: string };
        parts?: Array<{ type?: string; text?: string; synthetic?: boolean }>;
      }>;
      const last = [...(messages ?? [])].reverse().find((entry) => entry.info?.role === "assistant");
      text = (last?.parts ?? [])
        .filter((part) => part.type === "text" && !part.synthetic)
        .map((part) => part.text ?? "")
        .join("")
        .trim();
    } catch {
      text = "";
    }
    options.onEvent({ type: "turn_end", text });
  };

  (async () => {
    try {
      const response = await fetch(`${base}/event`, { headers: { authorization: authHeader }, signal: abort.signal });
      if (!response.body) {
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf("\n\n");
        while (index >= 0) {
          const chunk = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          index = buffer.indexOf("\n\n");
          const data = chunk
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (!data) {
            continue;
          }
          let event: { type?: string; properties?: Record<string, unknown> };
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          const props = event.properties ?? {};
          if (props.sessionID && props.sessionID !== session.id) {
            continue;
          }
          if (event.type === "message.part.updated") {
            const part = props.part as { id?: string; type?: string } | undefined;
            if (part?.id && part.type) {
              partTypes.set(part.id, part.type);
            }
          } else if (event.type === "message.part.delta") {
            if (props.field === "text" && partTypes.get(String(props.partID)) === "text") {
              options.onEvent({ type: "delta", text: String(props.delta ?? "") });
            }
          } else if (event.type === "session.error") {
            const error = props.error as { name?: string; data?: { message?: string } } | undefined;
            const message = error?.data?.message ?? error?.name ?? "opencode reported an error.";
            options.onEvent({
              type: "error",
              kind: error?.name === "ProviderAuthError" ? "signed-out" : /limit|quota|429/i.test(message) ? "limit" : "crash",
              message,
            });
          } else if (event.type === "session.idle" && busy) {
            busy = false;
            await finishTurn();
          }
        }
      }
    } catch {
      // The stream ends when the session closes.
    }
  })();

  const [providerID, ...rest] = options.model.split("/");
  const model = options.model && rest.length ? { providerID, modelID: rest.join("/") } : undefined;
  options.onEvent({ type: "ready", tools: [] });

  return {
    send(text: string) {
      busy = true;
      api("POST", `/session/${session.id}/prompt_async`, {
        agent: AGENT,
        ...(model ? { model } : {}),
        parts: [{ type: "text", text }],
      }).catch((error) => {
        options.onEvent({ type: "error", kind: "crash", message: error instanceof Error ? error.message : String(error) });
      });
    },
    close() {
      closed = true;
      abort.abort();
      api("POST", `/session/${session.id}/abort`).catch(() => undefined);
      program.kill();
    },
  };
}

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  label: "opencode",
  binaryNames: ["opencode"],
  installHint: "curl -fsSL https://opencode.ai/install | bash",
  signInHint: "opencode auth login",
  lockdown: "removed",
  paints: false,
  async probe(binary, env) {
    const version = await runProgram(binary, ["--version"], env, 15_000);
    const installed = version.code === 0;
    if (!installed) {
      return { installed: false, auth: { state: "unknown" }, models: [] };
    }
    const listed = await runProgram(binary, ["models"], env, 45_000);
    const models = parseOpencodeModels(listed.stdout);
    return {
      installed,
      version: version.stdout.trim().split(/\s+/).pop(),
      auth: models.length ? { state: "ready", kind: "api-key" } : { state: "signed-out" },
      models,
      lockdownProven: true,
      message: models.length
        ? undefined
        : "opencode has no model it can use outside its own app. Connect a provider with `opencode auth login`.",
    };
  },
  start,
};
