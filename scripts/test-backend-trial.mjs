// The admin's "Test backend" plays one campaign-shaped turn after its three
// quick checks (src/lib/backend-trial.ts): the storyteller's full rules and
// real tool schemas, the tool call streamed, and the narration streamed with
// the tools closed. A backend that passes the quick checks can still fail a
// campaign that way, and users found out only once a campaign began.
// requestDmMessage, the call a campaign's turn makes, runs against a fake
// OpenAI-compatible host (fetch is stubbed); the model's name picks how the
// fake behaves:
// - good: the tool call arrives in fragments, as streamed calls do;
// - repeats: every fragment repeats the name and the whole arguments, so
//   they join into a name no tool has, the way a broken compatible host
//   streams;
// - prose: narrates the action and calls nothing;
// - leaky: still calls a tool with the tools closed, then narrates once
//   none are offered;
// - silent: says nothing after the tool result;
// - strict: refuses stream_options the way an API that checks its body with
//   zod does (Venice), once, and plays the turn after it is dropped.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-backend-trial-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { runBackendTrial, trialShape } = await import("../src/lib/backend-trial.ts");
const { DM_SYSTEM } = await import("../src/lib/dm/prompt.ts");
const { probeRecord } = await import("../src/lib/model-registry/probes.ts");
const { DEFAULT_STORY_SETTINGS } = await import("../src/lib/defaults.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, setCampaignStatus, updateStorySettings } = await import("../src/lib/db/campaigns.ts");
const { compactTurnTools, dmTurnTools, dmTurnTuning, profileSignals } = await import("../src/lib/dm/turn.ts");

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`ok: ${name}`);
};

const sse = (events) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
const text = (...parts) => [
  ...parts.map((content) => ({ choices: [{ delta: { content } }] })),
  { choices: [{ delta: {}, finish_reason: "stop" }] },
];
const ARGS = '{"characterId":"pc-ash","kind":"skill_check","skill":"sleight_of_hand","difficulty":"moderate"}';
const callStart = { index: 0, id: "call_1", type: "function", function: { name: "request_roll", arguments: "" } };
const fragments = (pieces, repeatName = false) => [
  { choices: [{ delta: { tool_calls: [callStart] } }] },
  ...pieces.map((piece) => ({
    choices: [{ delta: { tool_calls: [{ index: 0, ...(repeatName ? { id: "call_1", function: { name: "request_roll", arguments: piece } } : { function: { arguments: piece } }) }] } }],
  })),
  { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
];

const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const { pathname } = new URL(String(url));
  if (!pathname.endsWith("/chat/completions")) {
    return new Response("Not Found", { status: 404 });
  }
  const body = JSON.parse(init.body);
  seen.push(body);
  const model = String(body.model);
  if (model === "strict" && "stream_options" in body) {
    return Response.json({ issues: [{ code: "unrecognized_keys", keys: ["stream_options"], path: [], message: "Unrecognized key(s) in object: 'stream_options'" }] }, { status: 400 });
  }
  const answered = body.messages.some((message) => message.role === "tool");
  if (!answered) {
    if (model === "prose") return sse(text("Ash kneels by the gate ", "and the lock clicks open."));
    if (model === "repeats") return sse(fragments([ARGS, ARGS], true));
    return sse(fragments([ARGS.slice(0, 20), ARGS.slice(20, 55), ARGS.slice(55)]));
  }
  if (model === "silent") return sse([{ choices: [{ delta: {}, finish_reason: "stop" }] }]);
  if (model === "leaky" && body.tools?.length) return sse(fragments([ARGS]));
  return sse(text("The tumblers give ", "one by one, and the gate swings open."));
};

const settingsFor = (model, baseUrl = "https://trial.test/v1") => ({
  ...DEFAULT_STORY_SETTINGS,
  textProvider: "custom",
  customBaseUrl: baseUrl,
  customModel: model,
  customApiKey: "test-key",
});
// The window is the stand-in for a server that names none (16K), as the
// fake names none.
const trial = (model, baseUrl) => runBackendTrial({ settings: settingsFor(model, baseUrl), timeoutMs: 30_000 });
const tokens = (value) => Math.ceil(JSON.stringify(value).length / 4);

