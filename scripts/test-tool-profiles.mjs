// The compact tool profile and the rules that ride with it
// (docs/agent-context-efficiency-audit-2026-10-17.md F02, F03):
// - a window the full set fits keeps the full set and every rule, word for
//   word; the trimmed set keeps its windows; the compact profile takes the
//   windows neither fits;
// - a compact call offers the core for the moment (exploring or fighting),
//   the groups the table's state and the players' words call for, and
//   more_tools for the rest; descriptions are cut to their first sentence,
//   names, kinds and enums kept;
// - the rules carry only the lines the tools and the party need, and a group
//   opened mid-turn brings its own lines;
// - in a turn, opening a group costs no call of the budget, the group is
//   offered from the next call on, and a tool never offered still runs when
//   called by name;
// - a later call the window no longer fits steps down to the essentials and
//   the tools the turn has called, and one no set fits narrates without tools
//   rather than halting the turn;
// - the documented minimums (src/lib/story-window.ts) hold: an exploration
//   turn at the narration floor, a fight's opening and next turn at the
//   combat floor, every call fitted.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-tool-profiles-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "16384";
process.env.DM_THINKING = "0";
register("./lib/register-alias.mjs", import.meta.url);

const profiles = await import("../src/lib/dm/tool-profiles.ts");
const rules = await import("../src/lib/dm/prompt-rules.ts");
const { tuneForModel } = await import("../src/lib/dm/model-tuning-logic.ts");
const { requestTokens } = await import("../src/lib/dm/request-fit.ts");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const ALL = [
  "request_roll", "request_player_input", "move_party", "update_location", "record_event", "search_lore", "send_whisper",
  "group_check", "check_notice", "set_npc", "npc_reaction", "social_check", "heal", "use_resource", "use_item", "use_spell_slot",
  "cast_buff", "grant_item", "modify_gold", "purchase", "set_condition", "clear_condition", "take_rest", "start_encounter",
  "travel", "pass_time", "roll_treasure", "open_shop", "haggle", "mount_up", "dismount", "downtime",
  "apply_hazard", "learn_spell", "update_sheet", "some_new_tool",
];

await test("the window decides the profile, and the environment can say otherwise", () => {
  const base = { catalog: null, configuredOutputTokens: 16_384, fullToolTokens: 27_000, leanToolTokens: 22_000 };
  assert.equal(tuneForModel({ ...base, windowTokens: 65_536 }).toolProfile, "full", "the documented default keeps the full set");
  assert.equal(tuneForModel({ ...base, windowTokens: 49_152 }).toolProfile, "lean", "48K keeps the trimmed set");
  const small = tuneForModel({ ...base, windowTokens: 32_768 });
  assert.equal(small.toolProfile, "compact");
  assert.match(small.notes.join(" "), /Compact tool set/);
  assert.equal(tuneForModel({ ...base, windowTokens: 16_384 }).toolProfile, "compact");
  assert.equal(tuneForModel({ ...base, windowTokens: 16_384, env: { toolProfile: "full" } }).toolProfile, "full");
  assert.equal(tuneForModel({ ...base, windowTokens: 131_072, env: { toolProfile: "compact" } }).toolProfile, "compact");
  assert.equal(tuneForModel({ ...base, windowTokens: 131_072, env: { leanTools: "1" } }).toolProfile, "lean");
  assert.equal(tuneForModel({ ...base, windowTokens: 16_384, leanToolTokens: undefined }).toolProfile, "lean", "without the trimmed cost, as before");
});

