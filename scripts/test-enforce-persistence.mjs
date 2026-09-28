// Rules state is what the database says it is.
//
// Nothing the rules depend on may live only in a running process: a server
// that restarts mid fight has to come back to the same round, the same turn,
// the same spent action and the same wounded goblin. Each test here writes
// state through the engine, closes the database handle the way a restart
// does, opens the file again and compares.
//
// Then the two ways state is deliberately taken BACK: a chapter rewind
// (src/lib/dm/rollback.ts), which restores the snapshot taken when the
// chapter opened, and the audited undo. A rewind is only sound if everything
// that moved since the snapshot moves back together. What is restored is the
// list in src/lib/dm/rollback-logic.ts (SNAPSHOT_TABLES and
// CAMPAIGN_SNAPSHOT_COLUMNS); what moved and is not on that list is where a
// rewind duplicates things.
import assert from "node:assert/strict";
import "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-persistence");
const { getDatabase } = await import("../src/lib/db/core.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const { listEffects } = await import("../src/lib/db/active-effects.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { getParty } = await import("../src/lib/db/party.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { ensureOpenChapter } = await import("../src/lib/db/chapters.ts");
const { captureBoundarySnapshot } = await import("../src/lib/db/snapshots.ts");
const { performRollback } = await import("../src/lib/dm/rollback.ts");
const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");
const { endOwnTurn } = await import("../src/lib/dm/encounter-tools.ts");

// What a restart does to the database: the handle goes, the file stays.
function restart() {
  getDatabase().close();
  globalThis.__localRoleplayDb = undefined;
  // The next query opens the file again and runs the boot migrations.
  getDatabase().prepare("SELECT 1").get();
}

const sansStamp = (row) => {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updatedAt"));
};

// ---- a sheet ----

await test("every rules field of a sheet survives a restart", async () => {
  const world = await openWorld();
  const hero = world.addHero({
    class: "druid",
    level: 5,
    abilities: { wis: 16, con: 14 },
    equipment: [
      { name: "Ring of Protection", qty: 1, attuned: true, equipped: true },
      { name: "Ornate key", qty: 2, identified: false, weight: 0.5 },
    ],
    gold: 12,
    copper: 34,
    spellcasting: {
      ability: "wis",
      slots: { 1: { max: 4, used: 3 }, 2: { max: 3, used: 1 }, 3: { max: 2, used: 2 } },
      prepared: ["Entangle"],
      known: [],
      cantrips: ["Druidcraft"],
      pending: ["Moonbeam"],
      pact: { level: 1, max: 1, used: 1 },
    },
  });
  world.patch(hero.id, {
    currentHp: 7,
    tempHp: 5,
    xp: 6500,
    conditions: ["poisoned", "prone"],
    conditionMeta: { poisoned: { rounds: 4, saveEnds: { ability: "con", dc: 13 } } },
    exhaustion: 2,
    concentratingOn: "Entangle",
    deathSaves: { successes: 1, failures: 2, stable: false, dead: false },
    resources: { wild_shape: { max: 2, used: 1 } },
    wildShape: {
      form: "Wolf", beastHp: 6, beastMaxHp: 11, beastAc: 13, kind: "wildshape",
      abilities: { str: 12, dex: 15, con: 12 }, speed: 40,
      attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing" }],
    },
    pets: [{ name: "Hoot", kind: "familiar", form: "owl", hp: 1, maxHp: 1, ac: 11, speed: 5, attacks: [], notes: "" }],
    hitDice: { die: "d8", total: 5, spent: 3 },
    classes: [{ id: "druid", subclass: "", level: 3 }, { id: "fighter", subclass: "", level: 2 }],
    hitDicePools: [
      { classId: "druid", die: "d8", total: 3, spent: 2 },
      { classId: "fighter", die: "d10", total: 2, spent: 1 },
    ],
  });
  const before = sansStamp(world.sheet(hero.id));
  assert.equal(before.currentHp, 7);
  assert.equal(before.wildShape.beastHp, 6);
  assert.deepEqual(before.deathSaves, { successes: 1, failures: 2, stable: false, dead: false });
  restart();
  assert.deepEqual(sansStamp(world.sheet(hero.id)), before);
});

// ---- a fight ----

await test("a fight survives a restart mid round: order, turn, budget, reactions, enemies", async () => {
  const world = await openWorld();
  const first = world.addHero({ name: "First", abilities: { dex: 14 } });
  const second = world.addHero({ name: "Second" });
  await world.beginFight([{ monster: "goblin", count: 2 }], {
    heroFaces: { [first.id]: 18, [second.id]: 12 },
  });
  const [goblin, other] = world.enemies();
  assert.equal((await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 3, type: "slashing" })).ok, true);
  assert.equal(
    (await world.invoke("set_enemy_condition", { enemyId: other.id, condition: "frightened", rounds: 3 })).ok,
    true,
  );
  assert.equal((await world.invoke("take_action", { characterId: first.id, action: "dodge" })).ok, true);
  // The player's own End Turn, without the DM wake the route adds.
  assert.equal(endOwnTurn(world.campaignId, world.owner.id), true);
  const live = world.encounter();
  encounters.saveEncounter({ ...live, reactionsUsed: [goblin.id], surprisedIds: [other.id] });

  const fight = sansStamp(world.encounter());
  const enemies = world.enemies().map(sansStamp);
  assert.equal(fight.turnIndex, 1);
  assert.equal(fight.order.length, 4);
  assert.equal(enemies[0].currentHp, goblin.maxHp - 3);
  assert.deepEqual(enemies[1].conditions, ["frightened"]);
  const heroes = world.sheets().map(sansStamp);
  assert.ok(heroes[0].conditions.length > 0, "the dodge is a tracked condition");

  restart();
  assert.deepEqual(sansStamp(world.encounter()), fight);
  assert.deepEqual(world.enemies().map(sansStamp), enemies);
  assert.deepEqual(world.sheets().map(sansStamp), heroes);
  // And the fight goes on from where it stood.
  // The pointer rests on players: past the goblins, the round turns over.
  assert.equal(endOwnTurn(world.campaignId, second.userId), true);
  const next = world.encounter();
  assert.equal(next.order[next.turnIndex].characterId, first.id);
  assert.equal(next.round, fight.round + 1);
});

