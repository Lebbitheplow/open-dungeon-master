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
const { AGENT_SCOPES, createConnectionGrant } = await import("../src/lib/agents/grants.ts");
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

  // The other tools held to their routes the same way: each promise below
  // was one the route behind the tool did not keep.
  await test("no other tool's description promises what its route does not do", () => {
    const every = createConnectionGrant({ userId: author.id, name: "every scope", scopes: [...AGENT_SCOPES] }).grant;
    const said = Object.fromEntries(workbenchTools(every).map((tool) => [tool.name, tool.description]));
    const property = (name, field) => workbenchTools(every).find((tool) => tool.name === name).inputSchema.properties[field].description;
    // requireStoryAuthority: a lead at a table a person runs is refused.
    assert.doesNotMatch(said.odm_update_game_settings, /party lead only/);
    assert.doesNotMatch(said.odm_write_lore, /party lead/);
    // An agent's call runs on the AI storyteller's rails (dm/invoke/route.ts).
    assert.doesNotMatch(said.odm_dm_invoke, /exactly as the GM console/);
    assert.match(said.odm_dm_narrate, /ends your turn/);
    // The storyteller sees a pact's approach; the GM seat sees every pact.
    assert.doesNotMatch(said.odm_answer_offer, /nobody else ever sees it/);
    assert.match(said.odm_get_pact, /GM seat/);
    // A held roll refuses typed faces (pending-rolls route, 403).
    assert.match(said.odm_answer_roll, /only the fallback/);
    // ooc wakes the GM only when it names @GM (actions route).
    assert.match(said.odm_take_action, /@GM/);
    // auto gathers every source (src/lib/dm/ask.ts).
    assert.doesNotMatch(property("odm_ask", "scope"), /picks from the question's words/);
    assert.doesNotMatch(said.odm_get_whispers, /sent you alone/);
  });

  console.log(`${passed} odm_list_campaigns tests passed`);
} finally {
  globalThis.fetch = originalFetch;
  getDatabase().close();
  globalThis.__localRoleplayDb = undefined;
  removeTempDir(dir);
}