await test("a compact call offers the core for the moment, and more_tools names the rest", () => {
  const explore = profiles.compactToolNames(ALL, { inEncounter: false }, []);
  for (const name of ["request_roll", "move_party", "start_encounter", "social_check", "grant_item", "take_rest", "check_notice"]) {
    assert.ok(explore.has(name), `${name} is core out of a fight`);
  }
  for (const name of ["travel", "open_shop", "mount_up", "downtime", "apply_hazard", "learn_spell", "cast_buff"]) {
    assert.ok(!explore.has(name), `${name} waits for its group`);
  }
  assert.ok(explore.has("some_new_tool"), "a tool no group names is never hidden");
  const fight = profiles.compactToolNames([...ALL, "pc_attack", "enemy_attack", "end_turn"], { inEncounter: true }, []);
  assert.ok(fight.has("pc_attack") && fight.has("end_turn"));
  assert.ok(!fight.has("move_party") && !fight.has("purchase"), "the exploring core waits in a fight");
  const closed = profiles.closedGroups(ALL, explore);
  assert.ok(closed.includes("world") && closed.includes("shop") && !closed.includes("outside"));
  const more = profiles.moreToolsTool(closed);
  assert.deepEqual(more.function.parameters.properties.group.enum, closed);
  assert.match(more.function.description, /world \(treasure hoards/);
});

await test("the table's state and the players' words open groups without being asked", () => {
  const offered = (signals) => profiles.compactToolNames(ALL, { inEncounter: false, ...signals }, []);
  assert.ok(offered({ shopOpen: true }).has("haggle"), "a shop at hand");
  // Buying and selling is purchase, in the exploring core whether or not a
  // shop is open (issue #471).
  assert.ok(offered({}).has("purchase"));
  assert.ok(offered({ mounts: true }).has("mount_up"), "a horse at hand");
  assert.ok(offered({ caster: true }).has("cast_buff"), "a caster at the table");
  assert.ok(offered({ englishPlayerText: "I want to buy a longsword and sell these pelts." }).has("haggle"));
  assert.ok(offered({ englishPlayerText: "We travel north along the road for two days." }).has("travel"));
  assert.ok(offered({ englishPlayerText: "I try to jump the chasm." }).has("apply_hazard"));
  assert.ok(!offered({ englishPlayerText: "I ask the innkeeper about the missing girl." }).has("travel"), "ordinary talk opens nothing");
  assert.deepEqual([...profiles.autoGroups({ inEncounter: true, legendary: true })], ["legendary"]);
});

await test("a compacted tool keeps its name, kinds, enums and what is required; more_tools returns the rest", () => {
  const tool = {
    type: "function",
    function: {
      name: "request_roll",
      description: "Ask the server to roll. It rolls real dice. It never lets you choose. ".repeat(4),
      parameters: {
        type: "object",
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ["check", "save"], description: "What is rolled. A check or a save. Never an attack." },
          dc: { type: "number", description: "x".repeat(400) },
        },
      },
    },
  };
  const compact = profiles.compactTool(tool);
  assert.equal(compact.function.name, "request_roll");
  assert.equal(compact.function.description, "Ask the server to roll.");
  assert.deepEqual(compact.function.parameters.required, ["kind"]);
  assert.deepEqual(compact.function.parameters.properties.kind.enum, ["check", "save"]);
  assert.equal(compact.function.parameters.properties.kind.description, "What is rolled.");
  assert.ok(compact.function.parameters.properties.dc.description.length <= 104);
  const help = profiles.toolHelp(tool);
  assert.equal(help.instructions, tool.function.description);
  assert.equal(help.parameters.kind, tool.function.parameters.properties.kind.description);
  assert.deepEqual(profiles.readMoreToolsCall('{"group":"World"}'), { group: "world", tool: null });
  assert.deepEqual(profiles.readMoreToolsCall("not json"), { group: null, tool: null });
});

