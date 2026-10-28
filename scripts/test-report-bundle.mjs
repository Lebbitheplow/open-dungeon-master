// The report bundle (issue #459, src/lib/report-bundle.ts): one file the
// server's admin saves to their own device for a GitHub bug report, at a
// table or from Admin. Nobody else may make one: a player tells whoever runs
// the server. What must hold is privacy. Keys and tokens never land in it, by shape or by the
// server's own saved values. Other players' lines and whispers never land
// in it at all. The narrator's prompt is never copied, and its tool calls'
// arguments go only to whoever runs the table, never a whisper's. The server
// log is an admin's alone, and the turn records whoever steers the story.
// Every one of those is decided from the seat, whatever the request asks.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-report-bundle");

process.env.TEST_REPORT_SERVICE_TOKEN = "env-report-secret-0099887766";
const bundle = await import("../src/lib/report-bundle.ts");
const log = await import("../src/lib/server-log.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const turns = await import("../src/lib/db/dm-turns.ts");
const { insertWhisper } = await import("../src/lib/db/dm-whispers.ts");

const realLog = console.log;
console.log = () => {};
log.installServerLog();

const PLAYER = { isAdmin: false, atTable: true, leadOrDm: false, steersStory: false, storytellerSecrets: false };
const AI_LEAD = { isAdmin: false, atTable: true, leadOrDm: true, steersStory: true, storytellerSecrets: false };
const HUMAN_DM = { isAdmin: false, atTable: true, leadOrDm: true, steersStory: true, storytellerSecrets: true };
const HUMAN_LEAD = { isAdmin: false, atTable: true, leadOrDm: true, steersStory: false, storytellerSecrets: false };
const ADMIN = { isAdmin: true, atTable: false, leadOrDm: false, steersStory: false, storytellerSecrets: false };
const ALL = { setup: true, pageErrors: true, turnTimings: true, serverLog: true, transcript: true, turnRecords: true };

const ids = (viewer) => bundle.offeredParts(viewer).map((part) => part.id);
const setup = {
  version: "0.30.0",
  build: "0.30.0",
  commit: "",
  platform: "linux 6",
  arch: "x64",
  node: "22",
  deviceWorld: false,
  dmMode: "ai",
  role: "player",
  narrator: { backend: "OpenAI API", model: "gpt-test" },
};

await test("Each seat is offered only its own parts: the log to an admin, the timings to the lead or DM, the records to whoever steers.", () => {
  assert.deepEqual(ids(PLAYER), ["setup", "pageErrors", "transcript"]);
  assert.deepEqual(ids(AI_LEAD), ["setup", "pageErrors", "turnTimings", "transcript", "turnRecords"]);
  assert.deepEqual(ids(HUMAN_LEAD), ["setup", "pageErrors", "turnTimings", "transcript"], "the lead at a person's table is a player for the records");
  assert.deepEqual(ids(ADMIN), ["setup", "pageErrors", "serverLog"]);
  assert.deepEqual(ids({ ...PLAYER, isAdmin: true }), ["setup", "pageErrors", "serverLog", "transcript"]);
  const defaults = Object.fromEntries(bundle.offeredParts(AI_LEAD).map((part) => [part.id, part.defaultOn]));
  assert.equal(defaults.transcript, false, "the transcript is on by default");
  assert.equal(defaults.turnRecords, false, "the turn records are on by default");
});

await test("A request cannot widen the bundle: unallowed parts are dropped, the transcript stays off unless asked, and only a plain true counts.", () => {
  assert.deepEqual([...bundle.chosenParts(ALL, PLAYER)].sort(), ["pageErrors", "setup", "transcript"]);
  assert.deepEqual([...bundle.chosenParts({}, PLAYER)].sort(), ["pageErrors", "setup"]);
  assert.deepEqual([...bundle.chosenParts(undefined, AI_LEAD)].sort(), ["pageErrors", "setup", "turnTimings"]);
  assert.deepEqual([...bundle.chosenParts({ transcript: "yes", turnRecords: 1, setup: false }, AI_LEAD)].sort(), ["pageErrors", "turnTimings"]);
  assert.deepEqual([...bundle.chosenParts(["serverLog"], PLAYER)].sort(), ["pageErrors", "setup"]);
  // A caller that skipped chosenParts still gets nothing the seat forbids.
  const forced = bundle.buildReportBundle({
    sources: { setup, serverLog: [{ at: 0, level: "info", text: "a log line" }], turns: [], messages: [] },
    parts: new Set(Object.keys(ALL)),
    viewer: PLAYER,
    reporterUserId: "me",
    secrets: [],
  });
  assert.equal(forced.serverLog, undefined, "a player got the server log");
  assert.equal(forced.turnRecords, undefined, "a player got the turn records");
  assert.equal(forced.turnTimings, undefined, "a player got the turn timings");
});

await test("The transcript holds only the reporter's own lines and the DM's narration of the last few turns.", () => {
  const messages = [];
  let seq = 0;
  const add = (authorType, userId, content) => messages.push({ seq: (seq += 1), authorType, userId, content, createdAt: new Date(seq * 1000).toISOString() });
  add("player", "me", "An old line of mine.");
  add("dm", null, "An old passage before the window.");
  for (let turn = 0; turn < bundle.REPORT_TURNS; turn += 1) {
    add("player", "me", `My line ${turn}.`);
    add("player", "other", `OTHER-PLAYER-LINE ${turn}`);
    add("system", null, `SYSTEM-LINE ${turn}`);
    add("dm", null, `Narration ${turn}.`);
  }
  const made = bundle.buildReportBundle({ sources: { setup, messages }, parts: new Set(["transcript"]), viewer: PLAYER, reporterUserId: "me", secrets: [] });
  const text = JSON.stringify(made);
  assert.ok(!text.includes("OTHER-PLAYER-LINE"), "another player's line reached the transcript");
  assert.ok(!text.includes("SYSTEM-LINE"), "a system line reached the transcript");
  assert.ok(!text.includes("An old"), "the transcript reached past the last few turns");
  assert.equal(made.transcript.filter((line) => line.from === "you").length, bundle.REPORT_TURNS);
  assert.equal(made.transcript.filter((line) => line.from === "dm").length, bundle.REPORT_TURNS);
  // A line with no author is nobody's own, even to a reporter with no id.
  const anon = bundle.buildReportBundle({ sources: { setup, messages: [{ seq: 1, authorType: "player", userId: null, content: "NULL-AUTHOR", createdAt: "" }] }, parts: new Set(["transcript"]), viewer: PLAYER, reporterUserId: null, secrets: [] });
  assert.ok(!JSON.stringify(anon).includes("NULL-AUTHOR"));
});

await test("Keys and tokens are cut from every part: by shape, by the server's known values, and from cookies.", () => {
  const secrets = ["saved-admin-key-55443322", "env-report-secret-0099887766"];
  const made = bundle.buildReportBundle({
    sources: {
      setup: { ...setup, narrator: { backend: "OpenAI API", model: "model saved-admin-key-55443322" } },
      serverLog: [
        { at: 0, level: "info", text: "Authorization: Bearer abcdef0123456789xyz" },
        { at: 0, level: "warn", text: "calling https://example.test/v1?key=AIzaQueryKey&x=1 with sk-or-v1-0123456789abcdefABCDEF" },
        { at: 0, level: "info", text: "cookie odm_session=s3ss10nT0k3nValue1234 for env-report-secret-0099887766" },
      ],
      messages: [{ seq: 1, authorType: "player", userId: "me", content: "my key is sk-proj-ABCDEFGHIJKLMNOP1234 and saved-admin-key-55443322", createdAt: "" }],
      turns: [],
    },
    parts: new Set(["setup", "serverLog", "transcript"]),
    viewer: { ...PLAYER, isAdmin: true },
    reporterUserId: "me",
    secrets,
  });
  const text = JSON.stringify(made);
  for (const secret of ["abcdef0123456789xyz", "AIzaQueryKey", "sk-or-v1-0123456789abcdefABCDEF", "s3ss10nT0k3nValue1234", "env-report-secret-0099887766", "saved-admin-key-55443322", "sk-proj-ABCDEFGHIJKLMNOP1234"]) {
    assert.ok(!text.includes(secret), `"${secret}" reached the bundle:\n${text}`);
  }
  assert.equal(made.serverLog.length, 3, "the log lines themselves went too");
});

const turnSource = {
  id: "turn-1",
  status: "done",
  actor: "ai",
  createdAt: "2026-10-24T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:12.500Z",
  modelCalls: 2,
  rolls: 1,
  calls: [{ task: "turn", durationMs: 9000, firstTokenMs: 800, finishReason: "tool_calls" }],
  toolCalls: [
    { name: "send_whisper", arguments: JSON.stringify({ characterId: "c2", content: "WHISPER-REPLY-TEXT" }) },
    { name: "set_npc_scheme", arguments: JSON.stringify({ npc: "Vex", scheme: "STORYTELLER-SCHEME" }) },
  ],
  trace: { promptTokens: 100, blocks: [] },
};

await test("The turn records never carry a whisper's words, and a tool's arguments only for whoever runs the table.", () => {
  const forLead = bundle.buildReportBundle({ sources: { setup, turns: [turnSource] }, parts: new Set(["turnRecords", "turnTimings"]), viewer: AI_LEAD, reporterUserId: "me", secrets: [] });
  const leadText = JSON.stringify(forLead);
  assert.ok(!leadText.includes("WHISPER-REPLY-TEXT"), "a whisper reached the lead's records");
  assert.ok(!leadText.includes("STORYTELLER-SCHEME"), "a storyteller secret reached the lead's records");
  assert.deepEqual(forLead.turnRecords[0].toolCalls.map((call) => call.name), ["send_whisper", "set_npc_scheme"]);
  assert.equal(forLead.turnTimings[0].seconds, 12.5);
  const forDm = bundle.buildReportBundle({ sources: { setup, turns: [turnSource] }, parts: new Set(["turnRecords"]), viewer: HUMAN_DM, reporterUserId: "me", secrets: [] });
  const dmText = JSON.stringify(forDm);
  assert.ok(!dmText.includes("WHISPER-REPLY-TEXT"), "a whisper reached the DM's records");
  assert.ok(dmText.includes("STORYTELLER-SCHEME"), "the DM's records lost the tool arguments they may read");
});

await test("The page's own errors are kept cut to size, without the address's query or keys, newest twenty only.", () => {
  const cleaned = bundle.cleanPageError({ kind: "rejection", message: "fetch failed for ?token=abc123secret with sk-live-0123456789ABCDEF", where: "/campaigns/abc?invite=XYZ#top", stack: "Error\n at Bearer zzzzzzzzzzzzzzzz" });
  assert.equal(cleaned.where, "/campaigns/abc");
  assert.equal(cleaned.kind, "rejection");
  for (const secret of ["abc123secret", "sk-live-0123456789ABCDEF", "zzzzzzzzzzzzzzzz", "XYZ"]) {
    assert.ok(!JSON.stringify(cleaned).includes(secret), `"${secret}" was kept`);
  }
  let ring = [];
  for (let index = 0; index < 30; index += 1) ring = bundle.keepPageError(ring, bundle.cleanPageError({ message: `e${index}` }));
  assert.equal(ring.length, bundle.PAGE_ERROR_LIMIT);
  assert.equal(ring.at(-1).message, "e29");
  const base = bundle.buildReportBundle({ sources: { setup }, parts: new Set(["setup"]), viewer: PLAYER, reporterUserId: "me", secrets: [] });
  assert.equal(bundle.withPageErrors(base, ring, false).pageErrors, undefined, "unticked errors went in");
  const withErrors = bundle.withPageErrors(base, [...ring, null, "junk", { message: "Bearer abcdefghijklmnop" }], true);
  assert.equal(withErrors.pageErrors.length, bundle.PAGE_ERROR_LIMIT);
  assert.ok(!JSON.stringify(withErrors).includes("abcdefghijklmnop"));
  assert.deepEqual(withErrors.included, ["setup", "pageErrors"]);
  const fromApp = bundle.cleanPageError({
    message: "TypeError: failed to fetch https://table.private-domain.test/api/campaigns/abc/state?invite=CODE123",
    stack: "TypeError\n    at run (https://table.private-domain.test/_next/static/chunks/page.js?dpl=dpl_secret_build:1:2345)",
    where: "/C:/Users/Someone/AppData/Local/Programs/odm/www/index.html",
  });
  const appText = JSON.stringify(fromApp);
  for (const leak of ["private-domain.test", "CODE123", "dpl_secret_build", "Someone"]) {
    assert.ok(!appText.includes(leak), `"${leak}" was kept in a page error: ${appText}`);
  }
  assert.ok(appText.includes("/_next/static/chunks/page.js"), "the stack lost its file");
});

const turnSourceForAddresses = {
  id: "turn-a",
  status: "failed",
  actor: "ai",
  createdAt: "2026-10-24T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:01.000Z",
  modelCalls: 1,
  rolls: 0,
  calls: [],
  toolCalls: [],
  trace: null,
};

await test("No address says where anything lives: hosts, IPs, emails and home folders are cut, a public provider's name stays.", () => {
  const made = bundle.buildReportBundle({
    sources: {
      setup: { ...setup, narrator: { backend: "OpenAI-compatible server", model: "/home/someone/models/qwen.gguf" } },
      serverLog: [
        { at: 0, level: "warn", text: "POST http://gpu-box.lan:8001/v1/chat/completions?trace=1 failed: connect ECONNREFUSED 10.20.30.40:8080" },
        { at: 0, level: "info", text: "getaddrinfo ENOTFOUND nas-box.lan, then https://api.openai.com/v1/models answered" },
        { at: 0, level: "info", text: "signed in as someone@example.test from table.private-domain.test" },
        { at: 0, level: "error", text: "at C:\\Users\\Someone\\AppData\\Local\\odm\\server.js:10:2" },
      ],
      turns: [{ ...turnSourceForAddresses, calls: [{ task: "turn", error: "fetch failed for http://192.168.7.9:11434/api/chat" }] }],
    },
    parts: new Set(["setup", "serverLog", "turnTimings"]),
    viewer: { ...AI_LEAD, isAdmin: true },
    reporterUserId: "me",
    secrets: [],
    addresses: bundle.addressHosts(["https://table.private-domain.test/", "localhost:3000", "api.openai.com", "cube"]),
  });
  const text = JSON.stringify(made);
  for (const leak of ["gpu-box.lan", "10.20.30.40", "nas-box.lan", "someone@example.test", "private-domain.test", "Someone", "/home/someone", "192.168.7.9", "trace=1"]) {
    assert.ok(!text.includes(leak), `"${leak}" reached the bundle:\n${text}`);
  }
  assert.ok(text.includes("https://api.openai.com/v1/models"), "a public provider's address lost its name");
  assert.ok(text.includes("/v1/chat/completions"), "the path of a cut address went too");
  assert.deepEqual(bundle.addressHosts(["https://table.private-domain.test/", "localhost:3000", "api.openai.com", "cube"]), ["table.private-domain.test"], "a loopback, a public host or one word was listed to cut");
});

await test("The bug report form opens with nothing from the report in the address but Your setup, cut by whole lines.", () => {
  assert.equal(bundle.BUG_REPORT_URL, "https://github.com/Lebbitheplow/open-game-master/issues/new?template=bug_report.yml");
  assert.equal(bundle.bugReportUrl(), bundle.BUG_REPORT_URL);
  assert.equal(bundle.bugReportUrl({}), bundle.BUG_REPORT_URL, "a report without its setup filled the form");
  const setup = { version: "1.0.0", build: "1.0.0", commit: "", platform: "linux", arch: "x64", node: "22", deviceWorld: false, narrator: { backend: "none", model: "", off: true }, checkFirst: Array.from({ length: 400 }, (_, index) => `check number ${index}`) };
  const url = bundle.bugReportUrl({ setup });
  assert.ok(url.length < 6200, `the address is ${url.length} long`);
  const field = decodeURIComponent(url.slice(url.indexOf("&setup=") + 7));
  assert.ok(field.startsWith("- Version 1.0.0\n"), field.slice(0, 80));
  assert.ok(field.includes("- Narrator: none\n"), field.slice(0, 200));
  assert.match(field, /- check number \d+$/, "a line was cut in the middle");
  assert.match(bundle.reportFileName(new Date("2026-10-24T10:11:12Z")), /^odm-report-2026-10-24-10-11-12\.json$/);
});

// ---- the routes, on a real table ----

// The setup asks the table's backends about themselves (src/lib/report-setup-server.ts).
// Here the only one that answers is a llama.cpp server on a private address,
// serving an 8B model with an 8K window: two things a report must flag.
// Everything else answers 404 at once, so no probe waits on the network.
const LLAMA = "http://10.20.30.40:8080";
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.startsWith(`${LLAMA}/v1/models`)) return json({ object: "list", data: [{ id: "qwen3-8b", object: "model", owned_by: "llamacpp" }] });
  if (url.startsWith(`${LLAMA}/props`)) return json({ n_ctx: 8192 });
  return new Response("", { status: 404 });
};

