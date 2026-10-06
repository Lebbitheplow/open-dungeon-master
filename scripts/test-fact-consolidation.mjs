// Fact consolidation: the extraction calls see the facts on file under
// handles and may say a new fact replaces one, or that one is now false or
// repeats another (src/lib/dm/fact-consolidation-logic.ts). Only a shown,
// unpinned fact of the same campaign is ever retired; an unreadable reply
// retires nothing. The chapter-close case runs on the fake harness.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-fact-consolidation-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.HARNESS_FAKE = "1";
process.env.HARNESS_FAKE_SCRIPT = path.join(dir, "script.json");
process.env.DM_THINKING = "0";

register("./lib/register-alias.mjs", import.meta.url);

// One vector for every text, so no model is loaded: ranking falls to words.
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const { renderFactsOnFile, consolidationRetirements } = await import("../src/lib/dm/fact-consolidation-logic.ts");
const { RENDER_CHAR_BUDGET } = await import("../src/lib/dm/fact-logic.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage, listMessagesInSeqRange } = await import("../src/lib/db/messages.ts");
const { insertFact, getFactById, retireFacts } = await import("../src/lib/db/facts.ts");
const { factsOnFileFor } = await import("../src/lib/dm/fact-consolidation.ts");
const { maybeCloseChapter } = await import("../src/lib/dm/chapter-close.ts");
const { ensureOpenChapter } = await import("../src/lib/db/chapters.ts");
const { removeTempDir } = await import("./lib/remove-temp-dir.mjs");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// ---- the pure rules ---------------------------------------------------------

const onFile = (id, category, fact) => ({ id, category, subject: "", fact });

await test("facts on file get handles in the order given, within the fact sheet's budget and per-category cap", () => {
  const facts = [
    ...Array.from({ length: 8 }, (_, at) => onFile(`npc-${at}`, "npc", `Person ${at} lives by the ford.`)),
    onFile("loc-1", "location", "The mill stands by the river."),
  ];
  const { text, shown } = renderFactsOnFile(facts);
  // Six people at most, then the place: handles follow what is shown.
  assert.deepEqual(shown.map((fact) => fact.id), ["npc-0", "npc-1", "npc-2", "npc-3", "npc-4", "npc-5", "loc-1"]);
  assert.deepEqual(shown.map((fact) => fact.handle), ["f1", "f2", "f3", "f4", "f5", "f6", "f7"]);
  assert.match(text, /^\[f1\] \[People\] Person 0 lives by the ford\.$/m);
  assert.match(text, /^\[f7\] \[Places\] The mill stands by the river\.$/m);
  const long = Array.from({ length: 40 }, (_, at) => onFile(`w-${at}`, ["world", "lore", "party", "promise", "npc", "location"][at % 6], "x".repeat(290)));
  assert.ok(renderFactsOnFile(long).text.length <= RENDER_CHAR_BUDGET, "past the fact sheet's budget");
});

await test("a reply retires the shown facts it replaces or lists, and nothing else", () => {
  const shown = [
    { handle: "f1", id: "a" },
    { handle: "f2", id: "b" },
  ];
  const reply = '```json\n{"facts": [{"category": "party", "subject": "Kara", "fact": "Kara lost the key.", "replaces": "f1"}], "retire": ["f2", "f9", 4]}\n```';
  assert.deepEqual(consolidationRetirements(reply, shown).sort(), ["a", "b"]);
  assert.deepEqual(consolidationRetirements('{"facts": [], "retire": ["f1", "f1"]}', shown), ["a"]);
  for (const unreadable of ["", "no json here", '{"retire": ["f1"', '{"retire": "f1"}']) {
    assert.deepEqual(consolidationRetirements(unreadable, shown), []);
  }
});

// ---- against a real campaign ------------------------------------------------

const lead = createUser("rowan", "x");
saveGlobalConfig({ harness: { id: "claude", model: "fake-model", campaigns: "all" }, text: { provider: "harness" } });
const table = (title) => {
  const campaign = createCampaign(lead.id, { title, description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal", gameSettings: {} });
  updateStorySettings(campaign.id, { textProvider: "harness", imageGenerationEnabled: false, autoImages: false });
  setCampaignStatus(campaign.id, "active");
  return campaign.id;
};
const mine = table("The Bronze Key");
const theirs = table("Elsewhere");
const fact = (campaignId, category, subject, text, pinned = false) =>
  insertFact({ campaignId, category, subject, fact: text, source: "manual", pinned }).id;

const keyFact = fact(mine, "party", "Kara", "Kara carries the bronze key.");
const repeated = fact(mine, "location", "", "The mill stands by the river.");
const repeat = fact(mine, "location", "", "By the river stands the mill.");
const pinnedFact = fact(mine, "world", "", "The bell has rung for eighty years.", true);
const elsewhere = fact(theirs, "party", "Kara", "Kara carries the bronze key.");

for (let at = 0; at < 6; at += 1) {
  insertCampaignMessage({
    campaignId: mine,
    seq: allocateSeq(mine),
    authorType: at % 2 ? "dm" : "player",
    content: at === 5 ? "Kara drops the bronze key into the lake, and the mill by the river burns." : `Kara walks toward the mill, step ${at}.`,
  });
}

await test("only the campaign's own facts are shown, nearest to the passage first", async () => {
  const chapter = ensureOpenChapter(mine);
  const messages = listMessagesInSeqRange(mine, chapter.seqStart, allocateSeq(mine));
  const { shown } = await factsOnFileFor(mine, messages);
  const ids = shown.map((entry) => entry.id);
  assert.ok(!ids.includes(elsewhere), "another campaign's fact was shown");
  assert.deepEqual(new Set(ids), new Set([keyFact, repeated, repeat, pinnedFact]));
  assert.equal(ids[ids.length - 1], pinnedFact, "the fact sharing no word with the passage should come last");
});

await test("retiring by id stays inside the campaign and spares pinned facts", () => {
  const count = retireFacts(mine, [elsewhere, pinnedFact]);
  assert.equal(count, 0);
  assert.equal(getFactById(elsewhere).status, "active");
  assert.equal(getFactById(pinnedFact).status, "active");
});

await test("a chapter close retires what its summary call replaces or lists, and nothing of another campaign", async () => {
  const chapter = ensureOpenChapter(mine);
  const { shown } = await factsOnFileFor(mine, listMessagesInSeqRange(mine, chapter.seqStart, allocateSeq(mine)));
  const handleOf = (id) => shown.find((entry) => entry.id === id).handle;
  fs.writeFileSync(
    process.env.HARNESS_FAKE_SCRIPT,
    JSON.stringify([
      [
        {
          text: JSON.stringify({
            title: "The Key in the Lake",
            summary: "Kara dropped the bronze key into the lake.",
            highlights: ["The key sank."],
            // Another subject than the fact it replaces, so insert-time
            // supersede by subject cannot be what retires it.
            facts: [{ category: "party", subject: "the bronze key", fact: "Kara lost the bronze key in the lake.", replaces: handleOf(keyFact) }],
            retire: [handleOf(repeat), handleOf(pinnedFact)],
          }),
        },
      ],
    ]),
  );
  await maybeCloseChapter(mine, { beatCompleted: false, manual: true });
  assert.equal(getFactById(keyFact).status, "superseded");
  assert.equal(getFactById(repeat).status, "superseded");
  assert.equal(getFactById(repeated).status, "active");
  assert.equal(getFactById(pinnedFact).status, "active");
  assert.equal(getFactById(elsewhere).status, "active");
});

console.log(`test-fact-consolidation: ${passed} tests passed`);
removeTempDir(dir);
