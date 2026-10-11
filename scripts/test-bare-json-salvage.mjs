// The two gpt-oss failures scripts/smoke-local.mjs found (PR #53), and the
// silent endings next to them:
// - a reply that is a call's arguments as bare JSON ('{"characterIds":[...],
//   "prompt":"..."}'), alone or glued to the prose, runs as that call and
//   never reaches the table;
// - a reply with no text and no tool call is asked again once, outside the
//   call budget, and a turn whose last reply stays empty gets the
//   tools-closed narration call;
// - a reply of calls that need no follow-up (a tool that does not exist,
//   complete_beat) and no prose is narrated instead of closing on the
//   empty-turn line.
// Pure helpers first, then the real turn machine against a fake
// OpenAI-compatible server on a throwaway database.
//
// Usage: node scripts/test-bare-json-salvage.mjs
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";
import { answerReader, isReaderRequest } from "./lib/claims-reader.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-bare-json-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.OPENAI_COMPAT_CONTEXT = "65536";

register("./lib/register-alias.mjs", import.meta.url);

const { findBareJsonObjects, stripToolText } = await import("../src/lib/dm/tool-text.ts");
const { salvageJsonToolCalls } = await import("../src/lib/dm/json-salvage.ts");
const { createStreamingArtifactFilter, extractStoryText } = await import("../src/lib/story-prompt.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, getFloor, setCampaignStatus, updateStorySettings, allocateSeq } =
  await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage, listRecentMessages } = await import("../src/lib/db/messages.ts");
const { startDmTurn, dmTurnToolCatalogue, MAX_MODEL_CALLS } = await import("../src/lib/dm/turn.ts");

const NARRATION = "Bram's shortsword is still too far away; the ragged bandit stands well beyond reach.";
const QUESTION = "What will Bram do? He is 80 ft from the bandit.";

// ---- the pure helpers --------------------------------------------------------
{
  const glued = `${NARRATION} What will you do?{"characterIds":["c1"],"prompt":"Move, dash, or something else?"}`;
  const found = findBareJsonObjects(glued);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].value.characterIds, ["c1"]);
  assert.equal(stripToolText(glued), `${NARRATION} What will you do?`);
  // Braces inside strings do not end the object; prose braces are left alone.
  const nested = 'He grins. {"prompt":"a } and a { inside","characterIds":["c1"]} Then silence.';
  assert.equal(stripToolText(nested), "He grins. Then silence.");
  assert.equal(stripToolText("A sign reads {closed} in chalk."), "A sign reads {closed} in chalk.");
  assert.equal(stripToolText('An unclosed {"brace in the text'), 'An unclosed {"brace in the text');
  // Unchanged: the older leak shapes still go.
  assert.equal(stripToolText("The door creaks. [request_roll characterId=c1 kind=custom]").trim(), "The door creaks.");
  console.log("ok: bare JSON is found and stripped, prose braces are not");
}

