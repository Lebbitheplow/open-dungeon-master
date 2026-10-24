// Sides through the targeting tools (issue 503, Phase 6): each tool that aims
// at a creature takes any combatant (src/lib/dm/combatant.ts), and a sheet
// struck through the foe paths is struck as the character it is.
//
//   - cast_at_enemy at a companion turned on the party rolls the character's
//     own save and lands the spell on its sheet;
//   - cast_at_player with a sheet caster (casterEnemyId names it): the
//     turncoat's spell at a party member, from its own slot;
//   - grapple a turncoat: its own Athletics or Acrobatics resists;
//   - opportunity attacks both ways between a turncoat and the party;
//   - a creature the party dominates (a real Dominate Person) fights for
//     it: enemy_attack strikes its old ally stat block against stat block,
//     an ally is refused, its command (declare_intent) steers the backstop,
//     victory does not wait for it, and the charm's end sends it back.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-enforce-combat-sides-handlers");
const world = await openWorld();
const kit = await combatKit(world);
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const rolls = await import("../src/lib/db/rolls.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const { onPersonsTurn } = await import("../src/lib/dm/invoke.ts");
const encounters = await import("../src/lib/db/encounters.ts");

const BODY = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
const hero = world.addHero({
  name: "Mira", class: "fighter", level: 3, abilities: BODY, proficiencies: TRAINED,
  maxHp: 40, ac: 12, acOverride: true, equipment: [{ name: "Longsword", qty: 1 }],
});
const priest = world.addHero({ name: "Oren", ...caster("cleric", "wis", ["Hold Person"], ["Sacred Flame"], 9), maxHp: 40, ac: 12, acOverride: true });
const mage = world.addHero({ name: "Vex", ...caster("wizard", "int", ["Dominate Person"], [], 9), maxHp: 40, ac: 12, acOverride: true });

async function recruit(name, extra = {}) {
  const joined = await world.invoke("add_companion", {
    gender: "Unknown", name, class: "fighter", race: "human", level: 3, personality: "Grim.", kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  const id = joined.result.characterId;
  world.patch(id, {
    abilities: BODY, proficiencies: TRAINED, maxHp: 30, currentHp: 30, ac: 14, acOverride: true,
    equipment: [{ name: "Longsword", qty: 1 }], conditions: [], conditionMeta: {}, ...extra,
  });
  return world.sheet(id);
}

function fresh() {
  for (const sheet of [hero, priest, mage]) {
    world.patch(sheet.id, { currentHp: 40, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null, concentratingOn: null });
  }
}

// A fight with one turncoat (a guest leaves with its fight) and `count`
// dummies, nobody beside anybody.
async function stage(count = 1, extra = {}) {
  await kit.endFight();
  fresh();
  const turncoat = await recruit("Aldric", extra);
  await kit.fight(count, { heroFaces: { [hero.id]: 19, [priest.id]: 18, [mage.id]: 17, [turncoat.id]: 3 } });
  kit.place(hero.id, 2, 2);
  kit.place(priest.id, 4, 2);
  kit.place(mage.id, 6, 2);
  kit.place(turncoat.id, 10, 10);
  world.enemies().forEach((enemy, index) => kit.place(enemy.id, 14 + index * 2, 14));
  return { turncoat, enemies: world.enemies() };
}

const attacksBy = (id) => rolls.listRecentRolls(world.campaignId, 100).filter((roll) => roll.kind === "attack" && roll.attacker?.id === id);

await test("cast_at_enemy at a turncoat rolls the character's own save and lands the spell on its sheet", async () => {
  const { turncoat } = await stage();
  moveToSide(world.campaign(), turncoat.id, "foe");
  kit.place(turncoat.id, 5, 2);
  kit.giveTurn(priest.id);
  // The turncoat's DEX save: a d20 of 2 (+1) against Oren's DC 15, then a
  // 9th-level cleric's 2d8 of 6 and 6.
  world.dice(2, 6, 6);
  const out = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: turncoat.id, spell: "Sacred Flame" });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.saved, false, JSON.stringify(out.result));
  assert.equal(world.sheet(turncoat.id).currentHp, 30 - 12);
  const save = rolls.listRecentRolls(world.campaignId, 20).find((roll) => roll.kind === "saving_throw" && roll.characterId === turncoat.id);
  assert.ok(save, "the save is the character's own, on its own card");
});

