// Quests by hand (docs/vtt-parity-implementation-plan.md section 5.7): the
// arc mirrors into the log and keeps the DM's ticks, hand-written quests
// stand beside them, the tools write and tick, and a player's log has no
// DM-only rows.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-quests-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { listQuests, syncArcQuests, insertQuest } = await import("../src/lib/db/quests.ts");
const { handleSetQuest, handleTickObjective } = await import("../src/lib/dm/binder-tools.ts");
const { normalizeObjectives, questsVisibleTo, renderQuestsForPrompt, tickObjective } = await import("../src/lib/dm/quest-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
const live = () => getCampaignById(campaign.id);

test("objectives normalise from strings and objects, capped", () => {
  const list = normalizeObjectives(["Ask at the mill", "", { id: "keep", text: "Search the weir", done: true }, 7]);
  assert.deepEqual(list, [
    { id: "o1", text: "Ask at the mill", done: false },
    { id: "keep", text: "Search the weir", done: true },
  ]);
  assert.equal(normalizeObjectives(Array.from({ length: 20 }, (_, i) => `step ${i}`)).length, 12);
  assert.deepEqual(tickObjective(list, "o1", true)[0].done, true);
});

test("the arc mirrors into quests and a re-sync keeps the DM's ticks", () => {
  const subArcs = [
    { id: "sa1", name: "The Miller", goal: "Find out who burned the mill.", status: "active" },
    { id: "sa2", name: "Old Debts", goal: "Pay Osric.", status: "resolved" },
  ];
  syncArcQuests(campaign.id, subArcs);
  const first = listQuests(campaign.id);
  assert.equal(first.length, 2);
  assert.equal(first.find((q) => q.sourceRef === "sa2").status, "done");
  const miller = first.find((q) => q.sourceRef === "sa1");
  const ticked = handleTickObjective(live(), JSON.stringify({ questId: miller.id, objectiveId: "goal" }));
  assert.equal(ticked.complete, true);
  syncArcQuests(campaign.id, [subArcs[0]]);
  const after = listQuests(campaign.id);
  assert.equal(after.length, 1, "a sub-arc that left takes its row");
  assert.equal(after[0].objectives[0].done, true, "the tick survives the re-sync");
});

test("set_quest writes a hand quest, edits it, and the console's lines become objectives", () => {
  const made = handleSetQuest(live(), JSON.stringify({ title: "Find the daughter", objectives: "Ask at the mill\nSearch the weir" }));
  assert.equal(made.ok, true);
  assert.equal(made.quest.objectives.length, 2);
  assert.equal(made.quest.source, "dm");
  const edited = handleSetQuest(live(), JSON.stringify({ questId: made.quest.id, status: "failed" }));
  assert.equal(edited.quest.status, "failed");
  assert.ok("error" in handleSetQuest(live(), JSON.stringify({ questId: "nope", title: "x" })));
  assert.ok("error" in handleSetQuest(live(), "{}"), "a new quest needs a title");
});

test("tick_objective refuses a stranger's quest and an unknown objective", () => {
  const quest = insertQuest({ campaignId: campaign.id, title: "Secret errand", objectives: normalizeObjectives(["a", "b"]), visibility: "dm" });
  assert.ok("error" in handleTickObjective(live(), JSON.stringify({ questId: quest.id, objectiveId: "o9" })));
  const other = createCampaign(dm.id, { title: "Other", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  assert.ok("error" in handleTickObjective(getCampaignById(other.id), JSON.stringify({ questId: quest.id, objectiveId: "o1" })));
  const ok = handleTickObjective(live(), JSON.stringify({ questId: quest.id, objectiveId: "o1" }));
  assert.equal(ok.complete, false);
});

test("a player's log drops the DM's rows and the prompt block shows the ticks", () => {
  const all = listQuests(campaign.id);
  const mine = questsVisibleTo(all, false);
  assert.ok(mine.every((quest) => quest.visibility === "party"));
  assert.ok(all.some((quest) => quest.visibility === "dm"));
  const block = renderQuestsForPrompt(all);
  assert.ok(block.includes("[x] a"));
  assert.ok(block.includes("[DM only] Secret errand"));
  assert.ok(!block.includes("Find the daughter"), "a failed quest is out of the block");
});

console.log(`test-quests: ${passed} passed`);