{
  seen.length = 0;
  const result = await trial("good");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stages.toolTurn.detail, "Called request_roll.");
  assert.equal(result.stages.narration.ok, true);
  assert.equal(seen.length, 2, "one call for the tool, one for the narration");
  const [first, second] = seen;
  assert.equal(first.stream, true, "the tool call is streamed, as a turn's is");
  assert.equal(first.tool_choice, "auto");
  assert.equal(first.tools.length, trialShape(settingsFor("good")).tools.length);
  assert.ok(first.messages[0].content.startsWith(DM_SYSTEM), "the storyteller's own rules lead the prompt");
  assert.equal(second.stream, true);
  assert.equal(second.tool_choice, "none", "the narration is asked for with the tools closed");
  const echoed = second.messages.find((message) => message.role === "assistant");
  assert.equal(echoed.tool_calls[0].function.arguments, ARGS, "the fragments were joined into the call the model made");
  ok("a backend that streams its tool call in fragments and narrates after it passes");
}

{
  const result = await trial("repeats");
  assert.equal(result.ok, false);
  assert.equal(result.stages.toolTurn.ok, false);
  assert.match(result.stages.toolTurn.detail, /request_rollrequest_roll.*not one of the tools/);
  assert.match(result.stages.narration.detail, /Not tried/);
  ok("streamed fragments that do not join into the call the model made fail it, and the narration is not tried");
}

{
  const result = await trial("prose");
  assert.equal(result.ok, false);
  assert.match(result.stages.toolTurn.detail, /narrated instead of calling a tool/);
  ok("a model that narrates the action and calls nothing fails");
}

{
  seen.length = 0;
  const result = await trial("leaky");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.stages.narration.detail, /tools were taken away/);
  assert.equal(seen.length, 3);
  assert.equal(seen[2].tools, undefined, "the rescue call offers no tools, as narrateAfterToolLeak's does");
  ok("a tool call with the tools closed is rescued as a turn rescues it, and said");
}

{
  const result = await trial("silent");
  assert.equal(result.ok, false);
  assert.equal(result.stages.toolTurn.ok, true);
  assert.match(result.stages.narration.detail, /no narration/);
  ok("a model that says nothing after the tool result fails the narration");
}

{
  const fake = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: "Invalid API key." } }, { status: 401 });
  const result = await trial("good");
  globalThis.fetch = fake;
  assert.equal(result.ok, false);
  assert.ok(result.error, "the backend's refusal is passed on");
  assert.equal(result.stages.toolTurn.ok, false);
  ok("a refused request fails with the backend's answer");
}