await test("cast_at_enemy refuses a character on the caster's own side", async () => {
  const { turncoat } = await stage();
  kit.giveTurn(priest.id);
  const out = await world.invoke("cast_at_enemy", { characterId: priest.id, targetEnemyId: turncoat.id, spell: "Sacred Flame" });
  assert.equal(out.ok, false);
  assert.match(out.error, /side/);
  assert.equal(world.sheet(turncoat.id).currentHp, 30);
});

await test("cast_at_player with a sheet caster named by casterEnemyId: the turncoat's spell at a party member, from its own slot and DC", async () => {
  const { turncoat } = await stage(1, {
    class: "cleric",
    spellcasting: { ability: "wis", slots: { 1: { max: 2, used: 0 } }, known: [], prepared: [], cantrips: ["Sacred Flame"] },
    abilities: { ...BODY, wis: 16 },
    equipment: [{ name: "Component pouch", qty: 1 }],
  });
  moveToSide(world.campaign(), turncoat.id, "foe");
  kit.place(turncoat.id, 3, 3);
  kit.giveTurn(turncoat.id);
  world.dice(2, 5);
  const out = await world.invoke("cast_at_player", { characterId: hero.id, casterEnemyId: turncoat.id, spell: "Sacred Flame", saveAbility: "dex", dc: 1 });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(world.sheet(hero.id).currentHp, 40 - 5);
});

await test("A grapple holds a turncoat when the party member's Athletics beats the character's own check", async () => {
  const { turncoat } = await stage();
  moveToSide(world.campaign(), turncoat.id, "foe");
  kit.place(turncoat.id, 3, 2);
  kit.giveTurn(hero.id);
  world.dice(18, 2);
  const out = await world.invoke("take_action", { characterId: hero.id, action: "grapple", targetEnemyId: turncoat.id });
  world.clearDice();
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.success, true, JSON.stringify(out.result));
  const held = world.sheet(turncoat.id);
  assert.ok(held.conditions.includes("grappled"));
  assert.equal(held.conditionMeta.grappled?.source, hero.id);
});

await test("Opportunity attacks run both ways between a turncoat and the party, and not between allies", async () => {
  const { turncoat } = await stage();
  moveToSide(world.campaign(), turncoat.id, "foe");
  kit.place(hero.id, 5, 5);
  kit.place(turncoat.id, 5, 6);
  kit.place(priest.id, 4, 6);
  // The turncoat walks away from Mira and Oren: both strike as it goes.
  kit.giveTurn(turncoat.id);
  const before = attacksBy(hero.id).length;
  world.dice(15, 4, 15, 4);
  const walked = await world.invoke("move_token", { tokenName: turncoat.id, x: 5, y: 9 });
  world.clearDice();
  assert.equal(walked.ok, true, walked.error);
  assert.equal(attacksBy(hero.id).length, before + 1, "Mira's opportunity attack on the turncoat");
  // Mira walks away from the turncoat: it strikes her as she goes.
  kit.place(turncoat.id, 5, 6);
  kit.giveTurn(hero.id);
  const struck = attacksBy(turncoat.id).length;
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: hero.userId });
  world.dice(15, 4);
  const response = await route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 5, y: 2 }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  world.clearDice();
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(attacksBy(turncoat.id).length, struck + 1, "the turncoat's opportunity attack on Mira");
  // Oren walking away from Mira draws nothing: they fight side by side.
  kit.place(hero.id, 8, 8);
  kit.place(priest.id, 8, 9);
  kit.place(turncoat.id, 15, 15);
  kit.giveTurn(priest.id);
  const allies = attacksBy(hero.id).length;
  world.signIn({ id: priest.userId });
  await route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x: 8, y: 12 }) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  assert.equal(attacksBy(hero.id).length, allies, "no opportunity attack on an ally");
});

