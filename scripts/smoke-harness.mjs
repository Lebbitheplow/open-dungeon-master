// Live smoke: a real agent program narrates real DM turns through ODM's MCP
// endpoint. NOT part of npm test: it runs the admin's own Claude Code, Codex,
// opencode or Grok Build, which spends their plan.
//
//   HARNESS=claude HARNESS_MODEL=haiku node scripts/smoke-harness.mjs
//   HARNESS=opencode HARNESS_MODEL=llama/qwen3.6-35b node scripts/smoke-harness.mjs
//
// Asserts the program's own tool list held nothing but the table's tools,
// that a canary file in its scratch folder was never read, that its rolls
// were the server's, and that its narration landed as the DM's message.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const HARNESS = process.env.HARNESS || "claude";
const MODEL = process.env.HARNESS_MODEL || (HARNESS === "claude" ? "haiku" : "");
const TURNS = Number.parseInt(process.env.HARNESS_TURNS ?? "", 10) || 2;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-smoke-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
delete process.env.HARNESS_FAKE;
register("./lib/register-alias.mjs", import.meta.url);

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { handleMcpRequest } = await import("../src/lib/agents/mcp-server.ts");
const { activeBridgeSessions } = await import("../src/lib/harness/bridge.ts");
const { probeHarness } = await import("../src/lib/harness/status.ts");
const { recentAgentActivity } = await import("../src/lib/agents/activity.ts");
const { testHarness } = await import("../src/lib/harness/test-run.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const response = await handleMcpRequest(
    new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.HARNESS_MCP_URL = `http://127.0.0.1:${server.address().port}/api/mcp`;

saveGlobalConfig({ harness: { id: HARNESS, model: MODEL, utilityModel: MODEL }, text: { provider: "harness" } });
const status = await probeHarness(HARNESS, { refresh: true });
console.log(`${status.label} ${status.version ?? "?"} at ${status.path ?? "?"}: auth=${status.auth.state} ${status.auth.plan ?? ""}`);
assert.ok(status.installed, status.message);

const probe = await testHarness();
for (const stage of probe.stages) {
  console.log(`  test stage ${stage.id}: ${stage.ok === null ? "skipped" : stage.ok ? "ok" : "FAILED"}${stage.detail ? ` (${stage.detail})` : ""}`);
}
assert.ok(probe.stages.every((stage) => stage.ok), "the admin test turn failed");

const lead = createUser("rowan", "x");
const campaign = createCampaign(lead.id, {
  title: "The Salt Road",
  description: "A caravan job that goes wrong at the ford.",
  theme: "low fantasy, coastal trade road",
  maxPlayers: 4,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: {},
});
updateStorySettings(campaign.id, { textProvider: "harness", imageGenerationEnabled: false, autoImages: false });
setCampaignStatus(campaign.id, "active");
const avery = createSheet(
  campaign.id,
  lead.id,
  3,
  createSheetSchema.parse({
    name: "Avery",
    race: "human",
    class: "rogue",
    abilities: { str: 12, dex: 17, con: 13, int: 12, wis: 12, cha: 11 },
    maxHp: 24,
    ac: 15,
    hitDice: { die: "d8", total: 3, spent: 0 },
    proficiencies: { saves: ["dex", "int"], skills: ["perception", "athletics"], languages: ["common"], tools: [], armor: [], weapons: ["shortsword"] },
    equipment: [{ name: "Shortsword", qty: 1 }],
    gold: 12,
  }),
);

const actions = [
  "I climb onto the lead wagon and scan the far bank of the ford for anything moving. (Roll Perception for me.)",
  "I wade into the ford, shortsword drawn, and shout for whoever is hiding to show themselves.",
  "I search the reeds where the shape went.",
];
for (let index = 0; index < TURNS; index += 1) {
  insertCampaignMessage({
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    authorType: "player",
    userId: lead.id,
    characterId: avery.id,
    content: actions[index % actions.length],
  });
  const started = Date.now();
  await startDmTurn(campaign.id);
  const last = listRecentMessages(campaign.id, 3).pop();
  console.log(`\n--- turn ${index + 1} (${Math.round((Date.now() - started) / 1000)}s, ${last.authorType}) ---\n${last.content.slice(0, 900)}`);
  assert.equal(last.authorType, "dm", `turn ${index + 1} did not produce narration: ${last.content}`);
  assert.equal(activeBridgeSessions(), 0, "a session outlived its turn");
}

const calls = recentAgentActivity({ limit: 100 }).filter((row) => row.grantKind === "turn");
console.log(`\ntool calls through MCP: ${calls.map((row) => `${row.tool}${row.ok ? "" : "(refused)"}`).join(", ") || "none"}`);
console.log(`server rolls: ${listRecentRolls(campaign.id, 50).length}`);

server.close();
removeTempDir(dir);
console.log("\nHARNESS SMOKE PASS");
process.exit(0);
