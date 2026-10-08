// A server shared with friends (issues #137, #138): the two admin settings
// (who may start campaigns, whose campaigns may spend the paid backends),
// the usage ledger that counts what each backend reported, and the parsers
// that read those reports. Real throwaway database, test-jobs pattern.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-shared-host-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
fs.mkdirSync(path.join(dir, "public", "uploads"), { recursive: true });
fs.mkdirSync(path.join(dir, "public", "generated"), { recursive: true });
process.chdir(dir);

register("./lib/register-alias.mjs", import.meta.url);

const { createUser, setUserAdmin } = await import("../src/lib/db/users.ts");
const { createCampaign, setPartyLead, joinByInviteCode } = await import("../src/lib/db/campaigns.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const shared = await import("../src/lib/shared-host.ts");
const { recordUsage, usageOverview, storageBytesFor, forgetUsageFor } = await import("../src/lib/usage/ledger.ts");
const { runInUsageScope, currentUsageScope, bindUsageScope } = await import("../src/lib/usage/scope.ts");
const { chatUsage, responsesUsage, ollamaUsage } = await import("../src/lib/usage/parse.ts");
const { harnessOfferFor } = await import("../src/lib/harness/policy.ts");
const { enqueueMediaJob } = await import("../src/lib/media-queue.ts");

let failed = 0;
async function test(name, run) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`not ok - ${name}`);
    console.log(error);
  }
}