await test("A creature dominated by a real Dominate Person fights for the party: it strikes its old ally, an ally is refused, and victory does not wait for it", async () => {
  const { enemies } = await stage(2);
  const [ogre, goblin] = enemies;
  kit.place(ogre.id, 7, 2);
  kit.place(goblin.id, 7, 3);
  kit.giveTurn(mage.id);
  // Its WIS save: a 1.
  world.dice(1);
  const cast = await world.invoke("cast_at_enemy", { characterId: mage.id, targetEnemyId: ogre.id, spell: "Dominate Person" });
  world.clearDice();
  assert.equal(cast.ok, true, cast.error);
  assert.equal(sideOf(world.encounter(), "enemy", ogre.id), "party");
  assert.equal(activePublicEncounter(world.campaignId).sides?.[ogre.id], "party");
  // It may not strike the party now.
  kit.freshRound();
  const refused = await world.invoke("enemy_attack", { enemyId: ogre.id, targetCharacterId: hero.id });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /side/);
  // It strikes the goblin it fought beside: a 15 (+4) against AC 13, 1d6+2 of 4+2.
  world.dice(15, 4);
  const struck = await world.invoke("enemy_attack", { enemyId: ogre.id, targetCharacterId: goblin.id });
  world.clearDice();
  assert.equal(struck.ok, true, struck.error);
  assert.equal(struck.result.hit, true, JSON.stringify(struck.result));
  assert.equal(kit.enemy(goblin.id).currentHp, 40 - 6);
  // The goblin may strike back: they are on opposite sides now. The blow
  // gives the ogre a new Wisdom save against the spell (SRD 5.1, Dominate
  // Person): a 1, so the domination holds.
  kit.freshRound();
  world.dice(15, 3, 1);
  const back = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: ogre.id });
  world.clearDice();
  assert.equal(back.ok, true, back.error);
  assert.equal(kit.enemy(ogre.id).currentHp, 40 - 5);
  assert.equal(sideOf(world.encounter(), "enemy", ogre.id), "party", "the domination holds through the blow");
  // The goblin falls: no foe stands, and the dominated ogre does not hold
  // the fight open.
  kit.setEnemy(goblin.id, { currentHp: 1 });
  kit.giveTurn(hero.id);
  kit.place(hero.id, 8, 3);
  const slay = await kit.swing(hero.id, goblin.id, [18, 4]);
  assert.equal(slay.ok, true, slay.error);
  assert.equal(world.encounter(), null, "victory with the dominated ogre still standing");
  assert.equal(encounters.getLatestEndedEncounter(world.campaignId).outcome, "victory");
});

await test("A dominated creature's command steers the backstop, and the charm's end sends it back to its side", async () => {
  const { enemies } = await stage(3);
  const [ogre, goblin, orc] = enemies;
  kit.place(ogre.id, 9, 9);
  kit.place(goblin.id, 9, 10);
  kit.place(orc.id, 10, 9);
  kit.setEnemy(ogre.id, { conditions: ["charmed"], conditionMeta: { charmed: { spell: "Dominate Person", source: mage.id } } });
  assert.equal(sideOf(world.encounter(), "enemy", ogre.id), "party");
  const told = await world.invoke("declare_intent", { actor: ogre.id, verb: "Club", target: orc.id });
  assert.equal(told.ok, true, told.error);
  assert.match(told.result.note, /standing order/);
  kit.freshRound();
  world.dice(15, 4);
  onPersonsTurn(world.campaign(), (turn) => tools.autoActSkippedEnemies(world.campaign(), turn, world.encounter(), [ogre.id], world.sheets(), new Map(world.sheets().map((sheet) => [sheet.id, sheet]))));
  world.clearDice();
  assert.equal(kit.enemy(orc.id).currentHp, 40 - 6, "the ordered target, not the nearer goblin");
  assert.equal(kit.enemy(goblin.id).currentHp, 40);
  // The charm ends: it is a foe again.
  kit.setEnemy(ogre.id, { conditions: [], conditionMeta: {} });
  assert.equal(sideOf(world.encounter(), "enemy", ogre.id), "foe");
});

await kit.endFight();
finish();
