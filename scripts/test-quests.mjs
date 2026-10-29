// Quests by hand (docs/vtt-parity-implementation-plan.md section 5.7): the
// arc mirrors into the log and keeps the DM's ticks, hand-written quests
// stand beside them, the tools write and tick, and a player's log has no
// DM-only rows. Issue 581: what the table does to an arc quest stands
// against the arc, the table hears of every change, and the glance and the
// campaign payload read the log itself.
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
const { createCampaign, getCampaignById, publicCampaign, setStoryArc } = await import("../src/lib/db/campaigns.ts");
const { copyQuests, listQuests, retireArcQuests, syncArcQuests, insertQuest } = await import("../src/lib/db/quests.ts");
const { editQuest } = await import("../src/lib/db/quest-arc.ts");
const { handleSetQuest, handleTickObjective } = await import("../src/lib/dm/binder-tools.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { normalizeStoryArc } = await import("../src/lib/dm/arc-logic.ts");
const {
  arcQuestStatus,
  normalizeObjectives,
  questGlanceOf,
  questLogForExport,
  questLogLines,
  questsVisibleTo,
  reconcileSubArcs,
  renderQuestsForPrompt,
  subArcAfterQuestEdit,
  tickObjective,
} = await import("../src/lib/dm/quest-logic.ts");

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
  insertQuest({ campaignId: campaign.id, title: "Gone thread", source: "arc", sourceRef: "sa9" });
  syncArcQuests(campaign.id, [subArcs[0]]);
  const after = listQuests(campaign.id).filter((quest) => quest.source === "arc");
  assert.ok(!after.some((quest) => quest.sourceRef === "sa9"), "an open quest whose sub-arc left takes its row");
  // A long arc sheds its settled threads (setStoryArc's size cap); the quest
  // the party finished stays on the log as what they did (issue 581).
  const settled = after.find((quest) => quest.title === "Old Debts");
  assert.equal(settled?.status, "done", "a settled quest outlives its sub-arc");
  assert.equal(settled.sourceRef, "", "and no longer answers to its id");
  assert.equal(after.find((quest) => quest.sourceRef === "sa1").objectives[0].done, true, "the tick survives the re-sync");
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
  const secret = handleTickObjective(live(), JSON.stringify({ quest: "[GM only] Hidden debt", objective: "Pay it" }));
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
  assert.ok(block.includes("[GM only] Secret errand"));
  assert.ok(!block.includes("Find the daughter"), "a failed quest is out of the block");
});

// ---- issue 581: the arc's quests, the glance, the payload ----

