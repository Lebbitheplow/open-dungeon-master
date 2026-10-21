// Wait for the table (gameSettings.waitForTable, src/lib/dm/table-wait.ts):
// the pure decision, the window over a real database, passes, the agent
// webhook opportunity staying live while the table gathers, and the wiring
// in the routes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "odm-table-wait-"));
process.env.SQLITE_DB_PATH = path.join(directory, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.ODM_PLAYER_WEBHOOK_ORIGINS = "https://receiver.example";
register("./lib/register-alias.mjs", import.meta.url);

const { getDatabase, nowIso } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, setCampaignStatus, setFloor, allocateSeq, joinByInviteCode, updateGameSettings } = await import("../src/lib/db/campaigns.ts");
const { insertCampaignMessage } = await import("../src/lib/db/messages.ts");
const { subscribe } = await import("../src/lib/events.ts");
const { normalizeGameSettings } = await import("../src/lib/schemas/game-settings.ts");
const { decideTableWait, clampWaitSeconds, formatLeft, holdsPostForTable, TABLE_WAIT_DEFAULT_SECONDS } = await import("../src/lib/dm/table-wait-logic.ts");
const { settleTableWait, passTable, currentTableWait, tableWaitTurnStarted, waitsForTable, tableWaitHasAnswers } = await import("../src/lib/dm/table-wait.ts");
const { getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { setDmStatus } = await import("../src/lib/dm/status.ts");
const { pauseTable, resumeTable } = await import("../src/lib/dm/table-break.ts");
const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
const { createPlayerWebhook, playerWebhookState, reserveWebhookWrite } = await import("../src/lib/agents/webhooks.ts");

let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`ok - ${name}`); }

const A = { userId: "a", name: "Arden" };
const B = { userId: "b", name: "Kalanis" };
const T0 = 1_000_000;
const base = { present: [A, B], posts: [], passes: [], openedAt: T0, seconds: 120, now: T0 };

await test("the setting defaults on, with a five-minute wait (a lone player is still answered at once)", () => {
  const settings = normalizeGameSettings({});
  assert.equal(settings.waitForTable, true);
  assert.equal(settings.waitForTableSeconds, 300);
  assert.equal(TABLE_WAIT_DEFAULT_SECONDS, 300);
  assert.equal(normalizeGameSettings({ waitForTable: true, waitForTableSeconds: 5 }).waitForTableSeconds, 300, "out of range falls back");
  assert.equal(normalizeGameSettings({ waitForTable: true, waitForTableSeconds: 600 }).waitForTableSeconds, 600, "ten minutes is allowed");
  assert.equal(clampWaitSeconds(5), 15);
  assert.equal(clampWaitSeconds(10_000), 900);
  assert.equal(clampWaitSeconds("x"), 300);
});

await test("an untouched beat waits on everyone present and has no clock yet", () => {
  const d = decideTableWait(base);
  assert.equal(d.fire, false);
  assert.equal(d.deadline, null);
  assert.equal(d.view.deadline, null);
  assert.deepEqual(d.view.waitingOn, [A, B]);
});

await test("a post starts the clock and leaves the others waited on", () => {
  const d = decideTableWait({ ...base, posts: [{ ...A, at: T0 + 5_000 }], now: T0 + 6_000 });
  assert.equal(d.fire, false);
  assert.equal(d.deadline, T0 + 5_000 + 120_000);
  assert.deepEqual(d.view.waitingOn, [B]);
  assert.deepEqual(d.view.answered, [{ ...A, passed: false }]);
});

await test("the last present player acting or passing fires the one turn", () => {
  const acted = decideTableWait({ ...base, posts: [{ ...A, at: T0 }, { ...B, at: T0 + 1 }, { ...A, at: T0 + 2 }] });
  assert.equal(acted.fire, true);
  assert.equal(acted.view.answered.length, 2, "two posts from one player are one answer");
  const pass = decideTableWait({ ...base, posts: [{ ...A, at: T0 }], passes: [{ ...B, at: T0 + 1 }] });
  assert.equal(pass.fire, true);
  assert.deepEqual(pass.view.answered.at(-1), { ...B, passed: true });
});

await test("passes alone never fire: there is nothing for the DM to answer", () => {
  const d = decideTableWait({ ...base, passes: [{ ...A, at: T0 }, { ...B, at: T0 }] });
  assert.equal(d.fire, false);
  assert.deepEqual(d.view.waitingOn, []);
});

