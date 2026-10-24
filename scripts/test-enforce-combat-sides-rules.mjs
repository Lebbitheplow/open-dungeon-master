// The spells and creatures that put a combatant on the other side, or against
// anyone (issue 503, Phase 6):
//
//   - Confusion's 7 or 8: the engine's die picks a creature in reach,
//     whichever side, and the attack tools hold the creature to it (an
//     enemy against its own ally, a character against theirs);
//   - a summon whose maker loses it keeps its sheet on the foes' side,
//     strikes the party with its own attacks, and its fall counts for XP.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-combat-sides-rules");
const world = await openWorld();
const kit = await combatKit(world);
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const { spellTurnStart } = await import("../src/lib/dm/spell-aura.ts");
const { spawnSummons, endSpellSummons } = await import("../src/lib/dm/summon-store.ts");
const { findSummonForm } = await import("../src/lib/srd/summon-forms.ts");
const { summonRecord } = await import("../src/lib/dm/summon-rules.ts");
const encounters = await import("../src/lib/db/encounters.ts");

const BODY = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
const hero = world.addHero({
  name: "Mira", class: "fighter", level: 3, abilities: BODY, proficiencies: TRAINED,
  maxHp: 40, ac: 12, acOverride: true, equipment: [{ name: "Longsword", qty: 1 }],
});
const friend = world.addHero({
  name: "Bram", class: "fighter", level: 3, abilities: BODY, proficiencies: TRAINED,
  maxHp: 40, ac: 12, acOverride: true, equipment: [{ name: "Longsword", qty: 1 }],
});

const CONFUSED = { conditions: ["confused"], conditionMeta: { confused: { spell: "Confusion", source: friend.id, rounds: 10 } } };
const lashOf = (holder, round) => holder?.conditionMeta?.confused?.lashOut?.round === round ? holder.conditionMeta.confused.lashOut.target : null;

