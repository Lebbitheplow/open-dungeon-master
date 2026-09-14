// Legendary actions, lair actions and legendary resistance (docs/vtt-
// parity-implementation-plan.md 4.1): the profile a block implies, the
// pool that refills on the creature's own turn and is spent out of it,
// the resistance that turns a bound creature's failed save around.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-legendary-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { legendaryProfile, parseLegendaryLine, refillActions, spendLegendaryAction, spendResistance, freshPool } = await import("../src/lib/dm/legendary-logic.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign, getCampaignById } = await import("../src/lib/db/campaigns.ts");
const { createEncounter, insertEnemy, getActiveEncounter, saveEncounter } = await import("../src/lib/db/encounters.ts");
const { handleLairAction, handleLegendaryAction, handleLegendaryResist, initLegendaryPools, refillLegendaryForTurn, autoLegendaryResistance } = await import("../src/lib/dm/legendary-tools.ts");
const { publicEncounter } = await import("../src/lib/db/encounter-view.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const dragonStats = {
  ac: 18,
  maxHp: 200,
  dexMod: 0,
  speed: "40 ft.",
  attacks: [{ name: "Tail", toHit: 11, damage: "2d8+6", damageType: "bludgeoning", reach: 15, kind: "melee" }],
  traits: [
    "Legendary Resistance (3/Day). If the dragon fails a saving throw, it can choose to succeed instead.",
    "The dragon can take 3 legendary actions, choosing from the options below.",
    "Legendary action: Detect. The dragon makes a Wisdom (Perception) check.",
    "Legendary action: Tail Attack. The dragon makes a tail attack.",
    "Legendary action: Wing Attack (Costs 2 Actions). The dragon beats its wings.",
    "Lair action: The ground shakes; each creature makes a DC 15 Dex save or falls prone.",
  ],
  resist: "",
  immune: "fire",
  vulnerable: "",
  conditionImmune: "",
  cr: 13,
  xp: 10000,
};

test("a block's legendary lines become actions with costs, and the counters are read", () => {
  const profile = legendaryProfile(dragonStats);
  assert.equal(profile.actionsPerRound, 3);
  assert.equal(profile.resistances, 3);
  assert.deepEqual(profile.actions.map((action) => [action.name, action.cost]), [["Detect", 1], ["Tail Attack", 1], ["Wing Attack", 2]]);
  assert.equal(profile.lairActions.length, 1);
  assert.equal(legendaryProfile({ traits: ["Keen Smell. Advantage on smell checks."] }), null);
  assert.deepEqual(parseLegendaryLine("Wing Attack (Costs 2 Actions). Beats its wings."), { name: "Wing Attack", cost: 2, text: "Beats its wings." });
});

test("the pool spends by cost, refuses what it cannot pay, and refills on its own turn", () => {
  const profile = legendaryProfile(dragonStats);
  let pool = freshPool(profile);
  const detect = spendLegendaryAction(pool, profile, "detect");
  assert.equal(detect.ok, true);
  pool = detect.pool;
  const wing = spendLegendaryAction(pool, profile, "Wing Attack");
  assert.equal(wing.ok, true);
  assert.equal(wing.pool.actions, 0);
  const broke = spendLegendaryAction(wing.pool, profile, "Tail Attack");
  assert.equal(broke.ok, false);
  assert.match(broke.error, /only 0 legendary actions/);
  assert.equal(spendLegendaryAction(pool, profile, "Fireball").ok, false);
  const refilled = refillActions({ actions: 0, resistances: 1 }, profile);
  assert.deepEqual(refilled, { actions: 3, resistances: 1 }, "resistances are kept, actions come back");
  assert.equal(spendResistance({ actions: 3, resistances: 0 }), null);
});

const dm = createUser("dm", "x");
const campaign = createCampaign(dm.id, { title: "T", description: "", theme: "", maxPlayers: 4, startingLevel: 5, difficulty: "normal" });
const live = () => getCampaignById(campaign.id);
const encounter = createEncounter(campaign.id, "The dragon");
const dragon = insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: "red-dragon", displayName: "Vermithrax", initiative: 15, stats: dragonStats });
const goblin = insertEnemy({ encounterId: encounter.id, campaignId: campaign.id, slug: "goblin", displayName: "Goblin", initiative: 10, stats: { ...dragonStats, traits: [], maxHp: 7, cr: 0.25, xp: 50 } });

test("the fight starts with pools for the legendary enemies and the lair flag from the block", () => {
  initLegendaryPools(encounter, [dragon, goblin], false);
  assert.deepEqual(encounter.legendary.pools[dragon.id], { actions: 3, resistances: 3 });
  assert.equal(encounter.legendary.pools[goblin.id], undefined);
  assert.equal(encounter.legendary.lair, true, "a block with lair actions makes the fight a lair");
  encounter.order = [
    { kind: "enemy", enemyId: dragon.id, name: "Vermithrax", initiative: 15 },
    { kind: "enemy", enemyId: goblin.id, name: "Goblin", initiative: 10 },
  ];
  encounter.orderReady = true;
  encounter.turnIndex = 1;
  saveEncounter(encounter);
});

test("legendary_action is refused on the creature's own turn and spent on another's", () => {
  const spent = handleLegendaryAction(live(), JSON.stringify({ enemyId: dragon.id, action: "Tail Attack" }));
  assert.equal(spent.ok, true);
  assert.equal(spent.remaining, 2);
  assert.match(spent.next, /enemy_attack/);
  const stored = getActiveEncounter(campaign.id);
  assert.equal(stored.legendary.pools[dragon.id].actions, 2);
  stored.turnIndex = 0;
  saveEncounter(stored);
  const own = handleLegendaryAction(live(), JSON.stringify({ enemyId: dragon.id, action: "Detect" }));
  assert.match(own.error, /own turn/);
  assert.ok("error" in handleLegendaryAction(live(), JSON.stringify({ enemyId: goblin.id, action: "Detect" })));
  refillLegendaryForTurn(stored, dragon);
  assert.equal(stored.legendary.pools[dragon.id].actions, 3);
  saveEncounter(stored);
});

test("resistance is spent on a binding failure and by hand, and the tracker shows both to the DM only", () => {
  const stored = getActiveEncounter(campaign.id);
  assert.equal(autoLegendaryResistance(live(), stored, dragon), true);
  assert.equal(stored.legendary.pools[dragon.id].resistances, 2);
  const byHand = handleLegendaryResist(live(), JSON.stringify({ enemyId: dragon.id }));
  assert.equal(byHand.remaining, 1);
  assert.ok("error" in handleLegendaryResist(live(), JSON.stringify({ enemyId: goblin.id })));
  const dmView = publicEncounter(getActiveEncounter(campaign.id), [dragon, goblin], { enemyNumbers: true });
  const row = dmView.enemies.find((enemy) => enemy.id === dragon.id);
  assert.deepEqual(row.legendary, { actions: 3, actionsMax: 3, resistances: 1, resistancesMax: 3 });
  assert.equal(dmView.lair.active, true);
  const playerView = publicEncounter(getActiveEncounter(campaign.id), [dragon, goblin], { enemyNumbers: false });
  assert.equal(playerView.enemies.find((enemy) => enemy.id === dragon.id).legendary, undefined);
});

test("the lair acts once a round", () => {
  const first = handleLairAction(live(), null, JSON.stringify({ action: "The ground shakes." }));
  assert.equal(first.ok, true);
  const again = handleLairAction(live(), null, JSON.stringify({ action: "Again." }));
  assert.match(again.error, /already acted/);
});

console.log(`test-legendary: ${passed} passed`);
