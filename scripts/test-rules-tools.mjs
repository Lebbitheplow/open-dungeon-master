// The DM's rules name tools (src/lib/dm/prompt-rules.ts), so they can go stale when a tool is renamed or
// moves to a group a compact turn does not offer. Held here:
// - every tool-looking name in the rules is a real tool or an enum value some tool takes;
// - in a compact turn, every tool the rules name is offered, or sits in a group the turn can still open with
//   more_tools, and the rules say so exactly when the turn carries more_tools.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const world = await openWorld();
const { dmSystemText, encounterRulesText, groupGuidance } = await import("../src/lib/dm/prompt-rules.ts");
const { ruleContextFor } = await import("../src/lib/dm/rule-context.ts");
const { compactTurnTools, dmTurnTools, profileSignals } = await import("../src/lib/dm/turn.ts");
const { TOOL_GROUPS, autoGroups, closedGroups } = await import("../src/lib/dm/tool-profiles.ts");
const { readCardTool } = await import("../src/lib/dm/prep-card-tool.ts");
const { runPreparedEncounterTool } = await import("../src/lib/dm/prepared-encounter-tool.ts");
const { completeBeatTool, recallStoryTool } = await import("../src/lib/dm/prompt.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const hero = world.addHero({ class: "wizard", level: 3 });
const campaign = world.campaign();
const everything = { ...campaign, gameSettings: { ...campaign.gameSettings, worldSimulation: true, ambienceEnabled: true } };
const sheets = [hero];

const tools = new Map();
for (const fight of [false, true]) for (const tool of dmTurnTools(everything, fight, true, false)) tools.set(tool.function.name, tool);
for (const tool of [readCardTool, runPreparedEncounterTool, completeBeatTool, recallStoryTool]) tools.set(tool.function.name, tool);
const values = new Set();
const collect = (node) => {
  if (!node || typeof node !== "object") return;
  for (const [key, child] of Object.entries(node)) {
    if (key === "enum") for (const value of child) values.add(String(value));
    else collect(child);
  }
};
for (const tool of tools.values()) collect(tool.function.parameters);

const MORE_TOOLS_RULE = /A tool these rules name that is not in your list is in a group more_tools opens/;
const rendered = (fight, groups, moreTools) => {
  const context = ruleContextFor({ sheets, inEncounter: fight, groups, arc: false, recall: false, map: fight, legendary: false, moreTools });
  return [true, false].map((ammunition) => [dmSystemText(ammunition, context), fight ? encounterRulesText(ammunition, context) : ""].join("\n")).join("\n");
};
const everyText = [dmSystemText(false), dmSystemText(true), encounterRulesText(false), encounterRulesText(true), ...Object.keys(TOOL_GROUPS).map((group) => groupGuidance(group, false))].join("\n");

test("a name the rules write like a tool is a tool or a value a tool takes", () => {
  const stale = [...new Set(everyText.match(/\b[a-z]+(?:_[a-z]+)+\b/g))].filter((word) => !tools.has(word) && !values.has(word) && word !== "more_tools");
  assert.deepEqual(stale, [], "names in the rules that no tool or enum has");
});

test("in a compact turn the rules name only tools the turn offers or can open", () => {
  const names = [...tools.keys()].sort((a, b) => b.length - a.length);
  const mention = new RegExp(`\\b(${names.join("|")})\\b`, "g");
  const lost = [];
  for (const fight of [false, true]) {
    const signals = profileSignals(everything, sheets, fight);
    const { offered, closed: closedIds } = compactTurnTools(everything, fight, true, signals, [...autoGroups({ inEncounter: fight, englishPlayerText: "" })]);
    const groups = Object.keys(TOOL_GROUPS).filter((group) => TOOL_GROUPS[group].tools.some((name) => offered.has(name)));
    const closed = new Set(closedGroups([...tools.keys()], offered));
    const reachable = new Set([...closed].flatMap((group) => TOOL_GROUPS[group].tools));
    const text = rendered(fight, groups, closedIds.length > 0);
    for (const name of new Set(text.match(mention))) {
      if (!offered.has(name) && !reachable.has(name)) lost.push(`${fight ? "fight" : "explore"}: ${name}`);
    }
  }
  assert.deepEqual(lost, [], "tools the rules name that a compact turn neither offers nor can open");
});

test("the rules point at more_tools exactly when the turn carries it", () => {
  const context = (moreTools, brief = false) => ruleContextFor({ sheets, inEncounter: false, groups: new Set(), arc: false, recall: false, map: false, legendary: false, moreTools, brief });
  assert.match(dmSystemText(false, context(true)), MORE_TOOLS_RULE);
  assert.doesNotMatch(dmSystemText(false, context(false)), MORE_TOOLS_RULE);
  assert.doesNotMatch(dmSystemText(false, context(true, true)), MORE_TOOLS_RULE);
  const signals = profileSignals(everything, sheets, false);
  const open = Object.keys(TOOL_GROUPS);
  assert.deepEqual(compactTurnTools(everything, false, true, signals, open).closed, [], "every group opened leaves nothing to point at");
  assert.ok(compactTurnTools(everything, false, true, signals, []).closed.length > 0);
});

// What the rules call by a camelCase name is a parameter some tool takes, or a field a tool's result carries.
const RESULT_FIELDS = ["levelUpAvailable", "extraAttack", "enemiesToAct"];
test("a parameter or result field the rules name exists", () => {
  const params = new Set();
  const walkProps = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "properties" && child && typeof child === "object") for (const name of Object.keys(child)) params.add(name);
      walkProps(child);
    }
  };
  for (const tool of tools.values()) walkProps(tool.function.parameters);
  const unknown = [...new Set(everyText.match(/\b[a-z]+[A-Z][A-Za-z]*\b/g))].filter((word) => !params.has(word) && !RESULT_FIELDS.includes(word));
  assert.deepEqual(unknown, [], "camelCase names in the rules that no tool takes or returns");
});

console.log(`rules-tools: ${passed} tests passed`);
