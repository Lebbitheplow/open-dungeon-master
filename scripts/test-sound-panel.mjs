// The sound panel's route (POST /api/campaigns/[id]/ambience), the library
// endpoint and the admin's sound library status, driven through the real
// route handlers against a throwaway encrypted database and a throwaway
// public/ambience folder.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-sound-panel-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");
const { getAmbience } = await import("../src/lib/db/ambience.ts");
const { rebuildManifest, readLock, writeLock } = await import("../src/lib/ambience/library.ts");

const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const campaignsRoute = await route("campaigns");
const joinRoute = await route("campaigns/join");
const ambienceRoute = await route("campaigns/[campaignId]/ambience");
const libraryRoute = await route("ambience");
const adminRoute = await route("admin/ambience");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const lead = createUser("lead", "x", { isAdmin: true });
const player = createUser("player", "x");

function as(user) {
  globalThis.__odmTestToken = mintSession(user.id).token;
}

async function call(mod, method, body, params = {}) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

// A library with one take of the tavern and two of the battle, built the
// way the scripts build it: files in the folder, credits in the lock, the
// manifest rebuilt from both.
fs.mkdirSync(path.join(dir, "public", "ambience"), { recursive: true });
for (const file of ["tavern.mp3", "battle.mp3", "battle-2.mp3", "thunder.ogg", "notes.txt"]) {
  fs.writeFileSync(path.join(dir, "public", "ambience", file), "x");
}
writeLock({ "battle-2.mp3": { title: "Battle (take 2)", author: "Made here", license: "Generated", origin: "generated" } });
assert.equal(rebuildManifest(), 3, "three cues playable");
assert.equal(readLock()["battle-2.mp3"].origin, "generated");

as(lead);
const created = await call(campaignsRoute, "POST", { title: "Table", gameSettings: { ambienceEnabled: true, ambienceAuto: true } });
assert.equal(created.status, 201, JSON.stringify(created.json));
const campaignId = created.json.campaign.id;
const inviteCode = created.json.campaign.inviteCode;
as(player);
const joined = await call(joinRoute, "POST", { inviteCode });
assert.ok(joined.status < 300, JSON.stringify(joined.json));

await test("the library endpoint lists every take and counts the layers", async () => {
  as(player);
  const { status, json } = await call(libraryRoute, "GET");
  assert.equal(status, 200);
  assert.deepEqual(
    json.tracks.battle.map((take) => take.url),
    ["/ambience/battle.mp3", "/ambience/battle-2.mp3"],
  );
  assert.equal(json.tracks.battle[1].title, "Battle (take 2)");
  assert.equal(json.tracks.tavern.length, 1);
  assert.equal(json.counts.bed.installed, 1);
  assert.equal(json.counts.music.installed, 1);
  assert.equal(json.counts.music.files, 2);
  assert.equal(json.counts.sting.installed, 1);
  assert.ok(json.counts.bed.total >= 20);
  assert.ok(json.credits.some((credit) => credit.file === "battle-2.mp3" && credit.author === "Made here"));
});

await test("the lead of an AI table sets the room and the music from the panel", async () => {
  as(lead);
  const set = await call(ambienceRoute, "POST", { bed: "tavern", music: "battle" }, { campaignId });
  assert.equal(set.status, 200, JSON.stringify(set.json));
  assert.match(set.json.playing, /tavern.*battle/);
  const state = getAmbience(campaignId);
  assert.equal(state.bed, "tavern");
  assert.equal(state.music, "battle");
  assert.deepEqual(state.held, []);
});

await test("a hold pins the layer and a plain pick lets it go", async () => {
  as(lead);
  const held = await call(ambienceRoute, "POST", { bed: "tavern", hold: true }, { campaignId });
  assert.equal(held.status, 200);
  assert.deepEqual(getAmbience(campaignId).held, ["bed"]);
  const loosed = await call(ambienceRoute, "POST", { bed: "tavern", hold: false }, { campaignId });
  assert.equal(loosed.status, 200);
  assert.deepEqual(getAmbience(campaignId).held, []);
  const silenced = await call(ambienceRoute, "POST", { music: "none" }, { campaignId });
  assert.equal(silenced.status, 200);
  assert.equal(getAmbience(campaignId).music, null);
});

await test("a sound plays once and changes nothing", async () => {
  as(lead);
  const before = getAmbience(campaignId);
  const sting = await call(ambienceRoute, "POST", { sting: "thunder" }, { campaignId });
  assert.equal(sting.status, 200, JSON.stringify(sting.json));
  assert.equal(sting.json.played, "Thunderclap");
  assert.deepEqual(getAmbience(campaignId), before);
});

await test("a cue the catalog does not know, or the wrong layer, is refused", async () => {
  as(lead);
  assert.equal((await call(ambienceRoute, "POST", { bed: "polka" }, { campaignId })).status, 400);
  assert.equal((await call(ambienceRoute, "POST", { bed: "battle" }, { campaignId })).status, 400);
  assert.equal((await call(ambienceRoute, "POST", { sting: "tavern" }, { campaignId })).status, 400);
  assert.equal((await call(ambienceRoute, "POST", {}, { campaignId })).status, 400);
  assert.equal(getAmbience(campaignId).bed, "tavern", "nothing moved");
});

await test("a player may not change what the table hears", async () => {
  as(player);
  const refused = await call(ambienceRoute, "POST", { bed: "cave" }, { campaignId });
  assert.equal(refused.status, 403);
  assert.equal(getAmbience(campaignId).bed, "tavern");
});

await test("a table with the sound library off refuses every change", async () => {
  as(lead);
  const quiet = await call(campaignsRoute, "POST", { title: "Quiet", gameSettings: { ambienceEnabled: false } });
  const refused = await call(ambienceRoute, "POST", { bed: "cave" }, { campaignId: quiet.json.campaign.id });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /switched off/);
});

await test("the admin sees the library's state; a player does not", async () => {
  as(lead);
  const { status, json } = await call(adminRoute, "GET");
  assert.equal(status, 200);
  assert.equal(json.files, 4);
  assert.equal(json.counts.music.files, 2);
  assert.equal(json.status, "idle");
  assert.match(json.packUrl, /ambience-pack\.zip$/);
  // A rescan picks up a file dropped in by hand.
  fs.writeFileSync(path.join(dir, "public", "ambience", "cave.mp3"), "x");
  const rescanned = await call(adminRoute, "POST", { action: "rescan" });
  assert.equal(rescanned.json.counts.bed.installed, 2);
  assert.equal((await call(adminRoute, "POST", { url: "ftp://nowhere/pack.zip" })).status, 400);
  as(player);
  assert.equal((await call(adminRoute, "GET")).status, 403);
});

console.log(`sound panel: ${passed} tests passed`);
process.chdir(os.tmpdir());
removeTempDir(dir);
