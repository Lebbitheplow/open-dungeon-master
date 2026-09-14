// Torch and spell timers (docs/vtt-parity-implementation-plan.md 7.3): a
// carried light is lit as the party steps onto the board, burns down as
// the clock moves and gutters out when its minutes are spent.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-light-timers-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { carriedLight, lightPlacement, lightRemaining, gutterBurntLights } = await import("../src/lib/dm/light-timers.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createBattleMap, insertToken, getToken, expireBurntLights } = await import("../src/lib/db/battle-maps.ts");
const { createEncounter } = await import("../src/lib/db/encounters.ts");
const { advanceClock, getClock } = await import("../src/lib/db/clock.ts");
const { subscribe } = await import("../src/lib/events.ts");

// The bus hands subscribers SSE text; read the type and the payload back.
function parseChunk(chunk) {
  const type = /^event: (.+)$/m.exec(chunk)?.[1] ?? "";
  const data = /^data: (.+)$/m.exec(chunk)?.[1] ?? "{}";
  try {
    return { type, payload: JSON.parse(data) };
  } catch {
    return { type, payload: {} };
  }
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("a torch burns an hour, a lantern six, an everburning thing forever", () => {
  assert.deepEqual(carriedLight({ equipment: [{ name: "Torch" }] }), { radius: 4, minutes: 60 });
  assert.deepEqual(carriedLight({ equipment: [{ name: "Hooded lantern" }] }), { radius: 6, minutes: 360 });
  assert.deepEqual(carriedLight({ equipment: [{ name: "Everburning torch" }] }), { radius: 4, minutes: 0 });
  assert.deepEqual(carriedLight({ equipment: [{ name: "Rope" }] }), { radius: 0, minutes: 0 });
});

test("lighting now sets when it gutters out", () => {
  assert.deepEqual(lightPlacement({ radius: 4, minutes: 60 }, 1000), { lightRadius: 4, burnsUntil: 1060, lightMinutes: 60 });
  assert.deepEqual(lightPlacement({ radius: 4, minutes: 0 }, 1000), { lightRadius: 4, burnsUntil: 0, lightMinutes: 0 });
  assert.deepEqual(lightPlacement({ radius: 0, minutes: 0 }, 1000), { lightRadius: 0, burnsUntil: 0, lightMinutes: 0 });
});

test("the bar reads minutes left of the whole, or nothing", () => {
  assert.deepEqual(lightRemaining({ lightRadius: 4, burnsUntil: 1060, lightMinutes: 60 }, 1015), { remaining: 45, total: 60 });
  assert.deepEqual(lightRemaining({ lightRadius: 4, burnsUntil: 1060, lightMinutes: 60 }, 2000), { remaining: 0, total: 60 });
  assert.equal(lightRemaining({ lightRadius: 4, burnsUntil: 0, lightMinutes: 0 }, 1015), null);
  assert.equal(lightRemaining({ lightRadius: 0, burnsUntil: 900, lightMinutes: 60 }, 1015), null);
});

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 3, difficulty: "normal" });
const encounter = createEncounter(campaign.id, "In the dark");
const map = createBattleMap({ campaignId: campaign.id, encounterId: encounter.id, width: 6, height: 6, terrain: ".".repeat(36), ambient: "dark", theme: "dungeon", lights: [], seed: 1 });
const start = getClock(campaign.id).instant;
const torch = insertToken({ mapId: map.id, campaignId: campaign.id, kind: "pc", refId: "pc-1", name: "Marla", x: 1, y: 1, ...lightPlacement({ radius: 4, minutes: 60 }, start) });
const forever = insertToken({ mapId: map.id, campaignId: campaign.id, kind: "pc", refId: "pc-2", name: "Pike", x: 2, y: 2, ...lightPlacement({ radius: 4, minutes: 0 }, start) });

test("a lit token remembers its burn", () => {
  assert.equal(torch.burnsUntil, start + 60);
  assert.equal(torch.lightMinutes, 60);
  assert.equal(forever.burnsUntil, 0);
});

test("half an hour on, the torch still burns", () => {
  advanceClock(campaign.id, 30, "minutes");
  assert.equal(getToken(torch.id).lightRadius, 4);
});

test("the hour up, the torch gutters out, the everburning one does not, and the board hears", () => {
  const seen = [];
  const stop = subscribe(campaign.id, (chunk) => seen.push(parseChunk(chunk)));
  advanceClock(campaign.id, 45, "minutes");
  stop();
  assert.equal(getToken(torch.id).lightRadius, 0);
  assert.equal(getToken(torch.id).burnsUntil, 0);
  assert.equal(getToken(forever.id).lightRadius, 4);
  assert.ok(seen.some((event) => event.type === "fx" && event.payload?.kind === "gutter" && event.payload?.toTokenId === torch.id), "no gutter fx");
  assert.ok(seen.some((event) => event.type === "battle_map_updated"), "board not redrawn");
});

test("expiry is idempotent and direct", () => {
  assert.deepEqual(expireBurntLights(campaign.id, getClock(campaign.id).instant), []);
  assert.equal(gutterBurntLights(campaign.id, getClock(campaign.id).instant), 0);
});

console.log(`light-timers: ${passed} tests passed`);
fs.rmSync(dir, { recursive: true, force: true });
