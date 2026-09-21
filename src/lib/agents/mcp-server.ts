// ODM's MCP endpoint: the one door an agent program has into the game.
//
// Two kinds of caller hold a token for it:
//   - a turn grant: an agent program ODM started to narrate one DM turn
//     (src/lib/harness/bridge.ts). Its tools are that turn's DM tools, and
//     every call goes back through the DM loop and its rules. Loopback only.
//   - a connection grant: a person's own agent session (Claude Code, Codex,
//     any MCP client) acting as that person, with exactly the permissions
//     their account has in the web app (src/lib/agents/workbench.ts).
//
// Stateless: every request builds a fresh server for the grant it carries,
// so there is nothing to leak between callers and no session to hijack.

import { createMcpHandler, Server, type McpHttpHandler } from "@modelcontextprotocol/server";
import { bridgeSessionForToken, type BridgeSession } from "@/lib/harness/bridge";
import { resolveConnectionGrant, type ConnectionGrant } from "@/lib/agents/grants";
import { workbenchCall, workbenchTools } from "@/lib/agents/workbench";
import { recordAgentActivity, throttleAgent } from "@/lib/agents/activity";

export const MAX_MCP_BODY_BYTES = 1_000_000;

type Grant =
  | { kind: "turn"; session: BridgeSession }
  | { kind: "connection"; grant: ConnectionGrant };

const VERSION = "1.0.0";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], ...(isError ? { isError: true } : {}) };
}

function serverFor(grant: Grant): Server {
  const server = new Server(
    { name: "open-dungeon-master", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        grant.kind === "turn"
          ? "These tools are the Open Dungeon Master rules engine for the turn you are narrating."
          : "Open Dungeon Master: act on this server as the signed-in player, with that player's permissions.",
    },
  );
  server.setRequestHandler("tools/list", async () => ({
    tools: grant.kind === "turn" ? grant.session.catalogue : workbenchTools(grant.grant),
  }));
  server.setRequestHandler("tools/call", async (request) => {
    const name = String(request.params.name ?? "");
    const args =
      request.params.arguments && typeof request.params.arguments === "object"
        ? (request.params.arguments as Record<string, unknown>)
        : {};
    const started = Date.now();
    if (grant.kind === "turn") {
      const meta = (request.params as { _meta?: Record<string, unknown> })._meta ?? {};
      const callId = typeof meta["claudecode/toolUseId"] === "string" ? (meta["claudecode/toolUseId"] as string) : undefined;
      const outcome = await grant.session.call(name, args, callId);
      recordAgentActivity({
        grantKind: "turn",
        grantId: grant.session.tokenHash.slice(0, 16),
        userId: null,
        campaignId: grant.session.campaignId,
        tool: name,
        ok: !outcome.isError,
        ms: Date.now() - started,
      });
      return textResult(outcome.text, outcome.isError);
    }
    const limited = throttleAgent(grant.grant.id, name);
    if (limited) {
      return textResult(limited, true);
    }
    const outcome = await workbenchCall(grant.grant, name, args);
    recordAgentActivity({
      grantKind: "connection",
      grantId: grant.grant.id,
      userId: grant.grant.userId,
      campaignId: outcome.campaignId ?? null,
      tool: name,
      ok: !outcome.isError,
      ms: Date.now() - started,
    });
    return textResult(outcome.text, outcome.isError);
  });
  return server;
}

declare global {
  var __odmMcpHandler: McpHttpHandler | undefined;
}

function handler(): McpHttpHandler {
  if (!globalThis.__odmMcpHandler) {
    globalThis.__odmMcpHandler = createMcpHandler(
      (ctx) => {
        const grant = ctx.authInfo?.extra?.grant as Grant | undefined;
        if (!grant) {
          throw new Error("MCP request without a grant");
        }
        return serverFor(grant);
      },
      { legacy: "stateless", onerror: (error) => console.warn("[mcp]", error.message) },
    );
  }
  return globalThis.__odmMcpHandler;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(hostHeader: string | null): boolean {
  if (!hostHeader) {
    return false;
  }
  const host = hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
  return LOOPBACK.has(host.toLowerCase());
}

export function bearerOf(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
}

function refuse(status: number, error: string, extra: Record<string, string> = {}) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } },
  );
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  // No browser page may talk to this endpoint: MCP clients are programs and
  // send no Origin, so one being present means a web page is trying.
  if (request.headers.get("origin")) {
    return refuse(403, "Browser origins are not allowed on this endpoint.");
  }
  const length = Number.parseInt(request.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(length) && length > MAX_MCP_BODY_BYTES) {
    return refuse(413, "Request too large.");
  }
  const token = bearerOf(request);
  if (!token) {
    return refuse(401, "Missing bearer token.", { "WWW-Authenticate": 'Bearer realm="open-dungeon-master"' });
  }
  let grant: Grant | null = null;
  const session = bridgeSessionForToken(token);
  if (session) {
    // A turn token only works from this machine: it is handed to a program
    // ODM started here, so a request carrying one from anywhere else (a
    // tunnel, the public address) is refused even though the token matches.
    if (!isLoopbackHost(request.headers.get("host"))) {
      return refuse(403, "This token is only valid from this machine.");
    }
    grant = { kind: "turn", session };
  } else {
    const connection = resolveConnectionGrant(token);
    if (connection) {
      grant = { kind: "connection", grant: connection };
    }
  }
  if (!grant) {
    return refuse(401, "Unknown or expired token.", { "WWW-Authenticate": 'Bearer realm="open-dungeon-master", error="invalid_token"' });
  }
  const response = await handler().fetch(request, {
    authInfo: {
      token: "",
      clientId: grant.kind === "turn" ? "odm-turn" : grant.grant.id,
      scopes: grant.kind === "turn" ? ["turn"] : grant.grant.scopes,
      extra: { grant },
    },
  });
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, headers });
}
