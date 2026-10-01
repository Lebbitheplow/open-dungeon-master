// A spell probe run with no content pack, for scripts/lib/enforce-spell-kit.mjs
// withoutPack(). The parent sets CONTENT_DB_PATH to nothing; this prints one
// line of JSON: what the engine stored, read from the sheet, the encounter
// row and the dice it rolled.
//
//   CONTENT_DB_PATH=/nonexistent node scripts/lib/enforce-spell-nopack.mjs fireball
import { openWorld } from "./enforce-world.mjs";
import { castOnOwnTurn, fightDummies, packAnswers } from "./enforce-spells.mjs";
import { caster, countDice, FIGHTER } from "./enforce-spell-kit.mjs";

const probe = process.argv[2] ?? "";
const out = { probe, pack: await packAnswers() };

async function table(heroes, count = 1) {
  const world = await openWorld();
  const sheets = heroes.map((hero) => world.addHero(hero));
  const enemies = await fightDummies(world, count, { heroFaces: { [sheets[0].id]: 20 } });
  castOnOwnTurn(world);
  return { world, sheets, enemies };
}

if (probe === "fireball") {
  // The caller's numbers are wrong on purpose: the spell's own are 8d6, DEX,
  // half on a success.
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", ["Fireball"])]);
  world.diceLog();
  world.dice(20, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1);
  const cast = await world.invoke("aoe_damage", {
    casterId: wizard.id, spell: "Fireball", level: 3, damage: "20d6", saveAbility: "wis", dc: 25, enemyIds: [goblin.id],
  });
  const log = world.diceLog();
  world.clearDice();
  Object.assign(out, {
    ok: cast.ok,
    error: cast.error ?? null,
    saveAbility: cast.result?.saveAbility ?? null,
    halfOnSave: cast.result?.halfOnSave ?? null,
    d6: countDice(log, 6),
  });
} else if (probe === "firebolt") {
  const { world, sheets: [wizard], enemies: [goblin] } = await table([caster("wizard", "int", [], ["Fire Bolt"], 11)]);
  world.diceLog();
  world.dice(15, 1, 1, 1, 1, 1, 1);
  const hit = await world.invoke("pc_attack", {
    characterId: wizard.id, targetEnemyId: goblin.id, spell: "Fire Bolt", damage: "1d10",
  });
  const log = world.diceLog();
  world.clearDice();
  Object.assign(out, { ok: hit.ok, error: hit.error ?? null, d10: countDice(log, 10) });
} else if (probe === "heal") {
  const { world, sheets: [priest, friend] } = await table([caster("cleric", "wis", ["Cure Wounds", "Heal"], [], 11), FIGHTER]);
  world.patch(friend.id, { currentHp: 1 });
  world.patch(friend.id, { maxHp: 90 });
  world.dice(3);
  const cure = await world.invoke("heal", { characterId: friend.id, casterId: priest.id, spell: "Cure Wounds", level: 1 });
  world.clearDice();
  const afterCure = world.sheet(friend.id).currentHp;
  const heal = await world.invoke("heal", { characterId: friend.id, casterId: priest.id, spell: "Heal", level: 6 });
  Object.assign(out, {
    cure: cure.ok ? afterCure : cure.error,
    heal: heal.ok ? world.sheet(friend.id).currentHp : heal.error,
    slots: world.sheet(priest.id).spellcasting.slots,
  });
} else if (probe === "sacred-flame") {
  const { world, sheets: [priest], enemies: [goblin] } = await table([caster("cleric", "wis", [], ["Sacred Flame"], 5)]);
  world.diceLog();
  world.dice(1, 1, 1, 1, 1, 1, 1, 1);
  const cast = await world.invoke("cast_at_enemy", {
    characterId: priest.id, targetEnemyId: goblin.id, spell: "Sacred Flame", saveAbility: "wis", damage: "6d8",
  });
  const log = world.diceLog();
  world.clearDice();
  Object.assign(out, {
    ok: cast.ok,
    error: cast.error ?? null,
    corrected: cast.result?.corrected ?? null,
    d8: countDice(log, 8),
    damageType: cast.result?.damageType ?? null,
  });
} else {
  out.error = `unknown probe "${probe}"`;
}

console.log(JSON.stringify(out));
process.exit(0);