async function stage(count = 2) {
  await kit.endFight();
  for (const sheet of [hero, friend]) {
    world.patch(sheet.id, { currentHp: 40, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  await kit.fight(count, { heroFaces: { [hero.id]: 19, [friend.id]: 18 } });
  return world.enemies();
}

await test("Confusion's 7: the engine's die picks a creature in its reach, its own ally included, and enemy_attack holds it to that one", async () => {
  const [confused, ally] = await stage(2);
  kit.place(confused.id, 5, 5);
  kit.place(ally.id, 5, 6);
  kit.place(hero.id, 12, 12);
  kit.place(friend.id, 14, 14);
  kit.setEnemy(confused.id, CONFUSED);
  // The d10's 7; with one creature in reach there is nothing to pick between.
  world.dice(7);
  const lines = spellTurnStart(world.campaign(), world.encounter(), [confused.id]);
  world.clearDice();
  assert.ok(lines.some((line) => /lashes out at/.test(line)), lines.join(" | "));
  assert.equal(lashOf(kit.enemy(confused.id), world.encounter().round), ally.id);
  kit.place(hero.id, 4, 5);
  const refused = await world.invoke("enemy_attack", { enemyId: confused.id, targetCharacterId: hero.id });
  assert.equal(refused.ok, false, "only the creature the die picked");
  assert.match(refused.error, /confused/);
  world.dice(15, 4);
  const struck = await world.invoke("enemy_attack", { enemyId: confused.id, targetCharacterId: ally.id });
  world.clearDice();
  assert.equal(struck.ok, true, struck.error);
  assert.equal(struck.result.swings.length, 1, "one melee attack, not the routine");
  assert.equal(kit.enemy(ally.id).currentHp, 40 - 6, "its own ally takes the blow");
});

await test("Confusion's 8 on a character: the die picks among those in reach, and pc_attack strikes that one, an ally included, and no other", async () => {
  const [enemy] = await stage(1);
  kit.place(hero.id, 5, 5);
  kit.place(friend.id, 5, 6);
  kit.place(enemy.id, 12, 12);
  world.patch(hero.id, CONFUSED);
  // The d10's 8, then the pick: the first of the two in reach (the board's
  // token order, the party's before the enemies').
  kit.place(enemy.id, 4, 5);
  world.dice(8, 1);
  const lines = spellTurnStart(world.campaign(), world.encounter(), [hero.id]);
  world.clearDice();
  assert.ok(lines.some((line) => /lashes out at Bram/.test(line)), lines.join(" | "));
  kit.giveTurn(hero.id);
  const refused = await kit.attack(hero.id, enemy.id);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /confused/);
  const swing = await kit.swing(hero.id, friend.id, [18, 5]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(world.sheet(friend.id).currentHp, 40 - 8, "Bram takes the confused swing");
});

await test("Confusion's 2 to 6 and 9 to 10 pick nobody: no lash-out is kept", async () => {
  const [confused] = await stage(1);
  kit.place(confused.id, 5, 5);
  kit.place(hero.id, 5, 6);
  kit.setEnemy(confused.id, CONFUSED);
  world.dice(4);
  spellTurnStart(world.campaign(), world.encounter(), [confused.id]);
  world.clearDice();
  assert.equal(lashOf(kit.enemy(confused.id), world.encounter().round), null);
  assert.ok(kit.enemy(confused.id).conditions.includes("halted"));
});

function summonWolf(caster) {
  const form = findSummonForm("wolf");
  const record = summonRecord(form, { spell: "Conjure Fey", casterId: caster.id, casterName: caster.name, concentration: true, hostileOnBreak: true, castId: "fey" });
  const [wolf] = spawnSummons(world.campaign(), world.sheet(caster.id), { form, count: 1, record, rounds: 10, slotLevel: 6, initiative: "caster" });
  return wolf;
}

await test("A summon its maker loses keeps its sheet on the foes' side, strikes the party with its own bite, and its fall counts for XP", async () => {
  const [enemy] = await stage(1);
  const wolf = summonWolf(friend);
  kit.place(wolf.id, 5, 5);
  kit.place(hero.id, 5, 6);
  kit.place(enemy.id, 14, 14);
  endSpellSummons(world.campaign(), "Conjure Fey", friend.id);
  const turned = world.sheet(wolf.id);
  assert.ok(turned, "the sheet stays");
  assert.equal(sideOf(world.encounter(), "sheet", wolf.id), "foe");
  // Its bite on Mira, through pc_attack from its own sheet: +4 against AC 12.
  kit.giveTurn(wolf.id);
  const bite = await kit.swing(wolf.id, hero.id, [15, 3, 3]);
  assert.equal(bite.ok, true, bite.error);
  assert.equal(bite.result.hit, true, JSON.stringify(bite.result));
  assert.ok(world.sheet(hero.id).currentHp < 40, "Mira is bitten");
  // The enemy and the wolf fall: the fight is won, and the wolf's worth is in the XP.
  const before = world.sheet(hero.id).xp;
  kit.setEnemy(enemy.id, { currentHp: 1 });
  kit.place(enemy.id, 6, 6);
  kit.giveTurn(hero.id);
  const first = await kit.swing(hero.id, enemy.id, [18, 4]);
  assert.equal(first.ok, true, first.error);
  assert.ok(world.encounter(), "the wolf still stands");
  world.patch(wolf.id, { currentHp: 1 });
  kit.freshTurn();
  const second = await kit.swing(hero.id, wolf.id, [18, 4]);
  assert.equal(second.ok, true, second.error);
  assert.equal(world.encounter(), null, "the last foe fell");
  assert.equal(encounters.getLatestEndedEncounter(world.campaignId).outcome, "victory");
  // A wolf is CR 1/4 (50 XP), the dummy 50: 100 between two.
  assert.equal(world.sheet(hero.id).xp - before, 50);
});

await kit.endFight();
finish();
