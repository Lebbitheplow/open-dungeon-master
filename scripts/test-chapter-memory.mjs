// What a table remembers when its window is small and its summarizer fails
// (docs/agent-context-efficiency-audit-2026-10-17.md F05, F06):
// 1. a promise made early in a long first chapter, on a 16K window, with the
//    chapter summary call failing: the chapter closes, keeps a record from
//    the server's own milestones, the running summary and its mark stay, and
//    the next turn's prompt still carries the promise;
// 2. a long chapter that does get summarized is read whole, in budgeted
//    spans condensed first, not just its last 24,000 characters;
// 3. lines a turn left out are folded as soon as they fall out of the
//    window, in a batch the utility window holds, not at 120 messages.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-chapter-memory-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "16384";
register("./lib/register-alias.mjs", import.meta.url);

const {
  chunkLines,
  extractiveChapterSummary,
  spanTokensFor,
  transcriptBudgetTokens,
  FINAL_SPAN_TOKENS,
  MAX_CONDENSED_SPANS,
} = await import("../src/lib/dm/chapter-summary-logic.ts");
const { estimateTokens } = await import("../src/lib/dm/context-budget.ts");

// ---- pure: spans and the record kept without a summary -----------------------------
{
  const lines = Array.from({ length: 40 }, (_, index) => `Line ${index}: ${"x".repeat(2_000)}`);
  const spans = chunkLines(lines, 2_000);
  assert.deepEqual(spans.flat(), lines, "every line, in order");
  for (const span of spans) {
    assert.ok(span.reduce((sum, line) => sum + estimateTokens(line) + 1, 0) <= 2_000);
  }
  const huge = chunkLines([`START ${"y".repeat(50_000)} END`], 1_000);
  assert.equal(huge.length, 1);
  assert.ok(estimateTokens(huge[0][0]) <= 1_000, "one line longer than a span is cut to it");
  assert.ok(huge[0][0].startsWith("START") && huge[0][0].endsWith("END"));
  assert.equal(spanTokensFor(10_000, 50_000), FINAL_SPAN_TOKENS, "a short chapter reads in the usual span");
  const long = spanTokensFor(100_000, 50_000);
  assert.ok(Math.ceil(100_000 / long) <= MAX_CONDENSED_SPANS + 1, "a long one grows its spans to bound the calls");
  assert.ok(spanTokensFor(100_000, 3_000) <= 3_000, "never past what one call carries");
  assert.ok(transcriptBudgetTokens(16_384, 2_000, 1_600) < 16_384 - 3_600);
  assert.equal(transcriptBudgetTokens(2_000, 3_000, 1_600), 0);
  const kept = extractiveChapterSummary({ running: "The party reached the mill.", milestones: ["[story] Bram swore the Silver Oath"], lastNarration: "Rain hammers the shutters." });
  assert.match(kept, /reached the mill/);
  assert.match(kept, /Silver Oath/);
  assert.match(kept, /Where it ended: Rain/);
  assert.match(kept, /could not be written/);
  assert.equal(extractiveChapterSummary({ running: "", milestones: [], lastNarration: "" }), "");
  console.log("ok: spans hold every line in order, and the record kept without a summary is bounded and marked");
}

// ---- a fake backend whose summarizer can fail ------------------------------------
const requests = [];
let failChapter = true;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);
    const system = String(body.messages?.[0]?.content ?? "");
    const reply = (content) => {
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }));
    };
    if (system.includes("closing a chapter") || system.includes("condense one part")) {
      if (failChapter) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "summarizer down" }));
        return;
      }
      if (system.includes("condense one part")) {
        reply("The party bargained at the gate and swore oaths.");
        return;
      }
      reply(JSON.stringify({ title: "The Gate", summary: "The party made its way to the gate and kept its word.", highlights: ["They reached the gate."], facts: [] }));
      return;
    }
    if (system.includes("canonical campaign memory")) {
      reply("Earlier, Bram swore the Silver Oath to Mara at the ford.");
      return;
    }
    reply("The guard looks up. What do you do?");
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq, getCampaignSummaryState, setCampaignSummaryState } =
  await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, countMessages } = await import("../src/lib/db/messages.ts");
