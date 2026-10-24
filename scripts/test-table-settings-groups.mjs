// The live table settings in the campaign creator's named groups
// (src/app/campaigns/[campaignId]/table-settings-groups.ts): which groups a
// table shows in each DM mode, that every group's closed face says what is
// set inside, that the panel's search finds a setting by its everyday name,
// that the phone bar puts every tab within two taps, and that no control the
// old single panel drew went missing in the move.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import { suite } from "./lib/enforce-harness.mjs";

register("./lib/register-alias.mjs", import.meta.url);

const { test, finish } = suite("test-table-settings-groups");

const { tableGroups, tableGroupSummary, groupMatches, alliesShown, conscienceShown, ROW_GROUP } = await import(
  "../src/app/campaigns/[campaignId]/table-settings-groups.ts"
);
const { normalizeGameSettings } = await import("../src/lib/schemas/game-settings.ts");
const { phoneBarSplit, visiblePanelTabs, PHONE_BAR_SLOTS } = await import("../src/lib/dm/table-tabs.ts");

const context = { packName: null, genreName: "High fantasy", voiceName: "Heart", narrationOff: false, statsRule: "the server's reroll rule" };
const ids = (settings) => tableGroups(settings).map((group) => group.id);

await test("an AI table shows the AI and memory groups and no DM reminders", () => {
  const groups = ids(normalizeGameSettings({ dmMode: "ai" }));
  assert.ok(groups.includes("ai") && groups.includes("memory"));
  assert.ok(!groups.includes("console"));
  assert.deepEqual(groups.slice(0, 5), ["world", "character", "narration", "atmosphere", "safety"], "the creator's order");
});

await test("a human table drops the narrator's pipeline and keeps the DM's reminders", () => {
  const settings = normalizeGameSettings({ dmMode: "human" });
  const groups = ids(settings);
  assert.ok(groups.includes("console"));
  assert.ok(!groups.includes("memory"));
  // Auto already allows the allies a person plays, so the row hides.
  assert.equal(alliesShown(settings), false);
  assert.ok(!groups.includes("ai"));
  const shut = normalizeGameSettings({ dmMode: "human", companions: "off" });
  assert.ok(ids(shut).includes("ai"), "an Off carried over from an AI table shows the allies row");
  assert.equal(tableGroups(shut).find((group) => group.id === "ai").title, "Allies");
});

await test("an assisted table shows both the AI helps and the reminders", () => {
  const settings = normalizeGameSettings({ dmMode: "assisted" });
  assert.ok(ids(settings).includes("ai") && ids(settings).includes("console"));
  assert.match(tableGroupSummary("ai", settings, context), /AI helps with the monsters/);
});

await test("every group says what is set inside on its closed face", () => {
  for (const mode of ["ai", "steered", "assisted", "human"]) {
    const settings = normalizeGameSettings({ dmMode: mode, companions: "off" });
    for (const group of tableGroups(settings)) {
      const summary = tableGroupSummary(group.id, settings, context);
      assert.ok(summary.length > 3, `${mode}/${group.id}`);
      assert.doesNotMatch(summary, /undefined|NaN|\d+ of \d+ features/, `${mode}/${group.id}: ${summary}`);
    }
  }
  const off = normalizeGameSettings({ ttsEnabled: false });
  assert.equal(tableGroupSummary("narration", off, context), "Off: nothing is read aloud");
  assert.match(tableGroupSummary("narration", off, { ...context, narrationOff: true }), /Off on this server/);
  const memory = normalizeGameSettings({ stages: { recall: false } });
  assert.match(tableGroupSummary("memory", memory, context), /semantic recall/i);
});

await test("the search finds a setting by an everyday word", () => {
  const settings = normalizeGameSettings({});
  const find = (query) =>
    tableGroups(settings)
      .filter((group) => groupMatches(group, tableGroupSummary(group.id, settings, context), query))
      .map((group) => group.id);
  assert.ok(find("microphone").includes("voiceChat"));
  assert.ok(find("x-card").includes("safety"));
  assert.ok(find("hp").includes("character"));
  assert.ok(find("music").includes("atmosphere"));
  assert.ok(find("companions").includes("ai"));
  assert.ok(find("compaction").includes("memory"));
  assert.deepEqual(find("zzzz"), []);
  assert.equal(find("").length, tableGroups(settings).length);
});