await test("a pass after a post does not take the post back", () => {
  const d = decideTableWait({ ...base, posts: [{ ...A, at: T0 }], passes: [{ ...A, at: T0 + 1 }] });
  assert.deepEqual(d.view.answered, [{ ...A, passed: false }]);
  assert.deepEqual(d.view.waitingOn, [B]);
});

await test("the time running out fires with whoever answered", () => {
  const at = T0 + 1_000;
  assert.equal(decideTableWait({ ...base, posts: [{ ...A, at }], now: at + 119_999 }).fire, false);
  assert.equal(decideTableWait({ ...base, posts: [{ ...A, at }], now: at + 120_000 }).fire, true);
});

await test("every answer restarts the clock: a table still talking is not cut off", () => {
  const C = { userId: "c", name: "Mira" };
  const three = { ...base, present: [A, B, C] };
  // Arden posts, then Kalanis answers him 100 seconds later.
  const posts = [{ ...A, at: T0 + 10_000 }, { ...B, at: T0 + 110_000 }];
  const d = decideTableWait({ ...three, posts, now: T0 + 10_000 + 120_000 });
  assert.equal(d.deadline, T0 + 110_000 + 120_000, "the deadline runs from Kalanis's post, not Arden's");
  assert.equal(d.fire, false, "two minutes after the first post, Mira still has time");
  assert.deepEqual(d.view.waitingOn, [C]);
  assert.equal(decideTableWait({ ...three, posts, now: T0 + 110_000 + 120_000 }).fire, true, "only quiet ends it");
  // A second post from someone who already answered restarts it too.
  const again = decideTableWait({ ...three, posts: [...posts, { ...A, at: T0 + 200_000 }], now: T0 + 230_000 });
  assert.equal(again.deadline, T0 + 200_000 + 120_000);
  // So does a pass.
  const pass = decideTableWait({ ...three, posts: posts.slice(0, 1), passes: [{ ...B, at: T0 + 50_000 }] });
  assert.equal(pass.deadline, T0 + 50_000 + 120_000);
});

await test("a pass before anyone posts starts no clock, and counts once a post lands", () => {
  const C = { userId: "c", name: "Mira" };
  const early = decideTableWait({ ...base, present: [A, B, C], passes: [{ ...B, at: T0 + 5_000 }] });
  assert.equal(early.deadline, null);
  const later = decideTableWait({ ...base, present: [A, B, C], passes: [{ ...B, at: T0 + 5_000 }], posts: [{ ...A, at: T0 + 9_000 }] });
  assert.equal(later.deadline, T0 + 9_000 + 120_000, "the clock runs from the latest answer");
});

await test("a post made while the DM was still writing does not start a clock that already ran", () => {
  const d = decideTableWait({ ...base, posts: [{ ...A, at: T0 - 60_000 }], now: T0 + 1_000 });
  assert.equal(d.deadline, T0 + 120_000);
  assert.equal(d.fire, false);
});

await test("only present players are waited on: a player alone at the table is answered at once", () => {
  const d = decideTableWait({ ...base, present: [A], posts: [{ ...A, at: T0 }] });
  assert.equal(d.fire, true);
  assert.deepEqual(d.view.waitingOn, []);
  assert.equal(decideTableWait({ ...base, present: [A] }).gathering, false, "one player present is no table to gather");
  assert.equal(decideTableWait({ ...base, present: [A, A] }).gathering, false, "one person twice is still one");
  assert.equal(decideTableWait(base).gathering, true);
  // A player who posted with no tab open is at the table too: the one with
  // the table open is waited on, and told so.
  const posted = decideTableWait({ ...base, present: [B], posts: [{ ...A, at: T0 }] });
  assert.equal(posted.gathering, true);
  assert.deepEqual(posted.view.waitingOn, [B]);
});

await test("only an open-floor post gathers: a spotlight answer, table talk and a first action never wait", () => {
  const post = { floorBefore: "open", kind: "do", isFirstAction: false, waits: true };
  assert.equal(holdsPostForTable(post), true);
  assert.equal(holdsPostForTable({ ...post, floorBefore: "spotlight" }), false, "a spotlight takes precedence");
  assert.equal(holdsPostForTable({ ...post, floorBefore: "initiative" }), false);
  assert.equal(holdsPostForTable({ ...post, kind: "ooc" }), false);
  assert.equal(holdsPostForTable({ ...post, isFirstAction: true }), false);
  assert.equal(holdsPostForTable({ ...post, waits: false }), false);
});