await test("the full rules are every line, word for word; a compact table's carry only what it needs", () => {
  const empty = { inEncounter: false, groups: new Set(), caster: false, features: false, classFeatures: false, featSpells: false, dying: false, arc: false, recall: false, map: false, legendary: false };
  assert.equal(rules.dmSystemText(false), rules.DM_SYSTEM);
  assert.equal(rules.dmSystemText(true, null), rules.dmSystemText(true));
  const fighters = rules.dmSystemText(false, empty);
  const casters = rules.dmSystemText(false, { ...empty, caster: true });
  assert.ok(fighters.length < rules.DM_SYSTEM.length * 0.7, "a table of fighters carries much less");
  assert.ok(!fighters.includes("Every spell is cast through exactly ONE tool"), "no spellcasting rules without a caster");
  assert.ok(casters.includes("Every spell is cast through exactly ONE tool"));
  for (const kept of ["NEVER state the result of any die roll", "NEVER invent a player character's actions", "A tool error comes marked", "Consumables go through use_item"]) {
    assert.ok(fighters.includes(kept), `always carried: ${kept}`);
  }
  assert.ok(!fighters.includes("roll_treasure"), "the world group's rules wait for the group");
  assert.match(rules.groupGuidance("world", false), /roll_treasure/);
  assert.match(rules.groupGuidance("sheet", false), /learn_spell/);
  assert.match(rules.groupGuidance("tactics", false), /declare_intent/);
  // The combat rules: the map's lines only with a map.
  const fight = { ...empty, inEncounter: true };
  assert.ok(!rules.encounterRulesText(false, fight).includes("Spell areas"));
  assert.ok(rules.encounterRulesText(false, { ...fight, map: true }).includes("Spell areas"));
  assert.equal(rules.encounterRulesText(false, null), rules.ENCOUNTER_RULES);
  // A class's own sentences ride only when someone at the table has it; a
  // class a world pack added (classes null) keeps every one.
  const withClasses = (classes) => ({ ...empty, inEncounter: true, classFeatures: true, map: true, classes });
  const fightersOnly = rules.encounterRulesText(false, withClasses(new Set(["fighter"])));
  assert.ok(!fightersOnly.includes("Deflect Missiles with the missile caught"), "a monk's reaction rides with no monk");
  assert.ok(rules.encounterRulesText(false, withClasses(new Set(["monk"]))).includes("Deflect Missiles with the missile caught"));
  assert.ok(rules.encounterRulesText(false, withClasses(null)).includes("Deflect Missiles with the missile caught"), "a homebrew class keeps every line");
  const coreFor = (classes) => rules.dmSystemText(false, { ...withClasses(classes), inEncounter: false });
  assert.ok(coreFor(new Set(["fighter"])).includes("Indomitable rerolls the last failed save by itself."));
  assert.ok(!coreFor(new Set(["fighter"])).includes("Channel Divinity variant"), "a cleric's Channel Divinity rides with no cleric");
  assert.ok(coreFor(new Set(["cleric"])).includes("Channel Divinity variant"));
  assert.ok(!coreFor(new Set(["cleric"])).includes("Indomitable rerolls"));
});

await test("a small model's short rules name the core tools in a few lines, and the moment's lines only", () => {
  const brief = { inEncounter: false, groups: new Set(["outside"]), caster: false, features: false, classFeatures: false, featSpells: false, dying: false, arc: true, recall: false, map: false, legendary: false, brief: true };
  const explore = rules.dmSystemText(false, brief);
  const fight = rules.encounterRulesText(false, { ...brief, inEncounter: true });
  const full = rules.dmSystemText(false, { ...brief, brief: false });
  assert.ok(explore.length < full.length / 4, `the short rules (${explore.length} chars) are a fraction of the full (${full.length})`);
  for (const tool of ["request_roll", "start_encounter", "move_party", "set_npc", "social_check", "complete_beat", "more_tools", "request_player_input"]) {
    assert.ok(explore.includes(tool), `out of a fight the short rules name ${tool}`);
  }
  for (const tool of ["pc_attack", "enemy_attack", "end_turn", "take_action", "aoe_damage"]) {
    assert.ok(fight.includes(tool), `in a fight they name ${tool}`);
  }
  assert.ok(!rules.dmSystemText(false, { ...brief, inEncounter: true }).includes("start_encounter"), "no fight to start in a fight");
  assert.ok(!explore.includes("cast_at_enemy") && !fight.includes("cast_at_enemy"), "no spell lines without a caster");
  assert.ok(rules.dmSystemText(false, { ...brief, caster: true }).includes("cast_at_enemy"));
  assert.ok(rules.dmSystemText(true, brief).includes("Ammunition is tracked"), "the table's variant rule still reaches the short rules");
  assert.ok(!rules.dmSystemText(false, { ...brief, arc: false }).includes("complete_beat"), "no beat to complete without an arc");
  // An opened group still brings its full lines.
  assert.match(rules.groupGuidance("world", false), /roll_treasure/);
});