const { insertCharacterEvent } = await import("../src/lib/db/character-events.ts");
const { listChapters } = await import("../src/lib/db/chapters.ts");
const { maybeCloseChapter } = await import("../src/lib/dm/chapter-close.ts");
const { maybeCompactHistory } = await import("../src/lib/dm/compaction.ts");
const { startDmTurn } = await import("../src/lib/dm/turn.ts");
const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");

const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
function table(title, lines, promiseAt = 1, recordMilestone = true) {
  const campaign = createCampaign(lead.id, { title, description: "A test of memory.", theme: "a ford", maxPlayers: 2, startingLevel: 1, difficulty: "normal", gameSettings: { ttsEnabled: false } });
  updateStorySettings(campaign.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "fake", imageGenerationEnabled: false, autoImages: false });
  setCampaignStatus(campaign.id, "active");
  const sheet = createSheet(campaign.id, lead.id, 1, createSheetSchema.parse({
    name: "Bram", race: "human", class: "fighter", abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, maxHp: 12, ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
  }));
  for (let index = 0; index < lines; index += 1) {
    const seq = allocateSeq(campaign.id);
    const promise = index === promiseAt;
    insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: index % 2 ? "dm" : "player",
      userId: index % 2 ? null : lead.id,
      characterId: index % 2 ? null : sheet.id,
      content: promise
        ? "Mara takes your hand: 'Swear the Silver Oath that you will bring the ring back by midsummer.' Bram swears it."
        : `Line ${index}. ${"The ford runs cold and the reeds whisper of bandits on the far bank. ".repeat(10)}`,
    });
    if (promise && recordMilestone) {
      insertCharacterEvent({ libraryCharacterId: sheet.libraryCharacterId, campaignCharacterId: sheet.id, campaignId: campaign.id, seq: allocateSeq(campaign.id), kind: "story", summary: "Bram swore the Silver Oath to bring Mara's ring back by midsummer." });
    }
  }
  // The newest line is the player's, so a turn has something to answer.
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: sheet.id, content: "I ask the guard what he saw." });
  return getCampaignById(campaign.id);
}

// ---- 1. a failed summary keeps the chapter ---------------------------------------------
{
  failChapter = true;
  // The promise is only in the transcript: no milestone was recorded for it.
  const campaign = table("Failed summary", 90, 1, false);
  requests.length = 0;
  await startDmTurn(campaign.id);
  const opening = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.ok(opening.contextTrace.historyEvicted >= 8, `on 16K the early lines fell out of the prompt (${opening.contextTrace.historyEvicted})`);
  const promiseVisible = (body) => JSON.stringify(body.messages).includes("Silver Oath");
  assert.equal(promiseVisible(requests[0]), false, "and the promise with them");

  // The turn folds what fell out in the background, without waiting for the
  // old 120-message threshold.
  for (let wait = 0; wait < 100 && !getCampaignSummaryState(campaign.id).coveredCount; wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const folded = getCampaignSummaryState(campaign.id);
  assert.ok(folded.coveredCount > 0, "the lines that fell out were folded");
  assert.match(folded.summary, /Silver Oath/, "and the promise is in the running summary");

  await maybeCloseChapter(campaign.id, { beatCompleted: false, manual: true });
  const closed = listChapters(campaign.id).find((chapter) => chapter.status === "closed");
  assert.ok(closed, "the chapter closed anyway");
  assert.match(closed.summary, /Silver Oath/, "its record carries the promise from the running summary");
  assert.match(closed.summary, /could not be written/);
  assert.deepEqual(getCampaignSummaryState(campaign.id), folded, "the running summary and its mark were left in place");

  // The next turn: the promise is still in front of the model.
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: null, content: "What did I promise Mara?" });
  requests.length = 0;
  await startDmTurn(campaign.id);
  const next = requests.find((body) => Array.isArray(body.tools));
  assert.ok(next, "the next turn called the model");
  assert.ok(promiseVisible(next), "the promise is in the next turn's prompt");
  console.log("ok: lines that fell out are folded, a failed summary closes the chapter with a record, and the promise survives");
}

