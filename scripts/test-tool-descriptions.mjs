// The compact tool profile cuts every description to its first sentence
// (src/lib/dm/tool-profiles.ts compactTool), so the first sentence has to
// carry what the model must get right:
// - no compact tool or parameter description ends mid-sentence ("..."), over
//   every tool the model can be offered, exploring and fighting;
// - the facts the engine's readers need survive the cut, field by field (a
//   coin amount's codes, what a scroll holds, which feature a flag serves);
// - a field several tools share says the same thing in the same words in each.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";

const world = await openWorld();
const { compactTool, moreToolsTool, TOOL_GROUPS } = await import("../src/lib/dm/tool-profiles.ts");
const { dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { readCardTool } = await import("../src/lib/dm/prep-card-tool.ts");
const { runPreparedEncounterTool } = await import("../src/lib/dm/prepared-encounter-tool.ts");
const { completeBeatTool, recallStoryTool } = await import("../src/lib/dm/prompt.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// Every tool a turn can offer: both fight states, with the settings-gated tools
// (images, settlement, ambience) switched on and the ones that wait on table state
// (prep cards, a story arc, the recall stage, prepared fights) added by hand.
const campaign = world.campaign();
const everything = { ...campaign, gameSettings: { ...campaign.gameSettings, worldSimulation: true, ambienceEnabled: true } };
const byName = new Map();
for (const fight of [false, true]) {
  for (const tool of dmTurnTools(everything, fight, true, false)) byName.set(tool.function.name, tool);
}
for (const tool of [readCardTool, runPreparedEncounterTool, completeBeatTool, recallStoryTool]) byName.set(tool.function.name, tool);
byName.set("more_tools", moreToolsTool(Object.keys(TOOL_GROUPS)));

// [path, full, compact] for every description a tool carries.
function descriptions(tool) {
  const compact = compactTool(tool);
  const found = [[tool.function.name, tool.function.description, compact.function.description]];
  const walk = (full, cut, path) => {
    if (!full || typeof full !== "object") return;
    for (const key of Object.keys(full)) {
      if (key === "description" && typeof full[key] === "string") found.push([path, full[key], cut[key]]);
      else walk(full[key], cut[key], key === "properties" ? path : key === "items" ? path : `${path}.${key}`);
    }
  };
  walk(tool.function.parameters, compact.function.parameters, tool.function.name);
  return found.filter(([, full]) => full !== undefined);
}
const all = [...byName.values()].flatMap((tool) => descriptions(tool).map(([path, full, cut]) => ({ tool: tool.function.name, path, full, cut })));
const field = (toolName, name) => {
  const path = name === undefined ? toolName : `${toolName}.${name}`;
  const hit = all.find((entry) => entry.path === path);
  assert.ok(hit, `${path} is offered`);
  return hit;
};

test("a compact description is a whole sentence", () => {
  assert.ok(byName.size > 80, `the whole set is covered (${byName.size} tools)`);
  const cut = all.filter((entry) => entry.cut.endsWith("..."));
  assert.deepEqual(cut.map((entry) => `${entry.path}: ${entry.cut}`), [], "descriptions the compact profile cuts mid-sentence");
});

test("a compact description is a sentence the cut did not break", () => {
  const broken = [];
  for (const entry of all) {
    const text = entry.cut;
    if (text.endsWith("...") || text === entry.full.replace(/\s+/g, " ").trim()) continue;
    const why = [];
    if ((text.match(/\(/g) ?? []).length !== (text.match(/\)/g) ?? []).length) why.push("an open parenthesis");
    if ((text.match(/"/g) ?? []).length % 2) why.push("an open quote");
    if (/[:;,]$/.test(text)) why.push("ends on punctuation that opens something");
    if (/\b(?:e\.g|i\.e|vs|etc|no)\.$/.test(text)) why.push("ends on an abbreviation");
    if (why.length) broken.push(`${entry.path}: ${why.join(", ")}: ${text}`);
  }
  assert.deepEqual(broken, []);
});

// What the engine reads from each field, as the first sentence must keep it.
const MUST_KEEP = {
  "modify_gold.coins": [/\bpp\b/, /\bgp\b/, /\bep\b/, /\bsp\b/, /\bcp\b/],
  "party_stash.coins": [/\bpp\b/, /\bgp\b/, /\bep\b/, /\bsp\b/, /\bcp\b/],
  "modify_gold.additional": [/Only when/, /another/, /different source/],
  "grant_item.additional": [/Only when/, /another/, /different source/],
  "request_roll.about": [/'none'/, /features keyed/],
  "group_check.about": [/'none'/, /features keyed/],
  "check_notice.about": [/trap/, /secret door/, /'none'/],
  "request_roll.creature": [/type or humanoid race/, /'undead'/, /'none'/],
  "group_check.creature": [/type or humanoid race/, /'undead'/, /'none'/],
  "request_roll.against": [/condition/, /damage type/, /disease/, /dismount/, /'none'/],
  "request_roll.damageType": [/damage type/],
  "grant_item.tags": [/SRD or pack/, /\[\]/],
  "reveal_item.tags": [/SRD or pack/, /\[\]/],
  "grant_item.worth": [/gold pieces/i, /no SRD or pack row/],
  "reveal_item.worth": [/gold pieces/i, /no SRD or pack row/],
  "grant_item.spell": [/scroll/, /spell lists/],
  "reveal_item.spell": [/scroll/, /spell lists/],
  "grant_item.srdName": [/English/, /SRD or pack/, /omit/i],
  "reveal_item.srdName": [/English/, /SRD or pack/, /omit/i],
  "set_condition.magical": [/magic/, /Fey Ancestry/],
  "declare_intent.kind": [/\bmove\b/],
  "use_resource.variant": [/flurry of blows/, /patient defense/, /step of the wind/],
  "apply_hazard.rank": [/'front'/, /'rear'/],
  "start_encounter.ambush": [/'enemies'/, /'party'/],
  "start_encounter.from": [/'ahead'/, /'behind'/],
  "cast_at_enemy.variant": [/Polymorph/, /beast/, /any creature/],
  "pc_attack.bonusAttack": [/martial arts/, /frenzy/, /feature/, /unarmed strike/],
  "update_sheet": [/never a level/, /heal/, /modify_gold/, /set_condition/],
  "pc_attack.whirlwind": [/Whirlwind/, /whirlwind true/],
  "pc_attack.volley": [/Volley/, /volley true/],
  "request_roll.targetEnemyId": [/enemyId/, /no sheet/],
  "purchase.srdName": [/Only when/, /English/],
  "modify_gold.delta": [/gold/, /negative/],
  "apply_damage.source": [/Required on an enemy/, /'hazard'/, /'environment'/],
  set_condition: [/duration/],
  "travel.water": [/half/, /none/],
  "pass_time.water": [/half/, /none/],
};

test("what the engine reads survives the compact cut", () => {
  for (const [path, facts] of Object.entries(MUST_KEEP)) {
    const [toolName, name] = path.split(".");
    const { cut } = field(toolName, name);
    for (const fact of facts) assert.match(cut, fact, `${path} keeps ${fact}: ${cut}`);
  }
});

test("a field several tools share reads the same in each", () => {
  const SHARED = {
    atX: ["aoe_damage", "cast_at_enemy", "use_spell_slot"],
    overchannel: ["aoe_damage", "cast_at_enemy"],
    srdName: ["grant_item", "reveal_item"],
    tags: ["grant_item", "reveal_item"],
    worth: ["grant_item", "reveal_item"],
    spell: ["grant_item", "reveal_item"],
    about: ["request_roll", "group_check"],
    creature: ["request_roll", "group_check"],
    coins: ["modify_gold", "party_stash"],
    water: ["travel", "pass_time"],
    improvised: ["pc_attack", "damage_object"],
  };
  for (const [name, tools] of Object.entries(SHARED)) {
    const [first, ...rest] = tools.map((tool) => field(tool, name));
    for (const entry of rest) {
      assert.equal(entry.cut, first.cut, `${entry.path} reads as ${first.path}`);
    }
  }
});

// One spelling for the ideas every tool repeats, so a model reads the same words for the same thing.
test("the same idea is spelled the same way in every tool", () => {
  const wrong = [];
  const ban = (pattern, say) => {
    for (const entry of all) if (pattern.test(entry.full)) wrong.push(`${entry.path}: ${say}`);
  };
  ban(/\bDefault(?!:)/, "a default is written 'Default: <value>'");
  ban(/\bdefaults to\b/i, "a default is written 'Default: <value>'");
  ban(/\(default\)|\bby default\b/, "a default inside a list is written '(the default)'");
  ban(/\b[Ll]eave (?:it )?out\b/, "leaving a field out is written 'Omit'");
  ban(/\bOnly if\b/i, "a condition is written 'Only when'");
  ban(/\d ft\b/, "a distance is written in feet");
  ban(/\bhit points?\b/, "hit points are written HP");
  ban(/\b(?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) sav/, "a save is written by its ability's abbreviation (CON save)");
  for (const entry of all) {
    if (/\bexact \w+Ids?\b/i.test(entry.full) && !/GAME STATE/.test(entry.full)) wrong.push(`${entry.path}: an exact id names where it comes from (GAME STATE)`);
  }
  assert.deepEqual(wrong, []);
});

// A trim once cut this cue to save room, and on the default model the
// goblins of the smoke skirmish never took a turn again: the player's
// "...then I end my turn" no longer read as endTurn. Words the model
// matches against what a player says stay in.
test("pc_attack's endTurn quotes the words a player ends a turn with", () => {
  const endTurn = all.find((entry) => entry.path === "pc_attack.endTurn");
  assert.ok(endTurn, "pc_attack has an endTurn field");
  assert.match(endTurn.full, /then I end my turn/);
});

console.log(`tool-descriptions: ${passed} tests passed`);
