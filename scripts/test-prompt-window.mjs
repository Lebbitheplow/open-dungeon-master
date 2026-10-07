// Issue #120: the DM prompt was packed against the model's whole window, with
// the tool definitions (~27K tokens on every call) and a thinking model's
// reasoning unaccounted for, so a 64K local model got ~1K to answer in and
// stopped at its output cap. The budget now takes the tool definitions and a
// window-scaled reply reserve off the window before any block is packed.
//
// Two turns through a fake OpenAI-compatible backend that records what it was
// sent:
// 1. a long transcript on a 48K window: the request's messages plus tools, by
//    the budget's own estimate, fit the window less the reply reserve, and the
//    trace names the tool definitions;
// 2. an empty reply with finish_reason "length": the turn logs the cause.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-prompt-window-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
const WINDOW = 48_000;
process.env.OPENAI_COMPAT_CONTEXT = String(WINDOW);

register("./lib/register-alias.mjs", import.meta.url);

const { estimateTokens, responseReserveTokens, computeBudgets, promptWindowTokens } = await import("../src/lib/dm/context-budget.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } =
  await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { startDmTurn, dmTurnToolTokens } = await import("../src/lib/dm/turn.ts");

let mode = "narrate";
const requests = [];
function sse(res, deltas, finish = "stop") {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (mode === "length") {
      // A thinking model that ran out of room: no text, no tool call.
      sse(res, [], "length");
      return;
    }
    sse(res, [{ content: "The bandit circles warily, blade low, waiting for an opening." }]);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
function table(title, lines) {
  const campaign = createCampaign(lead.id, {
    title,
    description: "A test of the prompt window.",
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
  for (let index = 0; index < lines; index += 1) {
    insertCampaignMessage({
      campaignId: campaign.id,
      seq: allocateSeq(campaign.id),
      authorType: index % 2 ? "dm" : "player",
      userId: index % 2 ? null : lead.id,
      characterId: index % 2 ? null : sheet.id,
      content: `Line ${index}. ${"The ford runs cold and the reeds whisper of bandits on the far bank. ".repeat(12)}`,
    });
  }
  return getCampaignById(campaign.id);
}

// ---- 1. the packed prompt leaves the reserve -----------------------------------
{
  const campaign = table("Long transcript", 81);
  const toolTokens = dmTurnToolTokens(campaign);
  assert.ok(toolTokens > 15_000, `the tool set is a real cost (${toolTokens} tokens)`);
  await startDmTurn(campaign.id);
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the turn finished (${turn.status})`);
  const request = requests[0];
  assert.ok(request.tools?.length > 50, "the full tool set went out");
  const sent =
    estimateTokens(JSON.stringify(request.messages)) + estimateTokens(JSON.stringify(request.tools));
  const reserve = responseReserveTokens(WINDOW);
  assert.equal(reserve, 6_000, "a 48K window reserves one eighth for the reply");
  assert.ok(
    sent <= WINDOW - reserve,
    `messages plus tools (${sent} tokens) fit the window less the reply reserve (${WINDOW - reserve})`,
  );
  // The transcript was cut to the share of the reduced window, not the whole one.
  const kept = request.messages.filter((m) => /^Line \d+\./.test(String(m.content ?? "").replace(/^\[[^\]]*\] /, ""))).length;
  const historyBudget = computeBudgets(promptWindowTokens(WINDOW, toolTokens)).history;
  const perLine = estimateTokens(`[Bram | attempt] Line 0. ${"The ford runs cold and the reeds whisper of bandits on the far bank. ".repeat(12)}`);
  assert.ok(kept <= Math.floor(historyBudget / perLine) + 1, `kept ${kept} lines against a ${historyBudget}-token transcript share`);
  assert.ok(kept < 81, "older lines were dropped");
  // The trace shows the tools and counts them in both figures.
  const trace = turn.contextTrace;
  const tools = trace.blocks.find((block) => block.kind === "tools");
  assert.ok(tools, "the trace has a tool-definitions row");
  assert.equal(tools.tokens, toolTokens);
  assert.ok(trace.promptTokens > toolTokens, "the prompt figure includes the tools");
  assert.ok(trace.limitTokens <= WINDOW - reserve, `the limit shown (${trace.limitTokens}) is the window less the reserve`);
  assert.ok(trace.promptTokens <= trace.limitTokens, `the trace is within its own limit (${trace.promptTokens} of ${trace.limitTokens})`);
  console.log(`ok: ${sent} tokens of messages and tools sent against a ${WINDOW} window; ${kept} of 81 lines kept; trace ${trace.promptTokens}/${trace.limitTokens}`);
}

// ---- 2. an empty reply at the output cap is named -------------------------------
{
  mode = "length";
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(" "));
  };
  try {
    const campaign = table("Out of room", 5);
    await startDmTurn(campaign.id);
  } finally {
    console.warn = warn;
  }
  const named = warnings.filter((line) => line.includes("finish_reason=length"));
  assert.ok(named.length >= 1, "the output cap is named in the log");
  assert.match(named[0], /packed at ~\d+ of \d+ tokens/, "with the prompt's size");
  console.log("ok: an empty reply at the output cap is logged with the prompt size");
}

server.close();
removeTempDir(dir);
console.log("prompt-window: all passed");
