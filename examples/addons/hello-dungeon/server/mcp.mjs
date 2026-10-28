// A minimal MCP server over stdio, with no dependencies, so this example runs
// on the Node that Open Game Master already has (the desktop app's, too).
//
// It covers what an addon needs: the initialize handshake, tools/list,
// tools/call with progress notifications and cancellation, logging, and
// sampling requests back to the server. A real addon is welcome to use the
// official SDK instead (npm @modelcontextprotocol/sdk, PyPI mcp); the server
// cannot tell the difference.
//
// One rule above all: stdout is the protocol. Log to stderr (console.error),
// or with ctx.log, never with console.log.

import { createInterface } from "node:readline";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export function createServer({ name, version }) {
  const tools = new Map();
  const pending = new Map();
  const running = new Map();
  let nextId = 1;
  let clientCapabilities = {};

  const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

  // A request from this server to the client (sampling), answered later.
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = `s${nextId++}`;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });

  function context(id, meta) {
    const token = meta?.progressToken;
    const controller = new AbortController();
    running.set(id, controller);
    return {
      signal: controller.signal,
      progress(progress, total, message) {
        if (token !== undefined) {
          send({ method: "notifications/progress", params: { progressToken: token, progress, total, message } });
        }
      },
      log(data, level = "info") {
        send({ method: "notifications/message", params: { level, data } });
      },
      // Ask the server's storyteller model. Refused unless the admin granted
      // the ai.text permission.
      async sample(messages, options = {}) {
        if (!clientCapabilities.sampling) {
          throw new Error("This server did not offer sampling (the ai.text permission is not granted).");
        }
        const result = await request("sampling/createMessage", {
          messages: messages.map((text) => ({ role: "user", content: { type: "text", text } })),
          maxTokens: options.maxTokens ?? 400,
          ...(options.system ? { systemPrompt: options.system } : {}),
        });
        return result?.content?.text ?? "";
      },
    };
  }

  async function handle(message) {
    const { id, method, params = {} } = message;
    if (method === undefined) {
      // A reply to one of our own requests.
      const entry = pending.get(id);
      if (entry) {
        pending.delete(id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
      }
      return;
    }
    if (method === "notifications/cancelled") {
      running.get(params.requestId)?.abort();
      return;
    }
    if (method.startsWith("notifications/")) return;
    try {
      let result;
      if (method === "initialize") {
        clientCapabilities = params.capabilities ?? {};
        const asked = params.protocolVersion;
        result = {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {}, logging: {} },
          serverInfo: { name, version },
        };
      } else if (method === "ping") {
        result = {};
      } else if (method === "tools/list") {
        result = {
          tools: [...tools.values()].map(({ name: toolName, description, inputSchema }) => ({ name: toolName, description, inputSchema })),
        };
      } else if (method === "tools/call") {
        const tool = tools.get(params.name);
        if (!tool) throw new Error(`No tool named ${params.name}.`);
        try {
          const value = await tool.run(params.arguments ?? {}, context(id, params._meta));
          result = { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
        } catch (error) {
          // A tool that fails says so in its result, as MCP asks, so the
          // server can show the message to the person who started it.
          result = { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
        } finally {
          running.delete(id);
        }
      } else {
        send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
        return;
      }
      send({ id, result });
    } catch (error) {
      send({ id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  return {
    tool(toolName, description, inputSchema, run) {
      tools.set(toolName, { name: toolName, description, inputSchema, run });
    },
    listen() {
      const lines = createInterface({ input: process.stdin });
      lines.on("line", (line) => {
        if (!line.trim()) return;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          console.error("[mcp] ignored a line that is not JSON");
          return;
        }
        void handle(message);
      });
      // The server closes stdin when it stops the addon.
      lines.on("close", () => process.exit(0));
    },
  };
}
