// Content a person wrote: homebrew spells and monsters, rulesets, and world
// packs, asked through the routes that store them and the engine that reads
// them. (Homebrew GEAR is test-enforce-magic-items.mjs's and
// test-enforce-weapons.mjs's.)
//
// The rules held:
//   homebrew is its author's: nobody else lists, reads, edits or deletes it;
//   a homebrew spell is of level 0 to 9 and says how it resolves;
//   whatever was stored, the monster that reaches a fight is inside the
//   bounds of src/lib/bestiary/monster-draft.ts (armor class 30, 1,000 hit
//   points, +20 to hit, three attacks a turn, dice the table can roll), and
//   its experience is its rating's, never the author's;
//   a table fights its OWNER's monsters, and a published monster answers to
//   its name before a hand-built one does (bestiary/index.ts resolveMonster);
//   a ruleset is its author's, and only whoever runs a table applies one;
//   a world pack renames things and carries no numbers.
//
// SRD 5.1 has no homebrew; the rule a finding is held to here is the one
// the book does have: a spell has one level, and a cleric of 1st level
// prepares 1st level cleric spells.
import assert from "node:assert/strict";
import { call, seats, signOut } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-homebrew");
const { worldPackSchema } = await import("../src/lib/worlds/types.ts");

const world = await openWorld();
const who = await seats(world);
const params = { campaignId: world.campaignId };
const route = {
  brew: await world.route("homebrew"),
  one: await world.route("homebrew/[id]"),
  spells: await world.route("campaigns/[campaignId]/sheet/spells"),
  rulesets: await world.route("rulesets"),
  ruleset: await world.route("rulesets/[rulesetId]"),
};

async function brew(user, kind, name, data) {
  world.signIn(user);
  return call(route.brew, "POST", { kind, name, data });
}
const listed = async (user, kind) => {
  world.signIn(user);
  return (await call(route.brew, "GET", undefined, {}, `http://test/?kind=${kind}`)).json.entries;
};

const CLERIC_ONE = {
  class: "cleric",
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
  spellcasting: {
    ability: "wis",
    slots: { 1: { max: 2, used: 0 } },
    prepared: ["Bless"],
    known: [],
    cantrips: [],
  },
};

// ---- whose it is ----

await test("homebrew is its author's and nobody else's", async () => {
  const made = await brew(who.player, "spell", "Ember Dart", { desc: "A dart of embers.", level: 1 });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.entry.id;
  assert.equal(made.json.entry.userId, who.player.id);

  for (const user of [who.other, who.dm, who.lead, who.stranger]) {
    assert.equal((await listed(user, "spell")).length, 0);
    const target = { id };
    assert.equal((await call(route.one, "GET", undefined, target)).status, 404);
    assert.equal((await call(route.one, "PATCH", { name: "Stolen" }, target)).status, 404);
    assert.equal((await call(route.one, "DELETE", undefined, target)).status, 404);
  }
  signOut();
  assert.equal((await call(route.brew, "GET", undefined, {}, "http://test/")).status, 401);
  assert.equal((await call(route.brew, "POST", { kind: "spell", name: "x", data: { desc: "x" } })).status, 401);
  assert.equal((await call(route.one, "DELETE", undefined, { id })).status, 401);

  const mine = await listed(who.player, "spell");
  assert.deepEqual(mine.map((entry) => entry.name), ["Ember Dart"]);
  assert.equal((await call(route.one, "DELETE", undefined, { id })).status, 200);
  assert.equal((await listed(who.player, "spell")).length, 0);
});

await test("an author cannot write an entry into another account", async () => {
  const made = await brew(who.player, "feat", "Borrowed", {
    desc: "x", userId: who.other.id, user_id: who.other.id, id: "chosen-id",
  });
  assert.equal(made.status, 201);
  assert.equal(made.json.entry.userId, who.player.id);
  assert.notEqual(made.json.entry.id, "chosen-id");
  assert.equal((await listed(who.other, "feat")).length, 0);
});

// ---- spells ----

