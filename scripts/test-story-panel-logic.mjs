import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);

const { milestoneLine, visibleStoryChapters, storyPanelArcForCampaign } = await import("../src/lib/dm/story-panel-logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

function chapter(id, index, overrides = {}) {
  return {
    id,
    campaignId: "campaign-1",
    index,
    title: `Chapter ${index}`,
    summary: "",
    highlights: [],
    seqStart: 0,
    seqEnd: null,
    status: "open",
    clockLabel: "",
    act: null,
    saga: null,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    ...overrides,
  };
}

test("shows Chapter 1 fetched after an empty initial campaign snapshot", () => {
  const firstChapter = chapter("chapter-1", 1);
  assert.deepEqual(visibleStoryChapters([], [firstChapter]), [firstChapter]);
});

test("keeps snapshot stream state and fills abridged chapter summaries", () => {
  const fetchedClosed = chapter("chapter-1", 1, {
    status: "closed",
    title: "The Market",
    summary: "The party receives a letter.",
    highlights: ["A sealed message arrives."],
    seqEnd: 4,
  });
  const fetchedOpen = chapter("chapter-2", 2);
  const snapshotClosed = chapter("chapter-1", 1, {
    status: "closed",
    title: "The Market",
    summary: "",
    highlights: [],
    seqEnd: 4,
    abridged: true,
  });
  const streamOpen = chapter("chapter-2", 2, { title: "The Road", seqStart: 5 });

  assert.deepEqual(
    visibleStoryChapters([snapshotClosed, streamOpen], [fetchedClosed, fetchedOpen]),
    [
      { ...fetchedClosed, abridged: false },
      streamOpen,
    ],
  );
});

test("does not display a loaded story arc after switching campaigns", () => {
  assert.equal(typeof storyPanelArcForCampaign, "function");
  if (typeof storyPanelArcForCampaign !== "function") return;

  const previousCampaign = {
    campaignId: "campaign-1",
    arc: { premise: "The old campaign's plot" },
    dmOutline: "Old outline",
  };
  assert.equal(storyPanelArcForCampaign(previousCampaign, "campaign-2"), null);
  assert.equal(storyPanelArcForCampaign(previousCampaign, "campaign-1"), previousCampaign);
});

test("a Log milestone names the character once (issue 644)", () => {
  assert.equal(milestoneLine("Vex", "Vex and Sir Ivo Ashford were married"), "Vex and Sir Ivo Ashford were married");
  assert.equal(milestoneLine("Vex", "Reached level 5"), "Vex: Reached level 5");
  assert.equal(milestoneLine("Vex", "Vexing omens followed them"), "Vex: Vexing omens followed them", "a whole name, not its letters");
  assert.equal(milestoneLine("Sir Ivo", "Sir Ivo's oath was kept"), "Sir Ivo's oath was kept");
});

console.log(`test-story-panel-logic: ${passed} passed`);
