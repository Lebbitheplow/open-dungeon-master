import { createHash, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import * as z from "zod/v4";

const VERSION = "0.1.0";
const CONTROL_URL = process.env.ODM_MCP_CONTROL_URL?.trim() || "http://127.0.0.1:3005/api/internal/mcp";
const TOKEN = process.env.ODM_MCP_TOKEN?.trim() || "";
const HOST = process.env.ODM_MCP_HOST?.trim() || "127.0.0.1";
const PORT = Number(process.env.ODM_MCP_PORT || 3006);

function digest(value) { return createHash("sha256").update(value, "utf8").digest(); }
function tokenMatches(value) { return Boolean(TOKEN && value) && timingSafeEqual(digest(value), digest(TOKEN)); }
function bearerFrom(headers) {
  const raw = headers.authorization || "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}
function allowedOrigin(origin) {
  if (!origin) return true;
  const allowed = (process.env.ODM_MCP_ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!allowed.length) return false;
  try { return allowed.includes(new URL(origin).origin); } catch { return false; }
}
async function callControl(action, params = {}) {
  if (!TOKEN) throw new Error("ODM_MCP_TOKEN is not configured. The control plane is disabled.");
  const response = await fetch(CONTROL_URL, {
    method: "POST",
    redirect: "manual",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ action, params }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error("ODM control API redirected the authenticated request.");
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) throw new Error(body?.error || `ODM control API returned HTTP ${response.status}.`);
  return body?.result;
}
function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value && typeof value === "object" && !Array.isArray(value) ? value : { result: value } };
}
function failure(error) { return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true }; }
async function run(action, params) { try { return result(await callControl(action, params)); } catch (error) { return failure(error); } }

const userRefFields = {
  userId: z.string().uuid().optional(),
  username: z.string().trim().min(1).max(80).optional(),
};
const ownerRefFields = {
  ownerUserId: z.string().uuid().optional(),
  ownerUsername: z.string().trim().min(1).max(80).optional(),
};
const ownerRef = (args) => ({ userId: args.ownerUserId, username: args.ownerUsername });
const userRef = (args) => ({ userId: args.userId, username: args.username });