// An admin: only an admin's campaign runs on a backend address of its own
// (src/lib/db/settings.ts), and this one talks to the fake model below.
const lead = createUser(`lead${randomBytes(3).toString("hex")}`, "x", { isAdmin: true });
const probe = createCampaign(lead.id, {
  title: "Catalogue probe",
  description: "Reads the tool catalogue.",
  theme: "river ford",
  maxPlayers: 2,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
const catalogue = dmTurnToolCatalogue(getCampaignById(probe.id), false, false);
{
  const question = salvageJsonToolCalls('{"characterIds": ["c1"], "prompt": "Where do you move?"}', catalogue);
  assert.equal(question.text, "");
  assert.deepEqual(question.calls.map((call) => call.name), ["request_player_input"]);
  // Keys more than one tool takes are a guess the salvage never makes: a
  // heal and a hit both take characterId and amount.
  const either = salvageJsonToolCalls('The bandit circles. {"characterId":"c1","amount":5}', catalogue);
  assert.equal(either.text, "The bandit circles.");
  assert.equal(either.calls.length, 0);
  const move = salvageJsonToolCalls('The bandit circles. {"tokenName":"Bandit 1","x":5,"y":8}', catalogue);
  assert.equal(move.calls.length, 0, "move_token and teleport_token both take tokenName, x and y");
  const named = salvageJsonToolCalls('{"name":"move_token","arguments":"{\\"tokenName\\":\\"Avery\\",\\"x\\":2,\\"y\\":3}"}', catalogue);
  assert.deepEqual(named.calls.map((call) => call.name), ["move_token"]);
  assert.deepEqual(JSON.parse(named.calls[0].rawArguments), { tokenName: "Avery", x: 2, y: 3 });
  // A key no tool takes: cut, never run.
  const stray = salvageJsonToolCalls('The fog rolls in. {"mood":"grim","weatherLevel":3}', catalogue);
  assert.equal(stray.text, "The fog rolls in.");
  assert.equal(stray.calls.length, 0);
  // The structured story format stays for extractStoryText.
  const story = salvageJsonToolCalls('{"storyText":"The fog rolls in.","image":{"needed":false}}', catalogue);
  assert.equal(story.calls.length, 0);
  assert.equal(extractStoryText(story.text), "The fog rolls in.");
  console.log("ok: bare arguments become the one call they fit; ambiguous and stray ones are cut, story JSON is kept");
}
{
  const filter = createStreamingArtifactFilter();
  const streamed = [`${NARRATION} What will you do?`, "{", '"characterIds":["c1"],', '"prompt":"Move?"}', " trailing"]
    .map((chunk) => filter.push(chunk))
    .join("") + filter.flush();
  assert.equal(streamed, `${NARRATION} What will you do?`);
  const plain = createStreamingArtifactFilter();
  const prose = ["A sign reads {closed}", " in chalk."].map((chunk) => plain.push(chunk)).join("") + plain.flush();
  assert.equal(prose, "A sign reads {closed} in chalk.");
  console.log("ok: the stream holds back bare JSON and nothing else");
}

// ---- the turn machine ----------------------------------------------------------
let script = [];
let calls = 0;
let requests = [];
let sheetId = "";
function sse(res, deltas) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const delta of deltas) {
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}
const toolCall = (name, args) => ({
  tool_calls: [
    { index: 0, id: `call_${name}_${calls}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
  ],
});
const askJson = () => JSON.stringify({ characterIds: [sheetId], prompt: QUESTION });
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    if (!req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (isReaderRequest(body)) {
      answerReader(res);
      return;
    }
    requests.push(body);
    const reply = script[calls] ?? "narrate";
    if (reply === "empty") {
      sse(res, []);
    } else if (reply === "json-ask") {
      sse(res, [{ content: askJson() }]);
    } else if (reply === "narrate-json-ask") {
      sse(res, [{ content: `${NARRATION} What will you do?` }, { content: askJson() }]);
    } else if (reply === "unknown-tool") {
      sse(res, [toolCall("dance_wildly", { style: "jig" })]);
    } else {
      sse(res, [{ content: NARRATION }]);
    }
    calls += 1;
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

function table(title) {
  const campaign = createCampaign(lead.id, {
    title,
    description: "A test of the bare-JSON salvage and the empty-reply retry.",
    theme: "river ford",
    maxPlayers: 2,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  updateStorySettings(campaign.id, {
    textProvider: "custom",
    customBaseUrl: baseUrl,
    customModel: "fake",
    imageGenerationEnabled: false,
    autoImages: false,
  });
  setCampaignStatus(campaign.id, "active");
  const sheet = createSheet(
    campaign.id,
    lead.id,
    1,
    createSheetSchema.parse({
      name: "Bram",
      race: "human",
      class: "fighter",
      abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      maxHp: 12,
      ac: 16,
      hitDice: { die: "d10", total: 1, spent: 0 },
      proficiencies: { saves: ["str", "con"], skills: ["athletics"], languages: ["common"], tools: [], armor: [], weapons: [] },
    }),
  );
  sheetId = sheet.id;
  insertCampaignMessage({
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    authorType: "player",
    userId: lead.id,
    characterId: sheet.id,
    content: "I wade toward the bandit.",
  });
  return campaign;
}

async function run(title, replies) {
  script = replies;
  calls = 0;
  requests = [];
  const campaign = table(title);
  await startDmTurn(campaign.id);
  const dm = listRecentMessages(campaign.id, 20).filter((m) => m.authorType === "dm");
  return { campaign, text: dm[dm.length - 1]?.content ?? "", calls, requests };
}

const toolResults = (request) =>
  new Map(request.messages.filter((m) => m.role === "tool").map((m) => [m.tool_call_id, JSON.parse(m.content)]));

// The bug: a reply that is only the JSON closed the turn on the empty-turn line.
const whole = await run("JSON question only", ["json-ask", "narrate"]);
assert.equal(whole.text, NARRATION, `expected narration, got: ${whole.text}`);
assert.equal(whole.calls, 2, "the salvaged question gets the question-only narration call");
assert.match(toolResults(whole.requests[1]).get("json-salvaged-0")?.note ?? "", /The floor is theirs/, "the salvaged request_player_input handed Bram the floor");
assert.ok(toolResults(whole.requests[1]).has("json-salvaged-0"), "the salvaged call was answered");
assert.equal(getFloor(whole.campaign.id).mode, "spotlight");
console.log("ok: a reply that is bare request_player_input JSON runs as the call and is narrated");

// The bug: JSON glued to the prose reached the players.
const glued = await run("JSON glued to narration", ["narrate-json-ask"]);
assert.equal(glued.text, `${NARRATION} What will you do?`);
assert.equal(glued.calls, 1, "narration was already there; no extra call");
assert.equal(getFloor(glued.campaign.id).mode, "spotlight");
console.log("ok: JSON glued to the prose is cut from it and still runs");

// The bug: an empty reply closed the turn on the empty-turn line.
const empty = await run("Empty reply", ["empty", "narrate"]);
assert.equal(empty.text, NARRATION, `expected narration after a retry, got: ${empty.text}`);
assert.equal(empty.calls, 2);
assert.deepEqual(empty.requests[1].messages, empty.requests[0].messages, "the retry asks the same thing again");
assert.notEqual(empty.requests[1].tool_choice, "none", "the retry did not spend the call budget");
console.log("ok: an empty reply is asked again once");

// Empty twice: the tools-closed call narrates.
const twice = await run("Empty twice", ["empty", "empty", "narrate"]);
assert.equal(twice.text, NARRATION, `expected narration from the tools-closed call, got: ${twice.text}`);
assert.equal(twice.calls, 3);
assert.match(twice.requests[2].messages.at(-1).content, /Tools are closed for this turn/);
console.log("ok: a reply still empty after the retry gets the tools-closed narration call");

// Empty on every call: one retry, then the loop runs out, then the rescue.
const silent = await run("Empty throughout", Array(MAX_MODEL_CALLS + 3).fill("empty"));
assert.equal(silent.calls, 3, "one retry and one rescue, no loop");
assert.ok(silent.text.length > 0, "the empty-turn line still lands");
console.log("ok: a model that never answers costs three calls and ends on the empty-turn line");

// A call to a tool that does not exist, with no prose: told so, then narrated.
const unknown = await run("Unknown tool only", ["unknown-tool", "narrate"]);
assert.equal(unknown.text, NARRATION, `expected narration, got: ${unknown.text}`);
assert.equal(unknown.calls, 2);
assert.match(toolResults(unknown.requests[1]).get("call_dance_wildly_0")?.error ?? "", /no action called "dance_wildly"/);
console.log("ok: a reply of an unknown tool and no prose is narrated, and the tool result says it does not exist");

server.close();
removeTempDir(dir);
console.log("PASS: bare JSON calls run and never reach the table; empty replies are asked again.");
