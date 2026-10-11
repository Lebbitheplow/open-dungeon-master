// A broken embedder degrades retrieval but never silently: the turn's rules
// and lore, the lore tool, the scene archive and the facts on file all still
// answer on words when the embedding call throws, and each says so in the
// log, without the text it was asked to embed.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-embed-failure-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

// Works while the table is set up, then breaks the way a model that fails
// to load does.
let broken = false;
globalThis.__odmEmbedderPromise = Promise.resolve((texts) => {
  if (broken) {
    return Promise.reject(new Error("the embedding model failed to load"));
  }
  return Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) });
});

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listMessagesInSeqRange } = await import("../src/lib/db/messages.ts");
const { insertLoreEntry, embedPendingLore } = await import("../src/lib/db/lore.ts");
const { insertFact } = await import("../src/lib/db/facts.ts");
const { ensureOpenChapter, closeChapterRow } = await import("../src/lib/db/chapters.ts");
const { buildTurnRetrieval } = await import("../src/lib/dm/context-retrieval.ts");
const { handleSearchLore } = await import("../src/lib/dm/lore-search.ts");
const { indexChapter, searchScenes } = await import("../src/lib/dm/memory-index.ts");
const { factsOnFileFor } = await import("../src/lib/dm/fact-consolidation.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const SECRET = "the Lich Queen's true name";
const lead = createUser(`lead-${randomBytes(3).toString("hex")}`, "x");
const campaignId = createCampaign(lead.id, {
  title: "Broken embedder", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal", gameSettings: {},
}).id;
updateStorySettings(campaignId, { textProvider: "harness", imageGenerationEnabled: false, autoImages: false });
setCampaignStatus(campaignId, "active");
insertLoreEntry({ campaignId, category: "history", title: "The Lich Queen", body: `Nobody speaks ${SECRET}.`, tags: [] });
await embedPendingLore(campaignId);
insertFact({ campaignId, category: "npc", subject: "Lich Queen", fact: `The Lich Queen hides ${SECRET}.`, source: "manual" });
const chapter = ensureOpenChapter(campaignId);
const seq = allocateSeq(campaignId);
insertCampaignMessage({ campaignId, seq, authorType: "player", content: `Who knows ${SECRET}?` });
closeChapterRow(chapter.id, { title: "The Lich Queen", summary: "The party heard of the Lich Queen.", highlights: [], seqEnd: seq });
await indexChapter(campaignId, chapter.id);
const messages = listMessagesInSeqRange(campaignId, chapter.seqStart, allocateSeq(campaignId));
broken = true;

// Every console.error line while `fn` runs.
async function errorsDuring(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...parts) => lines.push(parts.map(String).join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

function saidWithoutText(lines, tag) {
  assert.ok(lines.some((line) => line.includes(tag) && line.includes("embedding failed")), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes(SECRET)), "the text reached the log");
}

await test("the turn's retrieval still answers on words, and logs the failure", async () => {
  const { result, lines } = await errorsDuring(() => buildTurnRetrieval(getCampaignById(campaignId), messages));
  assert.match(result.loreBlock ?? JSON.stringify(result), /Lich Queen/);
  saidWithoutText(lines, "[context-retrieval]");
});

await test("the lore tool still finds the entry on words, and logs the failure", async () => {
  const { result, lines } = await errorsDuring(() => handleSearchLore(campaignId, JSON.stringify({ query: "Lich Queen" })));
  assert.match(JSON.stringify(result), /The Lich Queen/);
  saidWithoutText(lines, "[lore-search]");
});

await test("the scene archive still answers on words, and logs the failure", async () => {
  const { result, lines } = await errorsDuring(() => searchScenes(campaignId, "Lich Queen"));
  assert.ok(result.length > 0);
  saidWithoutText(lines, "[memory-index]");
});

await test("the facts on file are still shown, and the failure is logged", async () => {
  const { result, lines } = await errorsDuring(() => factsOnFileFor(campaignId, messages));
  assert.match(result.text, /Lich Queen/);
  saidWithoutText(lines, "[fact-consolidation]");
});

removeTempDir(dir);
console.log(`test-embed-failure: ${passed} passed`);
