// The saves a stat block's own lines change (issue #473): a creature
// resistant to a condition (Black Flag) saves with advantage wherever a save
// lays or ends that condition, an archmage halves a spell's damage, Sunlight
// Weakness and Hypersensitivity answer the noon sun, and an undead's Turn
// Resistance, Turn Defiance, Turn Vulnerability and Turn Immunity answer
// Turn Undead (src/lib/dm/turn-defiance.ts).
//
// Run: npx vitest run scripts/test-enforce-block-saves.mjs

import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { monsterKit } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-block-saves");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { turnDefence } = await import("../src/lib/dm/turn-defiance.ts");
const { sunlightTurnStart } = await import("../src/lib/dm/sunlight-turn.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");

const tank = world.addHero({ name: "Tank", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED, maxHp: 300, ac: 10, acOverride: true });
const priest = world.addHero({
  name: "Priest", class: "cleric", level: 5, abilities: { wis: 16 }, proficiencies: TRAINED, maxHp: 300, ac: 10, acOverride: true,
  features: [{ name: "Channel Divinity (1/rest)", source: "class", classId: "cleric" }],
  spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 } }, prepared: [], known: [], cantrips: ["Sacred Flame"] },
});
const monk = world.addHero({ name: "Monk", class: "monk", level: 5, abilities: { dex: 16, wis: 14 }, proficiencies: TRAINED, maxHp: 300 });

