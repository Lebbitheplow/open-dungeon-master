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
  const ticked = handleTickObjective(live(), JSON.stringify({ quest: miller.id, objective: "goal" }));
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
  const edited = handleSetQuest(live(), JSON.stringify({ quest: made.quest.id, status: "failed" }));
  assert.equal(edited.quest.status, "failed");
  assert.ok("error" in handleSetQuest(live(), JSON.stringify({ quest: "nope", title: "x" })));
  assert.ok("error" in handleSetQuest(live(), "{}"), "a new quest needs a title");
});

test("tick_objective refuses a stranger's quest and an unknown objective", () => {
  const quest = insertQuest({ campaignId: campaign.id, title: "Secret errand", objectives: normalizeObjectives(["a", "b"]), visibility: "dm" });
  assert.ok("error" in handleTickObjective(live(), JSON.stringify({ quest: quest.id, objective: "o9" })));
  const other = createCampaign(dm.id, { title: "Other", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  assert.ok("error" in handleTickObjective(getCampaignById(other.id), JSON.stringify({ quest: quest.id, objective: "o1" })));
  const ok = handleTickObjective(live(), JSON.stringify({ quest: quest.id, objective: "o1" }));
  assert.equal(ok.complete, false);
});

test("the quest tools take a quest by its title and an objective by its text, as the prompt block shows them", () => {
  insertQuest({ campaignId: campaign.id, title: "Clear the Cellar", objectives: normalizeObjectives(["Find the rats", "Burn the nest"]), visibility: "party" });
  const ticked = handleTickObjective(live(), JSON.stringify({ quest: "clear the cellar", objective: "Find the rats" }));
  assert.equal(ticked.ok, true, ticked.error);
  assert.deepEqual(ticked.quest.objectives.map((objective) => objective.done), [true, false]);
  insertQuest({ campaignId: campaign.id, title: "Hidden debt", objectives: normalizeObjectives(["Pay it", "Hide it"]), visibility: "dm" });
  const secret = handleTickObjective(live(), JSON.stringify({ quest: "[DM only] Hidden debt", objective: "Pay it" }));
  assert.equal(secret.ok, true, secret.error);
  const before = listQuests(campaign.id).length;
  const edited = handleSetQuest(live(), JSON.stringify({ quest: "Clear the Cellar", status: "done" }));
  assert.equal(edited.quest.status, "done");
  assert.equal(listQuests(campaign.id).length, before, "an edit by title adds no quest");
  const unknown = handleTickObjective(live(), JSON.stringify({ quest: "Clear the Cellar", objective: "Kill the cat" }));
  assert.match(unknown.error, /Find the rats/, "the refusal lists the objectives");
  const other = createCampaign(dm.id, { title: "Elsewhere", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  const stranger = handleTickObjective(getCampaignById(other.id), JSON.stringify({ quest: "Clear the Cellar", objective: "Burn the nest" }));
  assert.ok("error" in stranger, "another campaign cannot reach it by title");
  assert.doesNotMatch(stranger.error, /Cellar \(/, "nor sees it listed");
});

test("restating a quest's objectives keeps the ticks of the lines it keeps, and adds the new ones open", () => {
  const made = handleSetQuest(live(), JSON.stringify({ title: "Mend the bridge", objectives: ["Buy the planks", "Hire the carpenter"] }));
  handleTickObjective(live(), JSON.stringify({ quest: "Mend the bridge", objective: "Buy the planks" }));
  const restated = handleSetQuest(live(), JSON.stringify({ quest: "Mend the bridge", objectives: ["buy the planks", "Hire the carpenter", "Pay the toll"] }));
  assert.equal(restated.ok, true, restated.error);
  assert.deepEqual(
    restated.quest.objectives.map((objective) => [objective.text, objective.done]),
    [["buy the planks", true], ["Hire the carpenter", false], ["Pay the toll", false]],
    "the tick on the kept line survives",
  );
  const ids = restated.quest.objectives.map((objective) => objective.id);
  assert.equal(ids[0], made.quest.objectives[0].id, "a kept line keeps its id");
  assert.equal(new Set(ids).size, ids.length, "no two objectives share an id");
});

test("set_quest with the title of a quest in the log updates it rather than adding it twice", () => {
  const before = listQuests(campaign.id).length;
  const first = handleSetQuest(live(), JSON.stringify({ title: "Find the smuggler", objectives: ["Ask at the docks", "Watch the tide"] }));
  handleTickObjective(live(), JSON.stringify({ quest: "Find the smuggler", objective: "Ask at the docks" }));
  const again = handleSetQuest(live(), JSON.stringify({ title: "find the smuggler", objectives: ["Ask at the docks", "Search the warehouse"] }));
  assert.equal(again.quest.title, "Find the smuggler", "the log keeps the title it had");
  assert.equal(again.ok, true, again.error);
  assert.equal(listQuests(campaign.id).length, before + 1, "one quest, not two");
  assert.equal(again.quest.id, first.quest.id);
  assert.deepEqual(again.quest.objectives.map((objective) => objective.done), [true, false]);
  assert.match(again.note, /already in the log/);
  // A quest the party failed can be taken up again as a new one.
  handleSetQuest(live(), JSON.stringify({ quest: "Find the smuggler", status: "failed" }));
  const retry = handleSetQuest(live(), JSON.stringify({ title: "Find the smuggler" }));
  assert.notEqual(retry.quest.id, first.quest.id);
  assert.equal(retry.quest.status, "active");
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
