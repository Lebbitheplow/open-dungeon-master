// Issue 305 on a disposable table: real DM turns through a fake backend that
// records what it was sent, so the checks read the prompt the model got, not
// a helper's output. A city's lore (four gates, one of them secret, a pinned
// entry, and unrelated entries) answers an ask for every way in with all four
// gates and nothing else, a lone question with its lone entry, and a window
// too small for everything with a block that says what it left out. The
// lore stays inside its measured budget and the prompt inside the window at
// every window tried. The embedder is a stand-in that reads words, so the
// meaning signal is live without a model download.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-lore-retrieval-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "65536";

// Hashed bag of content words, normalized: texts sharing words point the
// same way, and "the" or "what" do not make two texts alike.
const DIM = 384;
const FUNCTION_WORDS = new Set("the and are all what with from that this its his her our you your could would into need way any who how much does take".split(" "));
function toyVector(text) {
  const vector = new Array(DIM).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    if (FUNCTION_WORDS.has(word)) continue;
    const stem = word.replace(/(es|s)$/, "");
    vector[createHash("md5").update(stem).digest().readUInt16BE(0) % DIM] += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}
globalThis.__odmEmbedderPromise = Promise.resolve((texts) => Promise.resolve({ tolist: () => texts.map(toyVector) }));

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } = await import(
  "../src/lib/db/campaigns.ts"
);
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertLoreEntry, embedPendingLore } = await import("../src/lib/db/lore.ts");
const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { startDmTurn, dmTurnToolTokens } = await import("../src/lib/dm/turn.ts");
const { computeBudgets, promptWindowTokens } = await import("../src/lib/dm/context-budget.ts");
const { loreBudgetChars } = await import("../src/lib/dm/lore-selection.ts");

const requests = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "The wind turns off the walls and the torches gutter." }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const lead = createUser(`lore${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
const campaign = createCampaign(lead.id, {
  title: "The Walls of Vharn",
  description: "A disposable scene for the lore pick.",
  theme: "high-fantasy",
  maxPlayers: 2,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
updateStorySettings(campaign.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "fake", imageGenerationEnabled: false, autoImages: false });
setCampaignStatus(campaign.id, "active");
getDatabase().prepare(`UPDATE campaigns SET scene = ? WHERE id = ?`).run("Outside the walls of Vharn at dusk", campaign.id);
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

const lore = (title, body, extra = {}) => insertLoreEntry({ campaignId: campaign.id, category: "geography", title, body, tags: [], ...extra });
const GATES = [
  lore("The North Gate", "The North Gate of Vharn opens at dawn; the Watch checks every cart and turns away anyone without a writ."),
  lore("The Drowned Gate", "Where the river enters Vharn, an old gate lies half under water. Swimmers can pass beneath it at low tide.", { visibility: "dm" }),
  lore("The Tanners' Gate", "The tanners' gate stinks of lye. Its guards take bribes and look the other way after dark."),
  lore("The Old King's Gate", "Bricked up a century ago, the old king's gate still has a postern the smugglers use."),
];
const OTHERS = [
  lore("The Brewers' Guild", "The guild sets the price of ale in Vharn and collects dues from every tavern keeper."),
  lore("Moon Worship", "The moon cult meets in the reed beds and sings to the drowned."),
  lore("The Salt Road", "Caravans carry salt north along the old road, three weeks to the mountain passes."),
  lore("Harvest Festival", "At the end of summer the farmers burn a straw giant and dance until morning."),
  lore("The Lich of the Fens", "A lich sleeps beneath the fens and dreams of the kingdom it lost."),
  lore("The Ferryman", "The ferryman charges a silver piece a head and never speaks of what he saw on the water."),
];
const PINNED = lore("The Watch", "The city watch wears grey and answers to the Margravine; its captains know every face at the gates.", { category: "factions" });
getDatabase().prepare(`UPDATE lore_entries SET pinned = 1 WHERE id = ?`).run(PINNED.id);
await embedPendingLore(campaign.id);
await new Promise((resolve) => setTimeout(resolve, 50));

// A player line, then a DM turn; the lore block and the trace it left.
async function turnOn(line, window) {
  process.env.OPENAI_COMPAT_CONTEXT = String(window);
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: sheet.id, content: line });
  const before = requests.length;
  await startDmTurn(campaign.id);
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the turn finished (${turn.status})`);
  const sent = requests[before].messages.map((message) => String(message.content ?? "")).join("\n\n");
  const start = sent.indexOf("WORLD LORE (");
  const block = start < 0 ? "" : sent.slice(start, sent.indexOf("\n\n", start) < 0 ? undefined : sent.indexOf("\n\n", start));
  return { block, trace: turn.contextTrace, sent };
}
const titlesIn = (block, entries) => entries.filter((entry) => block.includes(`] ${entry.title}`)).map((entry) => entry.title);

