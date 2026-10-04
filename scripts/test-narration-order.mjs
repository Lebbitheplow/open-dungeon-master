// Issue 68: after a fight the DM narrates on (a companion speaks, the floor
// opens) while the turn's tail still runs (experience, loot, more calls).
// A player who answered what they had read landed ABOVE that narration,
// because the narration was written, and took its seq, only when the whole
// turn ended. Drives the real turn machine against a fake OpenAI-compatible
// server on a throwaway database: the first call streams narration and a
// tool call, the second waits while a player replies the way the actions
// route does, and the transcript must read narration, then reply.
//
// Usage: node scripts/test-narration-order.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-narration-order-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "65536";

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { claimNarrationSeq } = await import("../src/lib/dm/narration-slot.ts");
const { queuedIntents } = await import("../src/lib/dm/intent-queue.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");

const FIRST = "The last goblin drops its spear and flees into the reeds. Brom wipes his axe and grins at you: 'Not bad, for a city sort.'";
const SECOND = "The ford falls quiet but for the water.";
const REPLY = "I grin back. 'Not bad yourself, Brom.'";

// Call 0 streams narration and a tool call; call 1 is held until the test
// lets it go, standing in for a long end-of-fight tail.
let calls = 0;
let release = () => {};
let tailReached = () => {};
const tail = new Promise((resolve) => (tailReached = resolve));
function sse(res, deltas) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (process.env.DEBUG_ORDER) {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      console.log("request", calls, req.url, "tools:", (body.tools ?? []).length, "stream:", body.stream, "last:", String(JSON.stringify(body.messages?.at(-1))).slice(0, 160));
    }
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const call = calls;
    calls += 1;
    if (call === 0) {
      sse(res, [
        { content: FIRST },
        // A look into the story always gets a follow-up call, and keeps the
        // narration already written (an outcome tool would hold it back).
        { tool_calls: [{ index: 0, id: "call_recall_story_0", type: "function", function: { name: "recall_story", arguments: JSON.stringify({ query: "goblins" }) } }] },
      ]);
      return;
    }
    if (call === 1) {
      new Promise((resolve) => {
        release = resolve;
        tailReached();
      }).then(() => sse(res, [{ content: SECOND }]));
      return;
    }
    sse(res, [{ content: SECOND }]);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const lead = createUser("lead", "x");
const campaign = createCampaign(lead.id, {
  title: "After the ford",
  description: "Issue 68.",
  theme: "river ford",
  maxPlayers: 2,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
updateStorySettings(campaign.id, {
  textProvider: "custom",
  customBaseUrl: baseUrl,
  customModel: "fake",
  imageGenerationEnabled: false,
  autoImages: false,
});
setCampaignStatus(campaign.id, "active");
const sheet = createSheet(
  campaign.id,
  lead.id,
  1,
  createSheetSchema.parse({
    name: "Ash",
    race: "human",
    class: "fighter",
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    maxHp: 12,
    ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
  }),
);
const post = (content) => {
  // What POST /actions does: claim, then take a seq.
  claimNarrationSeq(campaign.id);
  return insertCampaignMessage({
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    authorType: "player",
    userId: lead.id,
    characterId: sheet.id,
    content,
  });
};
post("I finish the last goblin.");

const turn = startDmTurn(campaign.id);
await Promise.race([
  tail,
  turn.then(() => {
    throw new Error(`the turn ended after ${calls} calls without reaching its tail`);
  }),
]);
// The first passage is on every screen; the turn is still running.
const reply = post(REPLY);
release();
await turn;

const transcript = listRecentMessages(campaign.id, 10).filter((m) => m.authorType !== "system");
const order = transcript.map((m) => (m.authorType === "dm" ? "dm" : m.content));
assert.deepEqual(order, ["I finish the last goblin.", "dm", REPLY], `transcript out of order: ${JSON.stringify(order)}`);
const narration = transcript.find((m) => m.authorType === "dm");
assert.ok(narration.content.includes(FIRST) && narration.content.includes(SECOND), `one passage, both calls: ${narration.content}`);
assert.ok(narration.seq < reply.seq);
console.log("ok: a reply posted while the narration streamed sits after it");
assert.deepEqual(
  queuedIntents(listRecentMessages(campaign.id, 10), []).map((intent) => intent.messageId),
  [reply.id],
  "the reply still waits for the DM",
);
console.log("ok: the reply is still queued for the DM, not taken as answered");

server.close();
removeTempDir(dir);