const CLUB = [{ name: "Club", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 13 (2d8+4) bludgeoning damage." }];

async function stage(row, count = 1) {
  await kit.endFight();
  for (const hero of [tank, priest, monk]) {
    world.patch(hero.id, { currentHp: 300, conditions: [], conditionMeta: {} });
  }
  await kit.fight(count, { heroFaces: { [tank.id]: 19, [priest.id]: 18, [monk.id]: 17 } });
  const enemies = world.enemies();
  for (const enemy of enemies) {
    mk.stage(enemy.id, row);
  }
  kit.place(tank.id, 5, 5);
  kit.place(priest.id, 9, 5);
  kit.place(monk.id, 4, 6);
  enemies.forEach((enemy, at) => kit.place(enemy.id, 5 + at, 6));
  kit.freshRound();
  return world.enemies();
}

// ---- a condition resisted ----

await test("A creature resistant to a condition saves against it with advantage (Black Flag), and an archmage's resistance to damage from spells halves a cleric's Sacred Flame.", async () => {
  const [ogre] = await stage({ name: "Ogre", size: "Large", type: "Giant", armor_class: 11, hit_points: 59, cr: 2, wisdom: 7, document__slug: "blackflag", slug: "ogre", damage_resistances: "frightened", actions: [{ name: "Club", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 13 (2d8+4) bludgeoning damage." }] });
  // The model binds only through the creature's save: two d20s, the higher
  // kept, so the 19 saves it.
  const save = await mk.forced([3, 19], () => mk.ai(mk.aiTurn(), "set_enemy_condition", { enemyId: ogre.id, condition: "frightened", saveAbility: "wis", saveDc: 12 }));
  assert.equal(save.unused, 0, "the save was rolled without advantage");
  assert.equal(save.result.saved, true, JSON.stringify(save.out));
  const [archmage] = await stage({ name: "Archmage", size: "Medium", type: "Humanoid", armor_class: 12, hit_points: 99, cr: 12, wisdom: 12, damage_resistances: "damage from spells; non magical bludgeoning, piercing, and slashing (from stoneskin)", actions: [{ name: "Dagger", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 4 (1d4 + 2) piercing damage." }] });
  const before = world.enemies()[0].currentHp;
  kit.giveTurn(priest.id);
  const flame = await mk.forced([1, 8, 8], () => world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: archmage.id, spell: "Sacred Flame", saveAbility: "dex" }));
  assert.equal(flame.ok, true, flame.error);
  assert.equal(before - world.enemies()[0].currentHp, 8, "16 radiant from a spell, halved");
});

await test("Stunning Strike's save is the creature's save against being stunned: a block resistant to it rolls twice and keeps the higher.", async () => {
  const [brute] = await stage({ name: "Brute", size: "Medium", type: "Humanoid", armor_class: 10, hit_points: 80, cr: 2, constitution: 10, document__slug: "blackflag", slug: "brute", damage_resistances: "stunned", actions: CLUB });
  kit.giveTurn(monk.id);
  // Hit, the fist's die, then the save's two d20s: the 1 alone would fail.
  const strike = await kit.swing(monk.id, brute.id, [15, 3, 1, 19], { weapon: "unarmed strike", stunningStrike: true });
  assert.equal(strike.ok, true, strike.error);
  assert.equal(strike.unused, 0, "the save was rolled without advantage");
  assert.equal(kit.enemy(brute.id).conditions.includes("stunned"), false);
});

// ---- the sun ----

const VAMPIRE = {
  name: "Night Lord", size: "Medium", type: "Undead", armor_class: 15, hit_points: 90, cr: 5, wisdom: 10, document__slug: "blackflag", slug: "night-lord",
  special_abilities: [
    { name: "Sunlight Weakness", desc: "While in sunlight, the night lord has disadvantage on attack rolls and saving throws." },
    { name: "Sunlight Hypersensitivity", desc: "The night lord takes 20 radiant damage when it starts its turn in sunlight." },
  ],
  actions: [{ name: "Claw", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 8 (2d4+3) slashing damage." }],
};

async function underNoonSun(run) {
  const { getClock, setClock } = await import("../src/lib/db/clock.ts");
  const { breakDown } = await import("../src/lib/dm/calendar.ts");
  getDatabase().prepare("UPDATE battle_maps SET outdoors = 1, ambient = 'bright' WHERE id = ?").run(kit.map().id);
  const clock = getClock(world.campaignId);
  let instant = clock.instant;
  while (breakDown(clock.calendar, instant).hour !== 12) {
    instant += 60;
  }
  setClock(world.campaignId, { ...clock, instant, weather: null });
  try {
    return await run();
  } finally {
    setClock(world.campaignId, clock);
    getDatabase().prepare("UPDATE battle_maps SET outdoors = 0 WHERE id = ?").run(kit.map().id);
  }
}

await test("Sunlight Weakness puts a creature's saves at disadvantage in the noon sun, and Sunlight Hypersensitivity burns it as its turn starts there.", async () => {
  const [lord] = await stage(VAMPIRE);
  await underNoonSun(async () => {
    // Two d20s, the lower kept: the 19 would have saved.
    const save = await mk.forced([19, 3], () => mk.ai(mk.aiTurn(), "set_enemy_condition", { enemyId: lord.id, condition: "frightened", saveAbility: "wis", saveDc: 12 }));
    assert.equal(save.unused, 0, "the save was rolled without disadvantage");
    assert.match(JSON.stringify(save.result), /fails the WIS save 3 vs DC 12/);
    const lines = sunlightTurnStart(world.campaign(), world.encounter(), world.enemies()[0]);
    assert.match(lines.join(" "), /takes 20 radiant damage/);
    assert.equal(world.enemies()[0].currentHp, 70);
  });
  const shade = sunlightTurnStart(world.campaign(), world.encounter(), world.enemies()[0]);
  assert.deepEqual(shade, [], "it burned out of the sun");
});

// ---- turning ----

const undead = (name, trait, extra = {}) => ({
  name, size: "Medium", type: "Undead", armor_class: 12, hit_points: 60, cr: 5, wisdom: 10, slug: name.toLowerCase().replace(/ /g, "-"),
  special_abilities: trait ? [trait] : [], actions: CLUB, ...extra,
});

async function turn(dice) {
  const resources = world.sheet(priest.id).resources ?? {};
  world.patch(priest.id, { resources: { ...resources, channel_divinity: { ...resources.channel_divinity, used: 0 } } });
  kit.giveTurn(priest.id);
  return mk.forced(dice, () => world.invoke("use_resource", { characterId: priest.id, resource: "Channel Divinity", variant: "turn undead" }));
}

await test("Turn Resistance (the SRD lich) saves against Turn Undead with advantage, Turn Vulnerability with disadvantage, and Turn Immunity is never turned.", async () => {
  const [lich] = await stage(undead("Lich", { name: "Turn Resistance", desc: "The lich has advantage on saving throws against any effect that turns undead." }));
  const resisted = await turn([1, 19]);
  assert.equal(resisted.ok, true, resisted.error);
  assert.equal(resisted.unused, 0, "the save was rolled without advantage");
  assert.match(resisted.result.turnUndead.join(" "), /resists .*advantage from Turn Resistance/);
  assert.equal(kit.enemy(lich.id).conditions.includes("turned"), false);
  const [skeleton] = await stage(undead("Cackling Skeleton", { name: "Turn Vulnerability", desc: "The cackling skeleton has disadvantage on saving throws against any effect that turns undead." }));
  const fled = await turn([19, 1]);
  assert.equal(fled.unused, 0, "the save was rolled without disadvantage");
  assert.equal(kit.enemy(skeleton.id).conditions.includes("turned"), true);
  const [sentinel] = await stage(undead("Underworld Sentinel", { name: "Turn Immunity", desc: "Is immune to effects that turn undead." }));
  const unmoved = await turn([1]);
  assert.equal(unmoved.unused, 1, "a save was rolled for a creature that cannot be turned");
  assert.match(unmoved.result.turnUndead.join(" "), /cannot be turned \(Turn Immunity\)/);
  assert.equal(kit.enemy(sentinel.id).conditions.includes("turned"), false);
});

await test("Turn Defiance (the SRD ghast) gives the ghast and the ghouls within 30 feet of it advantage, and a ghoul farther off none.", async () => {
  const [ghast, near, far] = await stage(undead("Ghast", null), 3);
  mk.stage(ghast.id, undead("Ghast", { name: "Turn Defiance", desc: "The ghast and any ghouls within 30 ft. of it have advantage on saving throws against effects that turn undead." }));
  for (const [at, ghoul] of [near, far].entries()) {
    mk.stage(ghoul.id, undead("Ghoul", null));
    getDatabase().prepare("UPDATE encounter_enemies SET display_name = ?, slug = 'ghoul' WHERE id = ?").run(`Ghoul ${at + 1}`, ghoul.id);
  }
  kit.place(ghast.id, 9, 6);
  kit.place(near.id, 10, 6);
  kit.place(far.id, 9, 13);
  const sorted = world.enemies();
  const defences = Object.fromEntries(sorted.map((enemy) => [enemy.id, turnDefence(world.encounter().id, enemy, sorted)]));
  assert.equal(defences[ghast.id].advantage, "Turn Defiance");
  assert.match(defences[near.id].advantage ?? "", /Turn Defiance/);
  assert.equal(defences[far.id].advantage, undefined, "a ghoul 35 feet off");
});

// ---- the whole pack ----

if (world.hasPack) {
  await test("Every pack block that answers turning is read: each one about the creature itself gives it immunity, advantage or disadvantage, and an aura for others alone gives it none.", () => {
    const rows = getContentDb().prepare("SELECT slug, document_slug, cr, data_json FROM monsters ORDER BY document_slug, slug").all();
    const unread = [];
    let read = 0;
    for (const row of rows) {
      const data = JSON.parse(row.data_json);
      const lines = (data.special_abilities ?? []).filter((entry) => /that turns? undead|vs\.? turn undead/i.test(String(entry?.desc ?? "")));
      if (!lines.length) {
        continue;
      }
      const stats = parseMonster(data, Number(row.cr) || 0);
      const defence = turnDefence("none", { id: row.slug, status: "alive", displayName: data.name, slug: row.slug, stats }, []);
      if (defence.immune || defence.advantage || defence.disadvantage) {
        read += 1;
      } else {
        unread.push(`${row.document_slug}/${row.slug}`);
      }
    }
    assert.ok(read >= 35, `${read} read`);
    // "Friendly undead within 30 feet of the avulzor": its aura, not itself.
    assert.deepEqual(unread, ["tob2/avulzor"]);
  });
}

finish();
