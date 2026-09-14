// teleport_token, set_movement and the stage fields of the board projection,
// against a throwaway encrypted database. A teleport respects walls,
// occupancy and a spell's range, spends no movement, and plays one effect;
// the projection reports health words, footprints and elevation for every
// shown token. See docs/vtt-parity-implementation-plan.md sections 1.1, 1.5.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-teleport-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { createSheet, listSheets, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { createEncounter, insertEnemy, recordEncounterTarget, getActiveEncounter } = await import(
  "../src/lib/db/encounters.ts"
);
const { createBattleMap, insertToken, getTokenByRef } = await import(
  "../src/lib/db/battle-maps.ts"
);
const { handleTeleportToken, handleSetMovement } = await import("../src/lib/dm/map-tools.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { subscribe } = await import("../src/lib/events.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const alice = createUser("alice", "x");
const campaign = createCampaign(alice.id, {
  title: "The Stage",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 5,
  difficulty: "normal",
});

function sheetInput(name) {
  return createSheetSchema.parse({
    name,
    race: "human",
    class: "fighter",
    abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 },
    maxHp: 20,
    ac: 16,
    hitDice: { die: "d10", total: 5, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
    equipment: [],
    features: [],
  });
}
const sheet = createSheet(campaign.id, alice.id, 5, sheetInput("Vex"));
const sheets = listSheets(campaign.id);
const sheetsById = new Map(sheets.map((entry) => [entry.id, entry]));
const live = () => getCampaignById(campaign.id);

const encounter = createEncounter(campaign.id, "A test fight", "fight");
assert.ok(encounter, "an encounter opens");
const stats = (extra = {}) => ({
  ac: 12,
  maxHp: 30,
  dexMod: 1,
  speed: "30 ft.",
  attacks: [{ name: "Slam", toHit: 4, damage: "1d8+2", type: "bludgeoning" }],
  traits: [],
  resist: "",
  immune: "",
  vulnerable: "",
  conditionImmune: "",
  cr: 1,
  xp: 200,
  ...extra,
});
const ogre = insertEnemy({
  encounterId: encounter.id,
  campaignId: campaign.id,
  slug: "ogre",
  displayName: "Ogre",
  initiative: 10,
  stats: stats({ size: "Large" }),
});
const goblin = insertEnemy({
  encounterId: encounter.id,
  campaignId: campaign.id,
  slug: "goblin",
  displayName: "Goblin",
  initiative: 12,
  stats: stats({ size: "Small", maxHp: 7 }),
});

//   0123456789
// 0 ##########
// 1 #........#
// 2 #........#
// 3 #........#
// 4 ##########
const WIDTH = 10;
const HEIGHT = 5;
const terrain = ["##########", "#........#", "#........#", "#........#", "##########"].join("");
const map = createBattleMap({
  encounterId: encounter.id,
  campaignId: campaign.id,
  width: WIDTH,
  height: HEIGHT,
  terrain,
  ambient: "bright",
  theme: "field",
  lights: [],
  seed: 1,
});
insertToken({ mapId: map.id, campaignId: campaign.id, kind: "pc", refId: sheet.id, name: "Vex", x: 1, y: 1 });
insertToken({ mapId: map.id, campaignId: campaign.id, kind: "enemy", refId: ogre.id, name: "Ogre", x: 5, y: 1 });
insertToken({ mapId: map.id, campaignId: campaign.id, kind: "enemy", refId: goblin.id, name: "Goblin", x: 8, y: 3 });

// Every effect the engine publishes for this campaign, as parsed payloads.
const fxSeen = [];
subscribe(campaign.id, (chunk) => {
  const match = /^event: (\S+)\ndata: (.*)\n\n$/s.exec(chunk);
  if (match && match[1] === "fx") {
    fxSeen.push(JSON.parse(match[2]));
  }
});

const teleport = (args) => handleTeleportToken(live(), JSON.stringify(args), sheets, sheetsById);

test("a teleport lands on open floor, spends no movement, and plays one effect", () => {
  const before = getTokenByRef(map.id, sheet.id);
  const out = teleport({ tokenName: "Vex", x: 3, y: 3 });
  assert.equal(out.ok, true, JSON.stringify(out));
  const after = getTokenByRef(map.id, sheet.id);
  assert.equal(after.x, 3);
  assert.equal(after.y, 3);
  assert.equal(after.movedThisRound, before.movedThisRound, "no movement spent");
  assert.equal(fxSeen.length, 1);
  assert.equal(fxSeen[0].kind, "teleport");
  assert.deepEqual(fxSeen[0].from, { x: 1, y: 1 });
  assert.deepEqual(fxSeen[0].to, { x: 3, y: 3 });
  assert.equal(fxSeen[0].toTokenId, after.id);
});

test("a wall tile is refused", () => {
  const out = teleport({ tokenName: "Vex", x: 0, y: 0 });
  assert.match(out.error, /wall/i);
  assert.equal(fxSeen.length, 1, "nothing played");
});

test("an occupied tile is refused", () => {
  const out = teleport({ tokenName: "Vex", x: 8, y: 3 });
  assert.match(out.error, /occupied/i);
});

test("a spell refuses a jump past its range; the DM's own hand has none", () => {
  // Vex at (3,3); (8,1) is 5 tiles = 25 ft.
  const far = teleport({ tokenName: sheet.id, x: 8, y: 1, rangeFeet: 20 });
  assert.match(far.error, /past the 20 ft range/);
  const near = teleport({ tokenName: sheet.id, x: 7, y: 3, rangeFeet: 20 });
  assert.equal(near.ok, true, JSON.stringify(near));
  assert.equal(near.distanceFeet, 20);
  const dm = teleport({ tokenName: "Vex", x: 1, y: 1 });
  assert.equal(dm.ok, true);
});

test("an enemy teleports by name and an unknown name is refused", () => {
  const out = teleport({ tokenName: "goblin", x: 8, y: 2 });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(getTokenByRef(map.id, goblin.id).y, 2);
  const unknown = teleport({ tokenName: "Dragon", x: 2, y: 2 });
  assert.match(unknown.error, /Unknown combatant/);
});

test("set_movement records flying and the projection reports it", () => {
  const out = handleSetMovement(live(), JSON.stringify({ tokenName: "Goblin", movement: "fly" }), sheets, sheetsById);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(getTokenByRef(map.id, goblin.id).movement, "fly");
  const again = handleSetMovement(live(), JSON.stringify({ tokenName: "Goblin", movement: "fly" }), sheets, sheetsById);
  assert.match(again.note, /Already/);
  const bad = handleSetMovement(live(), JSON.stringify({ tokenName: "Goblin", movement: "swim" }), sheets, sheetsById);
  assert.match(bad.error, /walk, fly or burrow/);
  const view = buildPlayerMapView(campaign.id, alice.id, { fullVision: true });
  const goblinToken = getTokenByRef(map.id, goblin.id);
  assert.equal(view.tokenElevation[goblinToken.id], "flying");
});

test("the projection carries health words, footprints and conditions", () => {
  patchSheet(sheet.id, { currentHp: 4, conditions: ["poisoned"], conditionMeta: { poisoned: { rounds: 2 } } });
  const view = buildPlayerMapView(campaign.id, alice.id, { fullVision: true });
  const mine = getTokenByRef(map.id, sheet.id);
  const ogreToken = getTokenByRef(map.id, ogre.id);
  const goblinToken = getTokenByRef(map.id, goblin.id);
  assert.equal(view.tokenHealth[mine.id], "critical");
  assert.equal(view.tokenHealth[ogreToken.id], "unharmed");
  assert.equal(view.tokenFootprint[ogreToken.id], 2, "the ogre is Large");
  assert.equal(view.tokenFootprint[goblinToken.id], undefined, "small creatures carry no footprint");
  assert.deepEqual(view.tokenConditions[mine.id], [{ id: "poisoned", label: "poisoned", rounds: 2 }]);
  assert.equal(view.turn, null, "no initiative order yet");
  assert.deepEqual(view.targets, {});
});

test("a player projection carries the words and no numbers", () => {
  const view = buildPlayerMapView(campaign.id, alice.id);
  assert.ok(view);
  assert.equal(view.tokenHp, undefined, "real hit points never reach a player");
  const mine = getTokenByRef(map.id, sheet.id);
  assert.equal(view.tokenHealth[mine.id], "critical");
});

test("target lines are recorded per round and mapped to token ids", () => {
  const enc = getActiveEncounter(campaign.id);
  recordEncounterTarget(enc.id, enc.round, sheet.id, ogre.id);
  recordEncounterTarget(enc.id, enc.round, sheet.id, ogre.id);
  const view = buildPlayerMapView(campaign.id, alice.id, { fullVision: true });
  const mine = getTokenByRef(map.id, sheet.id);
  const ogreToken = getTokenByRef(map.id, ogre.id);
  assert.deepEqual(view.targets, { [mine.id]: [ogreToken.id] });
  // A later round supersedes the lines.
  recordEncounterTarget(enc.id, enc.round + 1, ogre.id, sheet.id);
  const stale = getActiveEncounter(campaign.id);
  assert.equal(stale.targets.round, enc.round + 1);
  const later = buildPlayerMapView(campaign.id, alice.id, { fullVision: true });
  assert.deepEqual(later.targets, {}, "the encounter is still on the old round, so nothing draws");
});

console.log(`test-teleport: ${passed} passed`);
removeTempDir(dir);
