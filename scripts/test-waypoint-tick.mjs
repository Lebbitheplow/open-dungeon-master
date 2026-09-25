// Waypoints against a real campaign (issue #31): the DM's tool calls tick
// the [NOW] beat's steps, complete_beat is refused until they are all
// done, and the lead's claim completes the beat once the checklist clears.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-waypoint-tick-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setStoryArc } = await import("../src/lib/db/campaigns.ts");
const { insertQuest } = await import("../src/lib/db/quests.ts");
const { normalizeStoryArc } = await import("../src/lib/dm/arc-logic.ts");
const { tickWaypointsFromCalls } = await import("../src/lib/dm/waypoint-tick.ts");
const { completeActiveBeat, handleCompleteBeat } = await import("../src/lib/dm/arc.ts");
const { activeBeat, openWaypoints } = await import("../src/lib/dm/waypoint-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, {
  title: "The Sunken Crown",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 1,
  difficulty: "normal",
});
const quest = insertQuest({
  campaignId: campaign.id,
  title: "The Pilgrim's Burden",
  objectives: ["Find the glass fragment", "Return it to Father Kaelen"],
});
const fragmentObjective = quest.objectives[0].id;

setStoryArc(
  campaign.id,
  normalizeStoryArc({
    premise: "The heart wakes beneath the drowned cathedral.",
    beats: [
      { text: "Leave Halvord's Reach.", status: "done", act: 1 },
      {
        text: "Cross the glass plain to the drowned cathedral.",
        status: "active",
        act: 1,
        waypoints: [
          { kind: "npc", text: "Speak with Brisca Hale about the safe path" },
          { kind: "place", text: "Reach the Drowned Cathedral of Vael" },
          { kind: "objective", text: "Find the glass fragment" },
          { kind: "fight", text: "Defeat the Salt-Glass Husks" },
        ],
      },
      { text: "Confront the vicar.", status: "pending", act: 1 },
    ],
  }),
);

const open = () => openWaypoints(activeBeat(getCampaignById(campaign.id).storyArc).beat).map((w) => w.text);

try {
  test("complete_beat is refused while the checklist is open, naming the steps", () => {
    const outcome = handleCompleteBeat(campaign.id, "{}", false);
    assert.equal(outcome.completed, false);
    assert.equal(outcome.gated, true);
    assert.match(String(outcome.result.error), /open waypoints: Speak with Brisca Hale/);
    assert.equal(outcome.result.openWaypoints.length, 4);
  });

  await (async () => {
    const ticked = await tickWaypointsFromCalls(campaign.id, [
      { name: "set_npc", rawArguments: '{"name":"Brisca Hale","attitude":"friendly"}' },
      { name: "move_party", rawArguments: '{"name":"the Drowned Cathedral"}' },
    ]);
    test("the DM's NPC and location tools tick their waypoints by name", () => {
      assert.deepEqual(ticked, ["Speak with Brisca Hale about the safe path", "Reach the Drowned Cathedral of Vael"]);
      assert.deepEqual(open(), ["Find the glass fragment", "Defeat the Salt-Glass Husks"]);
    });
  })();

  await (async () => {
    const ticked = await tickWaypointsFromCalls(campaign.id, [
      { name: "tick_objective", rawArguments: JSON.stringify({ questId: quest.id, objectiveId: fragmentObjective }) },
    ]);
    test("a quest objective ticks its waypoint through the quest's own text", () => {
      assert.deepEqual(ticked, ["Find the glass fragment"]);
    });
  })();

  await (async () => {
    // A signal of a kind the checklist does not wait for changes nothing
    // and costs no embedding.
    const none = await tickWaypointsFromCalls(campaign.id, [{ name: "grant_item", rawArguments: '{"name":"rope"}' }]);
    test("a tool of the wrong kind ticks nothing", () => {
      assert.deepEqual(none, []);
      assert.equal(handleCompleteBeat(campaign.id, "{}", false).completed, false);
    });
  })();

  await (async () => {
    const ticked = await tickWaypointsFromCalls(
      campaign.id,
      [{ name: "end_encounter", rawArguments: '{"outcome":"victory"}' }],
      { enemyNames: ["Salt-Glass Husk", "Salt-Glass Husk"] },
    );
    test("ending a fight ticks the foe's waypoint from the foes that stood before it", () => {
      assert.deepEqual(ticked, ["Defeat the Salt-Glass Husks"]);
      assert.deepEqual(open(), []);
    });
  })();

  test("with the checklist clear the beat completes, and it counts as gated", () => {
    const outcome = handleCompleteBeat(campaign.id, "{}", false);
    assert.equal(outcome.completed, true);
    assert.equal(outcome.gated, true);
    assert.equal(getCampaignById(campaign.id).storyArc.beats[1].status, "done");
    // The next beat has no checklist: it gates nothing and counts as one.
    assert.equal(completeActiveBeat(campaign.id).gated, false);
  });
} finally {
  removeTempDir(dir);
}

console.log(`test-waypoint-tick: ${passed} tests passed`);