const arcTable = createCampaign(dm.id, { title: "Brackenford", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
const arcLive = () => getCampaignById(arcTable.id);
const storyArc = (subArcs) =>
  normalizeStoryArc({
    premise: "A waystone fails.",
    stakes: "The town falls.",
    antagonist: "The Ashen Choir.",
    beats: [{ text: "The stone dims", status: "active" }, { text: "The Choir comes" }],
    subArcs,
  });
const waystone = { id: "sa1", name: "Light for Brackenford", goal: "Restore the Crimson Waystone's protection.", hook: "The Choir drains it.", beats: ["Find the shard"], status: "active" };
const ferry = { id: "sa2", name: "The Ferryman's Toll", goal: "Pay or outwit the ferryman.", hook: "He serves the Choir.", beats: [], status: "pending" };
const heard = [];
const stopHearing = subscribe(arcTable.id, (chunk) => heard.push(/^event: (.+)$/m.exec(chunk)?.[1] ?? ""));
const arcRow = (ref) => listQuests(arcTable.id).find((quest) => quest.sourceRef === ref);
const subArcOf = (ref) => arcLive().storyArc.subArcs.find((subArc) => subArc.id === ref);

test("the arc's quests carry names and goals, never the GM's hooks or beats", () => {
  setStoryArc(arcTable.id, storyArc([waystone, ferry]));
  const rows = listQuests(arcTable.id);
  assert.equal(rows.length, 2);
  const text = JSON.stringify(rows);
  assert.ok(text.includes("Restore the Crimson Waystone's protection."));
  assert.ok(!text.includes("drains it") && !text.includes("Find the shard") && !text.includes("serves the Choir"));
});

test("a quest the GM marks done stays done through the next write of the arc, and the arc closes the thread (issue 581)", () => {
  const stale = arcLive().storyArc;
  heard.length = 0;
  const done = handleSetQuest(arcLive(), JSON.stringify({ quest: "Light for Brackenford", status: "done" }));
  assert.equal(done.ok, true, done.error);
  assert.ok(heard.includes("quests_updated"), "the table is told the log changed");
  assert.equal(subArcOf("sa1").status, "resolved", "the arc the storyteller steers by closes the thread");
  // A waypoint tick, a beat, or a chapter close that read the arc before the
  // edit writes its copy back.
  setStoryArc(arcTable.id, stale);
  assert.equal(arcRow("sa1").status, "done", "the quest did not come back");
  assert.equal(subArcOf("sa1").status, "resolved", "the older copy did not reopen the thread");
});

test("a renamed or hidden arc quest keeps its name and its mark", () => {
  handleSetQuest(arcLive(), JSON.stringify({ quest: "The Ferryman's Toll", title: "Cross the Black River" }));
  assert.equal(subArcOf("sa2").name, "Cross the Black River", "the arc calls it that too");
  editQuest(arcRow("sa2").id, { status: "hidden" });
  setStoryArc(arcTable.id, storyArc([{ ...waystone, status: "resolved" }, ferry]));
  assert.equal(arcRow("sa2").title, "Cross the Black River", "the old name did not come back");
  assert.equal(arcRow("sa2").status, "hidden", "a hidden quest stays hidden");
  assert.equal(subArcOf("sa2").name, "Cross the Black River");
});

test("reopening an arc quest reopens its thread, and the arc's own refresh still closes one", () => {
  editQuest(arcRow("sa1").id, { status: "active" });
  assert.equal(subArcOf("sa1").status, "active");
  assert.equal(arcRow("sa1").status, "active");
  // The chapter-close refresh settles a thread the table left open.
  const arc = arcLive().storyArc;
  const changed = setStoryArc(arcTable.id, { ...arc, subArcs: arc.subArcs.map((subArc) => (subArc.id === "sa1" ? { ...subArc, status: "resolved" } : subArc)) });
  assert.equal(changed, true, "setStoryArc says the log changed, for the caller to publish");
  assert.equal(arcRow("sa1").status, "done");
  assert.equal(setStoryArc(arcTable.id, arcLive().storyArc), false, "a write that changes no quest says so");
});

test("ticking an arc quest's last step closes the thread too", () => {
  editQuest(arcRow("sa1").id, { status: "active", objectives: arcRow("sa1").objectives.map((objective) => ({ ...objective, done: false })) });
  heard.length = 0;
  const ticked = handleTickObjective(arcLive(), JSON.stringify({ quest: "Light for Brackenford", objective: "Restore the Crimson Waystone's protection." }));
  assert.equal(ticked.complete, true, ticked.error);
  assert.ok(heard.includes("quests_updated"));
  assert.equal(subArcOf("sa1").status, "resolved");
});

test("a thread given a shed sub-arc's id is a quest of its own, not the old one (issue 581)", () => {
  // The arc numbers threads from its highest id, so once the cap sheds the
  // last settled thread its id can be handed out again.
  const table = createCampaign(dm.id, { title: "Ids", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  setStoryArc(table.id, storyArc([{ ...waystone, status: "resolved" }]));
  setStoryArc(table.id, storyArc([]));
  setStoryArc(table.id, storyArc([{ ...ferry, id: "sa1", status: "active" }]));
  const rows = listQuests(table.id);
  const fresh = rows.find((quest) => quest.sourceRef === "sa1");
  assert.equal(fresh.title, "The Ferryman's Toll", "the new thread keeps its own name");
  assert.equal(fresh.status, "active", "and is open");
  assert.equal(fresh.objectives[0].text, "Pay or outwit the ferryman.", "with its own step");
  assert.equal(getCampaignById(table.id).storyArc.subArcs[0].name, "The Ferryman's Toll", "the arc was not renamed after the old quest");
  assert.ok(rows.some((quest) => quest.title === "Light for Brackenford" && quest.status === "done"), "the old quest stays as what the party did");
});

test("a regenerated arc's threads start their own quests; the old arc's open ones go and its settled ones stay", () => {
  const table = createCampaign(dm.id, { title: "Regenerate", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  setStoryArc(table.id, storyArc([{ ...waystone, status: "resolved" }, { ...ferry, status: "active" }]));
  assert.equal(retireArcQuests(table.id), true);
  setStoryArc(table.id, storyArc([{ id: "sa1", name: "The Drowned Bell", goal: "Raise the bell.", hook: "", beats: [], status: "active" }]));
  const rows = listQuests(table.id);
  assert.deepEqual(rows.filter((quest) => quest.sourceRef).map((quest) => [quest.sourceRef, quest.title, quest.status]), [["sa1", "The Drowned Bell", "active"]]);
  assert.ok(rows.some((quest) => quest.title === "Light for Brackenford" && quest.status === "done" && !quest.sourceRef));
  assert.ok(!rows.some((quest) => quest.title === "The Ferryman's Toll"), "an open quest of the thrown-away arc goes");
});

test("the status rules: a settled or hidden row keeps its own word, an open one follows the arc", () => {
  assert.equal(arcQuestStatus("active", "done"), "done");
  assert.equal(arcQuestStatus("abandoned", "done"), "done");
  assert.equal(arcQuestStatus("resolved", "hidden"), "hidden");
  assert.equal(arcQuestStatus("resolved", "active"), "done");
  assert.equal(arcQuestStatus("abandoned", undefined), "failed");
  assert.equal(arcQuestStatus("pending", undefined), "active");
  const subArc = { id: "x", name: "A", status: "active" };
  assert.equal(subArcAfterQuestEdit(subArc, { title: "A", status: "hidden" }), subArc, "hiding says nothing about the story");
  assert.equal(subArcAfterQuestEdit(subArc, { title: "A", status: null }), subArc);
  assert.equal(subArcAfterQuestEdit({ ...subArc, status: "resolved" }, { title: "A", status: "active" }).status, "active");
  const rows = [{ source: "arc", sourceRef: "x", title: "A", status: "active" }];
  assert.equal(reconcileSubArcs([{ ...subArc, status: "resolved" }], rows)[0].status, "resolved", "an open row leaves a closed thread closed");
});

test("the glance shows the oldest open party quest and its next step, and nothing once all are done (issue 581)", () => {
  const quests = [
    { title: "Old", status: "done", visibility: "party", objectives: [] },
    { title: "Secret", status: "active", visibility: "dm", objectives: [] },
    { title: "Kept from players", status: "hidden", visibility: "party", objectives: [] },
    { title: "Light", status: "active", visibility: "party", objectives: [{ id: "a", text: "Find the shard", done: true }, { id: "b", text: "Relight the stone", done: false }] },
    { title: "Later", status: "active", visibility: "party", objectives: [] },
  ];
  assert.deepEqual(questGlanceOf(quests), { title: "Light", step: "Relight the stone" });
  assert.deepEqual(questGlanceOf(quests.map((quest) => ({ ...quest, status: quest.status === "active" ? "done" : quest.status }))), null);
  assert.deepEqual(questLogLines(quests), ["Light: Relight the stone", "Later"]);
  assert.deepEqual(questLogForExport(quests), ["Old (done)", "Light", "Later"]);
});

test("the campaign payload's questLog is the live log, so an older app's glance lets a finished quest go (issue 581)", () => {
  for (const quest of listQuests(arcTable.id)) {
    editQuest(quest.id, { status: "done" });
  }
  assert.deepEqual(publicCampaign(arcLive()).questLog, []);
  insertQuest({ campaignId: arcTable.id, title: "Warn the reeve", objectives: normalizeObjectives(["Ride to Holt"]) });
  assert.deepEqual(publicCampaign(arcLive()).questLog, ["Warn the reeve: Ride to Holt"]);
});

test("a copied campaign keeps its quest log, ticks and all", () => {
  const copy = createCampaign(dm.id, { title: "Copy", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
  copyQuests(arcTable.id, copy.id);
  const from = listQuests(arcTable.id).map(({ title, status, objectives, source, sourceRef, visibility }) => ({ title, status, objectives, source, sourceRef, visibility }));
  const to = listQuests(copy.id).map(({ title, status, objectives, source, sourceRef, visibility }) => ({ title, status, objectives, source, sourceRef, visibility }));
  assert.deepEqual(to, from);
});
stopHearing();

console.log(`test-quests: ${passed} passed`);
