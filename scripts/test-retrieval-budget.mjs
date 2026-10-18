// Per-turn retrieval, as the context audit found it
// (docs/agent-context-efficiency-audit-2026-10-17.md F12):
// - a long move kept its first 400 characters, so a name it ended on never
//   reached retrieval;
// - a rules document chosen to ride whole was rendered against a fixed 1,200
//   characters (five sections chosen, two shown), and rendering stopped at the
//   first section that did not fit;
// - the lore block kept an 800-character floor after the house rules had
//   spent the whole retrieval share;
// - the same query was embedded again on every turn, and a table with
//   nothing to rank by meaning still waited on the embedder.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-retrieval-budget-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "65536";
register("./lib/register-alias.mjs", import.meta.url);

// A stand-in embedder that counts what it is asked.
const embedded = [];
const stub = () =>
  Promise.resolve((texts) => {
    embedded.push(...texts);
    return Promise.resolve({ tolist: () => texts.map(() => Array.from({ length: 384 }, () => 0.05)) });
  });
globalThis.__odmEmbedderPromise = stub();

const { buildMoment, buildTurnRetrieval } = await import("../src/lib/dm/context-retrieval.ts");
const { renderHouseRulesWithTrace } = await import("../src/lib/dm/rules-logic.ts");
const { selectRuleChunks } = await import("../src/lib/dm/rules-activation-logic.ts");
const { loreBudgetChars, LORE_BUDGET_MIN } = await import("../src/lib/dm/lore-selection.ts");
const { embed, BACKGROUND_EMBED_BATCH } = await import("../src/lib/embeddings.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { setHouseRules, listRuleChunks, setRuleChunkFlags } = await import("../src/lib/db/rules.ts");
const { insertLoreEntry } = await import("../src/lib/db/lore.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

await test("a long move keeps the name it ends on", async () => {
  const move = `I lean on the bar and ${"tell the barkeep a long story about the road, the rain and the river. ".repeat(30)}Then I ask: where is Ilsabet Varr hiding?`;
  const moment = buildMoment({ scene: "The Drowned Lantern tavern" }, [
    { authorType: "dm", content: "The barkeep polishes a glass.", speech: [] },
    { authorType: "player", content: move, speech: [] },
  ]);
  assert.match(moment.query, /Ilsabet Varr/, "the end of the move reaches retrieval");
  assert.match(moment.ask, /Ilsabet Varr/);
  assert.match(moment.query, /^The Drowned Lantern tavern/);
  assert.match(moment.query, /I lean on the bar/, "and its start");
  assert.ok(moment.query.length <= 1_600, `bounded (${moment.query.length})`);
});

await test("a rules document chosen to ride whole is rendered whole", async () => {
  // The audit's reproduction: five sections, a 1,000-token retrieval share.
  const chunks = Array.from({ length: 5 }, (_, index) => ({
    id: `c${index}`,
    heading: `Rule ${index + 1}`,
    text: `${["Critical hits", "Potions", "Flanking", "Resting", "Inspiration"][index]}: ${`house rule ${index + 1} runs for a while about its own matter, `.repeat(12)}End of rule ${index + 1}.`,
    enabled: true,
    pinned: false,
    triggerKeywords: "",
  }));
  const activation = selectRuleChunks(chunks, "anything", 1_000);
  assert.equal(activation.verbatim, true, "the selector chose the whole document");
  const rendered = renderHouseRulesWithTrace(activation.forced, [], 1_000 * 4);
  assert.equal(rendered.shown.length, 5, `all five shown (${rendered.shown.length})`);
  for (let index = 1; index <= 5; index += 1) {
    assert.match(rendered.text, new RegExp(`End of rule ${index}\\.`));
  }
  assert.deepEqual(rendered.omitted, []);
});

await test("a section that does not fit is skipped, shorter ones still ride, and the left-out one is named", async () => {
  const long = { id: "long", heading: "Grand Tourney Rules", text: "x".repeat(2_000), enabled: true, pinned: true, triggerKeywords: "" };
  const short = { id: "short", heading: "Short Rests", text: "A short rest takes ten minutes.", enabled: true, pinned: true, triggerKeywords: "" };
  const near = { id: "near", heading: "Near match", text: "y".repeat(3_000), enabled: true, pinned: false, triggerKeywords: "" };
  const rendered = renderHouseRulesWithTrace([long, short], [near], 600);
  assert.deepEqual(rendered.shown, ["Short Rests"], "the shorter pinned section after it still rides");
  assert.deepEqual(rendered.omitted, ["Grand Tourney Rules"], "the always-on section left out is named");
  assert.match(rendered.text, /Also in effect, left out here for room: Grand Tourney Rules/);
  assert.ok(!rendered.text.includes("Near match"), "a retrieved near match simply waits");
});

await test("lore gets no floor once the house rules spent the share", async () => {
  assert.equal(loreBudgetChars(100, 5_000), 0, "the share is spent");
  assert.equal(loreBudgetChars(0, 0), LORE_BUDGET_MIN, "a small window with no house rules keeps the floor");
  assert.equal(loreBudgetChars(2_000, 3_000), 5_000, "house rules come off the share");
  assert.equal(loreBudgetChars(100, 300), LORE_BUDGET_MIN - 300, "the floor counts the house rules against it");
});

await test("the same query is embedded once; two asking at once share one embed", async () => {
  embedded.length = 0;
  await embed(["where is the miller?"], { query: true });
  await embed(["where is the miller?"], { query: true });
  assert.equal(embedded.length, 1, "the second ask reused the vector");
  await Promise.all([embed(["who lit the fire?"], { query: true }), embed(["who lit the fire?"], { query: true })]);
  assert.equal(embedded.filter((text) => text === "who lit the fire?").length, 1, "concurrent asks shared one embed");
  await embed(["where is the miller?"]);
  assert.equal(embedded.filter((text) => text === "where is the miller?").length, 2, "indexing never reads the query cache");
  globalThis.__odmEmbedderPromise = stub();
  await embed(["where is the miller?"], { query: true });
  assert.equal(embedded.filter((text) => text === "where is the miller?").length, 3, "a reloaded embedder starts afresh");
});

await test("background indexing goes in small batches a turn's query can pass", async () => {
  embedded.length = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const order = [];
  globalThis.__odmEmbedderPromise = Promise.resolve(async (texts) => {
    order.push(texts.length > 1 ? `batch of ${texts.length}` : texts[0]);
    if (texts.length > 1 && order.length === 1) await gate;
    return { tolist: () => texts.map(() => Array.from({ length: 384 }, () => 0.05)) };
  });
  const indexing = embed(Array.from({ length: 20 }, (_, index) => `document ${index}`), { background: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const query = embed(["the turn's query"], { query: true });
  release();
  await Promise.all([indexing, query]);
  assert.equal(order[0], `batch of ${BACKGROUND_EMBED_BATCH}`);
  assert.equal(order[1], "the turn's query", "the query went between batches, not after all twenty");
  globalThis.__odmEmbedderPromise = stub();
});

await test("a table with nothing to rank by meaning waits on no embedder", async () => {
  const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
  const created = createCampaign(lead.id, { title: "Small rules", description: "d", theme: "t", maxPlayers: 2, startingLevel: 1, difficulty: "normal", gameSettings: {} });
  setHouseRules(created.id, "## Critical hits\nA natural 20 doubles the dice.\n\n## Potions\nDrinking a potion is a bonus action.");
  const pinned = insertLoreEntry({ campaignId: created.id, category: "geography", title: "The Ford", body: "A cold ford.", tags: [] });
  getDatabase().prepare(`UPDATE lore_entries SET pinned = 1, embedding = ? WHERE id = ?`).run(Buffer.alloc(384 * 4), pinned.id);
  for (const chunk of listRuleChunks(created.id)) {
    getDatabase().prepare(`UPDATE rule_chunks SET embedding = ? WHERE id = ?`).run(Buffer.alloc(384 * 4), chunk.id);
  }
  const campaign = getCampaignById(created.id);
  const history = [{ authorType: "player", content: "I drink a potion.", speech: [] }];
  // Saving rules and lore indexes them in the background; let that finish.
  await new Promise((resolve) => setTimeout(resolve, 300));
  embedded.length = 0;
  const retrieval = await buildTurnRetrieval(campaign, history, 0);
  assert.equal(embedded.length, 0, "the whole rules document rides and the lore is all pinned: nothing embedded");
  assert.match(retrieval.houseRulesBlock, /Critical hits/);
  assert.match(retrieval.houseRulesBlock, /Potions/);
  assert.match(retrieval.loreBlock, /The Ford/);
  assert.deepEqual(retrieval.rulesTrace.omitted, []);
  // An unpinned entry to rank: now the moment is embedded.
  const other = insertLoreEntry({ campaignId: created.id, category: "geography", title: "The Mill", body: "A burnt mill.", tags: [] });
  getDatabase().prepare(`UPDATE lore_entries SET embedding = ? WHERE id = ?`).run(Buffer.alloc(384 * 4), other.id);
  await new Promise((resolve) => setTimeout(resolve, 300));
  embedded.length = 0;
  await buildTurnRetrieval(campaign, history, 0);
  assert.ok(embedded.length >= 1, "lore to rank brings the embedder back");
  setRuleChunkFlags(created.id, listRuleChunks(created.id)[0].id, { pinned: true });
});

removeTempDir(dir);
console.log(`retrieval-budget: ${passed} tests passed`);