const world = await openWorld();
const route = await world.route("campaigns/[campaignId]/report-bundle");
const adminRoute = await world.route("admin/report-bundle");
const params = { params: Promise.resolve({ campaignId: world.campaignId }) };
const post = (body) => route.POST(new Request("http://test/x", { method: "POST", body: JSON.stringify(body) }), params);
const lead = world.owner;
const leadHero = world.addHero();
const other = world.addHero();

saveGlobalConfig({ text: { customApiKey: "panel-saved-key-11223344" } });
console.log("[test] the backend refused panel-saved-key-11223344 with Authorization: Bearer lineToken0123456789");

world.say("player", "LEAD-OWN-LINE", leadHero);
world.say("player", "OTHER-PLAYER-SECRET-PLAN", other);
world.say("system", "SYSTEM-NOTICE-LINE");
world.say("dm", "The door creaks open.");
insertWhisper(world.campaignId, null, [{ characterId: other.id, userId: other.userId, characterName: other.name }], "WHISPER-TABLE-TEXT");
const turn = turns.createDmTurn(world.campaignId, [
  { role: "system", content: "SECRET-ARC-PROMPT. Private messages: [Hero 2, privately] PROMPT-WHISPER-TEXT" },
  { role: "user", content: "OTHER-PLAYER-SECRET-PLAN" },
  { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "send_whisper", arguments: JSON.stringify({ characterId: other.id, content: "WHISPER-REPLY-TEXT" }) } }] },
  { role: "tool", tool_call_id: "t1", content: "TOOL-RESULT-TEXT" },
]);
turns.saveDmTurn({
  ...turn,
  status: "done",
  callIndex: 1,
  contextTrace: { limitTokens: 1000, promptTokens: 10, blocks: [], shape: { historyStart: 1, historyEnd: 2, promptMessages: 2 }, calls: [{ index: 0, task: "turn", windowTokens: 1000, promptTokens: 10, toolTokens: 0, toolCount: 1, outputTokens: 100, dropped: 0, clipped: 0, durationMs: 1234 }] },
});