await test("the turn's spent action is still spent after a restart", async () => {
  const world = await openWorld();
  const hero = world.addHero({ name: "Dasher" });
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [hero.id]: 20 } });
  assert.equal((await world.invoke("take_action", { characterId: hero.id, action: "dash" })).ok, true);
  const budget = world.encounter().turnBudget;
  assert.ok(budget, "the dash opened a budget");
  restart();
  assert.deepEqual(world.encounter().turnBudget, budget);
  const again = await world.invoke("take_action", { characterId: hero.id, action: "dodge" });
  assert.equal(again.ok, false, "a second action in the same turn, after the restart");
});

// ---- the table around the fight ----

await test("effects, the clock, the party purse, parked rolls and the table's rules survive a restart", async () => {
  const world = await openWorld({
    gameSettings: { variantRules: { encumbrance: true, restVariant: "gritty" }, gm: { strictness: "harsh", tone: [] } },
    campaign: { startingLevel: 4, difficulty: "hard" },
  });
  const hero = world.addHero({ name: "Keeper", gold: 20 });
  // The console's form field and the model's list are both sent: the façade
  // wants the first and the handler the second (test-enforce-tool-args.mjs).
  const blessed = await world.invoke("set_effect", {
    characterId: hero.id,
    name: "Bless",
    field: "save",
    modifiers: [{ field: "save", mode: "add", value: 2 }],
    duration: "rounds",
    remaining: 10,
  });
  assert.equal(blessed.ok, true, blessed.error);
  assert.equal((await world.invoke("pass_time", { amount: 90, unit: "minutes" })).ok, true);
  assert.equal(
    (await world.invoke("party_stash", { do: "deposit", characterId: hero.id, amount: 5 })).ok,
    true,
  );
  campaigns.setMemberHoldRolls(world.campaignId, world.owner.id, true);
  const parked = await world.invoke("request_roll", {
    characterId: hero.id, kind: "saving_throw", ability: "wis", dc: 14, reason: "a whisper",
  });
  assert.equal(parked.result.parked, true);

  const before = {
    effects: listEffects(world.campaignId),
    clock: world.campaign().clock,
    party: getParty(world.campaignId),
    pending: listOpenPendingRolls(world.campaignId),
    settings: world.campaign().gameSettings,
    level: world.campaign().startingLevel,
    difficulty: world.campaign().difficulty,
    gold: world.sheet(hero.id).gold,
  };
  assert.equal(before.effects.length, 1);
  assert.equal(before.party.copper, 500);
  assert.equal(before.pending.length, 1);
  assert.equal(before.gold, 15);
  restart();
  assert.deepEqual(listEffects(world.campaignId), before.effects);
  assert.deepEqual(world.campaign().clock, before.clock);
  assert.deepEqual(getParty(world.campaignId), before.party);
  assert.deepEqual(listOpenPendingRolls(world.campaignId), before.pending);
  assert.deepEqual(world.campaign().gameSettings, before.settings);
  assert.equal(world.campaign().startingLevel, 4);
  assert.equal(world.campaign().difficulty, "hard");
});