// ---- a compact turn against a fake backend ---------------------------------------
const requests = [];
let script = [];
// A DM call: tools offered, or the game state in the message after the rules
// (src/lib/dm/prompt.ts stateAfterRules).
const isDmCall = (body) => Array.isArray(body.tools) || String(body.messages[1]?.content ?? "").includes("=== GAME STATE");
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    // A llama-server launched with -c 65536, for a table that sets no window.
    if (req.url.startsWith("/props")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ default_generation_settings: { n_ctx: 65_536 } }));
      return;
    }
    // Its listing: the tests' model reports no size, a small one does.
    if (req.url.endsWith("/v1/models")) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ data: [{ id: "fake" }, { id: "small-dm", meta: { n_params: 8_953_803_264 } }] }));
      return;
    }
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);
    // The DM's calls carry its game state, tools offered or not; the rest are
    // the claims reader's.
    const dm = isDmCall(body);
    const next = dm ? (script.shift() ?? { content: "The road winds on. What do you do?" }) : { content: "[]" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = next.call
      ? {
          ...(next.content ? { content: next.content } : {}),
          tool_calls: [{ index: 0, id: `call_${requests.length}`, type: "function", function: { name: next.call, arguments: JSON.stringify(next.args ?? {}) } }],
        }
      : { content: next.content };
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: next.call ? "tool_calls" : "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { createSheet, listSheets } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { getDmTurn, getLatestDmTurnId } = await import("../src/lib/db/dm-turns.ts");
const { startDmTurn, dmTurnTuning, dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { forgetContextWindows } = await import("../src/lib/model-client.ts");

const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
function table(line, model = "fake", tableLanguage = "english") {
  const campaign = createCampaign(lead.id, { title: "Compact", description: "A road.", theme: "a road", maxPlayers: 2, startingLevel: 1, difficulty: "normal", gameSettings: { ttsEnabled: false, tableLanguage } });
  updateStorySettings(campaign.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: model, imageGenerationEnabled: false, autoImages: false });
  setCampaignStatus(campaign.id, "active");
  const sheet = createSheet(campaign.id, lead.id, 1, createSheetSchema.parse({
    name: "Bram", race: "human", class: "fighter", abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, maxHp: 12, ac: 16,
    hitDice: { die: "d10", total: 1, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
  }));
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: sheet.id, content: line });
  return getCampaignById(campaign.id);
}

