// The table's optional rules, where an engine reads them.
//
// A variant rule is a promise the settings panel makes to a table, so each
// toggle is held to the same standard: stored, and then READ by the engine
// that resolves the thing it is about. Each test stages the same moment at
// two tables that differ in one setting and reads what the engine did.
//
//   powerfulCritical    the critical's extra dice land at their maximum
//   criticalDamageMods  flat modifiers double on a critical with the dice
//   ammunition          a shot spends a round; an empty quiver refuses it
//   encumbrance         PHB variant: over 10 x STR in pounds is disadvantage
//                       on STR, DEX and CON rolls and 20 feet of speed
//   restVariant         standard 1 h / 8 h, gritty 8 h / 7 days,
//                       heroic 5 min / 1 h (DMG rest variants)
//   difficulty          the encounter budget a fight is refused above
//   gm.strictness       ODM's own rule: every named difficulty's DC moves
//                       two points (docs/rules-coverage.md, "Strictness")
//
//   flanking            DMG variant: advantage on a melee attack with an ally
//                       on the far side of the target, on a mapped fight
//
// With every variant off a critical is the SRD's: the dice twice, the
// modifier once. Critical fumbles and lingering injuries are narration
// guidance by decision: their labels say "narrated", they reach the model as
// a sentence, and turning them on changes no engine state.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { standBeside } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, proficiencyBonus, suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-variant-rules");

// A row without the keys a comparison leaves out (the write stamp, ids).
const withoutKeys = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const { getDatabase } = await import("../src/lib/db/core.ts");
const { speedFor } = await import("../src/lib/srd/index.ts");

const TRAINED = {
  saves: [], skills: [], expertise: [], languages: ["Common"], tools: [],
  armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"],
};

// A fighter with a longsword beside one enemy that has hit points to spare,
// and the swing already aimed.
async function duel(variantRules, hero = {}) {
  const world = await openWorld({ gameSettings: { variantRules } });
  const fighter = world.addHero({
    class: "fighter",
    abilities: { str: 16, dex: 16 },
    proficiencies: TRAINED,
    equipment: [{ name: "Longsword", qty: 1, equipped: true }],
    ...hero,
  });
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [fighter.id]: 20 } });
  const [enemy] = world.enemies();
  getDatabase()
    .prepare(`UPDATE encounter_enemies SET max_hp = 90, current_hp = 90, ac = 12 WHERE id = ?`)
    .run(enemy.id);
  await standBeside(world, fighter.id, enemy.id);
  const swing = (args = {}) =>
    world.invoke("pc_attack", {
      characterId: fighter.id,
      enemyId: enemy.id,
      targetEnemyId: enemy.id,
      weapon: "Longsword",
      ...args,
    });
  return { world, fighter, enemy, swing, lost: () => 90 - world.enemies()[0].currentHp };
}

// ---- criticals ----

// Longsword 1d8, STR 16 (+3). The d20 shows 20, then the damage dice 3 and 5.
const CRITS = [
  { rules: {}, dice: [20, 3, 5], damage: 3 + 5 + 3, label: "the SRD critical rolls the dice twice and adds the modifier once" },
  { rules: { powerfulCritical: true }, dice: [20, 3], damage: 3 + 8 + 3, label: "Powerful Critical deals the extra die at its maximum" },
  { rules: { criticalDamageMods: true }, dice: [20, 3, 5], damage: 3 + 5 + 3 + 3, label: "Critical Damage Mods doubles the modifier too" },
  { rules: { powerfulCritical: true, criticalDamageMods: true }, dice: [20, 3], damage: 3 + 8 + 3 + 3, label: "both critical variants together" },
];

for (const row of CRITS) {
  await test(row.label, async () => {
    const { world, swing, lost } = await duel(row.rules);
    world.dice(...row.dice);
    const out = await swing();
    assert.equal(out.ok, true, out.error);
    assert.equal(world.clearDice(), 0, "every forced die was rolled");
    assert.equal(lost(), row.damage);
  });
}

await test("neither critical variant touches an ordinary hit", async () => {
  const { world, swing, lost } = await duel({ powerfulCritical: true, criticalDamageMods: true });
  world.dice(15, 3);
  const out = await swing();
  assert.equal(out.ok, true, out.error);
  assert.equal(lost(), 3 + abilityMod(16));
});

