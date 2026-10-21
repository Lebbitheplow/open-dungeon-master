// The pure parts of the agent-harness backend (docs/archive/harness-mcp-plan.md):
// how a DM turn is rendered for an agent program, what environment it may
// see, the lockdown flags each adapter starts it with, and how a picture it
// returns is checked. The flags are pinned here on purpose: a refactor that
// drops one of them turns a locked-down storyteller into a program with a
// shell, and must fail the build.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-harness-logic-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
register("./lib/register-alias.mjs", import.meta.url);

const { renderTurn, renderFollowUp, renderCompletion, toMcpTools, toolNames, HARNESS_PREAMBLE } = await import(
  "../src/lib/harness/render.ts"
);
const { buildChildEnv, leaksServerSecret } = await import("../src/lib/harness/child-env.ts");
const { claudeAdapter, claudeArgs, CLAUDE_ENV, CLAUDE_MCP_PREFIX, parseClaudeModels, withCacheBoundary } = await import(
  "../src/lib/harness/adapters/claude.ts"
);
const { effortChoices, withOfferedEffort } = await import("../src/lib/harness/effort-choices.ts");
const {
  codexAdapter,
  codexArgs,
  codexEffort,
  codexHomeTrouble,
  codexModel,
  codexTokenTotal,
  codexTurnUsage,
  directCatalog,
  ignoredCodexSettings,
  parseCodexCatalog,
  prepareCodexHome,
  userCodexMcpServers,
} = await import("../src/lib/harness/adapters/codex.ts");
const {
  opencodeAdapter,
  opencodeConfig,
  opencodeEffect,
  opencodeLockdownHolds,
  opencodeModels,
  opencodeVariant,
  opencodeVersion,
  opencodeDefaultModel,
  adminOpencodeConfig,
  staleOdmSessions,
  readOpencodeEvent,
  OPENCODE_BUILT_IN_ACTIONS,
} = await import("../src/lib/harness/adapters/opencode.ts");
const { grokAdapter, grokArgs, grokAgentProfile, GROK_ENV } = await import("../src/lib/harness/adapters/grok.ts");
const { sniffImage, imageSize, acceptImage, MAX_HARNESS_IMAGE_BYTES } = await import("../src/lib/harness/images.ts");
const { maskAccount } = await import("../src/lib/harness/status.ts");
const { knownInstallDirs } = await import("../src/lib/harness/discover.ts");
const { THIS_TURN_HEADING, THIS_MOMENT_HEADING, MOMENT_INSTRUCTION } = await import("../src/lib/prompt-boundary.ts");
const { buildDmMessages, buildGameStateBlock, ENCOUNTER_RULES, PLAYER_WHISPER_RULES, REAL_DICE_RULE } = await import(
  "../src/lib/dm/prompt.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const rollTool = {
  type: "function",
  function: {
    name: "request_roll",
    description: "Roll dice on the server.",
    parameters: { type: "object", properties: { characterId: { type: "string" } }, required: ["characterId"] },
  },
};

test("DM tools become MCP tools with their JSON Schema intact, deduplicated", () => {
  const tools = toMcpTools([rollTool, rollTool, { function: { name: "", parameters: {} } }, { nonsense: true }]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "request_roll");
  assert.equal(tools[0].inputSchema.type, "object");
  assert.deepEqual(tools[0].inputSchema.required, ["characterId"]);
  assert.deepEqual([...toolNames([rollTool])], ["request_roll"]);
});

test("a turn is rendered as the DM's own rules plus a transcript, with the preamble first", () => {
  const { system, prompt } = renderTurn([
    { role: "system", content: "RULES: the server is the rules engine." },
    { role: "user", content: "[Avery | attempt] I kick the door." },
    { role: "assistant", content: "The door groans." },
    { role: "user", content: [{ type: "text", text: "[Bryn] \"Careful.\"" }, { type: "image_url", image_url: { url: "x" } }] },
  ]);
  assert.ok(system.startsWith(HARNESS_PREAMBLE));
  assert.ok(system.includes("RULES: the server is the rules engine."));
  assert.ok(prompt.includes("[Avery | attempt] I kick the door."));
  assert.ok(prompt.includes("[Dungeon Master] The door groans."));
  assert.ok(prompt.includes("[a picture was shared here]"), "pictures are named, not silently dropped");
  assert.ok(prompt.endsWith("then write the narration."));
  assert.ok(!prompt.includes("RULES:"), "the rules stay in the system prompt, not the transcript");
});

test("a turn resumed after dice shows the calls and results as engine lines", () => {
  const { prompt } = renderTurn([
    { role: "system", content: "rules" },
    { role: "user", content: "I swing." },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "pc_attack", arguments: '{"target":"goblin-1"}' } }] },
    { role: "tool", tool_call_id: "c1", content: '{"hit":true,"damage":7}' },
  ]);
  assert.ok(prompt.includes('[engine] You called pc_attack {"target":"goblin-1"}'));
  assert.ok(prompt.includes('[engine] pc_attack answered: {"hit":true,"damage":7}'));
  assert.ok(prompt.includes("The dice above have landed."));
});

test("follow-ups carry only new user and system text, never tool results", () => {
  const text = renderFollowUp([
    { role: "assistant", content: "narration" },
    { role: "tool", tool_call_id: "x", content: "result" },
    { role: "user", content: "Your narration says the goblin died, but it has 3 HP left." },
  ]);
  assert.equal(text, "Your narration says the goblin died, but it has 3 HP left.");
});

test("a completion puts the last user message after the conversation", () => {
  const { system, prompt } = renderCompletion([
    { role: "system", content: "You summarise." },
    { role: "user", content: "Old passage." },
    { role: "assistant", content: "Summary so far." },
    { role: "user", content: "Summarise the chapter." },
  ]);
  assert.ok(system.includes("You summarise."));
  assert.ok(prompt.endsWith("Summarise the chapter."));
  assert.ok(prompt.includes("[assistant] Summary so far."));
});

test("the child environment is an allowlist: no server secret ever reaches a program", () => {
  const parent = {
    HOME: "/home/dm",
    PATH: "/usr/bin",
    LANG: "en_US.UTF-8",
    DB_ENCRYPTION_KEY: "a".repeat(64),
    OPENAI_COMPAT_API_KEY: "sk-server-key-123456",
    OPENROUTER_API_KEY: "or-key-123456",
    ODM_DEVICE_WORLD: "1",
    SQLITE_DB_PATH: "/data/odm.sqlite",
    ANTHROPIC_API_KEY: "sk-ant-admin",
    OPENAI_API_KEY: "sk-openai-admin",
    RANDOM_THING: "x",
  };
  const claude = buildChildEnv(parent, "claude", "/opt/bin:/usr/bin", { ODM_MCP_TOKEN: "t" });
  assert.equal(claude.HOME, "/home/dm");
  assert.equal(claude.PATH, "/opt/bin:/usr/bin");
  assert.equal(claude.ANTHROPIC_API_KEY, "sk-ant-admin", "the program's own key goes to it");
  assert.equal(claude.OPENAI_API_KEY, undefined, "another vendor's key does not");
  for (const secret of ["DB_ENCRYPTION_KEY", "OPENAI_COMPAT_API_KEY", "OPENROUTER_API_KEY", "ODM_DEVICE_WORLD", "SQLITE_DB_PATH", "RANDOM_THING"]) {
    assert.equal(claude[secret], undefined, `${secret} must not pass`);
  }
  assert.equal(leaksServerSecret(claude, parent), null);
  const codex = buildChildEnv(parent, "codex", "/usr/bin");
  assert.equal(codex.OPENAI_API_KEY, "sk-openai-admin");
  assert.equal(codex.ANTHROPIC_API_KEY, undefined);
  assert.equal(leaksServerSecret({ ...claude, SNEAKY: `prefix-${parent.DB_ENCRYPTION_KEY}` }, parent), "SNEAKY");
  // opencode 2 keeps its sign-ins in its store, which OPENCODE_DB can move.
  const opencodeHome = { ...parent, OPENCODE_CONFIG_DIR: "/home/dm/oc", OPENCODE_DB: "/home/dm/oc.db" };
  const opencode = buildChildEnv(opencodeHome, "opencode", "/usr/bin");
  assert.equal(opencode.OPENCODE_DB, "/home/dm/oc.db");
  assert.equal(opencode.OPENCODE_CONFIG_DIR, "/home/dm/oc");
  assert.equal(buildChildEnv(opencodeHome, "claude", "/usr/bin").OPENCODE_DB, undefined);
});