await test("an ask for every way in brings the pinned entry, then all four gates, and nothing unrelated", async () => {
  const { block, trace } = await turnOn("We need a way into Vharn. What are all the gates we could use?", 65_536);
  assert.ok(block, "the prompt carries a WORLD LORE block");
  const lines = block.split("\n").slice(1);
  assert.ok(lines[0].includes("] The Watch:"), `the pinned entry comes first (${lines[0]})`);
  assert.deepEqual(titlesIn(block, GATES).sort(), GATES.map((entry) => entry.title).sort(), block);
  assert.deepEqual(titlesIn(block, OTHERS), [], `nothing unrelated rides (${JSON.stringify(trace.lore.picks.filter((pick) => pick.included))})`);
  assert.match(block, /The Drowned Gate \(SECRET: the party does not know this\)/);
  assert.ok(!/left out for room/.test(block), "nothing close was left out");
  // The inspector's record: every gate kept, with why; the secret marked.
  const picks = trace.lore.picks;
  assert.equal(picks.find((pick) => pick.id === PINNED.id)?.reason, "pinned");
  for (const gate of GATES) {
    const pick = picks.find((entry) => entry.id === gate.id);
    assert.ok(pick?.included, `${gate.title} kept`);
    assert.match(pick.reason, /^rank \d: the ask names it \("gate"\)/);
  }
  assert.equal(picks.find((pick) => pick.id === GATES[1].id).secret, true);
  assert.ok(picks.filter((pick) => !pick.included).every((pick) => pick.weak), "anything held back was only a near match");
});

await test("one question about one thing brings that entry alone beside the pinned one", async () => {
  const { block, trace } = await turnOn("How much does the ferryman charge to take us across?", 65_536);
  assert.deepEqual(titlesIn(block, [...GATES, ...OTHERS]), ["The Ferryman"], block);
  assert.ok(block.includes("] The Watch:"), "pinned behaviour unchanged");
  assert.equal(trace.lore.picks.filter((pick) => pick.included && !pick.pinned).length, 1);
});

await test("at every window the lore keeps to its measured budget and the prompt to the window", async () => {
  let previous = 0;
  for (const window of [16_384, 32_768, 49_152, 65_536, 131_072]) {
    const { block, trace } = await turnOn("Which gate is least watched after dark?", window);
    const tools = dmTurnToolTokens(getCampaignById(campaign.id));
    const expected = loreBudgetChars(computeBudgets(promptWindowTokens(window, tools)).retrieval, 0);
    assert.equal(trace.lore.budgetChars, expected, `${window}: the budget is measured from the window`);
    assert.ok(trace.lore.chars <= trace.lore.budgetChars, `${window}: ${trace.lore.chars} of ${trace.lore.budgetChars}`);
    assert.ok(block.length - block.indexOf("\n") <= trace.lore.budgetChars + 2, `${window}: the block itself fits`);
    assert.ok(trace.lore.budgetChars >= previous, "a larger window never shrinks it");
    previous = trace.lore.budgetChars;
    // Every window now: the whole request is fitted before each call
    // (src/lib/dm/request-fit.ts), and the small ones take the compact
    // tool set (src/lib/dm/tool-profiles.ts).
    for (const call of trace.calls ?? []) {
      assert.ok(call.promptTokens + call.outputTokens <= window, `${window}: call ${call.index} fits (${call.promptTokens} + ${call.outputTokens})`);
    }
    assert.ok((trace.calls ?? []).length >= 1, `${window}: the call was made`);
  }
});

await test("when the pinned entries fill a small window, what they crowd out is named, never implied complete", async () => {
  for (let index = 0; index < 4; index += 1) {
    const extra = lore(`Standing Order ${index + 1}`, `${"The Margravine's standing orders run long and leave nothing to chance. ".repeat(14)}`, { category: "factions" });
    getDatabase().prepare(`UPDATE lore_entries SET pinned = 1 WHERE id = ?`).run(extra.id);
  }
  await embedPendingLore(campaign.id);
  const { block, trace } = await turnOn("Tell me about every gate into the city.", 16_384);
  const tools = dmTurnToolTokens(getCampaignById(campaign.id));
  assert.equal(trace.lore.budgetChars, loreBudgetChars(computeBudgets(promptWindowTokens(16_384, tools)).retrieval, 0), "the budget is measured from the small window");
  const lines = block.split("\n").slice(1);
  const closing = lines.at(-1);
  assert.match(closing, /^Also bearing on this moment, left out for room \(search_lore reads them\): /, block);
  const out = trace.lore.picks.filter((pick) => !pick.included && !pick.weak);
  assert.ok(out.length >= 1, "something close was held back");
  for (const pick of out) {
    assert.match(pick.reason, /over the lore budget/);
    assert.ok(closing.includes(pick.title) || /and \d+ more\./.test(closing), `${pick.title} is named`);
  }
  assert.ok(trace.lore.chars <= trace.lore.budgetChars);
});

server.close();
removeTempDir(dir);
console.log(`test-lore-retrieval: ${passed} passed`);