await test("a compact turn: the group opens free of the budget, rides from the next call, and its rules come with it", async () => {
  const campaign = table("I look around the crossroads.");
  assert.equal(dmTurnTuning(campaign).toolProfile, "compact", "16K takes the compact profile");
  script = [
    { call: "more_tools", args: { group: "world" } },
    { call: "set_weather", args: { condition: "rain" } },
    { call: "travel", args: { hours: 4, pace: "normal" } },
    { content: "Rain hammers the road as you march." },
  ];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the turn finished (${turn.status})`);
  const calls = requests.filter((body) => Array.isArray(body.tools));
  const offered = (body) => body.tools.map((tool) => tool.function.name);
  assert.ok(!offered(calls[0]).includes("travel"), "the first call carries the core");
  assert.ok(offered(calls[0]).includes("more_tools"));
  assert.ok(offered(calls[1]).includes("travel"), "the opened group rides from the next call");
  const result = calls[1].messages.find((message) => message.role === "tool");
  assert.match(String(result.content), /"opened":"world"/);
  assert.match(String(result.content), /roll_treasure/, "the group's rules came with it");
  assert.deepEqual(turn.contextTrace.profile.opened, ["world"]);
  assert.equal(calls.length, 4, "four calls: the lookup cost none of the four-call budget");
  assert.match(turn.narrationParts.join(" "), /Rain hammers the road/);
  // Every call fitted the 16K window.
  for (const body of calls) {
    const tokens = requestTokens(body.messages, body.tools);
    assert.ok(tokens + (body.max_tokens ?? 0) <= 16_384, `${tokens} + ${body.max_tokens} fits`);
  }
  // A compact system prompt: no spellcasting rules for a fighter alone.
  assert.ok(!String(calls[0].messages[0].content).includes("Every spell is cast through exactly ONE tool"));
  assert.ok(String(calls[0].messages[0].content).includes("NEVER state the result of any die roll"));
});

await test("a small model, sized by its server, plays on the short rules: no rulebook, enemy health in words, no dice markers in its transcript", async () => {
  const campaign = table("Goblins leap from the ditch! I raise my shield.", "small-dm");
  const hero = listSheets(campaign.id)[0];
  script = [
    { call: "request_roll", args: { characterId: hero.id, kind: "skill_check", skill: "athletics", difficulty: "easy" } },
    { call: "start_encounter", args: { enemies: [{ monster: "goblin", count: 1 }] } },
    { content: "A goblin snarls and circles you. What do you do?" },
  ];
  requests.length = 0;
  await startDmTurn(campaign.id);
  let turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the first turn finished (${turn.status}): ${turn.error ?? ""}`);
  assert.equal(dmTurnTuning(getCampaignById(campaign.id)).briefRules, true, "the 9B the server reported is small");
  const first = requests.find((body) => Array.isArray(body.tools));
  const system = String(first.messages[0].content);
  assert.match(system, /Every reply, in this order/);
  assert.ok(!system.includes("ENGINE BOUNDARY") && !system.includes("NEVER state the result of any die roll"), "no full rulebook");
  assert.ok(first.tools.some((tool) => tool.function.name === "more_tools"), "the compact set at a 64K window");
  // The next turn reads the fight: the goblin's health as a word, its attack
  // by name, and its own past narration without the dice markers.
  const sheet = hero;
  const told = listRecentMessages(campaign.id, 20).filter((message) => message.authorType === "dm").map((message) => message.content).join(" ");
  assert.match(told, /\[roll:[0-9a-f-]{36}\]/, "the stored narration carries the roll's dice marker");
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: sheet.id, content: "I hold my ground." });
  script = [{ content: "The goblin hesitates. What do you do?" }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the second turn finished (${turn.status}): ${turn.error ?? ""}`);
  const next = requests.find((body) => isDmCall(body));
  const state = next.messages.map((message) => String(message.content ?? "")).join("\n");
  assert.match(state, /Goblin[^\n]*\[enemyId=[^\]]+\] healthy/, "the goblin's health in a word");
  assert.ok(!/Goblin[^\n]*\[enemyId=[^\]]+\] HP \d/.test(state), "no hit points for a small model to repeat");
  assert.ok(!/\[roll:[0-9a-f-]{36}\]/.test(state), "no dice markers in the transcript it reads");
});

await test("a tool never offered still runs when called by name", async () => {
  const campaign = table("I sit quietly and listen.");
  script = [{ call: "pass_time", args: { hours: 6 } }, { content: "Night falls over the crossroads." }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  const calls = requests.filter((body) => Array.isArray(body.tools));
  assert.ok(!calls[0].tools.some((tool) => tool.function.name === "pass_time"), "it was not offered");
  const result = calls[1].messages.find((message) => message.role === "tool");
  assert.ok(!/no action called/.test(String(result.content)), `it ran (${String(result.content).slice(0, 120)})`);
  assert.equal(turn.status, "done");
});

await test("the players' words open the group the move needs on the first call", async () => {
  const campaign = table("I want to buy a sturdy rope and sell my old boots.");
  script = [{ content: "The trader eyes your boots. What will you offer?" }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const first = requests.find((body) => Array.isArray(body.tools));
  assert.ok(first.tools.some((tool) => tool.function.name === "haggle"), "the shop group rides from the start");
  assert.ok(first.tools.some((tool) => tool.function.name === "purchase"), "and the trade itself is in the exploring core");
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.deepEqual(turn.contextTrace.profile.intent, ["shop"]);
});

await test("the English words that open a group are read at an English table only: at every other table, English words included, a group is a more_tools call away", async () => {
  for (const language of ["italian", "french", "spanish", "german"]) {
    const campaign = table("I want to buy a sturdy rope and sell my old boots.", "fake", language);
    script = [{ content: "The trader eyes your boots. What will you offer?" }];
    requests.length = 0;
    await startDmTurn(campaign.id);
    const turn = getDmTurn(getLatestDmTurnId(campaign.id));
    assert.deepEqual(turn.contextTrace.profile.intent, [], language);
  }
});

// The window a lone first call of this table needs, by the same estimate the
// fit checks use: what a later call of the same turn outgrows.
async function firstCallTokens(line) {
  const campaign = table(line);
  script = [{ content: "Quiet fields." }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const first = requests.find((body) => Array.isArray(body.tools));
  return requestTokens(first.messages, first.tools);
}

await test("a follow-up the compact set no longer fits steps down to the essentials and the tools the turn has called", async () => {
  const line = "I wait by the crossroads stone.";
  const need = await firstCallTokens(line);
  // Room for the first call and its reply floor, not for a call and its
  // result on top of the whole compact set.
  process.env.OPENAI_COMPAT_CONTEXT = String(need + 1_024 + 30);
  const campaign = table(line);
  script = [{ call: "pass_time", args: { hours: 1 } }, { content: "An hour passes. A cart rattles by. What do you do?" }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the turn finished (${turn.status}): ${turn.error ?? ""}`);
  const calls = requests.filter((body) => Array.isArray(body.tools));
  assert.equal(calls.length, 2);
  const offered = (body) => body.tools.map((tool) => tool.function.name);
  assert.ok(offered(calls[1]).length < offered(calls[0]).length, `fewer tools (${offered(calls[0]).length} -> ${offered(calls[1]).length})`);
  for (const name of ["request_roll", "pass_time", "more_tools"]) {
    assert.ok(offered(calls[1]).includes(name), `${name} rides the narrow set`);
  }
  for (const body of calls) {
    assert.ok(requestTokens(body.messages, body.tools) + body.max_tokens <= Number(process.env.OPENAI_COMPAT_CONTEXT), "every call fits");
  }
  assert.match(turn.narrationParts.join(" "), /A cart rattles by/);
  process.env.OPENAI_COMPAT_CONTEXT = "16384";
});