// ---- a chapter rewind ----

// A table with a chapter open and its opening moment frozen.
async function chapter(options = {}) {
  const world = await openWorld(options);
  const hero = world.addHero({
    name: "Rewound",
    gold: 50,
    equipment: [{ name: "Silver Dagger", qty: 1 }, { name: "Rope", qty: 2 }],
  });
  ensureOpenChapter(world.campaignId);
  const freeze = () =>
    captureBoundarySnapshot(world.campaignId, 1, campaigns.latestSeq(world.campaignId));
  const rewind = async () => {
    const result = await performRollback(world.campaignId, 1);
    assert.equal(result.ok, true, result.error);
  };
  return { world, hero, freeze, rewind };
}

await test("a rewind puts the sheet back whole and takes the audit trail with it", async () => {
  const { world, hero, freeze, rewind } = await chapter();
  freeze();
  const before = sansStamp(world.sheet(hero.id));
  for (const [name, args] of [
    ["apply_damage", { amount: 11 }],
    ["modify_gold", { delta: 300 }],
    ["grant_item", { name: "Potion of Healing", qty: 3 }],
    ["remove_item", { name: "Rope", qty: 2 }],
    ["award_xp", { characterIds: [hero.id], amount: 450 }],
    ["set_condition", { condition: "poisoned", rounds: 5 }],
  ]) {
    const out = await world.invoke(name, { characterId: hero.id, reason: "chapter one", ...args });
    assert.equal(out.ok, true, `${name}: ${out.error}`);
  }
  assert.notDeepEqual(sansStamp(world.sheet(hero.id)), before);
  assert.ok(listRecentAudit(world.campaignId, 20).length >= 6);
  await rewind();
  assert.deepEqual(sansStamp(world.sheet(hero.id)), before);
  assert.equal(listRecentAudit(world.campaignId, 20).length, 0);
});

await test("a rewind to a moment mid fight restores the fight with the sheets", async () => {
  const { world, hero, freeze, rewind } = await chapter();
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [hero.id]: 20 } });
  const [goblin] = world.enemies();
  await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 2, type: "fire" });
  await world.invoke("apply_damage", { characterId: hero.id, amount: 4 });
  freeze();
  const fight = sansStamp(world.encounter());
  const enemies = world.enemies().map(sansStamp);
  const sheet = sansStamp(world.sheet(hero.id));

  await world.invoke("damage_enemy", { enemyId: goblin.id, amount: 50, type: "fire" });
  await world.invoke("apply_damage", { characterId: hero.id, amount: 9 });
  if (world.encounter()) {
    await world.invoke("end_encounter", { outcome: "victory" });
  }
  assert.equal(world.encounter(), null);

  await rewind();
  assert.deepEqual(sansStamp(world.encounter()), fight);
  assert.deepEqual(world.enemies().map(sansStamp), enemies);
  assert.deepEqual(sansStamp(world.sheet(hero.id)), sheet);
});

await test("a rewind ends a fight that began after the chapter opened", async () => {
  const { world, hero, freeze, rewind } = await chapter();
  freeze();
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [hero.id]: 20 } });
  assert.ok(world.encounter());
  await rewind();
  assert.equal(world.encounter(), null);
  assert.deepEqual(world.enemies(), []);
  assert.equal(campaigns.getFloor(world.campaignId).mode, "open");
});

await test("A rewind takes back everything that moved since the chapter opened, together: what a hero put in the party's pack is in the pack or in their hands, never both.", async () => {
  const { world, hero, freeze, rewind } = await chapter();
  freeze();
  assert.equal((await world.invoke("party_stash", { do: "deposit", characterId: hero.id, amount: 50 })).ok, true);
  assert.equal(
    (await world.invoke("party_stash", { do: "stow", characterId: hero.id, name: "Silver Dagger" })).ok,
    true,
  );
  assert.equal(world.sheet(hero.id).gold, 0);
  await rewind();
  const sheet = world.sheet(hero.id);
  const party = getParty(world.campaignId);
  const daggers =
    sheet.equipment.filter((item) => item.name === "Silver Dagger").length +
    party.inventory.filter((item) => item.name === "Silver Dagger").length;
  assert.equal(
    sheet.gold * 100 + party.copper,
    5000,
    `50 gp became ${sheet.gold} gp on the sheet and ${party.copper / 100} gp in the purse`,
  );
  assert.equal(daggers, 1);
});

