// Enemy intent, the engine's half (docs/visual-overhaul-plan.md 5.6): the
// likely intent, the declare_intent tool, and above all the redaction in the
// per-viewer map projection. scripts/test-board-intent.mjs holds the client's
// half.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-intent-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById, updateGameSettings } = await import("../src/lib/db/campaigns.ts");
const { createSheet, listSheets, patchSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { normalizeGameSettings } = await import("../src/lib/schemas/game-settings.ts");
const { createEncounter, insertEnemy, getActiveEncounter, saveEncounter } = await import(
  "../src/lib/db/encounters.ts"
);
const { createBattleMap, insertToken, getTokenByRef, setTokenHidden } = await import(
  "../src/lib/db/battle-maps.ts"
);
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { attackVerbKind, declaredVerbKind, expectedDamage, likelyIntent, projectIntents } = await import(
  "../src/lib/dm/intent.ts"
);
const { handleDeclareIntent } = await import("../src/lib/dm/intent-tools.ts");
const { visibleIntents } = await import("../src/lib/battlemap/intent.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

// ---- the pure half ----

const wightStats = {
  speed: "30 ft.",
  attacks: [
    { name: "Longsword", toHit: 4, damage: "1d8+2", type: "slashing" },
    { name: "Longbow", toHit: 4, damage: "1d8+2", type: "piercing" },
  ],
};

test("an attack's kind is read from its name", () => {
  assert.equal(attackVerbKind({ name: "Longsword" }), "melee");
  assert.equal(attackVerbKind({ name: "Light Crossbow" }), "ranged");
  assert.equal(attackVerbKind({ name: "Fire Bolt" }), "spell");
  assert.equal(attackVerbKind({ name: "Frost Breath" }), "spell");
  assert.equal(attackVerbKind(null), "other");
  assert.equal(declaredVerbKind("Retreat to the stairs", wightStats.attacks), "move");
  assert.equal(declaredVerbKind("longbow", wightStats.attacks), "ranged");
  assert.equal(declaredVerbKind("Gloat", wightStats.attacks), "other");
});

test("expected damage is the average, or nothing when it does not parse", () => {
  assert.equal(expectedDamage("1d8+2"), 7);
  assert.equal(expectedDamage("2d6+3"), 10);
  assert.equal(expectedDamage(""), null);
  assert.equal(expectedDamage("a lot"), null);
});

test("the likely intent picks the nearest living, unhidden player character", () => {
  const actor = { id: "t-wight", x: 5, y: 5 };
  const far = { id: "t-far", x: 9, y: 5 };
  const near = { id: "t-near", x: 6, y: 6 };
  const intent = likelyIntent({ stats: wightStats }, actor, [far, near]);
  assert.equal(intent.targetTokenId, "t-near");
  assert.equal(intent.verb, "Longsword");
  assert.equal(intent.verbKind, "melee");
  assert.equal(intent.expected, 7);
  assert.equal(intent.source, "likely");
  // The nearest one is down, then hidden: the far one is the mark.
  assert.equal(likelyIntent({ stats: wightStats }, actor, [far, { ...near, down: true }]).targetTokenId, "t-far");
  assert.equal(likelyIntent({ stats: wightStats }, actor, [far, { ...near, hidden: true }]).targetTokenId, "t-far");
  // Nobody standing, or nothing to attack with: nothing to say.
  assert.equal(likelyIntent({ stats: wightStats }, actor, [{ ...near, down: true }]), null);
  assert.equal(likelyIntent({ stats: { speed: "30 ft.", attacks: [] } }, actor, [near]), null);
});

test("a mark no move could close brings out the bow", () => {
  const intent = likelyIntent({ stats: wightStats }, { id: "t-wight", x: 0, y: 0 }, [{ id: "t-pc", x: 20, y: 0 }]);
  assert.equal(intent.verb, "Longbow");
  assert.equal(intent.verbKind, "ranged");
});

test("the pure projection drops an unseen actor and unnames an unseen mark", () => {
  const base = {
    round: 2,
    declared: { round: 2, byActor: { e1: { verb: "Longsword", verbKind: "melee", targetRef: "pc-2", expected: 9 } } },
    enemies: [
      { id: "e1", stats: wightStats, token: { id: "t-e1", x: 1, y: 1 } },
      { id: "e2", stats: wightStats, token: { id: "t-e2", x: 8, y: 1 } },
    ],
    pcTokens: [
      { id: "t-pc1", refId: "pc-1", x: 2, y: 1 },
      { id: "t-pc2", refId: "pc-2", x: 5, y: 1 },
    ],
    enemyNumbers: false,
  };
  const seen = projectIntents({ ...base, shownTokenIds: new Set(["t-e1", "t-pc1"]) });
  assert.equal(seen.length, 1, "the enemy outside the projection says nothing");
  assert.equal(seen[0].actorTokenId, "t-e1");
  assert.equal(seen[0].targetTokenId, null, "a mark outside the projection is not named");
  assert.ok(!("expected" in seen[0]));
  // Whatever comes out survives the client's own last check.
  assert.equal(visibleIntents(seen, ["t-e1", "t-pc1"], 2).length, 1);
});

// ---- the projection, against a real database ----

const dmUser = createUser("dana", "x");
const alice = createUser("alice", "x");
const campaign = createCampaign(dmUser.id, {
  title: "The Barrow",
  description: "",
  theme: "",
  maxPlayers: 4,
  startingLevel: 3,
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
    hitDice: { die: "d10", total: 3, spent: 0 },
    proficiencies: { saves: ["str", "con"], skills: [], languages: [], tools: [], armor: [], weapons: [] },
    equipment: [],
    features: [],
  });
}
const vex = createSheet(campaign.id, alice.id, 3, sheetInput("Vex"));
const bram = createSheet(campaign.id, dmUser.id, 3, sheetInput("Bram"));
const sheets = () => listSheets(campaign.id);
const sheetsById = () => new Map(sheets().map((entry) => [entry.id, entry]));

const encounter = createEncounter(campaign.id, "Wights in the barrow", "fight");
const stats = {
  ac: 14,
  maxHp: 45,
  dexMod: 2,
  speed: "30 ft.",
  attacks: wightStats.attacks,
  traits: [],
  resist: "",
  immune: "",
  vulnerable: "",
  conditionImmune: "",
  cr: 3,
  xp: 700,
};
const wight = insertEnemy({
  encounterId: encounter.id,
  campaignId: campaign.id,
  slug: "wight",
  displayName: "Wight",
  initiative: 12,
  stats,
});
const lurker = insertEnemy({
  encounterId: encounter.id,
  campaignId: campaign.id,
  slug: "wight",
  displayName: "Lurking Wight",
  initiative: 8,
  stats,
});

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
insertToken({ mapId: map.id, campaignId: campaign.id, kind: "pc", refId: vex.id, name: "Vex", x: 1, y: 1 });
insertToken({ mapId: map.id, campaignId: campaign.id, kind: "pc", refId: bram.id, name: "Bram", x: 4, y: 2 });
insertToken({ mapId: map.id, campaignId: campaign.id, kind: "enemy", refId: wight.id, name: "Wight", x: 5, y: 2 });
insertToken({ mapId: map.id, campaignId: campaign.id, kind: "enemy", refId: lurker.id, name: "Lurking Wight", x: 8, y: 3 });
const tokenOf = (refId) => getTokenByRef(map.id, refId);
setTokenHidden(tokenOf(lurker.id).id, true);

const playerView = (options = {}) => buildPlayerMapView(campaign.id, alice.id, options);
const dmView = () => buildPlayerMapView(campaign.id, dmUser.id, { fullVision: true, enemyNumbers: true });

test("a player is shown the likely intent of an enemy they can see, without the number", () => {
  const view = playerView();
  assert.equal(view.intents.length, 1);
  const [intent] = view.intents;
  assert.equal(intent.actorTokenId, tokenOf(wight.id).id);
  assert.equal(intent.targetTokenId, tokenOf(bram.id).id, "Bram stands next to it");
  assert.equal(intent.source, "likely");
  assert.equal(intent.round, 1);
  assert.ok(!("expected" in intent), "no number without enemyNumbers");
});

test("a hidden enemy yields no intent in a player projection, and one in the DM's", () => {
  const hiddenTokenId = tokenOf(lurker.id).id;
  const view = playerView();
  assert.ok(!view.tokens.some((token) => token.id === hiddenTokenId));
  assert.ok(!view.intents.some((intent) => intent.actorTokenId === hiddenTokenId));
  const dm = dmView();
  assert.equal(dm.intents.length, 2);
  assert.ok(dm.intents.some((intent) => intent.actorTokenId === hiddenTokenId));
  assert.ok(dm.intents.every((intent) => intent.expected === 7), "the DM sees the numbers");
});

test("a seat that may see enemy numbers is given the expected damage", () => {
  const [intent] = playerView({ enemyNumbers: true }).intents;
  assert.equal(intent.expected, 7);
});

test("every intent a player receives points only at tokens in their own projection", () => {
  const view = playerView({ enemyNumbers: true });
  const ids = new Set(view.tokens.map((token) => token.id));
  for (const intent of view.intents) {
    assert.ok(ids.has(intent.actorTokenId));
    assert.ok(!intent.targetTokenId || ids.has(intent.targetTokenId));
  }
  assert.deepEqual(visibleIntents(view.intents, ids, view.round), view.intents);
});

test("a declared intent wins over the likely one", () => {
  const result = handleDeclareIntent(
    getCampaignById(campaign.id),
    JSON.stringify({ actor: "Wight", verb: "Longbow", target: "Vex" }),
    sheets(),
    sheetsById(),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  const [intent] = playerView({ enemyNumbers: true }).intents;
  assert.equal(intent.source, "declared");
  assert.equal(intent.verb, "Longbow");
  assert.equal(intent.verbKind, "ranged");
  assert.equal(intent.targetTokenId, tokenOf(vex.id).id);
  assert.equal(intent.expected, 7, "the named attack's average when the DM gives none");
  assert.ok(!("expected" in playerView().intents[0]));
});

test("a declared mark the viewer's projection does not contain is dropped", () => {
  const bramToken = tokenOf(bram.id);
  setTokenHidden(bramToken.id, true);
  handleDeclareIntent(
    getCampaignById(campaign.id),
    JSON.stringify({ actor: wight.id, verb: "Longsword", target: bram.id, expected: 11 }),
    sheets(),
    sheetsById(),
  );
  const view = playerView();
  assert.ok(!view.tokens.some((token) => token.id === bramToken.id));
  const [intent] = view.intents;
  assert.equal(intent.verb, "Longsword");
  assert.equal(intent.targetTokenId, null);
  const dm = dmView().intents.find((entry) => entry.actorTokenId === tokenOf(wight.id).id);
  assert.equal(dm.targetTokenId, bramToken.id, "the DM still sees the mark");
  assert.equal(dm.expected, 11);
  setTokenHidden(bramToken.id, false);
});

test("declare_intent refuses what it cannot resolve", () => {
  const live = getCampaignById(campaign.id);
  assert.ok(handleDeclareIntent(live, JSON.stringify({ actor: "Nobody", verb: "Bite" }), sheets(), sheetsById()).error);
  assert.ok(handleDeclareIntent(live, JSON.stringify({ actor: "Wight" }), sheets(), sheetsById()).error);
  assert.ok(
    handleDeclareIntent(live, JSON.stringify({ actor: "Wight", verb: "Bite", target: "Nobody" }), sheets(), sheetsById())
      .error,
  );
});

test("a declared intent expires when the round turns", () => {
  const live = getActiveEncounter(campaign.id);
  assert.equal(live.intents.round, 1);
  live.round = 2;
  saveEncounter(live);
  const [intent] = playerView().intents;
  assert.equal(intent.source, "likely");
  assert.equal(intent.verb, "Longsword");
  assert.equal(intent.round, 2);
});

test("a downed character is not the likely mark", () => {
  patchSheet(bram.id, { currentHp: 0 });
  assert.equal(playerView().intents[0].targetTokenId, tokenOf(vex.id).id);
  patchSheet(bram.id, { currentHp: 20 });
});

test("the table setting off yields none, for the DM too", () => {
  assert.equal(normalizeGameSettings({}).enemyIntent, true, "on by default");
  updateGameSettings(campaign.id, { enemyIntent: false });
  assert.deepEqual(playerView().intents, []);
  assert.deepEqual(dmView().intents, []);
});

removeTempDir(dir);
console.log(`\n${passed} passed`);