await test("an enemy's critical on a hero follows the same two switches", async () => {
  const expected = { plain: null, powerful: null };
  for (const [key, rules] of [["plain", {}], ["powerful", { powerfulCritical: true, criticalDamageMods: true }]]) {
    const { world, fighter, enemy } = await duel(rules, { maxHp: 120 });
    getDatabase()
      .prepare(`UPDATE encounter_enemies SET stat_json = ? WHERE id = ?`)
      .run(
        JSON.stringify({ ...enemy.stats, attacks: [{ name: "Club", toHit: 4, damage: "1d6+2", type: "bludgeoning" }], attacksPerTurn: 1 }),
        enemy.id,
      );
    world.dice(20, 2, 4);
    const out = await world.invoke("enemy_attack", {
      enemyId: enemy.id,
      targetCharacterId: fighter.id,
      attack: "Club",
    });
    assert.equal(out.ok, true, out.error);
    world.clearDice();
    expected[key] = 120 - world.sheet(fighter.id).currentHp;
  }
  assert.equal(expected.plain, 2 + 4 + 2);
  assert.equal(expected.powerful, 2 + 6 + 2 + 2);
});

// ---- ammunition ----

const archer = (equipment) => ({ equipment: [{ name: "Longbow", qty: 1, equipped: true }, ...equipment] });
const shoot = (table) =>
  table.world.invoke("pc_attack", {
    characterId: table.fighter.id,
    enemyId: table.enemy.id,
    targetEnemyId: table.enemy.id,
    weapon: "Longbow",
  });
const arrows = (world, id) =>
  world.sheet(id).equipment.find((item) => /arrow/i.test(item.name))?.qty ?? 0;

await test("with ammunition off a bow fires from an empty quiver and spends nothing", async () => {
  // ODM's default (docs/rules-coverage.md, "Deliberate omissions"): quivers
  // are assumed full. SRD 5.1 has every shot spend a piece of ammunition.
  const table = await duel({ ammunition: false }, archer([]));
  // The archer stands beside the goblin: a shot with a hostile creature
  // within 5 feet rolls two d20s and keeps the lower.
  table.world.dice(15, 15, 4);
  const out = await shoot(table);
  assert.equal(out.ok, true, out.error);
  assert.equal(table.lost(), 4 + abilityMod(16));
  const stocked = await duel({ ammunition: false }, archer([{ name: "Arrows", qty: 20 }]));
  stocked.world.dice(15, 15, 4);
  assert.equal((await shoot(stocked)).ok, true);
  assert.equal(arrows(stocked.world, stocked.fighter.id), 20);
});

await test("with ammunition on a shot spends an arrow and an empty quiver refuses the shot", async () => {
  const empty = await duel({ ammunition: true }, archer([]));
  empty.world.dice(15, 4);
  const refused = await shoot(empty);
  assert.equal(refused.ok, false);
  assert.equal(empty.lost(), 0);
  empty.world.clearDice();

  const stocked = await duel({ ammunition: true }, archer([{ name: "Arrows", qty: 2 }]));
  stocked.world.dice(15, 4);
  const first = await shoot(stocked);
  assert.equal(first.ok, true, first.error);
  assert.equal(arrows(stocked.world, stocked.fighter.id), 1);
});

// ---- encumbrance ----

await test("encumbrance is weighed only at a table that turned it on", async () => {
  for (const encumbrance of [false, true]) {
    const world = await openWorld({ gameSettings: { variantRules: { encumbrance } } });
    // STR 10: encumbered over 50 lb, heavily over 100 lb.
    const hero = world.addHero({
      abilities: { str: 10 },
      equipment: [{ name: "Anvil", qty: 1, weight: 120 }],
    });
    world.dice(15, 4);
    const out = await world.invoke("request_roll", {
      characterId: hero.id,
      kind: "ability_check",
      ability: "str",
      reason: "lift the gate",
    });
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.total, encumbrance ? 4 : 15);
    assert.equal(world.clearDice(), encumbrance ? 0 : 1);
    assert.equal(speedFor(world.sheet(hero.id), { encumbrance }), encumbrance ? 10 : 30);
  }
});