await test("A rewind takes back the lasting effects laid since the chapter opened along with the sheets they sit on.", async () => {
  const { world, hero, freeze, rewind } = await chapter();
  freeze();
  const laid = await world.invoke("set_effect", {
    characterId: hero.id,
    name: "Shield of Faith",
    field: "ac",
    modifiers: [{ field: "ac", mode: "add", value: 2 }],
    duration: "minutes",
    remaining: 10,
  });
  assert.equal(laid.ok, true, laid.error);
  await rewind();
  const left = listEffects(world.campaignId).map((effect) => effect.name);
  assert.deepEqual(left, [], `still in force after the rewind: ${left.join(", ")}`);
});

await test("A rewind returns the in-world date and time to the chapter's opening moment, since rests, travel and timed conditions are counted against it.", async () => {
  const { world, freeze, rewind } = await chapter();
  freeze();
  const opened = world.campaign().clock.instant;
  assert.equal((await world.invoke("pass_time", { amount: 3, unit: "days" })).ok, true);
  await rewind();
  const now = world.campaign().clock.instant;
  assert.equal(now, opened, `the clock stands ${now - opened} minutes after the chapter's opening`);
});

await test("a rewind puts back the clock's own records with it: who rested, and when", async () => {
  const { world, hero, freeze, rewind } = await chapter();
  freeze();
  assert.equal((await world.invoke("take_rest", { kind: "long" })).ok, true);
  assert.ok(world.campaign().clock.longRests[hero.id] > 0);
  await rewind();
  assert.equal(world.campaign().clock.longRests, undefined);
  // The night that was unwound does not count against the next one.
  assert.equal((await world.invoke("take_rest", { kind: "long" })).ok, true);
});

await test("a snapshot taken before the purse, the effects and the clock were kept leaves them as they stand", async () => {
  const { world, hero, freeze, rewind } = await chapter();
  freeze();
  // The snapshot as an older server wrote it.
  const db = getDatabase();
  const row = db
    .prepare("SELECT id, snapshot_json FROM chapter_snapshots WHERE campaign_id = ? AND kind = 'boundary'")
    .get(world.campaignId);
  const old = JSON.parse(row.snapshot_json);
  delete old.tables.active_effects;
  delete old.campaign.party_json;
  delete old.campaign.clock_json;
  db.prepare("UPDATE chapter_snapshots SET snapshot_json = ? WHERE id = ?").run(JSON.stringify(old), row.id);

  assert.equal((await world.invoke("party_stash", { do: "deposit", characterId: hero.id, amount: 5 })).ok, true);
  assert.equal((await world.invoke("pass_time", { amount: 2, unit: "hours" })).ok, true);
  const laid = await world.invoke("set_effect", {
    characterId: hero.id,
    name: "Shield of Faith",
    field: "ac",
    modifiers: [{ field: "ac", mode: "add", value: 2 }],
    duration: "manual",
  });
  assert.equal(laid.ok, true, laid.error);
  const clock = world.campaign().clock.instant;
  await rewind();
  assert.equal(world.campaign().clock.instant, clock);
  assert.equal(getParty(world.campaignId).copper, 500);
  assert.deepEqual(listEffects(world.campaignId).map((effect) => effect.name), ["Shield of Faith"]);
});

// ---- undo ----

await test("an undone grant is taken back once, and an undone spend is returned once", async () => {
  const world = await openWorld();
  const hero = world.addHero({ name: "Undone", gold: 10 });
  const { revertAuditEntry } = await import("../src/lib/sheet-undo.ts");
  const { getAuditEntry } = await import("../src/lib/db/sheet-audit.ts");
  await world.invoke("grant_item", { characterId: hero.id, name: "Pearl", qty: 1 });
  await world.invoke("modify_gold", { characterId: hero.id, delta: -4 });
  const trail = listRecentAudit(world.campaignId, 5);
  const spend = trail.find((entry) => entry.kind === "modify_gold");
  const grant = trail.find((entry) => entry.kind === "grant_item");
  assert.ok(spend && grant, "both changes were audited");

  assert.equal(revertAuditEntry(world.campaign(), getAuditEntry(grant.id)).ok, true);
  assert.deepEqual(world.sheet(hero.id).equipment, []);
  assert.equal(revertAuditEntry(world.campaign(), getAuditEntry(grant.id)).ok, false);
  assert.equal(revertAuditEntry(world.campaign(), getAuditEntry(spend.id)).ok, true);
  assert.equal(world.sheet(hero.id).gold, 10);
  assert.equal(revertAuditEntry(world.campaign(), getAuditEntry(spend.id)).ok, false);
  assert.equal(world.sheet(hero.id).gold, 10);
  restart();
  assert.ok(getAuditEntry(grant.id).revertedAt, "the undo is remembered across a restart");
});

(await openWorld()).close();
finish();