const NEVER = ["OTHER-PLAYER-SECRET-PLAN", "SYSTEM-NOTICE-LINE", "WHISPER-TABLE-TEXT", "PROMPT-WHISPER-TEXT", "WHISPER-REPLY-TEXT", "SECRET-ARC-PROMPT", "TOOL-RESULT-TEXT", "panel-saved-key-11223344", "lineToken0123456789"];

const setAdmin = (userId, on) => getDatabase().prepare(`UPDATE users SET is_admin = ? WHERE id = ?`).run(on ? 1 : 0, userId);

await test("At a table only the server's admin may make a report: a player or a lead who is not the admin is refused.", async () => {
  world.signIn({ id: other.userId });
  const offered = await route.GET(new Request("http://test/x"), params);
  assert.equal(offered.status, 403);
  const refused = await post({ parts: ALL });
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error, /admin/);
  world.signIn(lead);
  assert.equal((await post({ parts: ALL })).status, 403, "a lead who is not the admin made a report");
});

await test("An admin seated as a player gets their own lines and the DM's, and nothing of the timings or the records.", async () => {
  setAdmin(other.userId, true);
  world.signIn({ id: other.userId });
  const offered = await (await route.GET(new Request("http://test/x"), params)).json();
  assert.deepEqual(offered.parts.map((part) => part.id), ["setup", "pageErrors", "serverLog", "transcript"]);
  const response = await post({ parts: { ...ALL, serverLog: false } });
  assert.equal(response.status, 200);
  const made = await response.json();
  const text = JSON.stringify(made);
  assert.equal(made.serverLog, undefined);
  assert.equal(made.turnTimings, undefined);
  assert.equal(made.turnRecords, undefined);
  assert.ok(!text.includes("LEAD-OWN-LINE"), "the lead's line reached another player's bundle");
  for (const kept of NEVER.filter((value) => value !== "OTHER-PLAYER-SECRET-PLAN")) {
    assert.ok(!text.includes(kept), `"${kept}" reached a player's bundle`);
  }
  assert.ok(made.transcript.some((line) => line.from === "you" && line.text === "OTHER-PLAYER-SECRET-PLAN"), "the reporter's own line is missing");
  assert.ok(made.transcript.some((line) => line.from === "dm" && line.text === "The door creaks open."));
  assert.equal(made.setup.role, "player");
  setAdmin(other.userId, false);
});