function createMcpServer() {
  const server = new McpServer({ name: "open-dungeon-master", version: VERSION }, { capabilities: { tools: {}, resources: {} } });

  server.registerResource("server-status", "odm://server/status", { title: "Open Dungeon Master server status", mimeType: "application/json" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await callControl("server.status", {}), null, 2) }] }));
  server.registerResource("control-capabilities", "odm://server/capabilities", { title: "Open Dungeon Master MCP control capabilities", mimeType: "application/json" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await callControl("server.capabilities", {}), null, 2) }] }));

  server.registerTool("odm_server", { title: "ODM server", description: "Inspect server health and control capabilities.", inputSchema: z.object({ operation: z.enum(["status", "capabilities"]).default("status") }) }, async ({ operation }) => run(operation === "status" ? "server.status" : "server.capabilities", {}));
  server.registerTool("odm_users", { title: "ODM users", description: "List existing ODM users and UUIDs.", inputSchema: z.object({}) }, async () => run("users.list", {}));

  server.registerTool("odm_campaigns", {
    title: "ODM campaigns",
    description: "Create, inspect and administer campaigns/workshops. Delete requires confirm=true.",
    inputSchema: z.object({
      operation: z.enum(["list", "get", "create", "update", "delete", "set_status"]),
      campaignId: z.string().uuid().optional(), kind: z.enum(["campaign", "workshop", "all"]).optional(),
      ...ownerRefFields,
      title: z.string().trim().min(1).max(80).optional(), description: z.string().trim().max(500).optional(), theme: z.string().trim().max(120).optional(),
      maxPlayers: z.number().int().min(1).max(8).optional(), startingLevel: z.number().int().min(1).max(20).optional(), difficulty: z.enum(["easy", "normal", "hard", "deadly"]).optional(),
      gameSettings: z.record(z.string(), z.unknown()).optional(), status: z.enum(["lobby", "active", "ended"]).optional(), confirm: z.boolean().optional(),
    }),
  }, async (args) => {
    if (args.operation === "list") return run("campaigns.list", { kind: args.kind || "campaign" });
    if (args.operation === "get") return run("campaigns.get", { campaignId: args.campaignId });
    if (args.operation === "create") return run("campaigns.create", { owner: ownerRef(args), title: args.title, description: args.description, theme: args.theme, maxPlayers: args.maxPlayers, startingLevel: args.startingLevel, difficulty: args.difficulty, kind: args.kind === "workshop" ? "workshop" : "campaign", gameSettings: args.gameSettings });
    if (args.operation === "update") {
      const patch = Object.fromEntries(["title", "description", "theme", "maxPlayers", "startingLevel", "difficulty"].filter((key) => args[key] !== undefined).map((key) => [key, args[key]]));
      return run("campaigns.update", { campaignId: args.campaignId, patch });
    }
    if (args.operation === "delete") return run("campaigns.delete", { campaignId: args.campaignId, confirm: args.confirm });
    return run("campaigns.set_status", { campaignId: args.campaignId, status: args.status });
  });

  server.registerTool("odm_campaign_settings", {
    title: "ODM campaign settings",
    description: "Change game rules, story/provider settings, or DM mode. Stored API keys are write-only over MCP.",
    inputSchema: z.object({ operation: z.enum(["game", "story", "dm_mode"]), campaignId: z.string().uuid(), patch: z.record(z.string(), z.unknown()).optional(), mode: z.enum(["ai", "human", "assisted"]).optional(), actorUserId: z.string().uuid().optional(), actorUsername: z.string().trim().min(1).max(80).optional() }),
  }, async (args) => {
    if (args.operation === "game") return run("campaigns.update_game_settings", { campaignId: args.campaignId, patch: args.patch || {} });
    if (args.operation === "story") return run("campaigns.update_story_settings", { campaignId: args.campaignId, patch: args.patch || {} });
    return run("campaigns.set_dm_mode", { campaignId: args.campaignId, mode: args.mode, actor: args.actorUserId || args.actorUsername ? { userId: args.actorUserId, username: args.actorUsername } : undefined });
  });

  server.registerTool("odm_story", {
    title: "ODM story control",
    description: "Set scene, quests, secret outline/story arc, read events, or publish a notice.",
    inputSchema: z.object({ operation: z.enum(["set_scene", "set_quest_log", "set_outline", "set_arc", "events", "announce"]), campaignId: z.string().uuid(), scene: z.string().max(2_000).optional(), quests: z.array(z.string()).max(20).optional(), outline: z.string().max(8_000).optional(), arc: z.unknown().optional(), afterSeq: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(500).optional(), message: z.string().max(1_000).optional(), level: z.enum(["info", "warning"]).optional() }),
  }, async (args) => {
    const map = { set_scene: "campaigns.set_scene", set_quest_log: "campaigns.set_quest_log", set_outline: "campaigns.set_outline", set_arc: "campaigns.set_story_arc", events: "campaigns.events", announce: "campaigns.announce" };
    return run(map[args.operation], { campaignId: args.campaignId, scene: args.scene, quests: args.quests, outline: args.outline, arc: args.arc, afterSeq: args.afterSeq || 0, limit: args.limit || 100, message: args.message, level: args.level || "info" });
  });

  server.registerTool("odm_members", { title: "ODM campaign members", description: "List members, add an existing user, or transfer party lead.", inputSchema: z.object({ operation: z.enum(["list", "join", "set_lead"]), campaignId: z.string().uuid(), ...userRefFields }) }, async (args) => args.operation === "list" ? run("campaigns.members", { campaignId: args.campaignId }) : run(args.operation === "join" ? "campaigns.join_user" : "campaigns.set_lead", { campaignId: args.campaignId, user: userRef(args) }));

  server.registerTool("odm_characters", {
    title: "ODM character library",
    description: "Manage library characters and instantiate them into a campaign. Delete requires confirm=true.",
    inputSchema: z.object({ operation: z.enum(["list", "get", "create", "update", "delete", "instantiate"]), ...ownerRefFields, characterId: z.string().uuid().optional(), campaignId: z.string().uuid().optional(), level: z.number().int().min(1).max(20).optional(), targetLevel: z.number().int().min(1).max(20).optional(), role: z.enum(["pc", "companion"]).optional(), workshopId: z.string().max(100).optional(), sheet: z.record(z.string(), z.unknown()).optional(), confirm: z.boolean().optional() }),
  }, async (args) => {
    if (args.operation === "list") return run("characters.list", { owner: ownerRef(args), role: args.role });
    if (args.operation === "get") return run("characters.get", { characterId: args.characterId });
    if (args.operation === "create") return run("characters.create", { owner: ownerRef(args), level: args.level, role: args.role || "pc", workshopId: args.workshopId || "", sheet: args.sheet });
    if (args.operation === "update") return run("characters.update", { characterId: args.characterId, level: args.level, sheet: args.sheet });
    if (args.operation === "delete") return run("characters.delete", { characterId: args.characterId, confirm: args.confirm });
    return run("characters.instantiate", { characterId: args.characterId, campaignId: args.campaignId, targetLevel: args.targetLevel });
  });

  server.registerTool("odm_sheets", { title: "ODM live character sheets", description: "Read or patch live campaign character sheets.", inputSchema: z.object({ operation: z.enum(["list", "get", "patch"]), campaignId: z.string().uuid().optional(), sheetId: z.string().uuid().optional(), patch: z.record(z.string(), z.unknown()).optional() }) }, async (args) => args.operation === "list" ? run("sheets.list", { campaignId: args.campaignId }) : args.operation === "get" ? run("sheets.get", { sheetId: args.sheetId }) : run("sheets.patch", { sheetId: args.sheetId, patch: args.patch || {} }));

  return server;
}

async function serveHttp() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("ODM_MCP_PORT must be a valid TCP port.");
  if (!TOKEN) throw new Error("ODM_MCP_TOKEN must be set before the HTTP MCP endpoint can start.");
  const handler = createMcpHandler(createMcpServer);
  const nodeHandler = toNodeHandler(handler);
  const http = createHttpServer(async (req, res) => {
    const pathname = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
    if (pathname === "/healthz") {
      try { await callControl("server.status", {}); res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"ok":true}'); }
      catch { res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"ok":false}'); }
      return;
    }
    if (pathname !== "/mcp") { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"Not found"}'); return; }
    if (!allowedOrigin(req.headers.origin)) { res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"error":"Origin not allowed"}'); return; }
    if (!tokenMatches(bearerFrom(req.headers))) { res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store", "www-authenticate": 'Bearer realm="open-dungeon-master-mcp"' }); res.end('{"error":"Unauthorized"}'); return; }
    try { await nodeHandler(req, res); }
    catch (error) { console.error("MCP request failed:", error instanceof Error ? error.message : String(error)); if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }); if (!res.writableEnded) res.end('{"error":"MCP request failed"}'); }
  });
  const shutdown = async () => { http.close(); await handler.close().catch(() => undefined); };
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
  await new Promise((resolve, reject) => { http.once("error", reject); http.listen(PORT, HOST, () => { console.error(`Open Dungeon Master MCP ${VERSION} listening on http://${HOST}:${PORT}/mcp`); resolve(); }); });
}

if (process.argv.includes("--stdio")) await serveStdio(createMcpServer);
else await serveHttp();