await test("a follow-up no tool set fits narrates what the turn did with no tools offered, rather than halting", async () => {
  const line = "I keep watch on the road.";
  const need = await firstCallTokens(line);
  process.env.OPENAI_COMPAT_CONTEXT = String(need + 1_024 + 30);
  const campaign = table(line);
  // A long passage beside the call: more than the narrow set saves.
  // Varied, so the repetition guard leaves it be.
  const words = ["wind", "grass", "hill", "cart", "crow", "stone", "river", "lantern", "fence", "orchard", "bell", "smoke", "ridge", "ford", "mill", "hedge", "barrow", "shrine"];
  const passage = Array.from({ length: 1_600 }, (_, index) => `${words[(index * 7) % words.length]} ${words[(index * 11 + 3) % words.length]} ${index}`).join(", ");
  script = [{ call: "pass_time", args: { hours: 1 }, content: passage }, { content: "Dusk settles over the watch. What do you do?" }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the turn finished (${turn.status}): ${turn.error ?? ""}`);
  const dmCalls = requests.filter(isDmCall);
  assert.equal(dmCalls.length, 2);
  const echoed = dmCalls[1].messages.filter((message) => message.role === "assistant").map((message) => String(message.content ?? "").length);
  assert.ok(!dmCalls[1].tools?.length, `the follow-up offered no tools (${dmCalls[1].tools?.length} offered; assistant text ${echoed}; window ${process.env.OPENAI_COMPAT_CONTEXT}; sent ${requestTokens(dmCalls[1].messages, dmCalls[1].tools)})`);
  assert.ok(dmCalls[1].messages.some((message) => message.role === "tool"), "the call it narrates is answered");
  assert.match(turn.narrationParts.join(" "), /Dusk settles over the watch/);
  assert.ok(turn.contextTrace.calls.some((call) => call.task === "turn_without_tools"), "the trace names the call");
  process.env.OPENAI_COMPAT_CONTEXT = "16384";
});

await test("a window the full set fits keeps the full set, uncut", async () => {
  process.env.OPENAI_COMPAT_CONTEXT = "65536";
  const campaign = table("I look around.");
  script = [{ content: "Quiet fields." }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const first = requests.find((body) => Array.isArray(body.tools));
  assert.equal(dmTurnTuning(campaign).toolProfile, "full");
  assert.deepEqual(first.tools, JSON.parse(JSON.stringify(dmTurnTools(campaign, false, false, false))), "the full set, as before");
  assert.ok(String(first.messages[0].content).includes(rules.DM_SYSTEM), "every rule, word for word");
  process.env.OPENAI_COMPAT_CONTEXT = "16384";
});

await test("the first turn asks the endpoint for its window before it picks the tools", async () => {
  delete process.env.OPENAI_COMPAT_CONTEXT;
  forgetContextWindows();
  const campaign = table("I look around the square.");
  script = [{ content: "Pigeons scatter from the fountain." }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.contextTrace.profile.name, "full", "the 64K the server reports keeps the full set, not the 16K default's compact one");
  const first = requests.find((body) => Array.isArray(body.tools));
  assert.equal(first.tools.length, dmTurnTools(campaign, false, false, false).length);
  // What the prompt was budgeted around: the full set's cost, not the compact
  // one a 16K guess would have reserved before the endpoint was asked.
  const reserved = turn.contextTrace.blocks.find((block) => block.kind === "tools")?.tokens ?? 0;
  assert.ok(reserved >= requestTokens([], first.tools) - 200, `the full set was reserved (${reserved})`);
  process.env.OPENAI_COMPAT_CONTEXT = "16384";
});

// The minimums the README and the guided setup quote (src/lib/story-window.ts),
// by the same estimate every fit check uses: the live runs behind them are in
// docs/agent-context-efficiency-audit-2026-10-17.md.
const windows = await import("../src/lib/story-window.ts");
const COMBAT_TOOLS = ["pc_attack", "enemy_attack", "end_turn"];
const dmBodies = () => requests.filter((body) => isDmCall(body));
function allFit(window) {
  for (const body of dmBodies()) {
    const tokens = requestTokens(body.messages, body.tools ?? []);
    assert.ok(tokens + (body.max_tokens ?? 0) <= window, `${tokens} + ${body.max_tokens} fits ${window}`);
  }
}

await test("the narration minimum narrates an exploration turn", async () => {
  process.env.OPENAI_COMPAT_CONTEXT = String(windows.MIN_NARRATION_WINDOW);
  const campaign = table("I rest by the crossroads shrine for an hour.");
  script = [{ call: "pass_time", args: { hours: 1 } }, { content: "An hour slips by under the moss-grown stones. What do you do?" }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  const turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the turn finished (${turn.status}): ${turn.error ?? ""}`);
  assert.ok(dmBodies().every((body) => body.tools?.length), "with tools on every call");
  allFit(windows.MIN_NARRATION_WINDOW);
  process.env.OPENAI_COMPAT_CONTEXT = "16384";
});

