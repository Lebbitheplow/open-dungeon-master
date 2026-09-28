// A DM reply that only asks a player something (request_player_input, no
// narration) gets one forced-narration call, in a fight as well as outside
// one. In a fight no spotlight is set (the initiative order owns the floor),
// and the rescue used to hang on the spotlight, so the turn closed on the
// empty-turn line. Drives the real turn machine against a fake
// OpenAI-compatible server on a throwaway database.
//
// Usage: node scripts/test-fight-input-rescue.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-fight-input-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "65536";

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } =
  await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createEncounter, getActiveEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { setInitiativeFloor, fightOwnsFloor } = await import("../src/lib/dm/encounter-tools.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");

const NARRATION = "The bandit sidesteps into the shallows, blade low, and the water churns around his boots.";
const QUESTION = "The bandit is 60 feet away. What do you do?";

// Scripted replies, one per /chat/completions request, streamed as SSE.
let script = [];
let calls = 0;
let sheetId = "";
function sse(res, deltas) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}
const ask = () => ({
  tool_calls: [
    {
      index: 0,
      id: `call_ask_${calls}`,
      type: "function",
      function: {
        name: "request_player_input",
        arguments: JSON.stringify({ characterIds: [sheetId], prompt: QUESTION }),
      },
    },
  ],
});
const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const reply = script[calls] ?? "narrate";
    calls += 1;
    if (reply === "ask") {
      sse(res, [ask()]);
    } else if (reply === "narrate-and-ask") {
      sse(res, [{ content: NARRATION }, ask()]);
    } else {
      sse(res, [{ content: NARRATION }]);
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

function table(title, { fight }) {
  const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x");
  const campaign = createCampaign(lead.id, {
    title,
    description: "A test of the question-only rescue.",
    theme: "river ford",
    maxPlayers: 2,
    startingLevel: 1,
    difficulty: "normal",
    // No narration audio: there is no TTS server in a test run.
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
      name: "Bram",
      race: "human",
      class: "fighter",
      abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      maxHp: 12,
      ac: 16,
      hitDice: { die: "d10", total: 1, spent: 0 },
      proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
    }),
  );
  sheetId = sheet.id;
  if (fight) {
    // A locked-in initiative order with this PC up, as scripts/test-combat-floor.mjs sets one.
    const encounter = createEncounter(campaign.id, "Bandits at the ford");
    encounter.order = [{ kind: "pc", characterId: sheet.id, userId: lead.id, name: "Bram", initiative: 15 }];
    encounter.orderReady = true;
    encounter.turnIndex = 0;
    saveEncounter(encounter);
    setInitiativeFloor(getCampaignById(campaign.id), getActiveEncounter(campaign.id));
    assert.equal(fightOwnsFloor(campaign.id), true, "the test fight does not own the floor");
  }
  insertCampaignMessage({
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    authorType: "player",
    userId: lead.id,
    characterId: sheet.id,
    content: "I splash across the shallows toward the nearest bandit.",
  });
  return campaign;
}

async function run(title, replies, options) {
  script = replies;
  calls = 0;
  const campaign = table(title, options);
  await startDmTurn(campaign.id);
  const dm = listRecentMessages(campaign.id, 20).filter((m) => m.authorType === "dm");
  return { text: dm[dm.length - 1]?.content ?? "", calls };
}

// The bug: in a fight, a reply that only asks gets no narration call.
const inFight = await run("Question in a fight", ["ask", "narrate"], { fight: true });
assert.ok(inFight.text.includes(NARRATION), `expected narration in a fight, got: ${inFight.text}`);
assert.equal(inFight.calls, 2, "the question-only reply should get exactly one narration call");
console.log("ok: fight, question only -> narrated after 2 calls");

// Unchanged: outside a fight the spotlight rescue still narrates.
const outside = await run("Question outside a fight", ["ask", "narrate"], { fight: false });
assert.ok(outside.text.includes(NARRATION), `expected narration outside a fight, got: ${outside.text}`);
assert.equal(outside.calls, 2);
console.log("ok: no fight, question only -> narrated after 2 calls (spotlight path)");

// Unchanged: a question that already comes with narration needs no extra call.
const both = await run("Question with narration in a fight", ["narrate-and-ask"], { fight: true });
assert.ok(both.text.includes(NARRATION));
assert.equal(both.calls, 1, "narration was already there; no extra call");
console.log("ok: fight, narration + question -> 1 call");

server.close();
removeTempDir(dir);
console.log("PASS: a question-only reply is narrated in a fight too.");