await test("the banner counts down in seconds, then minutes", () => {
  assert.equal(formatLeft(45), "45s");
  assert.equal(formatLeft(120), "2m");
  assert.equal(formatLeft(95), "1m 35s");
});

// ---- over a real table ----

const db = getDatabase();
const alice = createUser("wait-alice", "not-a-password");
const bob = createUser("wait-bob", "not-a-password");
const campaign = createCampaign(alice.id, { title: "Wait test", description: "", theme: "", difficulty: "normal", startingLevel: 1, maxPlayers: 4 });
joinByInviteCode(bob.id, campaign.inviteCode);
const sheet = (id, userId, name) => db.prepare(`INSERT INTO character_sheets (id, campaign_id, user_id, name, race, class, abilities_json, max_hp, current_hp, ac, hit_dice_json, proficiencies_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'human', 'fighter', '{}', 10, 10, 12, '{}', '{}', ?, ?)`).run(id, campaign.id, userId, name, nowIso(), nowIso());
sheet("wait-sheet-a", alice.id, "Arden");
sheet("wait-sheet-b", bob.id, "Kalanis");
setCampaignStatus(campaign.id, "active");
const narrate = () => insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "dm", content: "The gate creaks open." });
const post = (userId, characterId, content = "I step forward.") => insertCampaignMessage({ campaignId: campaign.id, seq: allocateSeq(campaign.id), authorType: "player", userId, characterId, content });
const leaveA = subscribe(campaign.id, () => {}, alice.id);
const leaveB = subscribe(campaign.id, () => {}, bob.id);

