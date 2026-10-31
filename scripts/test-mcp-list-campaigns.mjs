// odm_list_campaigns tells a connected agent what it lists. The route behind
// it (GET /api/campaigns) returns tables that play only: a workshop or a
// test table is never in the list. The tool's description once promised
// workshops too, so an agent went looking for one it could never find. These
// tests drive workbenchCall into the real route and hold the description to
// what the route returns.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-mcp-list-campaigns-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-routes.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { workbenchCall, workbenchTools } = await import("../src/lib/agents/workbench.ts");
const campaignsRoute = await import("../src/app/api/campaigns/route.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const author = createUser("list-author", "x");
const campaign = createCampaign(author.id, {
  title: "The Salt Road",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});
const workshop = createWorkshop(author.id, { title: "Bench Prep" });
const grant = createConnectionGrant({ userId: author.id, name: "author's agent", scopes: ["read"] }).grant;

// workbenchCall reaches routes over loopback fetch; here fetch goes straight
// to the list route, signed in with the session the grant minted.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url);
  assert.equal(target.pathname, "/api/campaigns", `unexpected path ${target.pathname}`);
  globalThis.__odmTestToken = (new Headers(init.headers).get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return campaignsRoute.GET(new Request(target, { method: init.method ?? "GET", headers: init.headers }));
};

try {
  await test("the list holds the author's campaign and not their workshop", async () => {
    const outcome = await workbenchCall(grant, "odm_list_campaigns", {});
    assert.equal(outcome.isError, false, outcome.text.slice(0, 300));
    const ids = JSON.parse(outcome.text).campaigns.map((entry) => entry.id);
    assert.ok(ids.includes(campaign.id), "the campaign is listed");
    assert.ok(!ids.includes(workshop.id), "the workshop is not listed");
  });

  await test("the description promises campaigns only and says workshops are not listed", () => {
    const tool = workbenchTools(grant).find((candidate) => candidate.name === "odm_list_campaigns");
    assert.ok(tool, "odm_list_campaigns is offered on the read scope");
    assert.ok(!/campaigns and workshops/i.test(tool.description), `still promises workshops: ${tool.description}`);
    assert.match(tool.description, /workshops[^.]* not listed/i);
  });

  console.log(`${passed} odm_list_campaigns tests passed`);
} finally {
  globalThis.fetch = originalFetch;
  getDatabase().close();
  globalThis.__localRoleplayDb = undefined;
  removeTempDir(dir);
}
