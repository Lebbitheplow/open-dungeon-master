// Connected agents read tool results under a size cap. A long campaign's
// snapshot used to be cut at 60,000 characters mid-JSON, so an agent got a
// document it could not parse with the safety pause, the DM's status and the
// seat's caps past the cut. This drives odm_get_campaign, odm_get_messages
// and odm_get_sheet through workbenchCall into the real route handlers on a
// campaign far over the cap, and checks the pure bounding helpers directly.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-agent-results-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);
register("./lib/register-routes.mjs", import.meta.url);

const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { allocateSeq, createCampaign, joinByInviteCode, setCampaignStatus } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { pauseDmQueue } = await import("../src/lib/dm/queue.ts");
const { X_CARD_REASON } = await import("../src/lib/dm/safety.ts");
const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { workbenchCall, workbenchTools } = await import("../src/lib/agents/workbench.ts");
const { connectionInstructions } = await import("../src/lib/agents/mcp-server.ts");
const { insertWhisper } = await import("../src/lib/db/dm-whispers.ts");
const { ASK_SCOPES, ASK_VISIBILITIES } = await import("../src/lib/dm/ask-logic.ts");
const { MAX_RESULT_CHARS, boundResultText, campaignForAgent, historyForAgent } = await import(
  "../src/lib/agents/agent-results.ts"
);

const routes = {
  snapshot: await import("../src/app/api/campaigns/[campaignId]/route.ts"),
  messages: await import("../src/app/api/campaigns/[campaignId]/messages/route.ts"),
  sheet: await import("../src/app/api/campaigns/[campaignId]/sheet/route.ts"),
  whispers: await import("../src/app/api/campaigns/[campaignId]/whispers/route.ts"),
};

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const sheetOf = (name) =>
  createSheetSchema.parse({
    name,
    race: "elf",
    class: "wizard",
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
    maxHp: 14,
    ac: 12,
    hitDice: { die: "d6", total: 2, spent: 0 },
    proficiencies: { saves: ["int"], skills: [], languages: ["common"], tools: [], armor: [], weapons: [] },
    equipment: [],
    gold: 0,
  });

const lead = createUser("agent-lead", "x");
const player = createUser("agent-player", "x");
const campaign = createCampaign(lead.id, {
  title: "Long road",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 2,
  difficulty: "normal",
});
joinByInviteCode(player.id, campaign.inviteCode);
const leadSheet = createSheet(campaign.id, lead.id, 2, sheetOf("Brannoc"));
const playerSheet = createSheet(campaign.id, player.id, 2, sheetOf("Liriel"));
setCampaignStatus(campaign.id, "active");

// 160 passages of about 1,500 characters: the browser snapshot carries the
// newest 100, roughly 150,000 characters of messages alone.
const seqs = [];
for (let index = 0; index < 160; index += 1) {
  const seq = allocateSeq(campaign.id);
  seqs.push(seq);
  const byPlayer = index % 4 === 3;
  insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: byPlayer ? "player" : "dm",
    userId: byPlayer ? player.id : null,
    characterId: byPlayer ? playerSheet.id : null,
    content: `Passage ${index}. ${"The rain keeps on over the crooked roofs of Saltmere. ".repeat(28)}`,
  });
}
pauseDmQueue(campaign.id, X_CARD_REASON);

const grant = createConnectionGrant({ userId: player.id, name: "Liriel's agent", scopes: ["read", "play"], campaignId: campaign.id }).grant;

// workbenchCall reaches routes over loopback fetch; here fetch goes straight
// to the route handlers, signed in with the session the grant minted.
const originalFetch = globalThis.fetch;
let routed = 0;
globalThis.fetch = async (url, init = {}) => {
  const target = new URL(url);
  const bearer = new Headers(init.headers).get("authorization") ?? "";
  globalThis.__odmTestToken = bearer.replace(/^Bearer\s+/i, "");
  const match = /^\/api\/campaigns\/([^/]+)(\/messages|\/sheet|\/whispers)?$/.exec(target.pathname);
  assert.ok(match, `unexpected path ${target.pathname}`);
  const mod = match[2] ? routes[match[2].slice(1)] : routes.snapshot;
  const method = init.method ?? "GET";
  routed += 1;
  return mod[method](new Request(target, { method, headers: init.headers, body: init.body }), { params: Promise.resolve({ campaignId: match[1] }) });
};

