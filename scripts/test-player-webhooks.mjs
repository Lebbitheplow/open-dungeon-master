import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "odm-webhooks-"));
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ODM_PLAYER_WEBHOOK_ORIGINS = "https://receiver.example";
register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase, nowIso } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, setFloor, allocateSeq, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
const { createConnectionGrant, revokeConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { createDmTurn, createPendingRoll, resolvePendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { createEncounter } = await import("../src/lib/db/encounters.ts");
const { publishPersisted } = await import("../src/lib/events.ts");
const { setDmStatus } = await import("../src/lib/dm/status.ts");
const { playerOpportunities } = await import("../src/lib/agents/webhook-opportunities.ts");
const { createPlayerWebhook, runPlayerWebhooksOnce, listPlayerWebhooks, deletePlayerWebhook, webhookUrl, webhookAuthorization, webhookHeaders, webhookSignature, playerWebhookState, reserveWebhookWrite, finishWebhookWrite } = await import("../src/lib/agents/webhooks.ts");
const { workbenchCall, workbenchTools } = await import("../src/lib/agents/workbench.ts");
const { PlayerInbox, receiverServer, verifySignature, validateEvent, playerPrompt } = await import("./lib/player-webhook-receiver.mjs");
const { runCodexPlayerTurn, playerCodexEnvironment, playerMcpOverride } = await import("./lib/player-webhook-codex.mjs");

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`); }
const db = getDatabase();
const user = createUser("webhook-player", "not-a-password");
const other = createUser("webhook-other", "not-a-password");
const campaign = createCampaign(user.id, { title: "Webhook test", description: "", theme: "", difficulty: "normal", startingLevel: 1, maxPlayers: 4 });
joinByInviteCode(other.id, campaign.inviteCode);
const sheetId = "webhook-test-sheet";
db.prepare(`INSERT INTO character_sheets (id, campaign_id, user_id, name, race, class, abilities_json, max_hp, current_hp, ac, hit_dice_json, proficiencies_json, created_at, updated_at)
  VALUES (?, ?, ?, 'Hero', 'human', 'fighter', '{}', 10, 10, 12, '{}', '{}', ?, ?)`).run(sheetId, campaign.id, user.id, nowIso(), nowIso());
const grant = createConnectionGrant({ userId: user.id, name: "Player test", scopes: ["read", "play"], campaignId: campaign.id }).grant;
const sub = createPlayerWebhook(grant, { campaignId: campaign.id, characterId: sheetId, url: "https://receiver.example/odm" });
const sent = [];
let clock = Date.now();
const send = async (_url, options) => { sent.push({ event: JSON.parse(options.body), options }); return new Response(null, { status: 202 }); };
const tick = async (transport = send) => { clock += 1000; await runPlayerWebhooksOnce(clock, transport); };
const narration = () => insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "dm", content: "A settled public passage. SECRET-NOT-SENT in game prose." });
const state = (overrides = {}) => ({ active: true, paused: false, busy: false, floor: { mode: "open" }, floorSeq: 3, userId: user.id, characterId: sheetId, rolls: [], turn: null, narration: { id: "n", seq: 4 }, lastPlayerSeq: 0, ...overrides });

try {
  await test("receiver destinations require an operator-approved exact HTTPS origin", () => {
    for (const url of ["http://receiver.example/odm", "https://receiver.example.evil/odm", "https://127.0.0.1/", "https://receiver.example/?token=x", "https://x:y@receiver.example/", "https://receiver.example/#x"]) assert.throws(() => webhookUrl(url));
    assert.throws(() => webhookUrl("https://receiver.example/", ""));
    assert.equal(webhookUrl("https://receiver.example/odm"), "https://receiver.example/odm");
  });
  await test("subscription pins the grant's own active character and scopes", () => {
    assert.throws(() => createPlayerWebhook({ ...grant, userId: other.id }, { campaignId: campaign.id, characterId: sheetId, url: sub.url }));
    assert.throws(() => createPlayerWebhook({ ...grant, scopes: ["read"] }, { campaignId: campaign.id, characterId: sheetId, url: sub.url }));
    assert.throws(() => createPlayerWebhook(grant, { campaignId: "another-campaign", characterId: sheetId, url: sub.url }));
    assert.ok(!JSON.stringify(listPlayerWebhooks(grant.id)).includes(sub.signingSecret));
    assert.equal(deletePlayerWebhook("other-grant", sub.id), false);
    assert.ok(workbenchTools(grant).some((t) => t.name === "odm_subscribe_player_webhook"));
    assert.ok(!workbenchTools({ ...grant, scopes: ["read"] }).some((t) => t.name.includes("webhook")));
  });
  await test("lobby produces no submissions or deliveries", async () => { narration(); await tick(); assert.equal(sent.length, 0); });
  await test("settled narration invites the player once, with no story or token payload", async () => {
    setCampaignStatus(campaign.id, "active"); await tick();
    const event = sent.at(-1).event;
    assert.equal(event.type, "response_requested");
    assert.equal(event.characterId, sheetId);
    assert.ok(!JSON.stringify(event).includes("SECRET-NOT-SENT"));
    assert.ok(!JSON.stringify(event).includes("signingSecret"));
    assert.ok(verifySignature(sub.signingSecret, sent.at(-1).options.headers["X-ODM-Timestamp"], sent.at(-1).options.headers["X-ODM-Signature"], sent.at(-1).options.body));
    const count = sent.length; await tick(); await tick(); assert.equal(sent.length, count);
  });
  await test("a subscription without authorizationHeader sends no Authorization header", () => {
    assert.ok(sent.length > 0 && sent.every((s) => !Object.keys(s.options.headers).some((h) => h.toLowerCase() === "authorization")));
    assert.equal(listPlayerWebhooks(grant.id)[0].hasAuthorizationHeader, false);
  });
  await test("paused, busy, hold and another player's spotlight do not invite actions", () => {
    for (const changes of [{ active: false }, { paused: true }, { busy: true }, { floor: { mode: "hold", next: { mode: "open" } } }, { floor: { mode: "spotlight", userIds: [other.id], respondedUserIds: [], prompt: "You?" } }]) assert.deepEqual(playerOpportunities(state(changes)), []);
    assert.deepEqual(playerOpportunities(state({ lastPlayerSeq: 5 })), []);
    assert.deepEqual(playerOpportunities(state({ awaitingRolls: true })), []);
  });
  await test("only this character's pending rolls invite a roll; other rolls block new actions", () => {
    const rolls = [{ id: "their-roll", userId: other.id, characterId: "other-sheet" }, { id: "other-owned", userId: user.id, characterId: "inactive-sheet" }];
    assert.deepEqual(playerOpportunities(state({ rolls })), []);
    assert.equal(playerOpportunities(state({ rolls: [...rolls, { id: "my-roll", userId: user.id, characterId: sheetId }] }))[0].pendingRollId, "my-roll");
  });
  await test("combat has distinct action and finish phases, then rearms next round", () => {
    const turn = { id: "fight", characterId: sheetId, userId: user.id, key: `1:${sheetId}`, waitingSeq: 6 };
    const s = state({ floor: { mode: "initiative", encounterId: "fight", userIds: [user.id], currentName: "Hero", round: 1 }, turn });
    const first = playerOpportunities(s)[0];
    assert.equal(first.phase, "act");
    const finish = playerOpportunities({ ...s, lastPlayerSeq: 7 })[0];
    assert.equal(finish.phase, "finish"); assert.notEqual(finish.opportunityId, first.opportunityId);
    assert.notEqual(playerOpportunities({ ...s, turn: { ...turn, key: `2:${sheetId}`, waitingSeq: 8 } })[0].opportunityId, first.opportunityId);
    assert.deepEqual(playerOpportunities({ ...s, turn: { ...turn, characterId: "inactive" } }), []);
  });
  await test("DM work defers narration until the persisted turn is done", async () => {
    narration();
    const turn = createDmTurn(campaign.id, []);
    setDmStatus(campaign.id, "narrating");
    const count = sent.length; await tick(); assert.equal(sent.length, count);
    db.prepare(`UPDATE dm_turns SET status = 'done' WHERE id = ?`).run(turn.id);
    setDmStatus(campaign.id, "idle"); await tick(); assert.equal(sent.length, count + 1);
  });
  await test("delivery failure retries the same event; concurrent ticks claim it once", async () => {
    narration(); let calls = 0; let firstId;
    await tick(async (_url, options) => { calls += 1; firstId = JSON.parse(options.body).eventId; throw new Error("network unavailable"); });
    assert.equal(calls, 1); await tick(); assert.notEqual(sent.at(-1).event.eventId, firstId);
    clock += 3000;
    await Promise.all([runPlayerWebhooksOnce(clock, send), runPlayerWebhooksOnce(clock, send)]);
    assert.equal(sent.filter((item) => item.event.eventId === firstId).length, 1);
  });
  await test("an obsolete queued passage is cancelled before retry", async () => {
    narration(); let oldId;
    await tick(async (_url, options) => { oldId = JSON.parse(options.body).eventId; return new Response(null, { status: 503 }); });
    insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: user.id, characterId: sheetId, content: "Already answered" });
    clock += 5000; await tick();
    assert.ok(!sent.some((s) => s.event.eventId === oldId));
    assert.equal(db.prepare(`SELECT state FROM player_webhook_deliveries WHERE id = ?`).get(oldId).state, "cancelled");
  });
  await test("safety pause survives a missing in-memory pause; resume issues a fresh opportunity", async () => {
    narration(); await tick(); const before = sent.at(-1).event.opportunityId;
    publishPersisted(campaign.id, "x_card", { at: Date.now() }); await tick();
    assert.equal(playerWebhookState(grant, sub.id).lifecycle, "paused");
    assert.equal(sent.at(-1).event.type, "campaign_paused");
    publishPersisted(campaign.id, "safety_resumed", { at: Date.now(), action: "continue" }); await tick();
    assert.equal(sent.at(-1).event.type, "response_requested"); assert.notEqual(sent.at(-1).event.opportunityId, before);
  });
  await test("spotlight responses keep the original opportunity for remaining players", async () => {
    const floor = { mode: "spotlight", userIds: [user.id, other.id], respondedUserIds: [], prompt: "Both answer" };
    setFloor(campaign.id, floor); publishPersisted(campaign.id, "floor_changed", { floor });
    const before = playerWebhookState(grant, sub.id).opportunities[0].opportunityId;
    const next = { ...floor, respondedUserIds: [other.id] };
    setFloor(campaign.id, next); publishPersisted(campaign.id, "floor_changed", { floor: next });
    assert.equal(playerWebhookState(grant, sub.id).opportunities[0].opportunityId, before);
    setFloor(campaign.id, { ...next, respondedUserIds: [user.id, other.id] });
    assert.deepEqual(playerWebhookState(grant, sub.id).opportunities, []);
    setFloor(campaign.id, { mode: "open" });
  });
  await test("guarded submissions reserve once, return identical receipts and reject changed/stale/cross-seat writes", () => {
    const o = playerWebhookState(grant, sub.id).opportunities[0];
    const input = { subscriptionId: sub.id, opportunityId: o.opportunityId, campaignId: campaign.id, tool: "odm_take_action", fingerprint: "one" };
    assert.equal(reserveWebhookWrite(grant, input), null);
    assert.throws(() => reserveWebhookWrite(grant, input), /uncertain/);
    const result = { text: '{"accepted":true}', isError: false, campaignId: campaign.id };
    finishWebhookWrite(sub.id, o.opportunityId, input.tool, result);
    assert.deepEqual(reserveWebhookWrite(grant, input), result);
    assert.throws(() => reserveWebhookWrite(grant, { ...input, fingerprint: "changed" }));
    assert.throws(() => reserveWebhookWrite({ ...grant, id: "someone-else" }, input));
    assert.throws(() => reserveWebhookWrite(grant, { ...input, opportunityId: "stale" }));
    assert.throws(() => reserveWebhookWrite(grant, { ...input, tool: "odm_end_turn" }));
  });
  await test("MCP guarded retry uses saved response without reaching the route twice", async () => {
    narration();
    const o = playerWebhookState(grant, sub.id).opportunities[0];
    const originalFetch = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = async () => { calls += 1; return Response.json({ accepted: true }); };
      const args = { campaignId: campaign.id, content: "I inspect the ward.", subscriptionId: sub.id, opportunityId: o.opportunityId };
      const first = await workbenchCall(grant, "odm_take_action", args);
      assert.equal(first.isError, false);
      assert.deepEqual(await workbenchCall(grant, "odm_take_action", args), first);
      assert.equal(calls, 1);
      assert.equal((await workbenchCall(grant, "odm_take_action", { ...args, content: "A different action" })).isError, true);
      assert.equal((await workbenchCall(grant, "odm_take_action", { ...args, subscriptionId: undefined })).isError, true);
    } finally { globalThis.fetch = originalFetch; }
  });
  await test("a refused guarded submission frees the opportunity for a corrected one", async () => {
    narration(); const o = playerWebhookState(grant, sub.id).opportunities[0];
    const originalFetch = globalThis.fetch; const bodies = [];
    try {
      globalThis.fetch = async (_url, init) => {
        bodies.push(JSON.parse(init.body).content);
        return bodies.length === 1 ? Response.json({ error: "It is Brannoc's turn in the initiative order." }, { status: 409 }) : Response.json({ messageId: "m" }, { status: 202 });
      };
      const args = { campaignId: campaign.id, subscriptionId: sub.id, opportunityId: o.opportunityId };
      const refused = await workbenchCall(grant, "odm_take_action", { ...args, content: "I swing at the ogre." });
      assert.equal(refused.isError, true); assert.match(refused.text, /HTTP 409/);
      const corrected = await workbenchCall(grant, "odm_take_action", { ...args, content: "I wait and watch the door." });
      assert.equal(corrected.isError, false);
      assert.deepEqual(bodies, ["I swing at the ogre.", "I wait and watch the door."]);
      // The accepted one is now the saved answer: a different third try is refused.
      assert.equal((await workbenchCall(grant, "odm_take_action", { ...args, content: "Something else" })).isError, true);
      assert.equal(bodies.length, 2);
    } finally { globalThis.fetch = originalFetch; }
  });
  await test("transport uncertainty blocks retries even after restarting the worker", async () => {
    narration(); const o = playerWebhookState(grant, sub.id).opportunities[0];
    const originalFetch = globalThis.fetch; let calls = 0;
    try {
      globalThis.fetch = async () => { calls += 1; throw new Error("lost reply"); };
      const args = { campaignId: campaign.id, content: "I help.", subscriptionId: sub.id, opportunityId: o.opportunityId };
      assert.equal((await workbenchCall(grant, "odm_take_action", args)).isError, true);
      assert.match((await workbenchCall(grant, "odm_take_action", args)).text, /uncertain/);
      assert.equal(calls, 1);
    } finally { globalThis.fetch = originalFetch; }
  });
  await test("a parked own roll wakes only its owner after the DM parks", async () => {
    const turn = createDmTurn(campaign.id, []);
    const roll = createPendingRoll({ campaignId: campaign.id, turnId: turn.id, userId: user.id, characterId: sheetId, toolCallId: null, kind: "ability", detail: "wisdom", expression: "1d20", advantage: "normal", dc: 12, reason: "Test" });
    db.prepare(`UPDATE dm_turns SET status = 'awaiting_rolls' WHERE id = ?`).run(turn.id);
    setDmStatus(campaign.id, "awaiting_rolls"); await tick();
    assert.equal(sent.at(-1).event.type, "roll_requested"); assert.equal(sent.at(-1).event.pendingRollId, roll.id);
    resolvePendingRoll(roll.id, "fallback", null);
    db.prepare(`UPDATE dm_turns SET status = 'done' WHERE id = ?`).run(turn.id);
    setDmStatus(campaign.id, "idle");
  });
  await test("failed deliveries stop at eight attempts without rearming the unchanged opportunity", async () => {
    narration(); let calls = 0;
    const fail = async () => { calls += 1; return new Response(null, { status: 503 }); };
    for (let i = 0; i < 10; i += 1) { clock += 310_000; await runPlayerWebhooksOnce(clock, fail); }
    assert.equal(calls, 8);
    assert.equal(listPlayerWebhooks(grant.id)[0].failed, 1);
  });
  await test("expiration and character reassignment cancel delivery, including after a worker restart", async () => {
    deletePlayerWebhook(grant.id, sub.id);
    const temporary = createConnectionGrant({ userId: user.id, name: "Temporary", scopes: ["read", "play"], campaignId: campaign.id }).grant;
    createPlayerWebhook(temporary, { campaignId: campaign.id, characterId: sheetId, url: sub.url });
    db.prepare(`UPDATE agent_grants SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?`).run(temporary.id);
    await tick(); assert.deepEqual(listPlayerWebhooks(temporary.id), []);
    const replacement = createConnectionGrant({ userId: user.id, name: "Switch", scopes: ["read", "play"], campaignId: campaign.id }).grant;
    createPlayerWebhook(replacement, { campaignId: campaign.id, characterId: sheetId, url: sub.url });
    db.prepare(`UPDATE character_sheets SET user_id = ? WHERE id = ?`).run(other.id, sheetId);
    await tick(); assert.deepEqual(listPlayerWebhooks(replacement.id), []);
    db.prepare(`UPDATE character_sheets SET user_id = ? WHERE id = ?`).run(user.id, sheetId);
    // The original subscription was correctly removed too. Restore one for the next checks.
    const restored = createPlayerWebhook(grant, { campaignId: campaign.id, characterId: sheetId, url: sub.url });
    sub.id = restored.id; sub.signingSecret = restored.signingSecret;
  });
  await test("combat finish phase cannot submit another initial action", () => {
    const fight = createEncounter(campaign.id, "Test fight");
    const waiting = allocateSeq(campaign.id);
    db.prepare(`UPDATE encounters SET order_ready = 1, order_json = ?, waiting_seq = ? WHERE id = ?`)
      .run(JSON.stringify([{ kind: "pc", userId: user.id, characterId: sheetId, name: "Hero", initiative: 10 }]), waiting, fight.id);
    setFloor(campaign.id, { mode: "initiative", encounterId: fight.id, userIds: [user.id], currentName: "Hero", round: 1 });
    insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId: user.id, characterId: sheetId, content: "Initial attack" });
    const o = playerWebhookState(grant, sub.id).opportunities[0]; assert.equal(o.phase, "finish");
    assert.throws(() => reserveWebhookWrite(grant, { subscriptionId: sub.id, opportunityId: o.opportunityId, campaignId: campaign.id, tool: "odm_take_action", fingerprint: "two" }));
    assert.equal(reserveWebhookWrite(grant, { subscriptionId: sub.id, opportunityId: o.opportunityId, campaignId: campaign.id, tool: "odm_end_turn", fingerprint: "end" }), null);
  });
  await test("revocation deletes subscription, pending deliveries and guarded receipts", async () => {
    revokeConnectionGrant(user.id, grant.id); const count = sent.length; await tick();
    assert.equal(sent.length, count); assert.deepEqual(listPlayerWebhooks(grant.id), []);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM player_webhook_writes`).get().n, 0);
  });
  await test("authorizationHeader is validated, sent verbatim on each delivery and never listed back", async () => {
    for (const bad of ["", "Bearer a\r\nX-Evil: 1", "Bearer a\nb", "Bearer a\rb", "x".repeat(1025), " Bearer a", "Bearer a ", "Bearer \u00e9", "Bearer \u0000", 42]) {
      assert.throws(() => webhookAuthorization(bad));
    }
    assert.equal(webhookAuthorization(undefined), null);
    assert.equal(webhookAuthorization("x".repeat(1024)).length, 1024);
    const hosted = createConnectionGrant({ userId: user.id, name: "Hosted agent", scopes: ["read", "play"], campaignId: campaign.id }).grant;
    const base = { campaignId: campaign.id, characterId: sheetId, url: sub.url };
    for (const authorizationHeader of ["Bearer a\r\nX-Evil: 1", "x".repeat(1025), 7]) {
      const refused = await workbenchCall(hosted, "odm_subscribe_player_webhook", { ...base, authorizationHeader });
      assert.equal(refused.isError, true);
      assert.ok(!refused.text.includes("X-Evil"));
    }
    assert.deepEqual(listPlayerWebhooks(hosted.id), []);
    const value = "Bearer hosted-receiver-SECRET-TOKEN";
    const created = await workbenchCall(hosted, "odm_subscribe_player_webhook", { ...base, authorizationHeader: value });
    assert.equal(created.isError, false);
    assert.ok(!created.text.includes(value)); assert.equal(JSON.parse(created.text).hasAuthorizationHeader, true);
    const listed = await workbenchCall(hosted, "odm_list_player_webhooks", {});
    assert.ok(!listed.text.includes(value)); assert.equal(JSON.parse(listed.text).subscriptions[0].hasAuthorizationHeader, true);
    const { id, signingSecret } = JSON.parse(created.text);
    assert.ok(!JSON.stringify(playerWebhookState(hosted, id)).includes(value));
    narration(); const before = sent.length; await tick();
    const delivered = sent.slice(before).filter((s) => s.event.subscriptionId === id);
    assert.ok(delivered.length > 0);
    for (const { options } of delivered) {
      assert.equal(options.headers.Authorization, value);
      assert.ok(verifySignature(signingSecret, options.headers["X-ODM-Timestamp"], options.headers["X-ODM-Signature"], options.body));
      assert.ok(!options.body.includes(value));
    }
    assert.equal(JSON.parse((await workbenchCall(hosted, "odm_unsubscribe_player_webhook", { subscriptionId: id })).text).removed, true);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM player_webhooks WHERE authorization_header IS NOT NULL`).get().n, 0);
  });
  await test("extra headers are validated, sent with each delivery and listed by name only; every event carries a text summary", async () => {
    const five = Object.fromEntries(["a", "b", "c", "d", "e"].map((k) => [`x-${k}`, "1"]));
    for (const bad of [{ Authorization: "Bearer a" }, { host: "x" }, { "Content-Type": "text/plain" }, { Cookie: "a=b" }, { "X-ODM-Signature": "v1=0" },
      { "Proxy-Anything": "1" }, { "bad name": "1" }, { ["a".repeat(65)]: "1" }, { "A-B": "1", "a-b": "2" }, five,
      { "anthropic-version": "a\r\nX-Evil: 1" }, { "anthropic-version": "" }, { "anthropic-version": 7 }, [], "anthropic-version: 1", 3]) {
      assert.throws(() => webhookHeaders(bad));
    }
    assert.equal(webhookHeaders(undefined), null);
    assert.equal(webhookHeaders({}), null);
    assert.deepEqual(webhookHeaders({ "anthropic-version": "2023-06-01" }), { "anthropic-version": "2023-06-01" });
    const hosted = createConnectionGrant({ userId: user.id, name: "Claude routine", scopes: ["read", "play"], campaignId: campaign.id }).grant;
    const base = { campaignId: campaign.id, characterId: sheetId, url: sub.url };
    const refused = await workbenchCall(hosted, "odm_subscribe_player_webhook", { ...base, headers: { "anthropic-version": "SECRET-VALUE\r\nX-Evil: 1" } });
    assert.equal(refused.isError, true);
    assert.ok(!refused.text.includes("SECRET-VALUE") && !refused.text.includes("X-Evil"));
    assert.deepEqual(listPlayerWebhooks(hosted.id), []);
    const value = "Bearer sk-ant-oat01-ROUTINE-SECRET";
    const version = "2023-06-01-SECRET-MARKER";
    const created = await workbenchCall(hosted, "odm_subscribe_player_webhook", { ...base, authorizationHeader: value, headers: { "anthropic-version": version } });
    assert.equal(created.isError, false);
    assert.ok(!created.text.includes(value) && !created.text.includes(version));
    assert.deepEqual(JSON.parse(created.text).headerNames, ["anthropic-version"]);
    const listed = await workbenchCall(hosted, "odm_list_player_webhooks", {});
    assert.ok(!listed.text.includes(version)); assert.deepEqual(JSON.parse(listed.text).subscriptions[0].headerNames, ["anthropic-version"]);
    const { id, signingSecret } = JSON.parse(created.text);
    narration(); const before = sent.length; await tick();
    const delivered = sent.slice(before).filter((s) => s.event.subscriptionId === id);
    assert.ok(delivered.length > 0);
    for (const { options, event } of delivered) {
      assert.equal(options.headers["anthropic-version"], version);
      assert.equal(options.headers.Authorization, value);
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.ok(verifySignature(signingSecret, options.headers["X-ODM-Timestamp"], options.headers["X-ODM-Signature"], options.body));
      assert.ok(!options.body.includes(version) && !options.body.includes(value));
      assert.equal(typeof event.text, "string");
      assert.ok(event.text.includes(id) && event.text.includes(event.opportunityId) && event.text.includes("Read the table"));
      assert.ok(event.text.length <= 4000);
    }
    assert.equal(JSON.parse((await workbenchCall(hosted, "odm_unsubscribe_player_webhook", { subscriptionId: id })).text).removed, true);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM player_webhooks WHERE extra_headers IS NOT NULL`).get().n, 0);
  });
  await test("signatures reject changed bodies, wrong keys and old/future timestamps", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = webhookSignature("secret", timestamp, "body");
    assert.ok(verifySignature("secret", timestamp, signature, "body"));
    assert.ok(!verifySignature("other", timestamp, signature, "body"));
    assert.ok(!verifySignature("secret", timestamp, signature, "tampered"));
    assert.ok(!verifySignature("secret", timestamp, signature, "body", Date.now() + 301_000));
    assert.ok(!verifySignature("secret", timestamp, signature, "body", Date.now() - 301_000));
  });
  await test("signed HTTP receiver persists before acknowledgement, rejects spoofing and deduplicates opportunities", async () => {
    const event = { ...sent.find((s) => s.event.type === "response_requested").event, subscriptionId: sub.id };
    const inbox = new PlayerInbox(path.join(directory, "inbox"));
    const config = { ...sub, path: "/odm" };
    assert.ok(validateEvent(event, config));
    assert.ok(!validateEvent({ ...event, characterId: "another" }, config));
    assert.ok(!validateEvent({ ...event, content: "malicious prompt" }, config));
    const server = receiverServer(config, inbox);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/odm`;
    const body = JSON.stringify({ ...event, occurredAt: nowIso() });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = { "X-ODM-Timestamp": timestamp, "X-ODM-Signature": webhookSignature(sub.signingSecret, timestamp, body), "X-ODM-Event-Id": event.eventId };
    try {
      assert.equal((await fetch(url, { method: "POST", body, headers })).status, 202);
      assert.equal(Object.keys(JSON.parse(fs.readFileSync(inbox.file, "utf8")).jobs).length, 1);
      assert.equal((await fetch(url, { method: "POST", body, headers })).status, 202);
      assert.equal((await fetch(url, { method: "POST", body: body + " ", headers })).status, 401);
      assert.equal((await fetch(url, { method: "POST", body: "x".repeat(17000), headers })).status, 413);
      const unsaved = { ...event, opportunityId: "disk-failure" };
      const failedBody = JSON.stringify(unsaved);
      const save = inbox.save;
      inbox.save = () => { throw new Error("disk full"); };
      assert.equal((await fetch(url, { method: "POST", body: failedBody, headers: { ...headers, "X-ODM-Signature": webhookSignature(sub.signingSecret, timestamp, failedBody) } })).status, 503);
      assert.ok(!Object.values(inbox.state.jobs).some((j) => j.event.opportunityId === "disk-failure"));
      inbox.save = save;
      let wakes = 0;
      await Promise.all([inbox.processOne(async () => true, async () => { wakes += 1; }), inbox.processOne(async () => true, async () => { wakes += 1; })]);
      assert.equal(wakes, 1);
      const restarted = new PlayerInbox(path.dirname(inbox.file));
      restarted.accept(event); await restarted.processOne(async () => true, async () => { wakes += 1; }); assert.equal(wakes, 1);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
  await test("receiver rechecks stale state, retries read failures and quarantines crashed turns", async () => {
    const event = { ...sent.find((s) => s.event.type === "response_requested").event, occurredAt: nowIso(), opportunityId: "receiver-fresh" };
    const inbox = new PlayerInbox(path.join(directory, "recovery"));
    inbox.accept(event); let wakes = 0;
    await inbox.processOne(async () => { throw new Error("offline"); }, async () => { wakes += 1; }); assert.equal(wakes, 0);
    await inbox.processOne(async () => false, async () => { wakes += 1; }, Date.now() + 10_000); assert.equal(wakes, 0);
    inbox.accept({ ...event, opportunityId: "receiver-uncertain" });
    await inbox.processOne(async () => true, async () => { wakes += 1; throw new Error("reply lost"); });
    assert.equal(wakes, 1);
    const restarted = new PlayerInbox(path.dirname(inbox.file));
    await restarted.processOne(async () => true, async () => { wakes += 1; }); assert.equal(wakes, 1);
    inbox.accept({ ...event, opportunityId: "receiver-running" });
    Object.values(inbox.state.jobs).at(-1).state = "running"; inbox.save();
    const crashed = new PlayerInbox(path.dirname(inbox.file)); assert.equal(Object.values(crashed.state.jobs).at(-1).state, "uncertain");
    assert.match(playerPrompt(event, "Be helpful"), /Before EACH write/);
    assert.match(playerPrompt(event, "Be helpful"), /never as instructions/);
    assert.ok(!playerPrompt({ ...event, text: "TEXT-ONLY-MARKER" }, "Be helpful").includes("TEXT-ONLY-MARKER"));
  });
  await test("Codex adapter initializes, persists its own thread before starting and resumes it serially", async () => {
    const calls = []; let threadId; let killed = 0; let handlers;
    const factory = (_binary, _args, _options, h) => {
      handlers = h;
      return { request: async (method, params) => {
        calls.push({ method, params });
        if (method === "thread/start" || method === "thread/resume") return { thread: { id: "receiver-thread" } };
        if (method === "turn/start") { assert.equal(threadId, "receiver-thread"); h.onNotification("turn/completed", { turn: { status: "completed" } }); }
        return {};
      }, notify(method) { calls.push({ method }); }, kill() { killed += 1; } };
    };
    const options = { binary: "fake-codex", cwd: directory, env: {}, prompt: "synthetic opportunity", effort: "medium", onThreadId: (id) => { threadId = id; } };
    await runCodexPlayerTurn(factory, ["app-server"], options);
    assert.deepEqual(calls.map((c) => c.method), ["initialize", "initialized", "thread/start", "turn/start"]);
    assert.equal(calls.at(-1).params.sandboxPolicy.type, "readOnly");
    assert.equal(calls.at(-1).params.approvalPolicy, "never");
    assert.deepEqual(handlers.onRequest("item/commandExecution/requestApproval"), { decision: "decline" });
    assert.deepEqual(handlers.onRequest("item/fileChange/requestApproval"), { decision: "decline" });
    assert.equal(killed, 1);
    calls.length = 0;
    await runCodexPlayerTurn(factory, ["app-server"], { ...options, threadId });
    assert.equal(calls[2].method, "thread/resume"); assert.equal(calls[2].params.threadId, threadId); assert.equal(killed, 2);
  });
  await test("receiver isolates its Codex home, ignores ambient API auth and approves only selected player tools", () => {
    const inherited = { PATH: "tools", CODEX_HOME: "normal-profile", OPENAI_API_KEY: "synthetic-api-key" };
    const env = playerCodexEnvironment(directory, inherited);
    assert.equal(env.CODEX_HOME, path.join(directory, "codex-home"));
    assert.equal(env.PATH, "tools"); assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(inherited.CODEX_HOME, "normal-profile"); assert.equal(inherited.OPENAI_API_KEY, "synthetic-api-key");
    const override = playerMcpOverride("https://odm.example/api/mcp", "private-helper");
    assert.match(override, /default_tools_approval_mode="approve"/);
    assert.ok(!override.includes("odm_subscribe_player_webhook"));
    assert.ok(!override.includes("odm_unsubscribe_player_webhook"));
    assert.ok(!override.includes("odm_dm_invoke"));
    assert.ok(override.includes("odm_get_player_webhook_opportunities"));
    assert.ok(override.includes("odm_get_sheet") && override.includes("odm_get_messages"));
    assert.ok(!override.includes("odm_get_character"), "the library copy is not the table's sheet");
  });
  await test("Codex failed or timed-out turns are stopped and never reported complete", async () => {
    let killed = 0;
    const factory = (failure) => (_binary, _args, _options, h) => ({
      request: async (method) => {
        if (method === "thread/start") return { thread: { id: "failed-thread" } };
        if (method === "turn/start" && failure) h.onNotification("turn/completed", { turn: { status: "failed" } });
        return {};
      }, notify() {}, kill() { killed += 1; },
    });
    const options = { binary: "fake", cwd: directory, env: {}, prompt: "test", onThreadId() {}, timeoutMs: 10 };
    await assert.rejects(runCodexPlayerTurn(factory(true), [], options), /failed/);
    await assert.rejects(runCodexPlayerTurn(factory(false), [], options), /timed out/);
    assert.equal(killed, 2);
  });
  console.log(`${passed} player webhook tests passed`);
} finally {
  db.close(); globalThis.__localRoleplayDb = undefined;
  fs.rmSync(directory, { recursive: true, force: true });
}