// From here the lead is the server's admin.
await test("An admin who leads an AI table gets the timings and the tool names, never the prompt, a whisper or another player's line.", async () => {
  setAdmin(lead.id, true);
  world.signIn(lead);
  const made = await (await post({ parts: { ...ALL, serverLog: false } })).json();
  const text = JSON.stringify(made);
  for (const kept of NEVER) {
    assert.ok(!text.includes(kept), `"${kept}" reached the lead's bundle`);
  }
  assert.equal(made.serverLog, undefined, "the server log went in unasked");
  assert.equal(made.turnTimings.at(-1).id, turn.id);
  assert.equal(made.turnTimings.at(-1).calls[0].durationMs, 1234);
  assert.deepEqual(made.turnRecords.at(-1).toolCalls, [{ name: "send_whisper", withheld: "a whisper is private to its player" }]);
  assert.ok(made.transcript.some((line) => line.text === "LEAD-OWN-LINE"));
});

await test("An admin at the table gets the server log with the panel's keys and token shapes cut out.", async () => {
  world.signIn(lead);
  const made = await (await post({ parts: { serverLog: true } })).json();
  assert.ok(made.serverLog.some((line) => line.includes("[test] the backend refused")), "the log line is missing");
  const text = JSON.stringify(made);
  assert.ok(!text.includes("panel-saved-key-11223344") && !text.includes("lineToken0123456789"), text);
});

