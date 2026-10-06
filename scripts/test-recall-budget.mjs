// Recall's chapter text against a real campaign: recall_story, Ask and the
// lore check fit the chapters they match into the model's chapter budget
// (src/lib/dm/chapter-lod.ts fitChaptersToBudget), so a stored summary of up
// to 8,000 characters reaches a small window as its first sentence and a
// large one whole. A recall_story query points at chapters without their
// summaries. Ask and the lore check run on the fake harness, whose log holds
// exactly what the model would have been sent.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-recall-budget-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.HARNESS_FAKE = "1";
process.env.HARNESS_FAKE_SCRIPT = path.join(dir, "script.json");
fs.writeFileSync(process.env.HARNESS_FAKE_SCRIPT, JSON.stringify([[{ text: "{}" }]]));
process.env.DM_THINKING = "0";

register("./lib/register-alias.mjs", import.meta.url);

// One vector for every text: scene recall finds every scene, with no model on disk.
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { ensureOpenChapter, closeChapterRow } = await import("../src/lib/db/chapters.ts");
const { indexChapter } = await import("../src/lib/dm/memory-index.ts");
const { handleRecallStory } = await import("../src/lib/dm/recall.ts");
const { runAsk } = await import("../src/lib/dm/ask.ts");
const { runLoreCheck } = await import("../src/lib/dm/lore-check.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const lead = createUser("rowan", "x");
saveGlobalConfig({ harness: { id: "claude", model: "fake-model", campaigns: "all" }, text: { provider: "harness" } });
const campaign = createCampaign(lead.id, {
  title: "The Lantern Mill",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: {},
});
updateStorySettings(campaign.id, { textProvider: "harness", imageGenerationEnabled: false, autoImages: false });
setCampaignStatus(campaign.id, "active");

// Two sealed chapters with summaries at the 8,000 characters storage keeps,
// six highlights each at their 300.
const opening = (index) => `The party burned the Lantern Mill in chapter ${index}.`;
const summaryOf = (index) => `${opening(index)} ${"The ash settled over the ford. ".repeat(260)}`.slice(0, 8_000);
let lastDm = null;
for (const index of [1, 2]) {
  const chapter = ensureOpenChapter(campaign.id);
  for (let line = 0; line < 4; line += 1) {
    lastDm = insertCampaignMessage({
      campaignId: campaign.id,
      seq: allocateSeq(campaign.id),
      authorType: "dm",
      content: `Chapter ${index}, scene ${line}: the Lantern Mill burns while the miller shouts at the river. `.repeat(8),
    });
  }
  const closed = closeChapterRow(chapter.id, {
    title: `The Lantern Mill, part ${index}`,
    summary: summaryOf(index),
    highlights: Array.from({ length: 6 }, (_, at) => `Highlight ${at}: ${"h".repeat(280)}`),
    seqEnd: allocateSeq(campaign.id) - 1,
  });
  await indexChapter(campaign.id, closed.closed.id);
}

// The window every model here packs against: the harness reads HARNESS_CONTEXT
// (8,000 at the least), so one variable sets both the story and utility model.
const atWindow = async (tokens, fn) => {
  if (tokens) {
    process.env.HARNESS_CONTEXT = String(tokens);
  } else {
    delete process.env.HARNESS_CONTEXT;
  }
  await fn();
  delete process.env.HARNESS_CONTEXT;
};
// The chapter lines sent, whichever chapter the recall matched: every scene
// ties under the one-vector embedder, so that is not fixed.
const chapterLines = (sent) =>
  [...sent.matchAll(/\[chapter:(\d)\] "The Lantern Mill, part \d": ([^\n]*)/g)].map((match) => ({
    index: Number(match[1]),
    text: match[2],
  }));
const assertShortened = (sent) => {
  const lines = chapterLines(sent);
  assert.ok(lines.length > 0, "no chapter was sent");
  for (const line of lines) {
    assert.equal(line.text, opening(line.index), "a whole summary reached a small window");
  }
};
const assertWhole = (sent) => {
  const lines = chapterLines(sent);
  assert.ok(lines.length > 0, "no chapter was sent");
  for (const line of lines) {
    assert.equal(line.text, summaryOf(line.index), "a large window lost the whole summary");
  }
};
const sentToModel = () =>
  (globalThis.__odmFakeHarnessLog ?? [])
    .filter((entry) => entry.kind === "start" || entry.kind === "prompt")
    .map((entry) => (entry.kind === "start" ? entry.detail.system ?? "" : String(entry.detail)))
    .join("\n");

await test("a recall_story query points at chapters without their summaries", async () => {
  const result = await handleRecallStory(getCampaignById(campaign.id), JSON.stringify({ query: "the Lantern Mill fire" }));
  assert.ok(result.scenes.length > 0);
  assert.ok(result.chapters.length > 0);
  for (const chapter of result.chapters) {
    assert.deepEqual(Object.keys(chapter).sort(), ["chapter", "title"]);
  }
  assert.ok(!JSON.stringify(result).includes("The ash settled"), "a summary rode along");
});

await test("recall_story by number fits the chapter to the window", async () => {
  await atWindow(8_000, async () => {
    const small = await handleRecallStory(getCampaignById(campaign.id), JSON.stringify({ chapter: 1 }));
    assert.equal(small.shortened, true);
    assert.equal(small.summary, opening(1));
    assert.deepEqual(small.highlights, []);
  });
  await atWindow(null, async () => {
    const large = await handleRecallStory(getCampaignById(campaign.id), JSON.stringify({ chapter: 1 }));
    assert.equal(large.shortened, undefined);
    assert.equal(large.summary, summaryOf(1));
    assert.equal(large.highlights.length, 6);
  });
});

await test("Ask sends a small window the chapters' first sentences and a large one their whole summaries", async () => {
  const ask = () => runAsk({ campaignId: campaign.id, userId: lead.id, question: "What happened at the Lantern Mill back then?", scope: "story" });
  await atWindow(8_000, async () => {
    globalThis.__odmFakeHarnessLog = [];
    await ask();
    assertShortened(sentToModel());
  });
  await atWindow(null, async () => {
    globalThis.__odmFakeHarnessLog = [];
    await ask();
    assertWhole(sentToModel());
  });
});

await test("the lore check does the same", async () => {
  const check = () =>
    runLoreCheck({ campaignId: campaign.id, messageId: lastDm.id, selection: "The Lantern Mill never burned.", category: "contradicts_lore" });
  await atWindow(8_000, async () => {
    globalThis.__odmFakeHarnessLog = [];
    await check();
    assertShortened(sentToModel());
  });
  await atWindow(null, async () => {
    globalThis.__odmFakeHarnessLog = [];
    await check();
    assertWhole(sentToModel());
  });
});

console.log(`test-recall-budget: ${passed} tests passed`);
removeTempDir(dir);
