// Issue #383, the model half: what a DM turn changes for the model a table
// runs on, read from the window and the model catalog rather than from the
// model's name (src/lib/dm/model-tuning-logic.ts). The trimmed tool set,
// the thinking request on tool calls and the reply cap used to be one
// environment switch each for every model. What must hold: the documented
// default setup is unchanged, a window the full tool set would crowd gets
// the trimmed set, a model the catalog says does not reason is not asked to
// think, a hosted model is never asked for more reply than it writes, the
// environment's switches still win, and the Context panel says why.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

process.env.ODM_MODEL_CATALOG = "off";
const { test, finish } = suite("test-model-tuning");

const { tuneForModel, MIN_STORY_ROOM_TOKENS, SMALL_MODEL_PARAMS } = await import("../src/lib/dm/model-tuning-logic.ts");
const { dmTurnTuning, dmTurnToolTokens } = await import("../src/lib/dm/turn.ts");
const { updateStorySettings, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { maxOutputTokensFor, configuredMaxOutputTokens } = await import("../src/lib/model-client.ts");
const { modelCatalog } = await import("../src/lib/model-registry/catalog.ts");

const world = await openWorld({ gameSettings: { ttsEnabled: false } });
world.addHero({ name: "Kara" });
// Only an admin's campaign keeps a backend address of its own
// (src/lib/db/settings.ts).
const { getDatabase } = await import("../src/lib/db/core.ts");
getDatabase().prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(world.owner.id);

function pointAt(settings, context) {
  if (context) process.env.OPENAI_COMPAT_CONTEXT = String(context);
  else delete process.env.OPENAI_COMPAT_CONTEXT;
  updateStorySettings(world.campaignId, { textProvider: "custom", imageGenerationEnabled: false, autoImages: false, ...settings });
  return getCampaignById(world.campaignId);
}

await test("The documented default (qwen3.6-35b on llama-server, a 64K window) keeps the full tool set and thinking on tool calls.", () => {
  const campaign = pointAt({ customBaseUrl: "http://127.0.0.1:8001/v1", customModel: "qwen3.6-35b" }, 65_536);
  const tuning = dmTurnTuning(campaign);
  assert.equal(tuning.leanTools, false, tuning.notes.join(" "));
  assert.equal(tuning.thinking, true, tuning.notes.join(" "));
  assert.equal(tuning.outputCap, null);
  assert.deepEqual(tuning.notes, []);
});

await test("A window the full tool set would crowd gets the trimmed set, says why, and charges the trimmed set to the prompt.", () => {
  const campaign = pointAt({ customBaseUrl: "http://127.0.0.1:8001/v1", customModel: "some-local-model" }, 49_152);
  const tuning = dmTurnTuning(campaign);
  assert.equal(tuning.leanTools, true);
  assert.equal(tuning.toolProfile, "lean");
  assert.match(tuning.notes.join(" "), /Trimmed tool set: the full set \(about \d+K tokens\) would leave only/);
  const lean = dmTurnToolTokens(campaign);
  const full = dmTurnToolTokens(pointAt({}, 131_072));
  assert.ok(lean < full, `the trimmed set (${lean}) is not smaller than the full set (${full})`);
  console.log(`[model-tuning] tool definitions: full ${full} tokens, trimmed ${lean}`);
});

await test("A window even the trimmed set would crowd gets the compact set, says why, and charges the compact set.", () => {
  const campaign = pointAt({ customBaseUrl: "http://127.0.0.1:8001/v1", customModel: "some-local-model" }, 16_384);
  const tuning = dmTurnTuning(campaign);
  assert.equal(tuning.toolProfile, "compact");
  assert.equal(tuning.leanTools, false);
  assert.equal(tuning.briefRules, false, "the window alone keeps the full rules");
  assert.match(tuning.notes.join(" "), /Compact tool set/);
  const compact = dmTurnToolTokens(campaign);
  const lean = dmTurnToolTokens(pointAt({ customModel: "some-local-model" }, 49_152));
  assert.ok(compact < lean * 0.7, `the compact set (${compact}) is well under the trimmed set (${lean})`);
  console.log(`[model-tuning] tool definitions: trimmed ${lean} tokens, compact ${compact}`);
});

await test("DM_LEAN_TOOLS and DM_THINKING in the environment still decide when they are set.", () => {
  const campaign = pointAt({ customBaseUrl: "http://127.0.0.1:8001/v1", customModel: "qwen3.6-35b" }, 16_384);
  process.env.DM_LEAN_TOOLS = "0";
  process.env.DM_THINKING = "0";
  try {
    const tuning = dmTurnTuning(campaign);
    assert.equal(tuning.leanTools, false);
    assert.equal(tuning.thinking, false);
  } finally {
    delete process.env.DM_LEAN_TOOLS;
    delete process.env.DM_THINKING;
  }
});

await test("A hosted model the catalog says does not reason is not asked to think, and its replies are capped at what it writes.", () => {
  // Any OpenAI row the bundled snapshot has that takes tools, does not
  // reason and writes less than the configured cap; no model is named here.
  const row = Object.values(modelCatalog().providers.openai?.models ?? {}).find(
    (model) => model.toolCall && !model.reasoning && model.outputTokens > 0 && model.outputTokens < configuredMaxOutputTokens() && model.contextTokens >= 100_000,
  );
  assert.ok(row, "the snapshot has no OpenAI row to test with");
  const campaign = pointAt({ customBaseUrl: "https://api.openai.com/v1", customModel: row.id, customApiKey: "sk-test-not-real-000000" });
  const tuning = dmTurnTuning(campaign);
  assert.equal(tuning.thinking, false, tuning.notes.join(" "));
  assert.equal(tuning.outputCap, row.outputTokens);
  assert.equal(maxOutputTokensFor("https://api.openai.com/v1", row.id), row.outputTokens);
  assert.match(tuning.notes.join(" "), /does not reason/);
  assert.equal(maxOutputTokensFor("http://127.0.0.1:8001/v1", row.id), configuredMaxOutputTokens(), "a local server's reply cap was taken from a hosted row");
});

await test("The rules, without the catalog: tools off in the catalog trim the set; an unknown model keeps today's behaviour.", () => {
  const base = { windowTokens: 65_536, fullToolTokens: 27_000, configuredOutputTokens: 16_384 };
  assert.deepEqual(tuneForModel({ ...base, catalog: null }), { toolProfile: "full", leanTools: false, briefRules: false, thinking: true, outputCap: null, notes: [] });
  assert.equal(tuneForModel({ ...base, catalog: { outputTokens: 0, toolCall: false, reasoning: true } }).leanTools, true);
  assert.equal(tuneForModel({ ...base, windowTokens: 27_000 + MIN_STORY_ROOM_TOKENS }).leanTools, false);
  assert.equal(tuneForModel({ ...base, windowTokens: 27_000 + MIN_STORY_ROOM_TOKENS - 1 }).leanTools, true);
  assert.equal(tuneForModel({ ...base, catalog: { outputTokens: 32_768, toolCall: true, reasoning: true } }).outputCap, null);
});

await test("A small model gets the short rules and the compact tools at any window, and says why; a large one and an unknown one do not.", () => {
  const base = { windowTokens: 81_920, fullToolTokens: 27_000, leanToolTokens: 22_000, configuredOutputTokens: 16_384, catalog: null };
  const small = tuneForModel({ ...base, parameters: 8_953_803_264 });
  assert.equal(small.briefRules, true);
  assert.equal(small.toolProfile, "compact");
  assert.match(small.notes.join(" "), /about 9B parameters/);
  assert.equal(small.thinking, true, "a small model still thinks before its tool calls");
  assert.equal(tuneForModel({ ...base, parameters: 35e9 }).briefRules, false);
  assert.equal(tuneForModel({ ...base, parameters: 35e9 }).toolProfile, "full");
  assert.equal(tuneForModel({ ...base, parameters: null }).briefRules, false);
  assert.equal(tuneForModel({ ...base, parameters: SMALL_MODEL_PARAMS }).briefRules, false, "the line itself is not small");
  // The environment still decides when set.
  const off = tuneForModel({ ...base, parameters: 9e9, env: { briefRules: "0" } });
  assert.deepEqual([off.briefRules, off.toolProfile], [false, "full"], "DM_BRIEF_RULES=0 plays a small model as any other");
  assert.equal(tuneForModel({ ...base, parameters: 35e9, env: { briefRules: "1" } }).briefRules, true);
  assert.equal(tuneForModel({ ...base, parameters: 9e9, env: { toolProfile: "full" } }).toolProfile, "full", "DM_TOOL_PROFILE still names the tools");
  // A model the catalog says takes no tools keeps the fewest.
  assert.equal(tuneForModel({ ...base, parameters: 9e9, catalog: { outputTokens: 0, toolCall: false, reasoning: true } }).toolProfile, "lean");
});

await test("A table on a small local model is fitted to it from the name alone when the server reports no size.", () => {
  const campaign = pointAt({ customBaseUrl: "http://127.0.0.1:8001/v1", customModel: "qwen3.5-9b-q8" }, 81_920);
  const tuning = dmTurnTuning(campaign);
  assert.equal(tuning.briefRules, true, tuning.notes.join(" "));
  assert.equal(tuning.toolProfile, "compact");
  const hosted = (model) => dmTurnTuning(pointAt({ customBaseUrl: "https://openrouter.ai/api/v1", customModel: model, customApiKey: "sk-or-test-000" })).briefRules;
  assert.equal(hosted("qwen/qwen3.5-9b"), true, "a small model is small wherever it runs");
  assert.equal(hosted("openai/gpt-oss-120b"), false);
  assert.equal(hosted("anthropic/claude-sonnet"), false, "a name with no size keeps the window's rules");
});

finish();