await test("The setup names the narrator's engine, model, size and window, never its address, and flags a small model and a short window.", async () => {
  getDatabase().prepare(`UPDATE campaigns SET settings_json = json_set(settings_json, '$.textProvider', 'custom', '$.customBaseUrl', '${LLAMA}/v1', '$.customModel', 'qwen3-8b', '$.customApiKey', 'campaign-own-key-99887766') WHERE id = ?`).run(world.campaignId);
  world.signIn(lead);
  const made = await (await post({ parts: { setup: true } })).json();
  const narrator = made.setup.narrator;
  assert.equal(narrator.backend, "llama.cpp on another machine");
  assert.equal(narrator.model, "qwen3-8b");
  assert.equal(narrator.answers, true);
  assert.equal(narrator.contextTokens, 8192);
  assert.equal(narrator.windowAssumed, undefined, "a window the server reported was called assumed");
  assert.equal(narrator.paramsB, 8);
  const checks = made.setup.checkFirst;
  assert.ok(checks.some((line) => line.includes("is small, about 8B parameters")), checks.join("\n"));
  assert.ok(checks.some((line) => line.startsWith("The narrator's window:") && line.includes("too small to narrate")), checks.join("\n"));
  assert.equal(made.setup.helper, null);
  assert.equal(made.setup.agentProgram, null);
  for (const key of ["install", "channel", "pictures", "narration", "dictation", "voiceChat"]) {
    assert.ok(made.setup[key] !== undefined, `the setup leaves out ${key}`);
  }
  assert.ok(made.readable.includes("Narrator: llama.cpp on another machine, model qwen3-8b, 8B parameters, 8,192-token window, answering."), made.readable.join("\n"));
  assert.ok(made.readable.includes("Check these first:"));
  const text = JSON.stringify(made);
  assert.ok(!text.includes("10.20.30.40"), "the backend's address reached the bundle");
  assert.ok(!text.includes("campaign-own-key-99887766"));
  assert.equal(made.setup.dmMode, "ai");

  // The dialog shows the same checks before anything is saved.
  const offered = await (await route.GET(new Request("http://test/x"), params)).json();
  assert.deepEqual(offered.checkFirst, checks);

  // The form opens with Your setup filled in from these lines, and nothing else.
  const url = bundle.bugReportUrl(made);
  assert.ok(url.startsWith(`${bundle.BUG_REPORT_URL}&setup=`), url);
  const field = decodeURIComponent(url.slice(url.indexOf("&setup=") + 7));
  assert.ok(field.includes("- Narrator: llama.cpp on another machine, model qwen3-8b"), field);
  assert.ok(field.includes("Found by Report a problem, to check first:"), field);
  assert.ok(!field.includes("10.20.30.40") && !field.includes("campaign-own-key"), field);
  assert.equal(new URL(url).searchParams.size, 2, "something besides the template and Your setup went in the address");
  world.signIn(world.addUser("stranger"));
  const refused = await post({ parts: ALL });
  assert.equal(refused.status, 404);
});