await test("the two encumbrance thresholds are 5 and 10 times Strength", async () => {
  const world = await openWorld({ gameSettings: { variantRules: { encumbrance: true } } });
  const rows = [
    { weight: 50, speed: 30 },
    { weight: 51, speed: 20 },
    { weight: 100, speed: 20 },
    { weight: 101, speed: 10 },
  ];
  for (const row of rows) {
    const hero = world.addHero({
      abilities: { str: 10 },
      equipment: [{ name: "Crate", qty: 1, weight: row.weight }],
    });
    assert.equal(speedFor(world.sheet(hero.id), { encumbrance: true }), row.speed, `${row.weight} lb`);
  }
});

// ---- rests ----

// Minutes on the in-world clock, from the DMG's rest variants.
const RESTS = [
  { restVariant: "standard", short: 60, long: 8 * 60 },
  { restVariant: "gritty", short: 8 * 60, long: 7 * 24 * 60 },
  { restVariant: "heroic", short: 5, long: 60 },
];

for (const row of RESTS.filter((entry) => entry.restVariant !== "gritty")) {
  await test(`${row.restVariant} rests take ${row.short} minutes and ${row.long} minutes`, async () => {
    const world = await openWorld({ gameSettings: { variantRules: { restVariant: row.restVariant } } });
    world.addHero({ class: "fighter" });
    const clock = () => world.campaign().clock.instant;
    let before = clock();
    const long = await world.invoke("take_rest", { kind: "long" });
    assert.equal(long.ok, true, long.error);
    assert.equal(clock() - before, row.long, "long rest");
    before = clock();
    const short = await world.invoke("take_rest", { kind: "short" });
    assert.equal(short.ok, true, short.error);
    assert.equal(clock() - before, row.short, "short rest");
  });
}

// The gritty short rest (a day on the clock where the rule says 8 hours) is
// recorded in test-enforce-short-rest.mjs as rest-gritty-short-rest-length.
await test("a gritty long rest takes the week", async () => {
  const world = await openWorld({ gameSettings: { variantRules: { restVariant: "gritty" } } });
  world.addHero({ class: "fighter" });
  const before = world.campaign().clock.instant;
  assert.equal((await world.invoke("take_rest", { kind: "long" })).ok, true);
  assert.equal(world.campaign().clock.instant - before, RESTS[1].long);
});

// ---- the encounter budget ----

await test("the campaign's difficulty moves the budget a fight is refused above", async () => {
  // ODM's own rule (dm/encounter-tools.ts encounterCeiling): the SRD has no
  // refusal, only the DMG's thresholds. One level 1 hero against two goblins.
  const started = {};
  for (const difficulty of ["easy", "normal", "hard", "deadly"]) {
    const world = await openWorld({ campaign: { difficulty } });
    world.addHero({ class: "fighter" });
    world.dice(1, 1);
    const out = await world.invoke("start_encounter", { enemies: [{ monster: "goblin", count: 2 }] });
    started[difficulty] = out.ok;
    assert.equal(Boolean(world.encounter()), out.ok);
  }
  assert.deepEqual(started, { easy: false, normal: false, hard: false, deadly: true });
});

// ---- strictness ----

const STRICTNESS = [
  { strictness: "lenient", dc: 13 },
  { strictness: "standard", dc: 15 },
  { strictness: "harsh", dc: 17 },
];

await test("strictness moves a group check's and a passive check's DC by two", async () => {
  for (const row of STRICTNESS) {
    const world = await openWorld({ gameSettings: { gm: { strictness: row.strictness, tone: [] } } });
    const hero = world.addHero({ class: "fighter" });
    world.dice(10);
    const group = await world.invoke("group_check", {
      ability: "str",
      difficulty: "moderate",
      characterIds: [hero.id],
    });
    assert.equal(group.ok, true, group.error);
    assert.equal(group.result.dc, row.dc, `group_check at ${row.strictness}`);
    const notice = await world.invoke("check_notice", { difficulty: "moderate", dc: undefined, sense: "perception" });
    if (notice.ok) {
      assert.equal(notice.result.dc, row.dc, `check_notice at ${row.strictness}`);
    }
  }
});