try {
  await test("with the setting off nothing waits and a pass is refused", () => {
    updateGameSettings(campaign.id, { waitForTable: false });
    narrate();
    assert.equal(waitsForTable(getCampaignById(campaign.id)), false);
    assert.equal(currentTableWait(campaign.id), null);
    assert.equal(settleTableWait(campaign.id), false);
    const refused = passTable(campaign.id, alice.id);
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 409);
  });

  await test("a post waits for the other present player, who is named", () => {
    updateGameSettings(campaign.id, { waitForTable: true, waitForTableSeconds: 120 });
    narrate();
    assert.deepEqual(currentTableWait(campaign.id).waitingOn.map((seat) => seat.name), ["Arden", "Kalanis"]);
    post(alice.id, "wait-sheet-a");
    assert.equal(settleTableWait(campaign.id), false, "held: Kalanis has not answered");
    const view = currentTableWait(campaign.id);
    assert.deepEqual(view.waitingOn.map((seat) => seat.name), ["Kalanis"]);
    assert.ok(view.deadline, "the clock runs from the latest answer");
    assert.ok(globalThis.__odmTableWait.get(campaign.id).timer, "a timer is armed for the deadline");
  });

  await test("the lead's go-on-now has something to answer once a post is in", () => {
    assert.equal(tableWaitHasAnswers(campaign.id), true);
  });

  await test("table talk is not an answer", () => {
    post(bob.id, "wait-sheet-b", "(ooc) brb, getting tea");
    assert.equal(settleTableWait(campaign.id), false);
  });

  await test("a player who already answered cannot pass; the last one's pass fires the turn", () => {
    const again = passTable(campaign.id, alice.id);
    assert.equal(again.ok, false);
    const last = passTable(campaign.id, bob.id);
    assert.deepEqual(last, { ok: true, fire: true });
  });

  await test("the deadline fires a held turn with only some answers", () => {
    tableWaitTurnStarted(campaign.id, db.prepare(`SELECT next_seq - 1 AS seq FROM campaigns WHERE id = ?`).get(campaign.id).seq);
    narrate();
    post(bob.id, "wait-sheet-b");
    assert.equal(settleTableWait(campaign.id), false);
    assert.equal(settleTableWait(campaign.id, Date.now() + 121_000), true);
    assert.equal(globalThis.__odmTableWait.get(campaign.id).timer, undefined, "the timer is cleared once it fires");
  });

  await test("a post made while the turn wrote counts for the next beat", () => {
    tableWaitTurnStarted(campaign.id, db.prepare(`SELECT next_seq - 1 AS seq FROM campaigns WHERE id = ?`).get(campaign.id).seq);
    post(alice.id, "wait-sheet-a", "I keep watch while the DM writes.");
    narrate();
    const view = currentTableWait(campaign.id);
    assert.deepEqual(view.answered.map((seat) => seat.name), ["Arden"]);
    assert.deepEqual(view.waitingOn.map((seat) => seat.name), ["Kalanis"]);
  });

  await test("a player who leaves is no longer waited on", () => {
    leaveB();
    assert.equal(settleTableWait(campaign.id), true);
  });

  await test("a player alone at the table sees no wait, cannot pass, and is answered as they post", () => {
    tableWaitTurnStarted(campaign.id, db.prepare(`SELECT next_seq - 1 AS seq FROM campaigns WHERE id = ?`).get(campaign.id).seq);
    narrate();
    assert.equal(waitsForTable(getCampaignById(campaign.id)), true, "the table still waits once someone else is back");
    assert.equal(currentTableWait(campaign.id), null, "no banner for a lone player");
    const pass = passTable(campaign.id, alice.id);
    assert.equal(pass.ok, false);
    assert.match(pass.error, /Nobody else is at the table/);
    post(alice.id, "wait-sheet-a");
    assert.equal(settleTableWait(campaign.id), true, "answered at once");
  });

  await test("a spotlight or a hold suspends the wait", () => {
    setFloor(campaign.id, { mode: "spotlight", userIds: [bob.id], prompt: "Kalanis?", respondedUserIds: [] });
    assert.equal(currentTableWait(campaign.id), null);
    assert.equal(passTable(campaign.id, alice.id).ok, false);
    setFloor(campaign.id, { mode: "open" });
  });

  await test("a table break stands the wait aside, and Resume starts its clock again", () => {
    const back = subscribe(campaign.id, () => {}, bob.id);
    tableWaitTurnStarted(campaign.id, db.prepare(`SELECT next_seq - 1 AS seq FROM campaigns WHERE id = ?`).get(campaign.id).seq);
    narrate();
    post(alice.id, "wait-sheet-a");
    assert.equal(settleTableWait(campaign.id), false);
    assert.ok(currentTableWait(campaign.id).deadline);
    pauseTable(campaign.id, { id: alice.id, username: "wait-alice" });
    assert.equal(waitsForTable(getCampaignById(campaign.id)), false);
    assert.equal(currentTableWait(campaign.id), null, "no wait banner over a break");
    assert.equal(settleTableWait(campaign.id, Date.now() + 10 * 60_000), false, "a deadline passing during the break fires nothing");
    const refused = passTable(campaign.id, bob.id);
    assert.equal(refused.ok, false);
    assert.match(refused.error, /The table is paused/);
    const resumedAt = Date.now();
    resumeTable(campaign.id, { id: alice.id, username: "wait-alice" });
    const view = currentTableWait(campaign.id);
    assert.deepEqual(view.waitingOn.map((seat) => seat.name), ["Kalanis"]);
    assert.ok(Date.parse(view.deadline) >= resumedAt + 120_000, "the clock counts from Resume, not from before the break");
    back();
  });

  await test("a spotlight answered by its named players does not then wait on the rest of the table", () => {
    // The lead spotlights Arden alone; Kalanis is at the table too.
    const leaveAgain = subscribe(campaign.id, () => {}, bob.id);
    tableWaitTurnStarted(campaign.id, db.prepare(`SELECT next_seq - 1 AS seq FROM campaigns WHERE id = ?`).get(campaign.id).seq);
    narrate();
    setFloor(campaign.id, { mode: "spotlight", userIds: [alice.id], prompt: "Arden, the guard asks your name.", respondedUserIds: [] });
    assert.equal(currentTableWait(campaign.id), null, "no banner while the spotlight runs");
    assert.equal(holdsPostForTable({ floorBefore: "spotlight", kind: "say", isFirstAction: false, waits: waitsForTable(getCampaignById(campaign.id)) }), false,
      "Arden's answer is a spotlight answer: the route wakes the DM with it rather than gathering");
    post(alice.id, "wait-sheet-a", "\"Arden of the Vale.\"");
    // The last answer releases the spotlight to the open floor and requests
    // the DM's turn, as today (requestDmTurn marks the DM thinking).
    setFloor(campaign.id, { mode: "open" });
    setDmStatus(campaign.id, "thinking");
    // Kalanis posting, or passing, before that turn starts reading does not
    // open a second wait.
    post(bob.id, "wait-sheet-b", "I glance at the guard's spear.");
    assert.equal(settleTableWait(campaign.id), false);
    assert.equal(globalThis.__odmTableWait.get(campaign.id).timer, undefined, "no gather timer was armed for the spotlight's answer");
    assert.equal(currentTableWait(campaign.id), null);
    assert.equal(passTable(campaign.id, bob.id).ok, false, "no pass while the DM is answering");
    // The coalesced turn reads both and narrates; the gather opens fresh.
    tableWaitTurnStarted(campaign.id, db.prepare(`SELECT next_seq - 1 AS seq FROM campaigns WHERE id = ?`).get(campaign.id).seq);
    setDmStatus(campaign.id, "idle");
    assert.equal(tableWaitHasAnswers(campaign.id), false, "nothing left over for a second wait");
    narrate();
    const fresh = currentTableWait(campaign.id);
    assert.deepEqual(fresh.answered, [], "the next narration starts a fresh beat");
    assert.equal(fresh.deadline, null);
    assert.deepEqual(fresh.waitingOn.map((seat) => seat.name), ["Arden", "Kalanis"]);
    leaveAgain();
  });

  await test("an agent's webhook keeps the narration opportunity live while the table gathers, until it passes", () => {
    const grant = createConnectionGrant({ userId: bob.id, name: "Muse", scopes: ["read", "play"], campaignId: campaign.id }).grant;
    const sub = createPlayerWebhook(grant, { campaignId: campaign.id, characterId: "wait-sheet-b", url: "https://receiver.example/odm" });
    tableWaitTurnStarted(campaign.id, db.prepare(`SELECT next_seq - 1 AS seq FROM campaigns WHERE id = ?`).get(campaign.id).seq);
    narrate();
    assert.equal(tableWaitHasAnswers(campaign.id), false, "nothing posted yet: go on now wakes nobody");
    const before = playerWebhookState(grant, sub.id).opportunities;
    assert.equal(before.length, 1);
    assert.equal(before[0].type, "response_requested");
    // The other player's post is held, so the DM stays idle and the
    // opportunity is the same one: the agent's write is not stale.
    post(alice.id, "wait-sheet-a");
    assert.equal(settleTableWait(campaign.id), false, "the agent's subscription keeps it at the table with no tab open");
    assert.deepEqual(playerWebhookState(grant, sub.id).opportunities.map((o) => o.opportunityId), before.map((o) => o.opportunityId));
    assert.equal(
      reserveWebhookWrite(grant, { subscriptionId: sub.id, opportunityId: before[0].opportunityId, campaignId: campaign.id, tool: "odm_pass", fingerprint: "pass" }),
      null,
      "a guarded pass is reserved against the live opportunity",
    );
    assert.deepEqual(passTable(campaign.id, bob.id), { ok: true, fire: true });
    assert.deepEqual(playerWebhookState(grant, sub.id).opportunities, [], "a pass answers the passage like a post");
  });
} finally {
  leaveA();
}