try {
  await test("the browser snapshot really is over the cap", async () => {
    globalThis.__odmTestToken = undefined;
    const before = routed;
    const response = await globalThis.fetch(`http://odm.test/api/campaigns/${campaign.id}`, {
      headers: { Authorization: `Bearer ${(await import("../src/lib/agents/grants.ts")).grantSessionToken(grant)}` },
    });
    const text = await response.text();
    assert.equal(routed, before + 1);
    assert.ok(text.length > 2 * MAX_RESULT_CHARS, `snapshot was only ${text.length} characters`);
    // The old cut ended inside the messages, so the table state never arrived.
    const cut = text.slice(0, MAX_RESULT_CHARS);
    assert.throws(() => JSON.parse(cut));
    assert.ok(!cut.includes('"safetyPause"'));
  });

  let view;
  await test("odm_get_campaign answers bounded, valid JSON with the table state first", async () => {
    const outcome = await workbenchCall(grant, "odm_get_campaign", { campaignId: campaign.id });
    assert.equal(outcome.isError, false, outcome.text.slice(0, 300));
    assert.ok(outcome.text.length <= MAX_RESULT_CHARS, `${outcome.text.length} characters`);
    view = JSON.parse(outcome.text);
    const keys = Object.keys(view);
    assert.deepEqual(keys.slice(0, 8), ["campaign", "me", "activeSheetId", "safetyPause", "dmStatus", "floor", "caps", "pendingRolls"]);
    assert.equal(view.safetyPause.reason, "x_card");
    assert.ok(view.dmStatus !== undefined && view.caps && typeof view.caps === "object");
    assert.equal(view.activeSheetId, playerSheet.id);
    assert.equal(view.campaign.settings, undefined, "story backend settings stay out");
    assert.equal(view.campaign.floor, undefined, "the floor is lifted to the top");
    assert.equal(view.floor.mode, "open");
    for (const key of ["narrationAudio", "utilityCalls", "blockedUserIds", "cast", "auditLog"]) {
      assert.equal(view[key], undefined, `${key} is browser-only`);
    }
  });

  await test("the newest messages are the ones kept, compact, with a way back", async () => {
    const shown = view.messages;
    assert.ok(shown.length >= 10 && shown.length < 100, `${shown.length} messages shown`);
    assert.equal(shown.at(-1).seq, seqs.at(-1), "the newest message is always there");
    assert.deepEqual(shown.map((m) => m.seq), seqs.slice(seqs.length - shown.length), "a contiguous newest run");
    assert.equal(view.history.olderBefore, shown[0].seq);
    assert.match(view.history.read, /odm_get_messages/);
    const spoken = shown.find((m) => m.author === "player");
    assert.equal(spoken.from, "Liriel");
    assert.equal(shown.find((m) => m.author === "dm").from, "Dungeon Master");
    assert.equal(Object.hasOwn(shown[0], "generatedImage"), false);
  });

  await test("this player's sheet is whole, everyone else's is a summary", async () => {
    const mine = view.sheets.find((sheet) => sheet.id === playerSheet.id);
    const theirs = view.sheets.find((sheet) => sheet.id === leadSheet.id);
    assert.ok(mine.abilities && mine.proficiencies, "own sheet in full");
    assert.equal(theirs.name, "Brannoc");
    assert.equal(theirs.currentHp, leadSheet.currentHp);
    assert.equal(theirs.abilities, undefined, "another player's sheet is summarized");
  });

  await test("odm_get_messages pages back from olderBefore to the first message", async () => {
    const seen = new Set(view.messages.map((m) => m.seq));
    let before = view.history.olderBefore;
    let pages = 0;
    while (before !== null) {
      const outcome = await workbenchCall(grant, "odm_get_messages", { campaignId: campaign.id, before, limit: 25 });
      assert.equal(outcome.isError, false, outcome.text.slice(0, 300));
      assert.ok(outcome.text.length <= MAX_RESULT_CHARS);
      const page = JSON.parse(outcome.text);
      assert.ok(page.messages.length > 0 && page.messages.length <= 25);
      assert.ok(page.messages.every((m) => m.seq < before), "a page is strictly older than before");
      for (const message of page.messages) {
        seen.add(message.seq);
      }
      before = page.olderBefore;
      pages += 1;
      assert.ok(pages < 20, "paging ends");
    }
    assert.equal(seen.size, seqs.length, "every message was reachable");
  });

  await test("odm_get_messages refuses a malformed page before the route", async () => {
    const calls = routed;
    for (const args of [{ before: 0 }, { before: 2.5 }, { limit: "ten" }]) {
      const outcome = await workbenchCall(grant, "odm_get_messages", { campaignId: campaign.id, ...args });
      assert.equal(outcome.isError, true);
    }
    assert.equal(routed, calls);
    const tooMany = await workbenchCall(grant, "odm_get_messages", { campaignId: campaign.id, limit: 500 });
    assert.equal(tooMany.isError, true);
    assert.match(tooMany.text, /HTTP 400/);
  });

  await test("odm_get_sheet reads the table's copy of the active character", async () => {
    const outcome = await workbenchCall(grant, "odm_get_sheet", { campaignId: campaign.id });
    assert.equal(outcome.isError, false, outcome.text.slice(0, 300));
    assert.equal(JSON.parse(outcome.text).sheet.id, playerSheet.id);
  });

  await test("the new reads are listed for a read connection and count as reads", async () => {
    const names = workbenchTools(grant).map((tool) => tool.name);
    assert.ok(names.includes("odm_get_messages") && names.includes("odm_get_sheet") && names.includes("odm_get_whispers"));
    const { isReadTool } = await import("../src/lib/agents/activity.ts");
    assert.ok(isReadTool("odm_get_messages") && isReadTool("odm_get_sheet") && isReadTool("odm_get_whispers"));
    assert.ok(!isReadTool("odm_whisper_dm"), "a whisper to the DM wakes a turn, so it counts as a change");
  });

  // The DM's send_whisper lands in dm_whispers, never in the transcript, so a
  // player agent reading only the snapshot never learned what it was told.
  await test("odm_get_whispers reads what the DM told this player alone, which the snapshot never carries", async () => {
    const secret = "Only you see the sigil under the altar cloth.";
    insertWhisper(campaign.id, null, [{ userId: player.id, characterId: playerSheet.id, characterName: "Liriel" }], secret);
    insertWhisper(campaign.id, null, [{ userId: lead.id, characterId: leadSheet.id, characterName: "Brannoc" }], "Brannoc's own secret.");
    const snapshot = await workbenchCall(grant, "odm_get_campaign", { campaignId: campaign.id });
    assert.ok(!snapshot.text.includes(secret));
    const outcome = await workbenchCall(grant, "odm_get_whispers", { campaignId: campaign.id });
    assert.equal(outcome.isError, false, outcome.text.slice(0, 300));
    const { whispers } = JSON.parse(outcome.text);
    assert.deepEqual(whispers.map((whisper) => [whisper.direction, whisper.content]), [["to_player", secret]]);
  });

  await test("odm_whisper_dm sends a private message to the DM, outside the transcript", async () => {
    const sent = await workbenchCall(grant, "odm_whisper_dm", { campaignId: campaign.id, message: "I palm the key while they argue." });
    assert.equal(sent.isError, false, sent.text);
    const { whispers } = JSON.parse((await workbenchCall(grant, "odm_get_whispers", { campaignId: campaign.id })).text);
    assert.deepEqual(whispers.at(-1).direction, "to_dm");
    assert.equal(whispers.at(-1).content, "I palm the key while they argue.");
    const { messages } = JSON.parse((await workbenchCall(grant, "odm_get_messages", { campaignId: campaign.id, limit: 5 })).text);
    assert.ok(!messages.some((message) => message.content.includes("palm the key")), "the table never sees it");
    const blank = await workbenchCall(grant, "odm_whisper_dm", { campaignId: campaign.id, message: "  " });
    assert.equal(blank.isError, true);
    assert.match(blank.text, /HTTP 400/);
  });

  await test("odm_ask offers exactly the scopes and visibilities the ask route accepts", () => {
    const ask = workbenchTools(grant).find((tool) => tool.name === "odm_ask");
    assert.deepEqual(ask.inputSchema.properties.scope.enum, ["auto", ...ASK_SCOPES]);
    assert.deepEqual(ask.inputSchema.properties.visibility.enum, [...ASK_VISIBILITIES]);
  });

  await test("every tool a description or the server instructions names is one the agent has", () => {
    process.env.ODM_PLAYER_WEBHOOK_ORIGINS = "https://receiver.example";
    const full = { ...grant, scopes: ["read", "play", "characters", "campaigns", "dm"] };
    const tools = workbenchTools(full);
    delete process.env.ODM_PLAYER_WEBHOOK_ORIGINS;
    const names = new Set(tools.map((tool) => tool.name));
    const texts = [
      connectionInstructions(full),
      ...tools.flatMap((tool) => [tool.description, ...Object.values(tool.inputSchema.properties).map((prop) => prop.description ?? "")]),
    ];
    const named = new Set(texts.flatMap((text) => text.match(/\bodm_[a-z_]+/g) ?? []));
    assert.ok(named.has("odm_get_campaign") && named.has("odm_get_whispers"));
    assert.deepEqual([...named].filter((name) => !names.has(name)), []);
    const readOnly = connectionInstructions({ ...grant, scopes: ["read"] });
    assert.match(readOnly, /odm_get_campaign/);
    assert.ok(!readOnly.includes("odm_ask"), "a read-only connection is not told about a tool it lacks");
    assert.ok(!connectionInstructions({ ...grant, scopes: ["characters"] }).includes("odm_get_campaign"));
  });

  await test("webhook tools and guard fields stay hidden while webhooks are off", () => {
    delete process.env.ODM_PLAYER_WEBHOOK_ORIGINS;
    const tools = workbenchTools(grant);
    assert.ok(!tools.some((tool) => tool.name.includes("webhook")));
    const act = tools.find((tool) => tool.name === "odm_take_action");
    assert.equal(act.inputSchema.properties.subscriptionId, undefined);
    assert.equal(act.inputSchema.properties.opportunityId, undefined);
    process.env.ODM_PLAYER_WEBHOOK_ORIGINS = "https://receiver.example";
    const on = workbenchTools(grant);
    assert.ok(on.some((tool) => tool.name === "odm_subscribe_player_webhook"));
    assert.ok(on.find((tool) => tool.name === "odm_take_action").inputSchema.properties.subscriptionId);
    delete process.env.ODM_PLAYER_WEBHOOK_ORIGINS;
  });

  await test("a generic long JSON result is shrunk as JSON and says what it cut", () => {
    const entries = Array.from({ length: 400 }, (_, index) => ({ id: `lore-${index}`, text: "Old songs of the deep road. ".repeat(20) }));
    const text = JSON.stringify({ entries, total: 400 });
    assert.ok(text.length > MAX_RESULT_CHARS);
    const bounded = boundResultText(text);
    assert.ok(bounded.length <= MAX_RESULT_CHARS);
    const parsed = JSON.parse(bounded);
    assert.equal(parsed.total, 400);
    assert.equal(parsed.entries[0].id, "lore-0");
    assert.deepEqual(parsed._truncated.lists, [{ path: "entries", shown: parsed.entries.length, total: 400 }]);
  });

  await test("one enormous string is clipped, and plain text is cut plainly", () => {
    const bounded = boundResultText(JSON.stringify({ note: "x".repeat(200_000) }));
    assert.ok(bounded.length <= MAX_RESULT_CHARS);
    assert.match(JSON.parse(bounded).note, /more characters\]$/);
    const plain = boundResultText("y".repeat(70_000));
    assert.ok(plain.startsWith("y".repeat(100)) && plain.endsWith("[truncated: 10000 more characters]"));
    assert.equal(boundResultText('{"small":true}'), '{"small":true}');
  });

  await test("a snapshot whose table state alone is huge still parses and keeps the safety pause", () => {
    const huge = {
      campaign: { id: "c", title: "Big fight", floor: { mode: "initiative" } },
      me: { id: "u" },
      safetyPause: { at: 1, reason: "x_card" },
      dmStatus: "idle",
      caps: { adjudicates: false },
      encounter: { combatants: Array.from({ length: 3000 }, (_, index) => ({ id: `m${index}`, name: "Goblin", notes: "Snarls. ".repeat(10) })) },
      messages: [{ seq: 1, authorType: "dm", content: "Steel rings out." }],
    };
    const bounded = campaignForAgent(JSON.stringify(huge));
    assert.ok(bounded.length <= MAX_RESULT_CHARS);
    const parsed = JSON.parse(bounded);
    assert.deepEqual(parsed.safetyPause, { at: 1, reason: "x_card" });
    assert.equal(parsed.dmStatus, "idle");
    assert.ok(parsed.encounter.combatants.length < 3000);
  });

  await test("a history page too long for one reply keeps its newest end and continues from it", () => {
    const messages = Array.from({ length: 100 }, (_, index) => ({ seq: index + 1, authorType: "dm", content: "z".repeat(2000) }));
    const page = JSON.parse(historyForAgent(JSON.stringify({ messages, olderBefore: null, names: {} })));
    assert.ok(page.messages.length < 100);
    assert.equal(page.messages.at(-1).seq, 100);
    assert.equal(page.olderBefore, page.messages[0].seq, "the cut part is still reachable");
    assert.match(page.note, /newest/);
    const whole = JSON.parse(historyForAgent(JSON.stringify({ messages: messages.slice(0, 3), olderBefore: null, names: {} })));
    assert.equal(whole.olderBefore, null, "the first page of a campaign has nothing older");
  });

  console.log(`${passed} agent result tests passed`);
} finally {
  globalThis.fetch = originalFetch;
  getDatabase().close();
  globalThis.__localRoleplayDb = undefined;
  removeTempDir(dir);
}