await test("Strictness shifts EVERY named difficulty's DC by two: a moderate check is DC 13 at a lenient table and DC 17 at a harsh one (docs/rules-coverage.md, \"Strictness\").", async () => {
  for (const row of STRICTNESS) {
    const world = await openWorld({ gameSettings: { gm: { strictness: row.strictness, tone: [] } } });
    const hero = world.addHero({ class: "fighter" });
    world.dice(10);
    const out = await world.invoke("request_roll", {
      characterId: hero.id,
      kind: "ability_check",
      ability: "str",
      difficulty: "moderate",
      reason: "force the door",
    });
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.dc, row.dc, `a moderate request_roll at a ${row.strictness} table is DC ${out.result.dc}`);
  }
});

// ---- switches nothing reads ----

// Every file under src/lib that an engine could read a rule from, apart from
// the ones that only store, describe or validate the settings.
function engineSources() {
  const root = path.resolve(import.meta.dirname, "../src/lib");
  const skip = /schemas\/|rulesets\/|rules-logic\.ts$|tours\/|help\/|db\/rulesets\.ts$|workshop/;
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.ts$/.test(entry.name) && !skip.test(full)) {
        out.push(fs.readFileSync(full, "utf8"));
      }
    }
  };
  walk(root);
  return out.join("\n");
}
const ENGINES = engineSources();
const readByAnEngine = (key) => new RegExp(`variantRules\\??\\.${key}\\b`).test(ENGINES);

await test("the six mechanical variants are each read by an engine", () => {
  // Flanking is read by the attack engines, from the tokens on the board
  // (src/lib/dm/pc-attack.ts, src/lib/dm/encounter-tools.ts); what it does
  // there is staged in test-enforce-advantage.mjs.
  for (const key of ["powerfulCritical", "criticalDamageMods", "ammunition", "encumbrance", "restVariant", "flanking"]) {
    assert.ok(readByAnEngine(key), key);
  }
});

// ---- the two narrated switches ----
//
// Critical fumbles and lingering injuries are guidance for the narrator.
// They stay that way by decision, so what is held here is that they say so
// and that turning them on moves nothing.

const { VARIANT_RULE_LABELS, NARRATED_VARIANT_RULES } = await import("../src/lib/rulesets/logic.ts");
const { VARIANT_RULE_LINES } = await import("../src/lib/dm/rules-logic.ts");

// Everything a fight can change, as text.
function fightState(world) {
  const db = getDatabase();
  const sheets = db
    .prepare(`SELECT * FROM character_sheets WHERE campaign_id = ? ORDER BY name`)
    .all(world.campaignId)
    .map((row) => withoutKeys(row, ["id", "user_id", "campaign_id", "created_at", "updated_at"]));
  const enemies = world.enemies().map((enemy) =>
    withoutKeys(enemy, ["id", "encounterId", "campaignId", "createdAt", "updatedAt"]),
  );
  return JSON.stringify({ sheets, enemies });
}

for (const key of ["criticalFumbles", "lingeringInjuries"]) {
  await test(`${key} is labelled and prompted as narration, and no engine reads it`, () => {
    assert.ok(NARRATED_VARIANT_RULES.includes(key));
    assert.match(VARIANT_RULE_LABELS[key], /narrated/i);
    assert.match(VARIANT_RULE_LINES[key], /narration only/i);
    assert.match(VARIANT_RULE_LINES[key], /server (applies nothing|tracks no injury)/i);
    const panel = fs.readFileSync(new URL("../src/app/campaigns/[campaignId]/RulesPanel.tsx", import.meta.url), "utf8");
    const entry = new RegExp(`key: "${key}",\\s*label: "([^"]+)",\\s*tip: "([^"]+)"`).exec(panel);
    assert.ok(entry, `the settings panel lists ${key}`);
    assert.match(entry[1], /narrated/i);
    assert.match(entry[2], /narration only/i);
    // A reader added later makes the label a lie: this is where that shows.
    assert.equal(readByAnEngine(key), false, `an engine reads variantRules.${key}`);
  });
}