await test("a homebrew spell is of level 0 to 9 and says how it resolves", async () => {
  const before = (await listed(who.player, "spell")).length;
  for (const data of [
    { desc: "x", level: -1 },
    { desc: "x", level: 10 },
    { desc: "x", level: 1.5 },
    { desc: "x", level: "3" },
    { desc: "", level: 1 },
    { level: 1 },
    { desc: "x", level: 1, mech: { resolution: "save" } },
    { desc: "x".repeat(8001), level: 1 },
  ]) {
    const response = await brew(who.player, "spell", "Broken", data);
    assert.equal(response.status, 400, JSON.stringify(data).slice(0, 80));
  }
  for (const body of [
    { kind: "curse", name: "x", data: { desc: "x" } },
    { kind: "spell", name: "", data: { desc: "x" } },
    { kind: "spell", name: "x".repeat(81), data: { desc: "x" } },
    { kind: "spell" },
    "{not json",
  ]) {
    world.signIn(who.player);
    assert.equal((await call(route.brew, "POST", body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal((await listed(who.player, "spell")).length, before);

  const kept = await brew(who.player, "spell", "Frost Lance", {
    desc: "A lance of frost.", level: 9, damage: "99d99", slots: 40,
    mech: { resolution: "save", save: "dex", halfOnSave: true, condition: { name: "Slowed", rounds: 999999 } },
  });
  assert.equal(kept.status, 201, JSON.stringify(kept.json));
  // Keys the normalizer does not know are dropped, and a duration is bounded.
  assert.equal(kept.json.entry.data.damage, undefined);
  assert.equal(kept.json.entry.data.slots, undefined);
  assert.equal(kept.json.entry.data.mech.condition.rounds, 6000);
});

await test("a player's homebrew cannot rewrite a published spell's level", async () => {
  world.patch(who.sheet.id, CLERIC_ONE);
  world.patch(who.otherSheet.id, CLERIC_ONE);
  // The control: without the homebrew row the engine knows the real level.
  world.signIn(who.other);
  const honest = await call(route.spells, "POST", { action: "prepare", spell: "Revivify" }, params);
  assert.equal(honest.status, 400, "the control: a cleric 1 prepared the published Revivify");

  await brew(who.player, "spell", "Revivify", { desc: "Returns the dead to life.", level: 1, classes: ["cleric"] });
  world.signIn(who.player);
  const picked = await call(route.spells, "POST", { action: "prepare", spell: "Revivify" }, params);
  await world.invoke("take_rest", { kind: "long" });
  const cast = await world.invoke("use_spell_slot", { characterId: who.sheet.id, level: 1, spell: "Revivify" });
  const after = world.sheet(who.sheet.id).spellcasting;
  world.patch(who.sheet.id, CLERIC_ONE);
  assert.ok(
    picked.status === 400 && cast.ok === false,
    `prepared with status ${picked.status}; cast from a 1st level slot: ${cast.ok}; slots ${JSON.stringify(after.slots)}`,
  );
});

await test(
  "A class prepares from its class list. A spell a player invented is on no list until whoever runs the table puts it there.",
  async () => {
    world.patch(who.sheet.id, CLERIC_ONE);
    await brew(who.player, "spell", "Doom Ray", {
      desc: "The target takes 20d10 necrotic damage.", level: 1, classes: ["cleric"],
      mech: { resolution: "auto", damageType: "necrotic" },
    });
    world.signIn(who.player);
    const picked = await call(route.spells, "POST", { action: "prepare", spell: "Doom Ray" }, params);
    const pending = world.sheet(who.sheet.id).spellcasting.pending ?? [];
    world.patch(who.sheet.id, CLERIC_ONE);
    assert.equal(picked.status, 400, `a player's own spell was accepted; waiting to be prepared: ${pending.join(", ")}`);
  },
);

// ---- monsters ----

const BEYOND = {
  ac: 99, maxHp: 99999, dexMod: 50, cr: 0, xp: 1000000, attacksPerTurn: 50,
  saveMods: { str: 99, dex: 99, con: 99, int: 99, wis: 99, cha: 99 },
  attacks: [{ name: "Bite", toHit: 99, damage: "4d12+10", type: "piercing" }],
};

async function spawn(monster) {
  if (world.encounter()) {
    await world.invoke("end_encounter", { outcome: "victory" });
  }
  const started = await world.invoke("start_encounter", { enemies: [{ monster, count: 1 }] });
  world.clearDice();
  return { started, enemy: world.enemies()[0] };
}

await test("whatever was stored, the monster that reaches a fight is inside the bounds", async () => {
  const made = await brew(who.dm, "monster", "Doom Hound", { desc: "x", stats: BEYOND });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const { started, enemy } = await spawn(`homebrew:${made.json.entry.id}`);
  assert.equal(started.ok, true, started.error);
  assert.equal(enemy.maxHp, 1000);
  assert.equal(enemy.currentHp, 1000);
  assert.equal(enemy.ac, 30);
  assert.equal(enemy.stats.attacksPerTurn, 3);
  assert.equal(enemy.stats.attacks[0].toHit, 20);
  assert.equal(enemy.stats.dexMod, 10);
  assert.deepEqual(Object.values(enemy.stats.saveMods), [15, 15, 15, 15, 15, 15]);
  // Experience is the rating's: a CR 0 creature is worth 10 XP.
  assert.equal(enemy.stats.xp, 10);
});

await test("a monster whose damage the table cannot roll never reaches a fight", async () => {
  for (const damage of ["101d6", "1d101", "banana", "1d6; DROP TABLE", ""]) {
    const made = await brew(who.dm, "monster", `Glitch ${damage.length}`, {
      desc: "x", stats: { ...BEYOND, maxHp: 40, ac: 12, attacks: [{ name: "Bite", toHit: 3, damage, type: "x" }] },
    });
    assert.equal(made.status, 201);
    const { started, enemy } = await spawn(`homebrew:${made.json.entry.id}`);
    assert.equal(started.ok, true, started.error);
    // An unreadable row opens as the CR 1 baseline, not as what was typed.
    assert.notEqual(enemy.stats.attacks[0]?.damage, damage, damage);
    assert.notEqual(enemy.maxHp, 40, damage);
  }
});

await test("a table fights its owner's monsters and no player's", async () => {
  const theirs = await brew(who.player, "monster", "Pocket Dragon", {
    desc: "x", stats: { ...BEYOND, maxHp: 1, ac: 1, attacks: [] },
  });
  assert.equal(theirs.status, 201);
  for (const ref of [`homebrew:${theirs.json.entry.id}`, "homebrew:", "homebrew:nothing"]) {
    const { started } = await spawn(ref);
    assert.equal(started.ok, false, ref);
    assert.equal(world.encounter(), null, ref);
  }
});

await test("a published monster answers to its name before a hand-built one", async () => {
  // ODM's rule (bestiary/index.ts): building a "Goblin" does not change what
  // every table means by a goblin.
  const made = await brew(who.dm, "monster", "Goblin", {
    desc: "x", stats: { ...BEYOND, ac: 25, maxHp: 500, cr: 0 },
  });
  assert.equal(made.status, 201);
  const { started, enemy } = await spawn("goblin");
  assert.equal(started.ok, true, started.error);
  assert.notEqual(enemy.maxHp, 500);
  assert.notEqual(enemy.ac, 25);
  if (world.hasPack) {
    // SRD 5.1 goblin: armor class 15, 7 hit points, challenge 1/4.
    assert.equal(enemy.ac, 15);
    assert.equal(enemy.maxHp, 7);
    assert.equal(enemy.stats.cr, 0.25);
  }
  await world.invoke("end_encounter", { outcome: "victory" });
});

// ---- rulesets ----

await test("a ruleset is its author's, and only whoever runs the table applies one", async () => {
  const makeFor = async (user, variantRules = { powerfulCritical: true }) => {
    world.signIn(user);
    const made = await call(route.rulesets, "POST", { name: "House", variantRules });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    return made.json.ruleset.id;
  };
  const rule = () => world.campaign().gameSettings.variantRules.powerfulCritical;
  assert.equal(rule(), false);
  for (const user of [who.player, who.lead, who.other, who.bare, who.stranger]) {
    const id = await makeFor(user);
    const applied = await call(route.ruleset, "POST", { campaignId: world.campaignId }, { rulesetId: id });
    assert.ok([403, 404].includes(applied.status), `${user.username}: ${applied.status}`);
    assert.equal(rule(), false, user.username);
  }
  const dmRules = await makeFor(who.dm);
  for (const user of [who.player, who.assistant]) {
    world.signIn(user);
    assert.equal((await call(route.ruleset, "GET", undefined, { rulesetId: dmRules })).status, 404);
    assert.equal((await call(route.ruleset, "DELETE", undefined, { rulesetId: dmRules })).status, 404);
  }
  world.signIn(who.dm);
  for (const variantRules of [{ flanking: "yes" }, { restVariant: "epic" }]) {
    assert.equal((await call(route.rulesets, "POST", { name: "Bad", variantRules })).status, 400);
  }
  const applied = await call(route.ruleset, "POST", { campaignId: world.campaignId }, { rulesetId: dmRules });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.equal(rule(), true);
  // Every switch the ruleset did not name went back to the plain rule.
  assert.equal(world.campaign().gameSettings.variantRules.flanking, false);
});

await test("a ruleset's homebrew list names entries its author owns, on create and on edit", async () => {
  const [foreign] = await listed(who.player, "spell");
  assert.ok(foreign, "the player has a homebrew spell");
  world.signIn(who.dm);
  const count = async () => (await call(route.rulesets, "GET", undefined, {})).json.rulesets.length;
  const before = await count();
  for (const homebrewIds of [[foreign.id], ["names-nothing"], [foreign.id, "names-nothing"]]) {
    const made = await call(route.rulesets, "POST", { name: "Canon", variantRules: {}, homebrewIds });
    assert.equal(made.status, 400, JSON.stringify(homebrewIds));
    assert.deepEqual(made.json.ruleset?.homebrewIds ?? [], [], `stored ${JSON.stringify(made.json.ruleset?.homebrewIds)}`);
  }
  assert.equal(await count(), before, "a refused ruleset is not stored");

  // The author's own entries are theirs to list.
  const brewed = await call(route.brew, "POST", {
    kind: "feat", name: "Table Canon Feat", data: { description: "A feat for the list." },
  }, {});
  assert.ok(brewed.json.entry?.id, JSON.stringify(brewed.json));
  const own = brewed.json.entry.id;
  const made = await call(route.rulesets, "POST", { name: "Canon", variantRules: {}, homebrewIds: [own] });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual(made.json.ruleset.homebrewIds, [own]);

  const target = { rulesetId: made.json.ruleset.id };
  const edited = await call(route.ruleset, "PATCH", { homebrewIds: [own, foreign.id] }, target);
  assert.equal(edited.status, 400);
  const renamed = await call(route.ruleset, "PATCH", { name: "Canon, renamed" }, target);
  assert.equal(renamed.status, 200);
  assert.deepEqual(renamed.json.ruleset.homebrewIds, [own]);
  assert.equal(renamed.json.ruleset.name, "Canon, renamed");
});

// ---- world packs ----

const PACK = {
  id: "test_world", name: "Test World", blurb: "A world.", inspiredBy: "nothing", franchise: "Tests",
  baseGenre: "high_fantasy", theme: "A theme.",
};

await test("a world pack renames things and carries no numbers", () => {
  const parsed = worldPackSchema.parse({
    ...PACK,
    classes: [{ id: "fighter", name: "Legionary", hitDie: 20, saves: ["str", "dex", "con"], casterType: "full" }],
    races: [{ id: "human", name: "Imperial", speed: 90, abilityBonuses: { str: 10 } }],
    spells: [{ from: "Fireball", name: "Sunburst Charge", level: 1, damage: "40d6" }],
    items: [{ from: "Longsword", name: "Gladius", damage: "10d10" }],
    monsters: [{ slug: "goblin", name: "Gremlin", cr: 0.25, hp: 9999, ac: 40, attacks: [] }],
    variantRules: { powerfulCritical: true },
    gameSettings: { dicePolicy: "real_allowed" },
  });
  assert.deepEqual(parsed.classes, [{ id: "fighter", name: "Legionary", blurb: "", castingLabel: null }]);
  assert.deepEqual(parsed.races, [{ id: "human", name: "Imperial", blurb: "" }]);
  assert.deepEqual(parsed.spells, [{ from: "Fireball", name: "Sunburst Charge", blurb: "" }]);
  assert.deepEqual(parsed.items, [{ from: "Longsword", name: "Gladius", blurb: "" }]);
  assert.deepEqual(parsed.monsters, [{ slug: "goblin", name: "Gremlin", cr: 0.25, type: "", blurb: "" }]);
  assert.equal(parsed.variantRules, undefined);
  assert.equal(parsed.gameSettings, undefined);
  for (const broken of [{ id: "Bad Id" }, { baseGenre: "western" }, { monsters: [{ slug: "goblin", name: "x", cr: -1 }] }]) {
    assert.equal(worldPackSchema.safeParse({ ...PACK, ...broken }).success, false, JSON.stringify(broken));
  }
});

world.close();
finish();