await test("the routes hold open-floor posts, offer Pass, and re-arm after a restart", () => {
  const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  const actions = read("app/api/campaigns/[campaignId]/actions/route.ts");
  assert.match(actions, /holdsPostForTable\(\{ floorBefore: floor\.mode, kind, isFirstAction, waits: waitsForTable\(campaign\) \}\)\) \{\s*\/\/[^]*?if \(settleTableWait\(campaignId\)\) \{\s*requestDmTurn\(campaignId\);/);
  const pass = read("app/api/campaigns/[campaignId]/pass/route.ts");
  assert.match(pass, /export async function POST/);
  assert.match(pass, /requireVoice/);
  assert.match(read("lib/dm/loop.ts"), /tableWaitTurnStarted\(campaignId, latestSeq\(campaignId\)\);\s*await startDmTurn/);
  assert.match(read("lib/dm/turn.ts"), /if \(settleTableWait\(campaignId\)\) \{\s*wakeDm\(campaignId\);/);
  assert.match(read("instrumentation.ts"), /rearmTableWaits\(\)/);
  assert.match(read("app/api/campaigns/[campaignId]/route.ts"), /tableWait: currentTableWait\(campaignId\)/);
  assert.match(read("lib/agents/workbench.ts"), /name: "odm_pass"/);
  assert.match(read("app/campaigns/[campaignId]/Composer.tsx"), /<TableWaitBanner/);
  assert.match(read("app/api/campaigns/[campaignId]/floor/route.ts"), /floor\.mode === "open" && tableWaitHasAnswers\(campaignId\)\) \{\s*requestDmTurn\(campaignId\);/);
});

console.log(`${passed} table-wait tests passed`);