await test("With critical fumbles on, a natural 1 is the same miss it is with them off: nothing else on either side changes.", async () => {
  const after = {};
  for (const [name, rules] of [["off", {}], ["on", { criticalFumbles: true }]]) {
    const { world, fighter, enemy, swing } = await duel(rules, { maxHp: 40 });
    world.dice(1);
    const out = await swing();
    assert.equal(world.clearDice(), 0, "only the d20 was rolled");
    assert.equal(out.ok, true, out.error);
    assert.equal(out.result.hit, false, JSON.stringify(out.result));
    getDatabase()
      .prepare(`UPDATE encounter_enemies SET stat_json = ? WHERE id = ?`)
      .run(
        JSON.stringify({ ...enemy.stats, attacks: [{ name: "Club", toHit: 4, damage: "1d6+2", type: "bludgeoning" }], attacksPerTurn: 1 }),
        enemy.id,
      );
    world.dice(1);
    const back = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id, attack: "Club" });
    assert.equal(world.clearDice(), 0);
    assert.equal(back.ok, true, back.error);
    assert.equal(world.sheet(fighter.id).currentHp, 40);
    assert.deepEqual(world.sheet(fighter.id).conditions, []);
    after[name] = fightState(world);
  }
  assert.equal(after.on, after.off);
});

await test("With lingering injuries on, a critical hit and a drop to 0 hit points leave what they leave with them off: no injury is rolled or stored.", async () => {
  const after = {};
  for (const [name, rules] of [["off", {}], ["on", { lingeringInjuries: true }]]) {
    const { world, fighter, enemy } = await duel(rules, { maxHp: 40 });
    getDatabase()
      .prepare(`UPDATE encounter_enemies SET stat_json = ? WHERE id = ?`)
      .run(
        JSON.stringify({ ...enemy.stats, attacks: [{ name: "Club", toHit: 4, damage: "1d6+2", type: "bludgeoning" }], attacksPerTurn: 1 }),
        enemy.id,
      );
    world.dice(20, 2, 4);
    const crit = await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id, attack: "Club" });
    assert.equal(crit.ok, true, crit.error);
    assert.equal(world.clearDice(), 0, "the critical rolled its own dice and no injury die");
    assert.equal(world.sheet(fighter.id).currentHp, 40 - (2 + 4 + 2));
    assert.deepEqual(world.sheet(fighter.id).conditions, []);
    const down = await world.invoke("apply_damage", { characterId: fighter.id, amount: 32, type: "bludgeoning" });
    assert.equal(down.ok, true, down.error);
    const fallen = world.sheet(fighter.id);
    assert.equal(fallen.currentHp, 0);
    assert.deepEqual(fallen.conditions.filter((condition) => condition !== "unconscious" && condition !== "prone"), []);
    after[name] = fightState(world);
  }
  assert.equal(after.on, after.off);
});

// ---- a switch thrown mid fight ----

await test("a setting changed mid fight leaves the turn as it stood and rules the next roll", async () => {
  const { world, swing, lost } = await duel({});
  const settings = await world.route("campaigns/[campaignId]/settings");
  const frozen = () => {
    const encounter = withoutKeys(world.encounter(), ["updatedAt"]);
    return JSON.stringify({ encounter, floor: world.campaign().floor, state: fightState(world) });
  };
  world.dice(20, 3, 5);
  assert.equal((await swing()).ok, true);
  assert.equal(world.clearDice(), 0);
  assert.equal(lost(), 3 + 5 + 3);

  const before = frozen();
  world.signIn(world.owner);
  const changed = await settings.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify({ variantRules: { powerfulCritical: true } }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(changed.status, 200);
  assert.equal(frozen(), before, "the switch moved something in the fight");

  // The same switch from a plain player is refused and changes nothing.
  const player = world.addUser("bystander");
  world.signIn(player);
  const refused = await settings.PATCH(
    new Request("http://test/", { method: "PATCH", body: JSON.stringify({ variantRules: { powerfulCritical: false } }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.ok([403, 404].includes(refused.status), String(refused.status));
  assert.equal(world.campaign().gameSettings.variantRules.powerfulCritical, true);
});

// proficiencyBonus is imported so the file states the to-hit it relies on.
assert.equal(proficiencyBonus(1) + abilityMod(16), 5);

// Every table above shares one scratch database; it goes once, at the end.
(await openWorld()).close();
finish();
