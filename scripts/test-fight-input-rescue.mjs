// A DM reply that only asks a player something (request_player_input, no
// narration) gets one forced-narration call, in a fight as well as outside
// one. In a fight no spotlight is set (the initiative order owns the floor),
// and the rescue used to hang on the spotlight, so the turn closed on the
// empty-turn line. The same held for a question naming no player's
// character, and for a last call (toolChoice "none") that came back with a
// tool call anyway. Also here: cast_buff and split_damage get the follow-up
// call their handlers run in, and every echoed tool call gets a result.
// Drives the real turn machine against a fake OpenAI-compatible server on a
// throwaway database.
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
import { answerReader, isReaderRequest } from "./lib/claims-reader.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-fight-input-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "65536";

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } =
  await import("../src/lib/db/campaigns.ts");
const { createSheet, getSheetById } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { createEncounter, getActiveEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { setInitiativeFloor, fightOwnsFloor } = await import("../src/lib/dm/encounter-tools.ts");
const { startDmTurn, MAX_MODEL_CALLS } = await import("../src/lib/dm/turn.ts");

const NARRATION = "The bandit sidesteps into the shallows, blade low, and the water churns around his boots.";
const QUESTION = "The bandit is 60 feet away. What do you do?";

// Scripted replies, one per /chat/completions request, streamed as SSE.
// Every request body is kept so a test can read what the loop sent.
let script = [];
let calls = 0;
let requests = [];
let sheetId = "";
function sse(res, deltas) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}
const toolCall = (name, args) => ({
  tool_calls: [
    { index: 0, id: `call_${name}_${calls}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
  ],
});
const ask = (characterIds = [sheetId]) => toolCall("request_player_input", { characterIds, prompt: QUESTION });
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (isReaderRequest(body)) {
      answerReader(res);
      return;
    }
    requests.push(body);
    const reply = script[calls] ?? "narrate";
    if (reply === "ask") {
      sse(res, [ask()]);
    } else if (reply === "ask-nobody") {
      sse(res, [ask(["no-such-character"])]);
    } else if (reply === "narrate-and-ask") {
      sse(res, [{ content: NARRATION }, ask()]);
    } else if (reply === "narrate-and-buff") {
      sse(res, [{ content: NARRATION }, toolCall("cast_buff", { characterId: sheetId, spell: "Bless" })]);
    } else if (reply === "narrate-and-split") {
      sse(res, [
        { content: NARRATION },
        // The model's damage is dice the server rolls (src/lib/dm/ai-gate.ts).
        toolCall("split_damage", { dice: "1d4", type: "fire", targets: [{ characterId: sheetId, share: "full" }] }),
      ]);
    } else {
      sse(res, [{ content: NARRATION }]);
    }
    calls += 1;
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

function table(title, { fight }) {
  // An admin: only an admin's campaign runs on a backend address of its own
  // (src/lib/db/settings.ts), and this one talks to the fake model below.
  const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
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
  requests = [];
  const campaign = table(title, options);
  await startDmTurn(campaign.id);
  const dm = listRecentMessages(campaign.id, 20).filter((m) => m.authorType === "dm");
  return { text: dm[dm.length - 1]?.content ?? "", calls, requests };
}

// The tool results a request carried, by the call id they answer.
function toolResults(request) {
  return new Map(
    request.messages.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, JSON.parse(m.content)]),
  );
}

// Every assistant tool call in a request's history has a result after it: a
// strict endpoint (OpenAI) refuses the request otherwise.
function assertPaired(request) {
  const answered = new Set(request.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  for (const message of request.messages) {
    for (const call of message.role === "assistant" ? (message.tool_calls ?? []) : []) {
      assert.ok(answered.has(call.id), `tool call ${call.function?.name} (${call.id}) has no result`);
    }
  }
}

// The bug: in a fight, a reply that only asks gets no narration call.
const inFight = await run("Question in a fight", ["ask", "narrate"], { fight: true });
assert.ok(inFight.text.includes(NARRATION), `expected narration in a fight, got: ${inFight.text}`);
assert.equal(inFight.calls, 2, "the question-only reply should get exactly one narration call");
const fightNote = toolResults(inFight.requests[1]).get("call_request_player_input_0");
assert.equal(fightNote?.ok, true);
assert.match(fightNote.note, /put the question in your narration/, "in a fight the prompt shows nowhere; the note must say so");
console.log("ok: fight, question only -> narrated after 2 calls, told to ask in the narration");

// Unchanged: outside a fight the spotlight rescue still narrates.
const outside = await run("Question outside a fight", ["ask", "narrate"], { fight: false });
assert.ok(outside.text.includes(NARRATION), `expected narration outside a fight, got: ${outside.text}`);
assert.equal(outside.calls, 2);
assert.match(toolResults(outside.requests[1]).get("call_request_player_input_0")?.note ?? "", /The floor is theirs/);
console.log("ok: no fight, question only -> narrated after 2 calls (spotlight path)");

// Unchanged: a question that already comes with narration needs no extra call.
const both = await run("Question with narration in a fight", ["narrate-and-ask"], { fight: true });
assert.ok(both.text.includes(NARRATION));
assert.equal(both.calls, 1, "narration was already there; no extra call");
console.log("ok: fight, narration + question -> 1 call");

// A question naming no player's character sets no spotlight either.
const nobody = await run("Question to nobody", ["ask-nobody", "narrate"], { fight: false });
assert.ok(nobody.text.includes(NARRATION), `expected narration for a question to nobody, got: ${nobody.text}`);
assert.equal(nobody.calls, 2);
assert.equal(toolResults(nobody.requests[1]).get("call_request_player_input_0")?.ok, false, "nobody was handed the floor");
console.log("ok: question naming no player's character -> narrated after 2 calls");

// The last call is sent with toolChoice "none"; a server that answers it with
// a tool call anyway gets one more call with no tools offered.
const leak = await run("Tool call on the last call", Array(MAX_MODEL_CALLS).fill("ask"), { fight: false });
assert.ok(leak.text.includes(NARRATION), `expected narration after a leaked last call, got: ${leak.text}`);
assert.equal(leak.calls, MAX_MODEL_CALLS + 1);
assert.equal(leak.requests[MAX_MODEL_CALLS - 1].tool_choice, "none");
const rescue = leak.requests[MAX_MODEL_CALLS];
assert.equal(rescue.tools, undefined, "the rescue call offers no tools");
assert.match(rescue.messages.at(-1).content, /Tools are closed for this turn/);
for (const request of leak.requests) {
  assertPaired(request);
}
console.log(`ok: tool call on the last call -> narrated by a tool-less call ${MAX_MODEL_CALLS + 1}`);

// A leaked last call on a turn that already narrated costs nothing more.
const leakNarrated = await run(
  "Tool call on the last call after narration",
  Array(MAX_MODEL_CALLS).fill("narrate-and-buff"),
  { fight: false },
);
assert.ok(leakNarrated.text.includes(NARRATION));
assert.equal(leakNarrated.calls, MAX_MODEL_CALLS, "narration was already there; no rescue call");
console.log("ok: tool call on the last call after narration -> no rescue call");

// cast_buff alongside narration used to end the turn before its handler ran.
const buff = await run("Buff with narration", ["narrate-and-buff", "narrate"], { fight: false });
assert.equal(buff.calls, 2, "cast_buff needs the follow-up call its result is narrated from");
assert.ok(toolResults(buff.requests[1]).has("call_cast_buff_0"), "cast_buff never ran");
console.log("ok: narration + cast_buff -> the buff resolves and is narrated");

// split_damage likewise: the damage never landed.
const split = await run("Split damage with narration", ["narrate-and-split", "narrate"], { fight: true });
assert.equal(split.calls, 2, "split_damage needs the follow-up call its result is narrated from");
assert.ok(toolResults(split.requests[1]).has("call_split_damage_0"), "split_damage never ran");
const burned = getSheetById(sheetId).currentHp;
assert.ok(burned >= 8 && burned <= 11, `the 1d4 fire damage did not land (HP ${burned})`);
console.log("ok: narration + split_damage -> the damage lands");

server.close();
removeTempDir(dir);
console.log("PASS: a question-only reply is narrated, in a fight too, and no tool call is dropped.");