await test("Admin's report needs an admin, and holds the setup and the log only.", async () => {
  world.signIn({ id: other.userId });
  const refused = await adminRoute.POST(new Request("http://test/x", { method: "POST", body: "{}" }));
  assert.ok(refused.status === 401 || refused.status === 403, `a player made Admin's report (${refused.status})`);
  world.signIn(lead);
  const made = await (await adminRoute.POST(new Request("http://test/x", { method: "POST", body: JSON.stringify({ parts: ALL }) }))).json();
  assert.deepEqual(made.included, ["setup", "serverLog"]);
  assert.equal(made.madeFrom, "admin");
  assert.ok(!JSON.stringify(made).includes("panel-saved-key-11223344"));
});

await test("A request's own address and cookies, a backend's address in an error, and another table's key never reach the file.", async () => {
  const elsewhere = await openWorld();
  getDatabase().prepare(`UPDATE campaigns SET settings_json = json_set(settings_json, '$.customApiKey', 'other-table-key-77665544', '$.customBaseUrl', 'http://other-gpu.lan:9000/v1') WHERE id = ?`).run(elsewhere.campaignId);
  console.log("[test] other-table-key-77665544 at http://other-gpu.lan:9000/v1 for a user at reports.private-domain.test cookie-value-abcdef123456");
  const failed = turns.createDmTurn(world.campaignId, [{ role: "system", content: "prompt" }]);
  turns.saveDmTurn({
    ...failed,
    status: "failed",
    callIndex: 1,
    contextTrace: { limitTokens: 10, promptTokens: 1, blocks: [], calls: [{ index: 0, task: "turn", windowTokens: 10, promptTokens: 1, toolTokens: 0, toolCount: 0, outputTokens: 1, dropped: 0, clipped: 0, error: "connect ECONNREFUSED 10.20.30.40:8080 (http://gpu-box.lan:8001/v1)" }] },
  });
  world.signIn(lead);
  const request = new Request("http://test/x", {
    method: "POST",
    headers: { host: "reports.private-domain.test", cookie: "odm_theme=dark; odm_pref=cookie-value-abcdef123456" },
    body: JSON.stringify({ parts: ALL }),
  });
  const made = await (await route.POST(request, params)).json();
  const text = JSON.stringify(made);
  assert.ok(made.serverLog.some((line) => line.includes("[test] [redacted] at http://[address]/v1")), text);
  for (const leak of ["other-table-key-77665544", "other-gpu.lan", "private-domain.test", "cookie-value-abcdef123456", "10.20.30.40", "gpu-box.lan"]) {
    assert.ok(!text.includes(leak), `"${leak}" reached the bundle`);
  }
});