test("Claude Code is started with no built-in tools and only ODM's MCP server", () => {
  const args = claudeArgs({
    systemPromptPath: "/tmp/run/odm-system-prompt.md",
    model: "sonnet",
    effort: "high",
    mcpConfigPath: "/tmp/run/odm-mcp.json",
  });
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(value("--tools"), "", "every built-in tool removed");
  assert.ok(args.includes("--strict-mcp-config"), "the admin's own MCP servers ignored");
  assert.equal(value("--setting-sources"), "", "no user or project settings, hooks or CLAUDE.md");
  assert.equal(value("--permission-mode"), "dontAsk");
  assert.equal(value("--allowedTools"), `${CLAUDE_MCP_PREFIX}*`);
  assert.equal(value("--mcp-config"), "/tmp/run/odm-mcp.json");
  assert.equal(value("--system-prompt-file"), "/tmp/run/odm-system-prompt.md", "the system prompt replaces the coding persona");
  assert.ok(!args.includes("--system-prompt"), "the prompt itself never rides on the command line (Windows caps it at 32 K)");
  assert.ok(args.includes("--no-session-persistence"), "no transcript of a secret story left on disk");
  assert.ok(args.includes("--disable-slash-commands"));
  assert.equal(JSON.parse(value("--settings")).disableAllHooks, true);
  assert.equal(CLAUDE_ENV.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
  assert.equal(CLAUDE_ENV.CLAUDE_CODE_DISABLE_ADVISOR_TOOL, "1", "no second model consulted behind the lockdown's back");
  assert.equal(CLAUDE_ENV.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, "1", "no telemetry, error reports or auto-updates from a story run");
  assert.equal(CLAUDE_ENV.DISABLE_AUTOUPDATER, undefined, "auto-updates are already off through the switch above");
  assert.ok(!args.some((arg) => arg.includes("Bearer")), "the token never appears on the command line");
  const completion = claudeArgs({ systemPromptPath: "/tmp/run/odm-system-prompt.md", model: "", effort: "", mcpConfigPath: null });
  assert.ok(!completion.includes("--mcp-config"));
  assert.equal(completion[completion.indexOf("--tools") + 1], "");
});

test("Claude Code's models are the ones its initialize answer lists", () => {
  // Claude Code 2.1.296's answer on a Pro sign-in, trimmed to its models.
  const recorded = JSON.parse(fs.readFileSync(new URL("./fixtures/claude-initialize.json", import.meta.url), "utf8"));
  const { models, defaultEfforts } = parseClaudeModels(recorded.response.response.models);
  assert.deepEqual(
    models.map((model) => model.id),
    ["opus", "claude-fable-5-1[1m]", "sonnet", "haiku"],
    "in its order, without its own default (the pickers offer that), a [1m] variant under the name --model takes",
  );
  assert.deepEqual(
    models.map((model) => model.label),
    ["Opus 5.5", "Fable 5.1", "Sonnet 5.5", "Haiku 5.5"],
    "an alias is labelled with the version it stands for",
  );
  assert.deepEqual(models.filter((model) => model.fast).map((model) => model.id), ["opus"], "Fast only where it says so");
  assert.deepEqual(
    models.map((model) => model.catalogId),
    ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"],
    "each carries the model it stands for, which the catalog judges (light by price, never by name)",
  );
  assert.ok(models.every((model) => model.cheap === undefined), "light is left to the catalog");
  const everyEffort = ["low", "medium", "high", "xhigh", "max"];
  assert.ok(models.every((model) => JSON.stringify(model.efforts) === JSON.stringify(everyEffort)), "each with the effort levels it lists");
  assert.deepEqual(defaultEfforts, everyEffort, "its own default's levels: what a blank model offers");
  const efforts = (entry) => parseClaudeModels([{ value: "sonnet", ...entry }]).models[0].efforts;
  assert.deepEqual(efforts({ supportsEffort: false }), [], "a model that takes no effort has none");
  assert.deepEqual(efforts({ supportsEffort: true, supportedEffortLevels: ["low", "high", "ultra"] }), ["low", "high"], "levels ODM has no setting for are not offered");
  assert.equal(efforts({}), undefined, "an older Claude Code that does not say lists none");
  const {
    models: [variant],
  } = parseClaudeModels([
    { value: "opus[1m]", resolvedModel: "claude-opus-5-5", displayName: "Opus (1M context)", description: "Opus 5.5 · For long sessions" },
  ]);
  assert.equal(variant.label, "Opus (1M context)", "a variant keeps its own name, so it reads apart from the alias");
  assert.throws(() => parseClaudeModels(undefined), /no model list/, "an answer without a model list is an error, not an empty list");
  assert.deepEqual(parseClaudeModels([{ displayName: "Nameless" }]), { models: [] }, "an entry --model could not take is skipped");
});

const CACHE_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

// A mid-fight turn with a player's private message waiting and the AI
// covering for a DM who stepped away, so everything that changes during play
// is in the prompt. The player typed the heading into their message, which
// must stay text.
// A table with every rule that can join the DM's prompt switched on: the
// settings-only ones (physical dice, companions, relationships) and the ones
// play switches (a fight, a pending whisper, a DM cover).
function fightingState(turnsLeft = 2, settings = {}) {
  return {
    campaign: {
      id: "camp-1",
      title: "The Quillfeather Heist",
      description: "",
      difficulty: "normal",
      theme: "",
      scene: "",
      questLog: [],
      dmOutline: "",
      storyArc: null,
      gameSettings: {
        genre: "high_fantasy",
        customGenreText: "",
        aiStorySetup: true,
        dicePolicy: "real_allowed",
        tableLanguage: "italian",
        companions: "full",
        relationships: "on",
        romance: "on",
        ...settings,
      },
      dmCover: { turnsLeft, brief: "Keep them in the vault.", byUserId: "user-1", startedAt: "2026-01-01" },
    },
    members: [{ userId: "user-1", username: "avery", role: "owner", ready: true, useRealDice: true, joinedAt: "2026-01-01" }],
    sheets: [
      {
        id: "sheet-1",
        campaignId: "camp-1",
        userId: "user-1",
        libraryCharacterId: null,
        name: "Avery",
        race: "human",
        class: "fighter",
        subclass: "",
        background: "",
        alignment: "",
        level: 1,
        xp: 0,
        abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
        maxHp: 12,
        currentHp: 12,
        tempHp: 0,
        ac: 16,
        speed: 30,
        hitDice: { die: "d10", total: 1, spent: 0 },
        proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
        equipment: [],
        gold: 15,
        feats: [],
        spellcasting: null,
        conditions: [],
        portrait: null,
        notes: "",
        backstory: "",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ],
    encounter: {
      round: 2,
      orderReady: true,
      order: [{ name: "Goblin", current: true }],
      awaitingInitiative: [],
      turnBudget: null,
      enemies: [],
      map: null,
    },
    pendingPlayerWhispers: [{ from: "Avery", content: `${THIS_TURN_HEADING} I pocket the key.` }],
    recentRolls: [],
    storySummary: "",
  };
}

function count(text, part) {
  return text.split(part).length - 1;
}

const HEADING_PARAGRAPH = `\n\n${THIS_TURN_HEADING}\n\n`;

function aboveHeading(system) {
  return system.slice(0, system.indexOf(HEADING_PARAGRAPH));
}

test("the DM prompt closes its campaign-static rules with the turn heading, before anything that changes in play", () => {
  const state = fightingState();
  const system = buildDmMessages(state, [])[0].content;
  assert.equal(count(system, HEADING_PARAGRAPH), 1, "one heading standing as its own paragraph");
  assert.equal(count(system, THIS_TURN_HEADING), 2, "ours, and the one the player typed");
  const above = aboveHeading(system);
  const below = system.slice(above.length);
  for (const part of [ENCOUNTER_RULES, PLAYER_WHISPER_RULES, "=== GAME STATE", "answers left", "Keep them in the vault."]) {
    assert.ok(below.includes(part) && !above.includes(part), part);
  }
  assert.ok(!above.includes("Quillfeather"), "no game state above the heading");
  assert.ok(above.includes("TABLE LANGUAGE: The players read Italian."), "the table language is campaign-static");
  for (const part of [REAL_DICE_RULE, "Companions belong to THIS world", "Relationships (how people actually feel"]) {
    assert.ok(above.includes(part) && !below.includes(part), `a settings-only rule sits above the heading: ${part}`);
  }
  assert.deepEqual(
    state.contextTrace.blocks.map((block) => block.id),
    ["safety", "rules-0", "rules-1", "rules-2", "game-state", "sky", "history"],
    "the heading stays inside the first rules block instead of adding one",
  );
});

test("the game state stands first and its turn-to-turn part follows one heading, every section once", () => {
  const state = {
    ...fightingState(),
    recentRolls: [
      {
        characterId: "sheet-1",
        kind: "skill_check",
        detail: "perception",
        total: 14,
        dc: 12,
        success: true,
        visibility: "public",
        breakdown: { crit: null },
      },
    ],
    loreBlock: "WORLD LORE: the bell was cast from a drowned saint's chains.",
    houseRulesBlock: "HOUSE RULES: potions are a bonus action.",
    directorNotes: ["The fog thickens over the jetty."],
    worldBlock: "WORLD: Old Maren keeps a knife for every toll.",
    shopsBlock: "SHOP: the chandler sells lamp oil.",
  };
  const block = buildGameStateBlock(state);
  assert.equal(count(block, THIS_MOMENT_HEADING), 1);
  const [standing, moment] = block.split(THIS_MOMENT_HEADING);
  for (const part of ["=== GAME STATE (authoritative; never contradict) ===", "Campaign: The Quillfeather Heist", "Date and time:", "Party:\n"]) {
    assert.equal(count(block, part), 1, part);
    assert.ok(standing.includes(part), `standing: ${part}`);
  }
  for (const part of ["Active combat, round 2", "Recent rolls:", "WORLD LORE:", "HOUSE RULES:", "DIRECTOR NOTES", "WORLD: Old Maren", "SHOP:", "Private messages from players", "=== END GAME STATE ==="]) {
    assert.equal(count(block, part), 1, part);
    assert.ok(moment.includes(part), `moment: ${part}`);
  }
  assert.ok(buildDmMessages(state, [])[0].content.endsWith(`${moment.trimEnd()}`), "the moment runs to the end of the system prompt");
});

test("what play switches leaves the text above the heading as it was; a settings change moves it", () => {
  const above = aboveHeading(buildDmMessages(fightingState(), [])[0].content);
  const quiet = fightingState();
  quiet.encounter = null;
  quiet.pendingPlayerWhispers = [];
  quiet.campaign.dmCover = null;
  assert.equal(aboveHeading(buildDmMessages(quiet, [])[0].content), above, "fight, whisper and cover off");
  assert.equal(aboveHeading(buildDmMessages(fightingState(1), [])[0].content), above, "the cover countdown moved");
  for (const settings of [{ relationships: "off" }, { companions: "off" }, { romance: "off" }]) {
    assert.notEqual(aboveHeading(buildDmMessages(fightingState(2, settings), [])[0].content), above, JSON.stringify(settings));
  }
  const digital = fightingState();
  digital.members[0].useRealDice = false;
  assert.ok(!aboveHeading(buildDmMessages(digital, [])[0].content).includes(REAL_DICE_RULE), "a player gave up physical dice");
});

test("a chat model reads the turn-to-turn state after the transcript, the same text in the same words", () => {
  const history = [
    { id: "m1", seq: 1, authorType: "player", characterId: "sheet-1", content: "I listen at the chapel door.", intent: null },
    { id: "m2", seq: 2, authorType: "dm", characterId: null, content: "Chanting, low and wet.", intent: null },
  ];
  const plain = { ...fightingState(), contextLimitTokens: 131_072, directorBlock: "DIRECTOR: the bell rings once." };
  const chat = { ...plain, momentAfterHistory: true };
  const before = buildDmMessages(plain, history);
  const after = buildDmMessages(chat, history);
  assert.equal(after.length, before.length + 1, "one more message: the moment");
  assert.ok(before[0].content.includes(THIS_MOMENT_HEADING));
  assert.ok(!after[0].content.includes(THIS_MOMENT_HEADING), "no turn-to-turn state in the system message");
  const moment = after[1 + history.length];
  assert.equal(moment.role, "user");
  assert.ok(moment.content.startsWith(THIS_MOMENT_HEADING));
  // The newest player line is no longer the last thing read, so the moment
  // closes on the instruction to resolve it, as an agent program's opening
  // message does.
  assert.ok(moment.content.endsWith(`=== END GAME STATE ===\n\n${MOMENT_INSTRUCTION}`));
  assert.deepEqual(after.slice(1, 1 + history.length), before.slice(1, 1 + history.length), "the history is untouched");
  assert.equal(after.at(-1).content, "DIRECTOR: the bell rings once.", "the director's note stays last");
  assert.equal(`${after[0].content}\n\n${moment.content}`, `${before[0].content}\n\n${MOMENT_INSTRUCTION}`, "only the order changes, byte for byte");
  // The same budget and trace; only where the turn's own calls begin moves,
  // one message on, past the moment (src/lib/dm/turn-fit.ts).
  const withoutLength = (trace) => ({ ...trace, shape: { ...trace.shape, promptMessages: 0 } });
  assert.deepEqual(withoutLength(plain.contextTrace), withoutLength(chat.contextTrace), "the budget and the trace are the same");
  assert.equal(chat.contextTrace.shape.promptMessages, plain.contextTrace.shape.promptMessages + 1);
  assert.deepEqual(chat.contextTrace.shape.historyEnd, plain.contextTrace.shape.historyEnd, "the transcript sits in the same place");
});

test("a chat model reads the rules as the system message and the state as the message before the transcript", () => {
  const history = [
    { id: "m1", seq: 1, authorType: "player", characterId: "sheet-1", content: "I listen at the chapel door.", intent: null },
    { id: "m2", seq: 2, authorType: "dm", characterId: null, content: "Chanting, low and wet.", intent: null },
  ];
  const plain = { ...fightingState(), contextLimitTokens: 131_072, directorBlock: "DIRECTOR: the bell rings once." };
  const chat = { ...plain, stateAfterRules: true };
  const before = buildDmMessages(plain, history);
  const after = buildDmMessages(chat, history);
  assert.equal(after.length, before.length + 1, "one more message: the state");
  assert.equal(after[0].role, "system");
  assert.ok(!after[0].content.includes(THIS_TURN_HEADING), "no turn's state in the system message");
  assert.ok(after[0].content.endsWith(ENCOUNTER_RULES.split("\n").at(-1)), "a fight's rules stay with the rules");
  assert.equal(after[1].role, "user");
  assert.ok(after[1].content.startsWith(THIS_TURN_HEADING));
  assert.ok(after[1].content.endsWith("=== END GAME STATE ==="), "the state still runs to its end");
  assert.deepEqual(after.slice(2, 2 + history.length), before.slice(1, 1 + history.length), "the history is untouched");
  assert.equal(after.at(-1).content, "DIRECTOR: the bell rings once.", "the director's note stays last");
  const paragraphs = (text) => text.split("\n\n").sort();
  assert.deepEqual(paragraphs(`${after[0].content}\n\n${after[1].content}`), paragraphs(before[0].content), "the same text, moved");
  // What a prompt cache keeps from one turn of the fight to the next: the
  // cover countdown and the state move, the system message does not.
  assert.equal(buildDmMessages({ ...fightingState(1), stateAfterRules: true }, history)[0].content, after[0].content);
  assert.equal(chat.contextTrace.shape.historyStart, 2);
  assert.equal(chat.contextTrace.shape.historyEnd, 2 + history.length);
  // With the moment after the transcript as well, the standing state keeps
  // its place and the moment follows the history.
  const both = buildDmMessages({ ...plain, stateAfterRules: true, momentAfterHistory: true }, history);
  assert.ok(both[1].content.startsWith(THIS_TURN_HEADING) && !both[1].content.includes(THIS_MOMENT_HEADING));
  assert.ok(both[2 + history.length].content.startsWith(THIS_MOMENT_HEADING));
});

// What Claude Code caches as its second system block: everything after the
// boundary marker in the system prompt file it is given.
function blockTwo(state, history = []) {
  return withCacheBoundary(renderTurn(buildDmMessages(state, history), { settledTranscript: true }).system).split(CACHE_BOUNDARY)[1];
}

test("an agent program reads the turn-to-turn state after the transcript, and the rest stays put", () => {
  const state = { ...fightingState(), recentRolls: [], loreBlock: "WORLD LORE: the bell was cast from chains." };
  const history = [
    { id: "m1", seq: 1, authorType: "player", characterId: "sheet-1", content: "I listen at the chapel door.", intent: null },
    { id: "m2", seq: 2, authorType: "dm", characterId: null, content: "Chanting, low and wet.", intent: null },
  ];
  const { system, prompt } = renderTurn(buildDmMessages(state, history));
  assert.ok(!system.includes(THIS_MOMENT_HEADING) && !system.includes("WORLD LORE:"), "no turn-to-turn state in the system prompt");
  const block = blockTwo(state, history);
  for (const part of [ENCOUNTER_RULES, PLAYER_WHISPER_RULES, "=== GAME STATE (authoritative; never contradict) ===", "Party:\n"]) {
    assert.ok(block.includes(part), `block 2 holds ${part.slice(0, 40)}`);
  }
  const transcript = prompt.indexOf("</table_transcript>");
  const moment = prompt.indexOf(THIS_MOMENT_HEADING);
  const instruction = prompt.indexOf("It is your turn as the Dungeon Master");
  assert.ok(transcript > 0 && transcript < moment && moment < instruction, "transcript, then the moment, then the instruction");
  for (const part of ["Active combat, round 2", "WORLD LORE:", "Private messages from players", "=== END GAME STATE ==="]) {
    assert.equal(count(prompt, part) + count(system, part), 1, part);
  }
  // Only the moment differs: new dice and new lore leave block 2 as it was.
  const later = { ...state, loreBlock: "WORLD LORE: the chains came from a drowned saint." };
  later.recentRolls = [{ characterId: "sheet-1", kind: "skill_check", detail: "perception", total: 9, dc: 12, success: false, visibility: "public", breakdown: { crit: null } }];
  assert.equal(blockTwo(later, history), block, "fast state only");
  const withFact = { ...state, facts: [{ category: "world", subject: "The bell", fact: "The bell rings at the new moon.", pinned: false, knownBy: [] }] };
  assert.notEqual(blockTwo(withFact, history), block, "a fact added");
  assert.notEqual(blockTwo({ ...state, encounter: null }, history), block, "the fight ended");
});

test("Claude Code reads the older transcript in whole chunks of twenty in its system prompt, every line once, in order", () => {
  const lines = (count) =>
    Array.from({ length: count }, (_, at) => ({
      id: `m${at + 1}`,
      seq: at + 1,
      authorType: at % 2 ? "dm" : "player",
      characterId: at % 2 ? null : "sheet-1",
      content: `Line ${String(at + 1).padStart(3, "0")}: the bell tolls.`,
      intent: null,
    }));
  const state = () => ({ ...fightingState(), contextLimitTokens: 131_072 });
  assert.equal(claudeAdapter.settledTranscript, true, "Claude Code reads its system prompt from a file and caches it in blocks");
  const { system, prompt } = renderTurn(buildDmMessages(state(), lines(45)), { settledTranscript: true });
  for (let at = 1; at <= 45; at += 1) {
    const line = `Line ${String(at).padStart(3, "0")}:`;
    assert.equal(count(system, line) + count(prompt, line), 1, line);
    assert.ok((at <= 40 ? system : prompt).includes(line), `${line} is in the ${at <= 40 ? "system prompt" : "opening message"}`);
  }
  assert.ok(system.indexOf("Line 001:") < system.indexOf("Line 040:") && prompt.indexOf("Line 041:") < prompt.indexOf("Line 045:"));
  const block = blockTwo(state(), lines(45));
  assert.equal(blockTwo(state(), lines(41)), block, "the same chunk: block 2 stays as it was");
  assert.notEqual(blockTwo(state(), lines(61)), block, "a chunk closed: block 2 is written again");
});

test("every other program gets the whole transcript in its opening message, as before: none of them caches its system prompt in blocks", () => {
  const lines = (count) =>
    Array.from({ length: count }, (_, at) => ({
      id: `m${at + 1}`,
      seq: at + 1,
      authorType: at % 2 ? "dm" : "player",
      characterId: at % 2 ? null : "sheet-1",
      content: `Line ${String(at + 1).padStart(3, "0")}: the bell tolls.`,
      intent: null,
    }));
  for (const adapter of [codexAdapter, opencodeAdapter, grokAdapter]) {
    assert.notEqual(adapter.settledTranscript, true, `${adapter.id} keeps its transcript in the opening message`);
  }
  const state = { ...fightingState(), contextLimitTokens: 131_072 };
  const { system, prompt } = renderTurn(buildDmMessages(state, lines(45)));
  assert.ok(!system.includes("<table_transcript_earlier>"), "no transcript in the system prompt");
  for (let at = 1; at <= 45; at += 1) {
    const line = `Line ${String(at).padStart(3, "0")}:`;
    assert.equal(count(system, line), 0, line);
    assert.equal(count(prompt, line), 1, line);
  }
  assert.ok(prompt.indexOf("Line 001:") < prompt.indexOf("Line 045:"));
  // The turn-to-turn state still follows the transcript there.
  assert.ok(prompt.indexOf("</table_transcript>") < prompt.indexOf(THIS_MOMENT_HEADING));
});

test("Claude Code gets its cache boundary where the heading was, once, and every other prompt untouched", () => {
  const system = `rules\n\n${THIS_TURN_HEADING}\n\nstate\n\n${THIS_TURN_HEADING}`;
  assert.equal(withCacheBoundary(system), `rules\n\n${CACHE_BOUNDARY}\n\nstate\n\n${THIS_TURN_HEADING}`);
  const utility = renderCompletion([
    { role: "system", content: "You summarise." },
    { role: "user", content: "Summarise the chapter." },
  ]).system;
  assert.equal(withCacheBoundary(utility), utility);
});

test("a real DM turn reaches Claude Code with the boundary on its own line, directly after the DM rules", () => {
  const { system, prompt } = renderTurn(buildDmMessages(fightingState(), []));
  const written = withCacheBoundary(system);
  assert.equal(count(written, CACHE_BOUNDARY), 1);
  assert.equal(written.split("\n").filter((line) => line === CACHE_BOUNDARY).length, 1, "a line holding only the marker");
  assert.equal(written.slice(0, written.indexOf(CACHE_BOUNDARY)), `${aboveHeading(system)}\n\n`);
  assert.ok(aboveHeading(system).startsWith(`${HARNESS_PREAMBLE}\n\n`));
  assert.equal(written.replace(CACHE_BOUNDARY, THIS_TURN_HEADING), system, "nothing else changes");
  assert.ok(prompt.includes(`${THIS_TURN_HEADING} I pocket the key.`), "the player's copy stays text, in the moment");
});

test("Codex is started with its shell, web, apps and sub-agents off, read-only, never approving", () => {
  const args = codexArgs({ mcpUrl: "http://127.0.0.1:3005/api/mcp", images: false, disableServers: ["github"], catalogPath: "/run/codex-home/catalog.json" });
  const overrides = args.filter((_, index) => args[index - 1] === "-c");
  for (const expected of [
    "features.shell_tool=false",
    "features.unified_exec=false",
    "features.apps=false",
    "features.multi_agent=false",
    "features.image_generation=false",
    // Checked against Codex itself on 2026-10-09: these two are the keys that
    // remove the image viewer and the sub-agent tools. `tools.view_image`
    // was never a Codex key (ignored with a warning) and `features.multi_agent`
    // leaves the collaboration tools in place on current models.
    "features.view_image=false",
    "agents.enabled=false",
    'web_search="disabled"',
    // Checked on 0.162.1 on 2026-10-14 against the request Codex sends: each
    // removes a tool or a block of Codex's own from what the model is sent.
    "features.goals=false",
    "features.plugins=false",
    "skills.include_instructions=false",
    "include_permissions_instructions=false",
    "include_collaboration_mode_instructions=false",
    "include_environment_context=false",
    // ODM's tools straight in the request rather than behind a search.
    'model_catalog_json="/run/codex-home/catalog.json"',
    'sandbox_mode="read-only"',
    'approval_policy="never"',
    "mcp_servers.github.enabled=false",
    'mcp_servers.odm.url="http://127.0.0.1:3005/api/mcp"',
    'mcp_servers.odm.bearer_token_env_var="ODM_MCP_TOKEN"',
    // Issue #131: without this, Codex refuses its own calls to ODM's tools.
    'mcp_servers.odm.default_tools_approval_mode="approve"',
  ]) {
    assert.ok(overrides.includes(expected), `missing ${expected}`);
  }
  assert.equal(args[0], "app-server");
  assert.ok(!overrides.includes("tools.view_image=false"), "the key Codex ignores must not come back");
  const probeArgs = codexArgs({ mcpUrl: null, images: true, disableServers: [], catalogPath: null });
  assert.ok(probeArgs.includes("features.image_generation=true"));
  assert.ok(!probeArgs.some((arg) => arg.startsWith("model_catalog_json=")), "the probe lists Codex's own catalog");
  // Codex's own report of a setting it does not recognise, as the probe sees it.
  assert.deepEqual(
    ignoredCodexSettings(
      "Codex is ignoring 2 unrecognized configuration settings. Check for typos or deprecated settings.\n  session-flags: `tools.view_image` is ignored.\n  session-flags: `features.gone` is ignored.",
    ),
    ["tools.view_image", "features.gone"],
  );
  assert.deepEqual(ignoredCodexSettings("nothing of the kind"), []);
  assert.deepEqual(
    userCodexMcpServers('[mcp_servers.github]\ncommand = "x"\n\n[mcp_servers."linear"]\n[mcp_servers.odm]\n[profiles.fast]'),
    ["github", "linear"],
  );
});

// Two entries of `codex debug models` on 0.162.1, cut to the fields read here
// and one that must pass through untouched.
const CODEX_CATALOG = JSON.stringify({
  models: [
    {
      slug: "gpt-6.1-sol",
      supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map((effort) => ({ effort, description: effort })),
      truncation_policy: { mode: "tokens", limit: 10000 },
      experimental_supported_tools: ["send_user_message_async", "clock"],
      supports_search_tool: true,
      tool_mode: "code_mode_only",
    },
    {
      slug: "gpt-5.5",
      supported_reasoning_levels: ["low", "medium", "high", "xhigh"].map((effort) => ({ effort, description: effort })),
      truncation_policy: { mode: "tokens", limit: 10000 },
    },
  ],
});

test("Codex's own catalog is handed back with every model in direct tool mode, nothing else changed", () => {
  const models = parseCodexCatalog(CODEX_CATALOG);
  const direct = JSON.parse(directCatalog(models));
  assert.equal(direct.models.length, 2);
  for (const [at, model] of direct.models.entries()) {
    const original = JSON.parse(CODEX_CATALOG).models[at];
    assert.deepEqual(model, { ...original, tool_mode: "direct", supports_search_tool: false, experimental_supported_tools: [] });
  }
  assert.throws(() => parseCodexCatalog(JSON.stringify({ models: [] })), /no models/);
  assert.throws(() => parseCodexCatalog(JSON.stringify({ models: [{ display_name: "x" }] })), /no models/);
});

test("Codex runs at the admin's Effort when the model offers it, never clamped, and at its own default otherwise", () => {
  const models = parseCodexCatalog(CODEX_CATALOG);
  assert.equal(codexEffort(models, "gpt-6.1-sol", "xhigh"), "xhigh");
  assert.equal(codexEffort(models, "gpt-6.1-sol", "max"), "max");
  assert.equal(codexEffort(models, "gpt-5.5", "high"), "high");
  assert.equal(codexEffort(models, "gpt-5.5", "max"), null, "gpt-5.5 has no max");
  assert.equal(codexEffort(models, "gpt-6.1-sol", ""), null, "the program's default sends none");
  // The adapter checks against the model the thread runs on, the program's
  // default included; one missing from the catalog has no efforts to check.
  assert.equal(codexEffort(models, "gpt-unknown", "high"), null);
  // A recorded `model/list` entry: the card learns the same efforts, without
  // the levels ODM has no setting for.
  assert.deepEqual(
    codexModel({
      id: "gpt-6.1-sol",
      model: "gpt-6.1-sol",
      displayName: "GPT-6.1-Sol",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
      defaultReasoningEffort: "low",
      serviceTiers: [{ id: "priority", name: "Fast", description: "2x speed, increased usage" }],
    }),
    { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", fast: true, efforts: ["low", "medium", "high", "xhigh", "max"] },
  );
  assert.deepEqual(codexModel({ model: "gpt-5.5", supportedReasoningEfforts: [] }), { id: "gpt-5.5", label: "gpt-5.5", fast: false, efforts: [] });
});

test("the Effort picker offers what the chosen models list, as the model pickers list what the program reports", () => {
  const all = ["", "low", "medium", "high", "xhigh", "max"];
  const codex = {
    models: [
      { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", efforts: ["low", "medium", "high", "xhigh", "max"] },
      { id: "gpt-5.5", label: "GPT-5.5", efforts: ["low", "medium", "high", "xhigh"] },
    ],
    defaultEfforts: ["low", "medium", "high", "xhigh", "max"],
  };
  const pick = (model, utilityModel = "") => effortChoices(codex, { model, utilityModel });
  assert.deepEqual(pick("gpt-6.1-sol"), all);
  assert.deepEqual(pick("gpt-5.5"), all.slice(0, 5));
  // One Effort serves both models: what both list.
  assert.deepEqual(pick("gpt-6.1-sol", "gpt-5.5"), all.slice(0, 5));
  // A blank story model is the program's own default; a blank bookkeeping
  // model is the story model.
  assert.deepEqual(pick(""), all);
  assert.deepEqual(pick("", "gpt-5.5"), all.slice(0, 5));
  assert.deepEqual(effortChoices({ ...codex, defaultEfforts: ["low"] }, { model: "", utilityModel: "" }), ["", "low"]);
  // A model whose efforts are not known narrows nothing; the run checks it.
  assert.deepEqual(pick("gpt-gone"), all);
  assert.deepEqual(effortChoices({ models: [{ id: "haiku", label: "Haiku" }] }, { model: "", utilityModel: "haiku" }), all);
  // An opencode model with no variants offers only its own default.
  assert.deepEqual(effortChoices({ models: [{ id: "llama/qwen", label: "llama/qwen", efforts: [] }] }, { model: "llama/qwen", utilityModel: "" }), [""]);
  // A model change keeps the effort only where the new models offer it.
  const config = { model: "gpt-5.5", utilityModel: "", effort: "max" };
  assert.deepEqual(withOfferedEffort(codex, config), { ...config, effort: "" });
  assert.equal(withOfferedEffort(codex, { ...config, effort: "xhigh" }).effort, "xhigh");
  assert.equal(withOfferedEffort(codex, { ...config, model: "" }).effort, "max", "the default model lists it");
});

test("A Codex turn reports the tokens it spent, cached prompt and reasoning included as Codex counts them", () => {
  // `thread/tokenUsage/updated` as Codex sent it over two model calls in one
  // turn (the second one partly cached) and one call in the next.
  const update = (inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens) => ({
    threadId: "t1",
    turnId: "u1",
    tokenUsage: {
      total: { totalTokens: inputTokens + outputTokens, inputTokens, cachedInputTokens, cacheWriteInputTokens: 0, outputTokens, reasoningOutputTokens },
      last: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      modelContextWindow: 272000,
    },
  });
  const start = { inputTokens: 0, outputTokens: 0 };
  const first = codexTokenTotal(update(1000, 0, 5, 3));
  const afterTurn1 = codexTokenTotal(update(3000, 400, 10, 6));
  assert.deepEqual(first, { inputTokens: 1000, outputTokens: 5 });
  assert.deepEqual(codexTurnUsage(start, afterTurn1), { inputTokens: 3000, outputTokens: 10 });
  const afterTurn2 = codexTokenTotal(update(7000, 2800, 18, 9));
  assert.deepEqual(codexTurnUsage(afterTurn1, afterTurn2), { inputTokens: 4000, outputTokens: 8 });
  assert.equal(codexTokenTotal({ tokenUsage: {} }), null);
});

test("A Codex run's home links the admin's sign-in and config, and none of their instructions or skills", () => {
  const admin = path.join(dir, "codex-admin");
  const run = path.join(dir, "codex-run", "codex-home");
  fs.mkdirSync(path.join(admin, "skills", "mine"), { recursive: true });
  fs.writeFileSync(path.join(admin, "AGENTS.md"), "Speak like a pirate.");
  fs.writeFileSync(path.join(admin, "AGENTS.override.md"), "Speak like a parrot.");
  fs.writeFileSync(path.join(admin, "skills", "mine", "SKILL.md"), "---\nname: mine\n---");
  fs.writeFileSync(path.join(admin, "auth.json"), '{"tokens":{"refresh_token":"old"}}');
  fs.writeFileSync(path.join(admin, "config.toml"), 'model = "gpt-5.5"');
  prepareCodexHome(admin, run);
  assert.deepEqual(fs.readdirSync(run).sort(), ["auth.json", "config.toml"]);
  // Codex refreshes the sign-in by rewriting the file in place: the admin's
  // own copy must get the new tokens.
  fs.writeFileSync(path.join(run, "auth.json"), '{"tokens":{"refresh_token":"new"}}');
  assert.equal(fs.readFileSync(path.join(admin, "auth.json"), "utf8"), '{"tokens":{"refresh_token":"new"}}');
  // Removing the run folder leaves the admin's files where they were.
  fs.rmSync(path.join(dir, "codex-run"), { recursive: true, force: true });
  assert.ok(fs.existsSync(path.join(admin, "auth.json")));
  assert.ok(fs.existsSync(path.join(admin, "config.toml")));
  // An admin with no Codex home of their own (an API key in the environment).
  const bare = path.join(dir, "codex-run-bare", "codex-home");
  prepareCodexHome(path.join(dir, "no-such-home"), bare);
  assert.deepEqual(fs.readdirSync(bare), []);
  // When the link cannot be made, the card says why and what to do.
  const crossDrive = Object.assign(new Error("EXDEV: cross-device link not permitted, link 'D:\\codex\\auth.json'"), { code: "EXDEV" });
  assert.match(codexHomeTrouble(crossDrive), /another drive than the temp folder .*EXDEV.*Move CODEX_HOME/);
  assert.match(codexHomeTrouble(Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" })), /failed here \(EPERM/);
});

test("opencode 2's agent denies everything but ODM's tools, with ODM's MCP server outside Code Mode", () => {
  const none = { provider: {}, providers: {} };
  const config = opencodeConfig({ system: "SYS", mcp: { url: "http://127.0.0.1:1/api/mcp", token: "tok" }, admin: none });
  const rules = [
    { action: "*", resource: "*", effect: "deny" },
    { action: "odm_*", resource: "*", effect: "allow" },
  ];
  assert.deepEqual(config.permissions, rules);
  const agent = config.agents["odm-dm"];
  assert.equal(agent.system, "SYS");
  assert.equal(agent.mode, "primary");
  assert.deepEqual(agent.permissions, rules);
  assert.equal(config.mcp.servers.odm.codemode, false, "Code Mode would hide ODM's tools behind execute");
  assert.equal(config.mcp.servers.odm.oauth, false);
  assert.equal(config.mcp.servers.odm.headers.Authorization, "Bearer tok");
  assert.equal(config.providers, undefined);
  assert.equal(config.provider, undefined);
  assert.equal(config.model, undefined);
  // Read as opencode reads it: the last matching rule wins.
  assert.ok(opencodeLockdownHolds(agent.permissions, true));
  assert.ok(OPENCODE_BUILT_IN_ACTIONS.includes("execute") && OPENCODE_BUILT_IN_ACTIONS.includes("browser"));
  for (const action of OPENCODE_BUILT_IN_ACTIONS) {
    assert.equal(opencodeEffect(agent.permissions, action), "deny", action);
  }
  assert.equal(opencodeEffect(agent.permissions, "odm_request_roll"), "allow");
  const completion = opencodeConfig({ system: "S", mcp: null, admin: none });
  assert.equal(completion.mcp, undefined);
  assert.equal(opencodeEffect(completion.agents["odm-dm"].permissions, "odm_request_roll"), "deny");
  assert.ok(opencodeLockdownHolds(completion.agents["odm-dm"].permissions, false));
  // The rules opencode resolved for the agent on 2.0.27: its defaults first,
  // then ODM's, then the browser deny it appends.
  const resolved = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
    { action: "read", resource: "*.env.example", effect: "allow" },
    ...rules,
    { action: "browser", resource: "*", effect: "deny" },
  ];
  assert.ok(opencodeLockdownHolds(resolved, true));
  assert.ok(!opencodeLockdownHolds([...rules, { action: "*", resource: "*", effect: "allow" }], true), "an allow-all last opens everything");
  assert.ok(!opencodeLockdownHolds([...rules, { action: "read", resource: "*.md", effect: "allow" }], true), "a later allow on some files opens read");
  assert.ok(!opencodeLockdownHolds([...rules, { action: "shell", resource: "*", effect: "ask" }], true), "ask is not deny");
  assert.ok(!opencodeLockdownHolds([{ action: "*", resource: "*", effect: "deny" }], true), "ODM's tools must be allowed on a turn");
  assert.ok(!opencodeLockdownHolds(rules, false), "a completion gets no ODM tool either");
  assert.ok(!opencodeLockdownHolds([], false), "no rule at all allows everything");
  // opencode's own matcher: `?` is any one character, a trailing " *" may
  // match nothing, a backslash is a slash.
  assert.ok(!opencodeLockdownHolds([...rules, { action: "?*", resource: "*", effect: "allow" }], true), "a ?* allow opens every tool");
  assert.equal(opencodeEffect([{ action: "rea?", resource: "*", effect: "allow" }, { action: "*", resource: "*", effect: "deny" }], "read"), "deny");
  assert.equal(opencodeEffect([{ action: "*", resource: "*", effect: "deny" }, { action: "rea?", resource: "*", effect: "allow" }], "read"), "allow");
  assert.equal(opencodeEffect([{ action: "*", resource: "*", effect: "deny" }, { action: "web *", resource: "*", effect: "allow" }], "web"), "allow");
  assert.equal(opencodeEffect([{ action: "*", resource: "*", effect: "deny" }, { action: "a.b", resource: "*", effect: "allow" }], "axb"), "deny", "a dot is a dot");
  assert.equal(opencodeEffect([{ action: "*", resource: "*", effect: "deny" }, { action: "x\\y", resource: "*", effect: "allow" }], "x/y"), "allow");
});

test("opencode carries over only the providers and default models from the admin's global config, JSON or JSONC", () => {
  const llama = { package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: "http://127.0.0.1:8080/v1" } };
  assert.deepEqual(
    adminOpencodeConfig(JSON.stringify({ providers: { llama }, plugins: ["x"], mcp: { servers: { gh: {} } }, permissions: [], agents: { title: {} } })),
    { provider: {}, providers: { llama } },
  );
  const jsonc = `{
    // the admin's own notes
    "plugins": ["opencode-wakatime"],
    /* a block comment with "quotes" */
    "model": "llama/qwen",
    "small_model": "llama/tiny",
    "provider": { "old": { "options": { "baseURL": "http://a//b" } }, },
    "providers": { "llama": ${JSON.stringify(llama)}, },
  }`;
  // opencode 2 converts a 1.x entry (npm, options) only under `provider`;
  // under `providers` it is taken as 2.x's shape and every request fails.
  const admin = adminOpencodeConfig(jsonc);
  assert.deepEqual(admin, {
    provider: { old: { options: { baseURL: "http://a//b" } } },
    providers: { llama },
    model: "llama/qwen",
    small_model: "llama/tiny",
  });
  assert.deepEqual(adminOpencodeConfig("{}"), { provider: {}, providers: {} });
  assert.throws(() => adminOpencodeConfig("{ nope"));
  const config = opencodeConfig({ system: "S", mcp: null, admin });
  assert.deepEqual(config.provider, { old: { options: { baseURL: "http://a//b" } } });
  assert.deepEqual(config.providers, { llama });
  assert.equal(config.providers.old, undefined, "a 1.x entry is not put under providers");
  assert.equal(config.model, "llama/qwen");
  assert.equal(config.small_model, "llama/tiny");
  assert.equal(config.plugins, undefined);
  const legacyOnly = opencodeConfig({ system: "S", mcp: null, admin: adminOpencodeConfig(JSON.stringify({ provider: { old: {} } })) });
  assert.equal(legacyOnly.providers, undefined, "each key only when it holds something");
  assert.deepEqual(legacyOnly.provider, { old: {} });
});

test("the admin's opencode config is read as opencode reads it: a byte order mark, comments and trailing commas, strings untouched", () => {
  const llama = { name: "Llama, }", settings: { baseURL: "http://a//b/*c*/" } };
  assert.deepEqual(adminOpencodeConfig(`\uFEFF${JSON.stringify({ providers: { llama } })}`).providers, { llama }, "Windows PowerShell writes a BOM");
  assert.deepEqual(adminOpencodeConfig(JSON.stringify({ providers: { a: { name: "x, }", list: "[1, ]" } } })).providers, { a: { name: "x, }", list: "[1, ]" } });
  const jsonc = `{
    "providers": {
      "llama": ${JSON.stringify(llama)}, // the local one
      /* none yet */
    },
    "model": "llama/qwen", /* the default */
  }`;
  assert.deepEqual(adminOpencodeConfig(jsonc), { provider: {}, providers: { llama }, model: "llama/qwen" });
  assert.throws(() => adminOpencodeConfig("[1, 2]"), /does not hold a JSON object/);
});

test("a broken opencode config is reported by line and column, never with any of its text: it holds API keys", () => {
  const lines = [
    "{",
    "  // keys below, and a comment that takes up room: /* \"quoted\" */",
    '  "providers": { "a": { "apiKey": "sk-live-SECRET1234567890", "x": undefined } },',
    "}",
  ];
  const broken = lines.join("\n");
  let message = "";
  try {
    adminOpencodeConfig(broken);
  } catch (error) {
    message = error.message;
  }
  assert.equal(message, `it is not valid JSON at line 3, column ${lines[2].indexOf("undefined") + 1}`);
  // JSON.parse's own message for this text quotes the key's last characters.
  assert.throws(() => JSON.parse(broken.replace(/\/\/.*/, "")), /90/);
  const atStart = "\uFEFF{\n  \"model\": \"a/b\"\n  \"providers\": {}\n}";
  assert.throws(() => adminOpencodeConfig(atStart), { message: "it is not valid JSON at line 3, column 3" });
  assert.throws(() => adminOpencodeConfig('{ "a": "unterminated'), { message: "it is not valid JSON at line 1, column 8" });
  assert.throws(() => adminOpencodeConfig(""), { message: "it is not valid JSON at line 1, column 1" });
});

// GET /api/model on 2.0.27, trimmed.
const OPENCODE_MODELS = [
  { id: "claude-sonnet-5-5", providerID: "anthropic", variants: [{ id: "low" }, { id: "medium" }, { id: "high" }, { id: "xhigh" }, { id: "max" }], limit: { context: 1000000, output: 128000 } },
  { id: "claude-haiku-5-5", providerID: "anthropic", variants: [{ id: "none" }, { id: "low" }, { id: "medium" }, { id: "high" }, { id: "xhigh" }, { id: "max" }], limit: { context: 1000000, output: 128000 } },
  { id: "qwen/qwen3.8-flash", providerID: "openrouter", variants: [{ id: "none" }, { id: "high" }, { id: "max" }], limit: { context: 1000000, output: 131072 } },
  { id: "exo-free", providerID: "opencode", variants: [], limit: { context: 1048576, output: 131072 } },
];

test("opencode's models come with the efforts they offer, and Effort is sent as the model's variant", () => {
  const models = opencodeModels(OPENCODE_MODELS);
  assert.deepEqual(
    models.map((model) => model.id),
    ["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "openrouter/qwen/qwen3.8-flash"],
    "opencode's own free models refuse outside use and are not offered",
  );
  assert.deepEqual(models[0].efforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(models[2].efforts, ["high", "max"], "none and minimal are not efforts ODM offers");
  // An empty list says "no effort setting", so the admin card's hint shows.
  assert.deepEqual(opencodeModels([{ id: "m1", providerID: "llama", variants: [], limit: { context: 0 } }]), [{ id: "llama/m1", label: "llama/m1", efforts: [] }]);
  assert.deepEqual(opencodeModels([{ id: "m1", providerID: "llama", variants: [{ id: "none" }], limit: { context: 0 } }])[0].efforts, []);
  assert.equal(models[0].contextTokens, 1000000);
  assert.equal(opencodeVariant(OPENCODE_MODELS, "anthropic/claude-sonnet-5-5", "low"), "low");
  assert.equal(opencodeVariant(OPENCODE_MODELS, "openrouter/qwen/qwen3.8-flash", "max"), "max");
  assert.equal(opencodeVariant(OPENCODE_MODELS, "openrouter/qwen/qwen3.8-flash", "medium"), undefined, "an effort the model lacks is not sent");
  assert.equal(opencodeVariant(OPENCODE_MODELS, "anthropic/claude-sonnet-5-5", ""), undefined, "the program's default sends none");
  assert.equal(opencodeVariant(OPENCODE_MODELS, "llama/unlisted", "high"), undefined);
});

test("with no model chosen, opencode runs its default only when a run can use it, else the first usable model", () => {
  const sonnet = OPENCODE_MODELS[0];
  const exo = OPENCODE_MODELS[3];
  assert.equal(opencodeDefaultModel(OPENCODE_MODELS, OPENCODE_MODELS[2]), "openrouter/qwen/qwen3.8-flash", "the admin's own model");
  assert.equal(opencodeDefaultModel(OPENCODE_MODELS, exo), "anthropic/claude-sonnet-5-5", "never opencode's own free model");
  assert.equal(opencodeDefaultModel(OPENCODE_MODELS, null), "anthropic/claude-sonnet-5-5");
  assert.equal(opencodeDefaultModel(OPENCODE_MODELS, { ...sonnet, providerID: "gone" }), "anthropic/claude-sonnet-5-5", "a default it does not list");
  assert.equal(opencodeDefaultModel([exo], exo), null);
});

test("opencode 2's events become ODM's: narration only, usage summed over the turn's steps with cached prompt and reasoning counted, errors by kind", () => {
  const session = { sessionID: "ses_1", assistantMessageID: "msg_1" };
  const recorded = [
    { type: "session.step.started", data: { ...session, agent: "odm-dm" } },
    { type: "session.text.delta", data: { ...session, ordinal: 0, delta: "Roll! " } },
    { type: "session.tool.called", data: { ...session, id: "call_1", input: { die: "d20" } } },
    { type: "session.text.ended", data: { ...session, ordinal: 0, text: "Roll! " } },
    { type: "session.step.ended", data: { ...session, finish: "tool-calls", tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } } },
    { type: "session.usage.updated", data: { sessionID: "ses_1", tokens: { input: 100, output: 10 } } },
    { type: "session.reasoning.started", data: { ...session, ordinal: 0 } },
    { type: "session.reasoning.delta", data: { ...session, ordinal: 0, delta: "secret thoughts " } },
    { type: "session.reasoning.ended", data: { ...session, ordinal: 0, text: "secret thoughts " } },
    { type: "session.text.delta", data: { ...session, ordinal: 0, delta: "The goblin falls." } },
    { type: "session.step.ended", data: { ...session, finish: "stop", tokens: { input: 20, output: 5, reasoning: 7, cache: { read: 60, write: 40 } } } },
    { type: "session.usage.updated", data: { sessionID: "ses_1", tokens: { input: 220, output: 15 } } },
    { type: "session.execution.succeeded", data: { sessionID: "ses_1" } },
  ];
  const turn = { text: "", inputTokens: 0, outputTokens: 0 };
  const heard = recorded.flatMap((event) => readOpencodeEvent(turn, event));
  assert.deepEqual(heard, [
    { type: "delta", text: "Roll! " },
    { type: "delta", text: "The goblin falls." },
    { type: "turn_end", text: "Roll! The goblin falls.", usage: { inputTokens: 220, outputTokens: 22 } },
  ]);
  assert.ok(!JSON.stringify(heard).includes("secret"), "reasoning reaches no one");
  assert.deepEqual(turn, { text: "", inputTokens: 0, outputTokens: 0 }, "the next turn starts from nothing");
  const auth = { type: "provider.auth", message: "Incorrect API key provided", status: 401 };
  assert.deepEqual(readOpencodeEvent(turn, { type: "session.execution.failed", data: { sessionID: "ses_1", error: auth } }), [
    { type: "error", kind: "signed-out", message: "Incorrect API key provided" },
  ]);
  const limit = { type: "provider.rate-limit", message: "Rate limit reached for requests", status: 429 };
  assert.deepEqual(readOpencodeEvent(turn, { type: "session.retry.scheduled", data: { ...session, attempt: 2, error: limit } }), [
    { type: "error", kind: "limit", message: "Rate limit reached for requests" },
  ]);
  assert.deepEqual(readOpencodeEvent(turn, { type: "session.retry.scheduled", data: { ...session, attempt: 2, error: { type: "provider.overloaded", message: "busy" } } }), [], "other retries are opencode's to make");
  // A provider that cannot be reached (the local model server is not
  // running): opencode would retry until the turn times out with no reason
  // given, so the turn ends with opencode's after a few tries.
  const transport = { type: "provider.transport", message: "ConnectionRefused: Unable to connect. Is the computer able to access the url?" };
  for (const attempt of [2, 3]) {
    assert.deepEqual(readOpencodeEvent(turn, { type: "session.retry.scheduled", data: { ...session, attempt, error: transport } }), [], `retry ${attempt}`);
  }
  assert.deepEqual(readOpencodeEvent(turn, { type: "session.retry.scheduled", data: { ...session, attempt: 4, error: transport } }), [
    { type: "error", kind: "crash", message: `opencode could not reach the model's provider: ${transport.message}` },
  ]);
  assert.equal(readOpencodeEvent(turn, { type: "session.execution.failed", data: { sessionID: "ses_1", error: { type: "unknown", message: "boom" } } })[0].kind, "crash");
  // A figure a later opencode leaves out counts as none, and a delta that is
  // not text is no narration.
  const sparse = { text: "", inputTokens: 0, outputTokens: 0 };
  assert.deepEqual(
    [
      { type: "session.text.delta", data: { ...session, delta: undefined } },
      { type: "session.text.delta", data: { ...session, delta: "Done." } },
      { type: "session.step.ended", data: { ...session, tokens: { input: 9, output: 4 } } },
      { type: "session.step.ended", data: { ...session } },
      { type: "session.execution.succeeded", data: { sessionID: "ses_1" } },
    ].flatMap((event) => readOpencodeEvent(sparse, event)),
    [
      { type: "delta", text: "Done." },
      { type: "turn_end", text: "Done.", usage: { inputTokens: 9, outputTokens: 4 } },
    ],
  );
});

test("opencode below 2 is installed but unsupported", () => {
  assert.deepEqual(opencodeVersion("opencode v2.0.27\n"), { version: "2.0.27", supported: true });
  assert.deepEqual(opencodeVersion("1.18.30\n"), { version: "1.18.30", supported: false });
  assert.equal(opencodeVersion("nonsense"), null);
});

test("the sweep deletes only sessions a killed ODM run left behind", () => {
  // Folders as this platform spells them: on Windows "/tmp" resolves to a
  // drive ("D:\\tmp"), and the sweep compares resolved folders.
  const at = (...parts) => path.resolve(...parts);
  const tmpdir = at("/tmp");
  const tag = { openDungeonMaster: "run" };
  const live = new Set([at(tmpdir, "odm-harness-live")]);
  const now = Date.now();
  const sessions = [
    { id: "gone", metadata: tag, location: { directory: at(tmpdir, "odm-harness-gone") }, time: { updated: now } },
    { id: "live-run", metadata: tag, location: { directory: at(tmpdir, "odm-harness-live") }, time: { updated: now - 60_000 } },
    { id: "admin-own", location: { directory: at("/home/dm/projects/site") } },
    { id: "same-title-no-tag", location: { directory: at(tmpdir, "odm-harness-old") } },
    { id: "tag-outside-tmp", metadata: tag, location: { directory: at("/home/dm/odm-harness-x") } },
    { id: "tag-nested", metadata: tag, location: { directory: at(tmpdir, "sub", "odm-harness-y") } },
    { id: "tag-other-folder", metadata: tag, location: { directory: at(tmpdir, "project") } },
    { id: "tag-no-folder", metadata: tag },
    { id: "other-tag", metadata: { openDungeonMaster: "something else" }, location: { directory: at(tmpdir, "odm-harness-z") } },
  ];
  const options = { tmpdir, now, exists: (dir) => live.has(dir), canonical: (dir) => dir };
  assert.deepEqual(staleOdmSessions(sessions, options), ["gone"]);
  // ODM itself was killed (the desktop app quit mid-turn): the run folder
  // stays, but no run lives 20 minutes, so a session half an hour old is
  // left behind; one a few minutes old may be a live table's.
  const kept = { id: "folder-kept", metadata: tag, location: { directory: at(tmpdir, "odm-harness-live") } };
  assert.deepEqual(staleOdmSessions([{ ...kept, time: { updated: now - 31 * 60_000 } }], options), ["folder-kept"]);
  assert.deepEqual(staleOdmSessions([{ ...kept, time: { updated: now - 19 * 60_000 } }], options), []);
  assert.deepEqual(staleOdmSessions([{ ...sessions[2], time: { updated: 0 } }, { ...sessions[4], time: { updated: 0 } }], options), [], "age alone never makes an admin session ODM's");
});

test("the sweep finds the temp dir however opencode spells it: through a symlink, or not resolvable at all", () => {
  const realTmp = fs.mkdtempSync(path.join(dir, "real-tmp-"));
  const linkTmp = path.join(dir, "link-tmp");
  fs.symlinkSync(realTmp, linkTmp, process.platform === "win32" ? "junction" : "dir");
  const canonical = (folder) => {
    try {
      return fs.realpathSync.native(folder);
    } catch {
      return null;
    }
  };
  const tag = { openDungeonMaster: "run" };
  const tmpdir = fs.realpathSync.native(realTmp);
  const sessions = [
    { id: "via-link", metadata: tag, location: { directory: path.join(linkTmp, "odm-harness-a") } },
    { id: "real", metadata: tag, location: { directory: `${realTmp}${path.sep}odm-harness-b` } },
    { id: "slashes-and-dot", metadata: tag, location: { directory: `${realTmp.replaceAll(path.sep, "/")}/./odm-harness-c` } },
    { id: "parent-gone", metadata: tag, location: { directory: path.join(dir, "no-such-tmp", "odm-harness-d") } },
  ];
  assert.deepEqual(staleOdmSessions(sessions, { tmpdir, now: Date.now(), exists: () => false, canonical }), ["via-link", "real", "slashes-and-dot"]);
});

test("Grok Build runs in dontAsk with an agent profile naming only ODM's tools", () => {
  assert.deepEqual(grokArgs(), ["--permission-mode", "dontAsk", "agent", "stdio"]);
  const profile = grokAgentProfile("SYS", false);
  assert.ok(profile.includes('tools: ["odm__*"]'));
  assert.ok(profile.includes("SYS"));
  assert.ok(grokAgentProfile("S", true).includes('"image_gen"'));
  assert.equal(GROK_ENV.GROK_CLAUDE_MCPS_ENABLED, "0");
  assert.equal(GROK_ENV.GROK_CURSOR_MCPS_ENABLED, "0");
});

test("pictures are checked by their bytes, not by what the program says they are", () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]),
    Buffer.from([0, 0, 2, 0, 0, 0, 1, 0]),
    Buffer.alloc(64),
  ]);
  assert.deepEqual(sniffImage(png), { mime: "image/png", ext: "png" });
  assert.deepEqual(imageSize(png), { width: 512, height: 256 });
  assert.equal(sniffImage(Buffer.from("<svg onload=alert(1)>")), null);
  assert.equal(sniffImage(Buffer.from("%PDF-1.7 ...")), null);
  assert.equal(acceptImage(png)?.ext, "png");
  assert.equal(acceptImage(Buffer.from([0x89, 0x50])), null, "too small to be a picture");
  const huge = Buffer.concat([png, Buffer.alloc(MAX_HARNESS_IMAGE_BYTES)]);
  assert.equal(acceptImage(huge), null, "over the 8 MiB cap");
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 1, 0, 2, 0]), Buffer.alloc(80)]);
  assert.equal(sniffImage(jpeg)?.ext, "jpg");
  assert.deepEqual(imageSize(jpeg), { width: 512, height: 256 });
});

test("accounts are masked before they reach the admin page", () => {
  assert.equal(maskAccount("kaleb@example.com"), "ka…@example.com");
  assert.equal(maskAccount(undefined), undefined);
});

test("discovery looks where the installers put programs, not only on PATH", () => {
  const dirs = knownInstallDirs("/home/dm", "linux");
  assert.ok(dirs.includes("/home/dm/.local/bin"));
  assert.ok(dirs.includes("/home/dm/.npm-global/bin"));
  assert.ok(dirs.includes("/home/dm/.opencode/bin"));
  // Codex's own Windows installer (install.ps1) puts the binary here.
  const win = knownInstallDirs("C:\\Users\\dm", "win32");
  assert.ok(win.some((entry) => entry.endsWith("Programs\\OpenAI\\Codex\\bin")), "Codex's Windows install dir");
});

removeTempDir(dir);
console.log(`harness logic: ${passed} checks passed`);
