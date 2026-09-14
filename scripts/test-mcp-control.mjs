import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-mcp-control-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ODM_MCP_TOKEN = randomBytes(32).toString("hex");
process.env.ODM_MCP_OWNER_USERNAME = "mcp-admin";
register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { executeMcpControl } = await import("../src/lib/mcp-control.ts");
const { POST } = await import("../src/app/api/internal/mcp/route.ts");

try {
  createUser("mcp-admin", "x", { isAdmin: true });
  const status = await executeMcpControl("server.status", {});
  assert.equal(status.ok, true);
  assert.equal(status.users, 1);

  const created = await executeMcpControl("campaigns.create", { title: "MCP Test Campaign", maxPlayers: 1 });
  assert.equal(created.campaign.title, "MCP Test Campaign");
  const campaignId = created.campaign.id;

  await executeMcpControl("campaigns.update_story_settings", { campaignId, patch: { customApiKey: "must-not-leak" } });
  const readBack = await executeMcpControl("campaigns.get", { campaignId });
  assert.equal(JSON.stringify(readBack).includes("must-not-leak"), false, "stored provider key leaked through MCP read");

  const unauth = await POST(new Request("http://localhost/api/internal/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "server.status", params: {} }) }));
  assert.equal(unauth.status, 401);

  const auth = await POST(new Request("http://localhost/api/internal/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ODM_MCP_TOKEN}` }, body: JSON.stringify({ action: "campaigns.get", params: { campaignId } }) }));
  assert.equal(auth.status, 200);
  const payload = await auth.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.result.campaign.title, "MCP Test Campaign");

  console.log("mcp-control: authenticated control route, campaign CRUD read path, and secret masking passed");
} finally {
  removeTempDir(dir);
}