await test("A turn with no trace gives no tool calls: where its prompt ended is unknown, so none of the prompt is read.", async () => {
  const untraced = turns.createDmTurn(world.campaignId, [
    { role: "system", content: "prompt" },
    { role: "assistant", content: "", tool_calls: [{ id: "h", type: "function", function: { name: "set_scene", arguments: JSON.stringify({ scene: "HISTORY-CALL" }) } }] },
  ]);
  turns.saveDmTurn({ ...untraced, status: "done", contextTrace: null });
  world.signIn(lead);
  const made = await (await post({ parts: ALL })).json();
  assert.deepEqual(made.turnRecords.at(-1).toolCalls, []);
  assert.ok(!JSON.stringify(made).includes("HISTORY-CALL"));
});

const humanWorld = await openWorld({ gameSettings: { dmMode: "human" } });
await test("At a table a person runs, the DM's records carry tool arguments but still no whisper.", async () => {
  const humanRoute = await humanWorld.route("campaigns/[campaignId]/report-bundle");
  const humanParams = { params: Promise.resolve({ campaignId: humanWorld.campaignId }) };
  const humanTurn = turns.createDmTurn(humanWorld.campaignId, [
    { role: "system", content: "SECRET-ARC-PROMPT" },
    { role: "assistant", content: "", tool_calls: [
      { id: "a", type: "function", function: { name: "send_whisper", arguments: JSON.stringify({ content: "WHISPER-REPLY-TEXT" }) } },
      { id: "b", type: "function", function: { name: "set_scene", arguments: JSON.stringify({ scene: "A HALL" }) } },
    ] },
  ]);
  turns.saveDmTurn({ ...humanTurn, status: "done", contextTrace: { limitTokens: 1, promptTokens: 1, blocks: [], shape: { historyStart: 1, historyEnd: 1, promptMessages: 1 } } });
  setAdmin(humanWorld.owner.id, true);
  humanWorld.signIn(humanWorld.owner);
  const made = await (await humanRoute.POST(new Request("http://test/x", { method: "POST", body: JSON.stringify({ parts: ALL }) }), humanParams)).json();
  assert.equal(made.setup.dmMode, "human");
  const text = JSON.stringify(made);
  assert.ok(!text.includes("WHISPER-REPLY-TEXT") && !text.includes("SECRET-ARC-PROMPT"), text);
  assert.deepEqual(made.turnRecords.at(-1).toolCalls.at(-1), { name: "set_scene", arguments: { scene: "A HALL" } });
});

console.log = realLog;
finish();
