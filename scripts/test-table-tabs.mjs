// Which tabs the play table offers each seat, and in what order. The point
// of these assertions is that the two seats with work waiting (the DM
// console and the lead's desk) always lead the rail, that a plain player
// never sees either, and that the lead keeps their tab at a human-DM table
// even though the story has gone to the DM.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { visiblePanelTabs } = await import("../src/lib/dm/table-tabs.ts");

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
    ["dm", "lead", "party", "battle", "map", "story", "notes", "chat", "context", "settings"],
  );
});

test("no campaign loaded means neither setup tab", () => {
  const tabs = visiblePanelTabs({ ...base, hasSettings: false, secretStory: true, isLead: true });
  assert.deepEqual(tabs, ["lead", "party", "map", "story", "notes", "chat"]);
});

console.log(`table tabs: ${passed} tests passed`);
