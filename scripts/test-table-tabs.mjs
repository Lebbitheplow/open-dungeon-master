// Which tabs the play table offers each seat, and in what order. The point
// of these assertions is that the two seats with work waiting (the DM
// console and the lead's desk) always lead the rail, that a plain player
// never sees either, and that the lead keeps their tab at a human-DM table
// even though the story has gone to the DM.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { visiblePanelTabs, phoneBarSplit, TABLE_TAB_IDS } = await import("../src/lib/dm/table-tabs.ts");
const { TAB_IDS } = await import("../src/lib/table-layout.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A loaded campaign with maps on and no fight running.
const base = {
  hasBattleMap: false,
  mapsEnabled: true,
  hasSettings: true,
  secretStory: false,
  adjudicates: false,
  isLead: false,
};

test("the DM console comes first, then the lead's desk", () => {
  const tabs = visiblePanelTabs({ ...base, adjudicates: true, isLead: true, secretStory: true });
  assert.equal(tabs[0], "dm");
  assert.equal(tabs[1], "lead");
  assert.equal(tabs[2], "party");
});

test("a plain player has no lead tab and no console", () => {
  const tabs = visiblePanelTabs(base);
  assert.equal(tabs.includes("lead"), false);
  assert.equal(tabs.includes("dm"), false);
  assert.equal(tabs[0], "party");
});

test("the lead at a human-DM table keeps the lead tab without the secrets", () => {
  // isLead without secretStory is exactly the lead's shape once a person
  // holds the DM seat (src/lib/dm/viewer.ts).
  const tabs = visiblePanelTabs({ ...base, isLead: true, secretStory: false });
  assert.equal(tabs[0], "lead");
  assert.equal(tabs.includes("context"), false);
  assert.equal(tabs.includes("dm"), false);
});

test("context needs both a loaded campaign and story authority", () => {
  assert.equal(
    visiblePanelTabs({ ...base, hasSettings: true, secretStory: true }).includes("context"),
    true,
  );
  assert.equal(
    visiblePanelTabs({ ...base, hasSettings: false, secretStory: true }).includes("context"),
    false,
  );
  assert.equal(
    visiblePanelTabs({ ...base, hasSettings: true, secretStory: false }).includes("context"),
    false,
  );
});

test("the battle tab exists only while a map is live", () => {
  assert.equal(visiblePanelTabs(base).includes("battle"), false);
  assert.equal(visiblePanelTabs({ ...base, hasBattleMap: true }).includes("battle"), true);
});

test("maps off drops the map tab and nothing else", () => {
  const withMaps = visiblePanelTabs(base);
  const without = visiblePanelTabs({ ...base, mapsEnabled: false });
  assert.deepEqual(
    without,
    withMaps.filter((tab) => tab !== "map"),
  );
});

test("the full ordering with every tab on", () => {
  assert.deepEqual(
    visiblePanelTabs({
      hasBattleMap: true,
      mapsEnabled: true,
      hasSettings: true,
      secretStory: true,
      adjudicates: true,
      isLead: true,
    }),
    ["dm", "lead", "party", "battle", "map", "story", "notes", "chat", "world", "context", "settings"],
  );
});

// WF-10: the campaign's world is the story authority's, hidden truths and
// all; its routes answer nobody else (requireStoryAuthority), so the tab is
// offered exactly where Context is.
test("the World tab goes to story authority and to nobody else", () => {
  // The DM at a human-run table: the console and the world.
  const dm = visiblePanelTabs({ ...base, adjudicates: true, secretStory: true });
  assert.equal(dm.includes("world"), true);
  // The lead of an AI campaign steers the story without the console.
  const aiLead = visiblePanelTabs({ ...base, isLead: true, secretStory: true });
  assert.equal(aiLead.includes("world"), true);
  assert.equal(aiLead.includes("dm"), false);
  // The lead at a human-DM table, and every plain player, never see it.
  assert.equal(visiblePanelTabs({ ...base, isLead: true }).includes("world"), false);
  assert.equal(visiblePanelTabs(base).includes("world"), false);
  // Not before the campaign has loaded, like Context.
  assert.equal(visiblePanelTabs({ ...base, hasSettings: false, secretStory: true }).includes("world"), false);
});

test("the World tab sits beside Context and waits under More on a phone", () => {
  const tabs = visiblePanelTabs({ ...base, isLead: true, secretStory: true });
  assert.equal(tabs.indexOf("world") + 1, tabs.indexOf("context"));
  const { bar, more } = phoneBarSplit(tabs);
  assert.equal(bar.includes("world"), false);
  assert.equal(more.includes("world"), true);
});

test("one list of tabs serves the rail, the layout's panes and the paintings", () => {
  const all = visiblePanelTabs({
    hasBattleMap: true,
    mapsEnabled: true,
    hasSettings: true,
    secretStory: true,
    adjudicates: true,
    isLead: true,
  });
  assert.deepEqual([...TABLE_TAB_IDS], all);
  assert.deepEqual([...TAB_IDS], all);
});

test("no campaign loaded means neither setup tab", () => {
  const tabs = visiblePanelTabs({ ...base, hasSettings: false, secretStory: true, isLead: true });
  assert.deepEqual(tabs, ["lead", "party", "map", "story", "notes", "chat"]);
});

console.log(`table tabs: ${passed} tests passed`);