await test("the combat minimum opens a fight and plays its next turn with the attack tools", async () => {
  process.env.OPENAI_COMPAT_CONTEXT = String(windows.MIN_COMBAT_WINDOW);
  const campaign = table("Bandits leap from the ditch! I draw my sword.");
  script = [{ call: "start_encounter", args: { enemies: [{ monster: "bandit" }, { monster: "bandit" }] } }, { content: "Steel rings as two bandits close in." }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  let turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the opening finished (${turn.status}): ${turn.error ?? ""}`);
  const opening = dmBodies();
  assert.ok(opening.length >= 2, "the fight opened and the turn went on");
  for (const body of opening.slice(1)) {
    const offered = (body.tools ?? []).map((tool) => tool.function.name);
    for (const name of COMBAT_TOOLS) assert.ok(offered.includes(name), `${name} offered once the fight runs`);
  }
  allFit(windows.MIN_COMBAT_WINDOW);

  const bram = listSheets(campaign.id)[0];
  insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: lead.id, characterId: bram.id, content: "I swing my longsword at the nearest bandit." });
  script = [{ content: "The bandit circles, wary. Make your attack roll." }];
  requests.length = 0;
  await startDmTurn(campaign.id);
  turn = getDmTurn(getLatestDmTurnId(campaign.id));
  assert.equal(turn.status, "done", `the next turn finished (${turn.status}): ${turn.error ?? ""}`);
  const offered = (dmBodies()[0].tools ?? []).map((tool) => tool.function.name);
  for (const name of COMBAT_TOOLS) assert.ok(offered.includes(name), `${name} offered on the fight's next turn`);
  allFit(windows.MIN_COMBAT_WINDOW);
  process.env.OPENAI_COMPAT_CONTEXT = "16384";
});

server.close();
removeTempDir(dir);
console.log(`tool-profiles: ${passed} tests passed`);