const admin = createUser("Host", "hash");
setUserAdmin(admin.id, true);
const player = createUser("Guest", "hash");
const adminTable = createCampaign(admin.id, { title: "Host's table", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });
const guestTable = createCampaign(player.id, { title: "Guest's table", description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal" });

await test("the parsers read what each backend reports, and nothing from silence", () => {
  assert.deepEqual(chatUsage({ usage: { prompt_tokens: 1200, completion_tokens: 80 } }), { inputTokens: 1200, outputTokens: 80 });
  assert.equal(chatUsage({ choices: [] }), null);
  assert.equal(chatUsage({ usage: null }), null);
  assert.deepEqual(responsesUsage({ usage: { input_tokens: 10, output_tokens: 2 } }), { inputTokens: 10, outputTokens: 2 });
  assert.equal(responsesUsage(undefined), null);
  assert.deepEqual(ollamaUsage({ done: true, prompt_eval_count: 500, eval_count: 40 }), { inputTokens: 500, outputTokens: 40 });
  assert.equal(ollamaUsage({ message: { content: "..." } }), null);
  // Garbage counts as nothing rather than NaN.
  assert.deepEqual(chatUsage({ usage: { prompt_tokens: "x", completion_tokens: 3.6 } }), { inputTokens: 0, outputTokens: 4 });
});

await test("a backend on this machine or the LAN is local, keyed or not; a public host with a key is paid", () => {
  for (const url of ["http://127.0.0.1:8001/v1", "http://localhost:11434", "http://[::1]:8080/v1", "http://10.0.0.5:8000/v1", "http://192.168.1.20/v1", "http://172.20.3.4:8080", "http://169.254.1.1", "http://ollama:11434", "http://gpu-box.local:8001/v1", "http://model.lan/v1", "http://[fd12::1]:80"]) {
    assert.equal(shared.isPrivateBackendHost(url), true, url);
  }
  for (const url of ["https://api.openai.com/v1", "https://openrouter.ai/api/v1", "http://172.32.0.1/v1", "https://my-vllm.example.com/v1", "http://8.8.8.8:8000", "not a url", ""]) {
    assert.equal(shared.isPrivateBackendHost(url), false, url);
  }
});

await test("the policy defaults to everyone, and 'admins' holds the door for non-admins only", () => {
  assert.deepEqual(shared.sharedHostPolicy(), { campaignCreation: "everyone", paidAi: "everyone" });
  assert.equal(shared.canCreateCampaigns(player), true);
  saveGlobalConfig({ sharedHost: { campaignCreation: "admins" } });
  assert.equal(shared.canCreateCampaigns(player), false);
  assert.equal(shared.canCreateCampaigns({ ...admin, isAdmin: true }), true);
  assert.equal(shared.campaignCreationRefusal().status, 403);
  saveGlobalConfig({ sharedHost: { campaignCreation: "everyone" } });
  assert.equal(shared.canCreateCampaigns(player), true);
});

await test("paid AI answers to the campaign's lead, not its owner, and to the account outside a campaign", () => {
  saveGlobalConfig({ sharedHost: { paidAi: "admins" } });
  assert.equal(shared.paidAiAllowedForCampaign(adminTable.id), true);
  assert.equal(shared.paidAiAllowedForCampaign(guestTable.id), false);
  // The host joins the guest's table and takes the lead: the table may spend.
  assert.ok("campaign" in joinByInviteCode(admin.id, guestTable.inviteCode));
  assert.equal(setPartyLead(guestTable.id, admin.id), true);
  assert.equal(shared.paidAiAllowedForCampaign(guestTable.id), true);
  assert.equal(setPartyLead(guestTable.id, player.id), true);
  assert.equal(shared.paidAiAllowedForCampaign(guestTable.id), false);
  // In scope: the campaign decides; outside one, the account; with neither, allowed.
  assert.equal(runInUsageScope({ campaignId: guestTable.id }, () => shared.paidAiAllowedNow()), false);
  assert.equal(runInUsageScope({ campaignId: adminTable.id, userId: player.id }, () => shared.paidAiAllowedNow()), true);
  assert.equal(runInUsageScope({ userId: player.id }, () => shared.paidAiAllowedNow()), false);
  assert.equal(runInUsageScope({ userId: admin.id }, () => shared.paidAiAllowedNow()), true);
  assert.equal(shared.paidAiAllowedNow(), true);
  assert.match(shared.paidAiRefusal("images"), /keeps its paid picture backend for campaigns an administrator leads/);
  assert.equal(new shared.PaidAiRefusedError("speech").message, shared.paidAiRefusal("speech"));
  // The agent program follows the same rule even with its own setting on "all".
  saveGlobalConfig({ harness: { id: "claude", campaigns: "all" } });
  assert.equal(harnessOfferFor({ leadUserId: player.id }).offered, false);
  assert.match(harnessOfferFor({ leadUserId: player.id }).reason, /administrator leads/);
  saveGlobalConfig({ sharedHost: { paidAi: "everyone" } });
  assert.equal(shared.paidAiAllowedForCampaign(guestTable.id), true);
  saveGlobalConfig({ harness: { id: "" } });
});

await test("the scope rides down the async chain and onto a queued job", async () => {
  assert.deepEqual(currentUsageScope(), {});
  const seen = await runInUsageScope({ campaignId: adminTable.id, userId: admin.id }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return currentUsageScope();
  });
  assert.deepEqual(seen, { campaignId: adminTable.id, userId: admin.id });
  // A job queued inside the scope runs later with the same scope; one queued
  // outside runs with none.
  let inside = null;
  let outside = null;
  await runInUsageScope({ campaignId: guestTable.id }, () =>
    enqueueMediaJob("scoped", async () => {
      inside = currentUsageScope();
    }, "test"),
  );
  await enqueueMediaJob("unscoped", async () => {
    outside = currentUsageScope();
  }, "test");
  assert.deepEqual(inside, { campaignId: guestTable.id });
  assert.deepEqual(outside, {});
  // bindUsageScope adds to what it captured.
  const bound = runInUsageScope({ userId: player.id }, () => bindUsageScope(async () => currentUsageScope(), { campaignId: adminTable.id }));
  assert.deepEqual(await bound(), { userId: player.id, campaignId: adminTable.id });
});

await test("the ledger sums by campaign and by lead, with paid and local kept apart", () => {
  runInUsageScope({ campaignId: adminTable.id, userId: admin.id }, () => {
    recordUsage({ kind: "text", role: "story", backend: "custom", model: "gpt", paid: true, inputTokens: 1000, outputTokens: 100 });
    recordUsage({ kind: "text", role: "utility", backend: "local", model: "qwen", paid: false, inputTokens: 300, outputTokens: 30 });
    recordUsage({ kind: "image", role: "fast", backend: "openai", paid: true, units: 1 });
    recordUsage({ kind: "tts", role: "narration", backend: "kokoro", paid: false, units: 420 });
    recordUsage({ kind: "agent", role: "story", backend: "harness", model: "claude", paid: true, inputTokens: 5000, outputTokens: 400 });
  });
  runInUsageScope({ campaignId: guestTable.id, userId: player.id }, () => {
    recordUsage({ kind: "text", role: "story", backend: "custom", model: "llama", paid: false, inputTokens: 2000, outputTokens: 150 });
    recordUsage({ kind: "image", role: "slow", backend: "comfyui", paid: false, units: 2 });
  });
  // Outside any campaign: a library portrait and a dictation clip, the account's own.
  runInUsageScope({ userId: player.id }, () => {
    recordUsage({ kind: "image", role: "portrait", backend: "comfyui", paid: false, units: 1 });
    recordUsage({ kind: "stt", role: "dictation", backend: "openai", paid: true, units: 1 });
  });
  // Explicit ids win over the scope.
  recordUsage({ kind: "text", role: "story", backend: "custom", paid: true, inputTokens: 10, outputTokens: 1, campaignId: adminTable.id, userId: admin.id });

  const overview = usageOverview();
  const host = overview.campaigns.find((row) => row.campaignId === adminTable.id);
  const guest = overview.campaigns.find((row) => row.campaignId === guestTable.id);
  assert.equal(host.calls, 6);
  assert.equal(host.paidInputTokens, 6010);
  assert.equal(host.paidOutputTokens, 501);
  assert.equal(host.localInputTokens, 300);
  assert.equal(host.paidImages, 1);
  assert.equal(host.localSpeechChars, 420);
  assert.equal(host.agentTurns, 1);
  assert.equal(host.leadUsername, "Host");
  assert.equal(host.members, 1);
  assert.equal(guest.localInputTokens, 2000);
  assert.equal(guest.localImages, 2);
  assert.equal(guest.paidInputTokens, 0);
  assert.equal(guest.members, 2);
  assert.ok(host.lastAt && guest.lastAt);

  const hostAccount = overview.accounts.find((row) => row.userId === admin.id);
  const guestAccount = overview.accounts.find((row) => row.userId === player.id);
  // The lead's tables count for the lead; the guest's own work adds to the guest.
  assert.equal(hostAccount.paidInputTokens, 6010);
  assert.equal(hostAccount.campaignsOwned, 1);
  assert.equal(hostAccount.campaignsLed, 1);
  assert.equal(hostAccount.campaignsJoined, 2);
  assert.equal(guestAccount.localInputTokens, 2000);
  assert.equal(guestAccount.localImages, 3);
  assert.equal(guestAccount.paidDictationClips, 1);
  assert.equal(guestAccount.campaignsLed, 1);
  assert.equal(guestAccount.isAdmin, false);
  assert.equal(hostAccount.isAdmin, true);

  // An erased account's rows lose their name; the campaign's history stays.
  forgetUsageFor(player.id);
  const after = usageOverview();
  assert.equal(after.accounts.find((row) => row.userId === player.id).paidDictationClips, 0);
  assert.equal(after.campaigns.find((row) => row.campaignId === guestTable.id).localInputTokens, 2000);
});

await test("storage counts the files on disk the rows name, with their resized copies, and nothing missing", () => {
  const generated = path.join(dir, "public", "generated");
  fs.writeFileSync(path.join(generated, "scene-1.png"), Buffer.alloc(1000));
  fs.writeFileSync(path.join(generated, "scene-1-640.webp"), Buffer.alloc(200));
  fs.writeFileSync(path.join(generated, "scene-10.png"), Buffer.alloc(5000));
  assert.equal(storageBytesFor(["/generated/scene-1.png"]), 1200);
  assert.equal(storageBytesFor(["/generated/scene-1.png", "/generated/scene-1.png", "/generated/gone.png"]), 1200);
  assert.equal(storageBytesFor(["/generated/scene-10.png"]), 5000);
  assert.equal(storageBytesFor(["/etc/passwd", "https://x/uploads/a.png"]), 0);
});

await test("a keyed text backend is refused before any request leaves, a keyless one is not (#138)", async () => {
  const { requestDmMessage, requestUtilityMessage } = await import("../src/lib/dm/model.ts");
  const { customBackendIsPaid } = await import("../src/lib/model-client.ts");
  assert.equal(customBackendIsPaid("http://127.0.0.1:8001/v1", "sk-x"), false);
  assert.equal(customBackendIsPaid("https://api.example.invalid/v1", "sk-x"), true);
  assert.equal(customBackendIsPaid("https://api.example.invalid/v1", ""), false);
  const { normalizeSettings } = await import("../src/lib/db/settings.ts");
  // .invalid never resolves and nothing listens on port 9: a request that
  // goes out fails (502), a request the policy stops never does (403).
  const keyed = normalizeSettings({ textProvider: "custom", customBaseUrl: "http://api.example.invalid/v1", customModel: "m", customApiKey: "sk-test" });
  const keyless = normalizeSettings({ textProvider: "custom", customBaseUrl: "http://api.example.invalid/v1", customModel: "m", customApiKey: "" });
  const keyedLocal = normalizeSettings({ textProvider: "custom", customBaseUrl: "http://127.0.0.1:9/v1", customModel: "m", customApiKey: "sk-test" });
  const messages = [{ role: "user", content: "hi" }];
  saveGlobalConfig({ sharedHost: { paidAi: "admins" } });
  const refused = await runInUsageScope({ campaignId: guestTable.id }, () => requestDmMessage(keyed, messages, { timeoutMs: 2000 }));
  assert.equal(refused.error?.status, 403);
  assert.match((await refused.error.json()).error, /keeps its paid storyteller/);
  const allowedTable = await runInUsageScope({ campaignId: adminTable.id }, () => requestDmMessage(keyed, messages, { timeoutMs: 2000 }));
  assert.equal(allowedTable.error?.status, 502);
  const local = await runInUsageScope({ campaignId: guestTable.id }, () => requestDmMessage(keyless, messages, { timeoutMs: 2000 }));
  assert.equal(local.error?.status, 502);
  // A keyed server on this machine is the host's own: not refused.
  const localKeyed = await runInUsageScope({ campaignId: guestTable.id }, () => requestDmMessage(keyedLocal, messages, { timeoutMs: 2000 }));
  assert.equal(localKeyed.error?.status, 502);
  // The utility model follows the same rule, then falls back to the story model, which is refused too.
  const utility = normalizeSettings({ ...keyed, utilityProvider: "custom", utilityModel: "u", utilityBaseUrl: "http://api.example.invalid/v1", utilityApiKey: "sk-u" });
  const refusedUtility = await runInUsageScope({ campaignId: guestTable.id }, () => requestUtilityMessage(utility, messages, { timeoutMs: 2000 }));
  assert.equal(refusedUtility.error?.status, 403);
  saveGlobalConfig({ sharedHost: { paidAi: "everyone" } });
  const open = await runInUsageScope({ campaignId: guestTable.id }, () => requestDmMessage(keyed, messages, { timeoutMs: 2000 }));
  assert.equal(open.error?.status, 502);
});

removeTempDir(dir);
if (failed) {
  process.exit(1);
}
console.log("\nshared host checks passed");