{
  // Never more than a campaign's first call at that window: a fresh table
  // on the same backend, out of a fight, measured the way its turn builds
  // the call. At 32K to 48K the trial once sent 25 whole descriptions
  // (about 10,700 tokens) where the table's compact set is about 8,300.
  const lead = createUser(`trial${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
  for (const model of ["good", "trial-7b"]) {
    for (const window of [16_384, 32_768, 40_960, 49_152, 65_536, 131_072]) {
      process.env.OPENAI_COMPAT_CONTEXT = String(window);
      const made = createCampaign(lead.id, { title: "t", description: "t", theme: "t", maxPlayers: 2, startingLevel: 1, difficulty: "normal", gameSettings: { ttsEnabled: false } });
      updateStorySettings(made.id, { textProvider: "custom", customBaseUrl: "https://trial.test/v1", customModel: model, imageGenerationEnabled: false, autoImages: false });
      setCampaignStatus(made.id, "active");
      const campaign = getCampaignById(made.id);
      const tuning = dmTurnTuning(campaign);
      const tableTools =
        tuning.toolProfile === "compact"
          ? compactTurnTools(campaign, false, false, profileSignals(campaign, [], false), []).tools
          : dmTurnTools(campaign, false, false, tuning.leanTools);
      const shape = trialShape(settingsFor(model));
      const at = `${model} at ${window}`;
      assert.ok(shape.tools.length <= tableTools.length, `${at}: ${shape.tools.length} tools, the table ${tableTools.length}`);
      assert.ok(tokens(shape.tools) <= tokens(tableTools), `${at}: ${tokens(shape.tools)} tokens of tools, the table ${tokens(tableTools)}`);
      assert.equal(shape.tuning.toolProfile === "compact", tuning.toolProfile === "compact", `${at}: compact where the table is`);
      assert.equal(shape.tuning.briefRules, tuning.briefRules, `${at}: the short rules where the table reads them`);
      assert.ok(shape.tuning.briefRules ? shape.rules.length < DM_SYSTEM.length / 4 : shape.rules === DM_SYSTEM, `${at}: the rules a table there reads`);
    }
  }
  delete process.env.OPENAI_COMPAT_CONTEXT;
  // The small set has to fit the 16K a server that names no window is
  // planned at, with room left for a reply (chars/4, as request-fit counts).
  const small = trialShape(settingsFor("good"));
  const promptTokens = Math.ceil((small.rules.length + JSON.stringify(small.tools).length) / 4);
  assert.ok(promptTokens < 14_500, `the small trial prompt is ~${promptTokens} tokens`);
  process.env.OPENAI_COMPAT_CONTEXT = "131072";
  const names = trialShape(settingsFor("good")).tools.map((tool) => tool.function.name);
  delete process.env.OPENAI_COMPAT_CONTEXT;
  assert.ok(names.length > small.tools.length, `${names.length} tools with room, ${small.tools.length} without`);
  assert.equal(new Set(names).size, names.length, "no tool is offered twice");
  assert.ok(names.includes("request_roll"));
  ok("the trial sends no more tools, tool text or rules than a fresh table's first call at that window, small models included");
}

{
  // Thinking as a campaign's tool-deciding call thinks, and none on the
  // narration, on a server that takes the switch (a local llama-server).
  seen.length = 0;
  const result = await trial("good", "http://127.0.0.1:9/v1");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(seen[0].chat_template_kwargs?.enable_thinking, true, "the tool call thinks, as a turn's does");
  assert.equal(seen[1].chat_template_kwargs?.enable_thinking, false, "the narration does not");
  ok("the tool call thinks where a campaign's would, and the narration does not");
}

{
  // A small model reads the short rules a table on it would.
  seen.length = 0;
  const result = await trial("trial-7b");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(!seen[0].messages[0].content.startsWith(DM_SYSTEM) && seen[0].messages[0].content.length < DM_SYSTEM.length / 3, "the short rules, not the whole rulebook");
  ok("a small model plays the trial on the short rules");
}

{
  // A backend that refuses a body field in zod's words (#623) has it
  // dropped and the call retried, as a campaign's turn does, once.
  seen.length = 0;
  const result = await trial("strict");
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(seen.filter((body) => "stream_options" in body).length, 1, "refused once, then dropped for the rest of the turn");
  assert.equal(seen.length, 3, "the refused call, the tool call and the narration");
  ok("a field a strict backend refuses is dropped and the test turn retried");
}

{
  const quick = { ok: true, route: "chat", stages: { streaming: { ok: true }, toolCall: { ok: true }, toolContinuation: { ok: true } } };
  assert.equal(probeRecord("https://trial.test/v1", "m", quick).stages.turn, undefined, "no trial, nothing said of one");
  const failed = probeRecord("https://trial.test/v1", "m", { ...quick, ok: false, trial: { ok: false } });
  assert.equal(failed.ok, false);
  assert.equal(failed.stages.turn, false);
  ok("the model picker's record keeps a failed test turn");
}

globalThis.fetch = realFetch;
// The database handle stays open on purpose; Windows refuses rmSync on it.
removeTempDir(dir);
console.log(`backend-trial: ${passed} tests passed`);