// ---- 1b. a failed summary with nothing folded keeps the server's milestones -----------
{
  failChapter = true;
  const campaign = table("Milestone only", 20, 1, true);
  await maybeCloseChapter(campaign.id, { beatCompleted: false, manual: true });
  const closed = listChapters(campaign.id).find((chapter) => chapter.status === "closed");
  assert.match(closed.summary, /Silver Oath/, "the recorded milestone is in the chapter's record");
  assert.match(closed.summary, /Where it ended/);
  assert.equal(getCampaignSummaryState(campaign.id).coveredCount, 0, "nothing claims to cover the chapter's play");
  console.log("ok: with no running summary, the record keeps the server's milestones and where play ended");
}

// ---- 2. a long chapter is read whole, in spans -----------------------------------------
{
  failChapter = false;
  const campaign = table("Long chapter", 110, 1);
  requests.length = 0;
  await maybeCloseChapter(campaign.id, { beatCompleted: false, manual: true });
  const spanCalls = requests.filter((body) => String(body.messages[0].content).includes("condense one part"));
  const closing = requests.find((body) => String(body.messages[0].content).includes("closing a chapter"));
  assert.ok(spanCalls.length >= 1, `the chapter was condensed in spans first (${spanCalls.length})`);
  assert.ok(String(spanCalls[0].messages[1].content).includes("Silver Oath"), "the first span holds the chapter's start");
  assert.match(String(closing.messages[1].content), /Earlier in this chapter, condensed in order/);
  for (const body of [...spanCalls, closing]) {
    const tokens = Math.ceil(JSON.stringify(body.messages).length / 4);
    assert.ok(tokens + (body.max_tokens ?? 0) <= 16_384, `each call fits the window (${tokens} + ${body.max_tokens})`);
  }
  const closed = listChapters(campaign.id).find((chapter) => chapter.status === "closed");
  assert.equal(closed.title, "The Gate");
  assert.deepEqual(getCampaignSummaryState(campaign.id).summary, "", "a real summary takes over: the running one restarts");
  console.log(`ok: a long chapter is condensed in ${spanCalls.length} span(s) and closed from the whole of it`);
}

// ---- 3. lines that fell out are folded when they fall out -----------------------------
{
  process.env.OPENAI_COMPAT_CONTEXT = "8192";
  const campaign = table("Eviction", 30, 3);
  requests.length = 0;
  assert.ok(countMessages(campaign.id) < 120, "well under the old threshold");
  assert.equal(await maybeCompactHistory(campaign.id, { evicted: 2 }), true);
  assert.equal(requests.length, 0, "a couple of lines out is not worth a call");
  assert.equal(await maybeCompactHistory(campaign.id, { evicted: 20 }), true);
  const fold = requests.find((body) => String(body.messages[0].content).includes("canonical campaign memory"));
  assert.ok(fold, "twenty lines out are folded now");
  const tokens = Math.ceil(JSON.stringify(fold.messages).length / 4);
  assert.ok(tokens + (fold.max_tokens ?? 0) <= 8_192, `the batch fits the utility window (${tokens} + ${fold.max_tokens})`);
  const state = getCampaignSummaryState(campaign.id);
  assert.ok(state.coveredCount >= 8 && state.coveredCount <= 20, `the oldest lines are covered (${state.coveredCount})`);
  assert.match(state.summary, /Silver Oath/);
  setCampaignSummaryState(campaign.id, "", 0);
  console.log(`ok: lines that fell out of an 8K window are folded at once, ${state.coveredCount} in a batch that fits`);
}

server.close();
removeTempDir(dir);
console.log("chapter-memory: all passed");