await test("a row another panel links to names the group that holds it", () => {
  const groups = fs.readFileSync(new URL("../src/app/campaigns/[campaignId]/GameSettingsGroups.tsx", import.meta.url), "utf8");
  for (const [row, group] of Object.entries(ROW_GROUP)) {
    assert.match(groups, new RegExp(`data-settings-row="${row}"`));
    assert.equal(group, "ai");
  }
  const party = fs.readFileSync(new URL("../src/app/campaigns/[campaignId]/PartyPanel.tsx", import.meta.url), "utf8");
  assert.match(party, /closest<HTMLElement>\("\.cc-group:not\(\[data-open\]\)"\)/, "a link opens the closed group first");
});

// Every setting the single long panel offered is still offered: the patched
// keys of the old file, read from git, against the new two files.
await test("no control was lost in the regrouping", () => {
  const read = (file) => fs.readFileSync(new URL(`../src/app/campaigns/[campaignId]/${file}`, import.meta.url), "utf8");
  const now = read("GameSettingsPanel.tsx") + read("GameSettingsGroups.tsx");
  const keys = [
    "worldPack", "genre", "customGenreText", "tableLanguage", "campaignLength", "dicePolicy", "ttsEnabled", "ttsVoice",
    "presentation", "ambienceEnabled", "ambienceAuto", "boardDrawing", "enemyIntent", "aiStorySetup", "mapsEnabled",
    "multiclassingEnabled", "midGameJoinOpen", "holdSubmissions", "hpMethod", "startingWealth", "abilityRerollBelow",
    "beatReminder", "stages", "worldSimulation", "inventoryApprovals", "vitalsApprovals", "safety", "gm",
    "narrationGuard", "voice", "relationships", "romance", "companions", "maxCompanions", "maxGuests", "dmAssist",
    "companionConscience",
  ];
  for (const key of keys) {
    assert.match(now, new RegExp(`patch\\(\\{[^}]*\\b${key}\\b`), `${key} is still patched from the panel`);
  }
  for (const label of ["Transcription", "Proximity", "Whisper/shout", "Walls muffle", "Downed go deaf", "Living world", "Outcome check", "Theatre inserts"]) {
    assert.ok(now.includes(label), label);
  }
});

await test("Companion conscience shows only with bonds on and a lasting companion possible, and says so on the closed face", () => {
  const on = normalizeGameSettings({});
  assert.equal(on.companionConscience, "leave", "Leave is the default");
  assert.equal(conscienceShown(on, true), true);
  assert.equal(conscienceShown(on, false), false, "no lasting companion can travel with this party");
  assert.equal(conscienceShown(normalizeGameSettings({ relationships: "off" }), true), false, "bonds off");
  assert.match(tableGroupSummary("bonds", on, { ...context, lastingCompanions: true }), /companions may leave/);
  assert.doesNotMatch(tableGroupSummary("bonds", on, context), /companions/);
  assert.match(tableGroupSummary("bonds", normalizeGameSettings({ companionConscience: "turn" }), { ...context, lastingCompanions: true }), /companions may turn/);
  const groups = fs.readFileSync(new URL("../src/app/campaigns/[campaignId]/GameSettingsGroups.tsx", import.meta.url), "utf8");
  assert.match(groups, /data-settings-row="conscience"/);
  assert.match(groups, /label="Companion conscience"/, "the picker is named for screen readers");
  assert.match(groups, /InfoButton label="What does Companion conscience do\?"/, "an info button explains it");
  const find = (query) =>
    tableGroups(on)
      .filter((group) => groupMatches(group, tableGroupSummary(group.id, on, context), query))
      .map((group) => group.id);
  assert.ok(find("conscience").includes("bonds"));
});

await test("the phone bar keeps five tabs and lists the rest under More", () => {
  const lead = visiblePanelTabs({ hasBattleMap: false, mapsEnabled: true, hasSettings: true, secretStory: true, adjudicates: false, isLead: true });
  const split = phoneBarSplit(lead);
  assert.equal(split.bar.length, PHONE_BAR_SLOTS);
  assert.deepEqual([...split.bar, ...split.more].sort(), [...lead].sort(), "every tab is somewhere");
  assert.deepEqual(split.bar, ["lead", "party", "map", "story", "chat"], "the bar keeps the rail's own order");
  assert.ok(split.more.includes("settings") && split.more.includes("notes"));
  const dm = visiblePanelTabs({ hasBattleMap: true, mapsEnabled: true, hasSettings: true, secretStory: true, adjudicates: true, isLead: false });
  assert.ok(phoneBarSplit(dm).bar.includes("dm") && phoneBarSplit(dm).bar.includes("battle"), "the console and the board stay on the bar");
  const few = ["party", "story", "chat", "settings"];
  assert.deepEqual(phoneBarSplit(few), { bar: few, more: [] }, "a short list needs no More");
});

finish();
