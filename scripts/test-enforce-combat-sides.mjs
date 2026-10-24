// Sides in a fight (issue 503, Phase 6): a character sheet can fight on the
// foes' side and keep its sheet, and everything that splits a fight into two
// camps asks the side rather than the kind.
//
//   - a companion moved to the foes' side (src/lib/dm/combat-sides.ts) is a
//     target for pc_attack, and its own pc_attack lands on a party member's
//     sheet; before the move pc_attack refuses it as an ally;
//   - victory waits for everyone on the foes' side, the turncoat included,
//     and only the party's side shares the XP, which counts the turncoat;
//   - a turncoat at 0 hit points is dying, not dead (the rule this phase
//     decides, combat-sides-logic.ts sheetOutOfFight);
//   - the party's fall counts the party's side only;
//   - a player's command over a companion lapses on the foes' side and holds
//     again when it comes back;
//   - a sheet not in the order is rolled in and put on the board.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-combat-sides");
const world = await openWorld();
const kit = await combatKit(world);
const { moveToSide } = await import("../src/lib/dm/combat-sides.ts");
const { sideOf } = await import("../src/lib/dm/combatant.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { commanderOf } = await import("../src/lib/dm/companion-command.ts");
const { setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const tools = await import("../src/lib/dm/encounter-tools.ts");
const encounters = await import("../src/lib/db/encounters.ts");
const maps = await import("../src/lib/db/battle-maps.ts");
const { sheetEnemyStats } = await import("../src/lib/dm/sheet-foe-stats.ts");

const BODY = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
const hero = world.addHero({
  name: "Mira", class: "fighter", level: 3, abilities: BODY, proficiencies: TRAINED,
  maxHp: 40, ac: 12, acOverride: true, equipment: [{ name: "Longsword", qty: 1 }],
});
const friend = world.addHero({
  name: "Bram", class: "fighter", level: 3, abilities: BODY, proficiencies: TRAINED,
  maxHp: 40, ac: 12, acOverride: true, equipment: [{ name: "Longsword", qty: 1 }],
});

async function recruit(name) {
  const joined = await world.invoke("add_companion", {
    gender: "Unknown", name, class: "fighter", race: "human", level: 3, personality: "Grim.", kind: "guest",
  });
  assert.equal(joined.ok, true, joined.error);
  const id = joined.result.characterId;
  world.patch(id, {
    abilities: BODY, proficiencies: TRAINED, maxHp: 30, currentHp: 30, ac: 14, acOverride: true,
    equipment: [{ name: "Longsword", qty: 1 }], conditions: [], conditionMeta: {},
  });
  return world.sheet(id);
}

function fresh() {
  for (const sheet of [hero, friend]) {
    world.patch(sheet.id, { currentHp: 40, tempHp: 0, conditions: [], conditionMeta: {}, deathSaves: null });
  }
}

// A guest companion leaves with the fight it joined, so each fight recruits
// its own Aldric.
let aldric = null;
async function stage() {
  await kit.endFight();
  fresh();
  aldric = await recruit("Aldric");
  await kit.fight(1, { heroFaces: { [hero.id]: 19, [friend.id]: 18, [aldric.id]: 3 } });
  const [enemy] = world.enemies();
  kit.place(hero.id, 5, 5);
  kit.place(friend.id, 9, 9);
  kit.place(aldric.id, 5, 6);
  kit.place(enemy.id, 14, 14);
  return enemy;
}

await test("pc_attack refuses a companion fighting beside the attacker: an ally is no target.", async () => {
  await stage();
  kit.giveTurn(hero.id);
  const refused = await kit.attack(hero.id, aldric.id);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /side/i);
  assert.equal(world.sheet(aldric.id).currentHp, 30);
});

await test("A companion moved to the foes' side keeps its sheet, shows on the foes' side to every client, and pc_attack strikes it through its own Armor Class and hit points.", async () => {
  await stage();
  const moved = moveToSide(world.campaign(), aldric.id, "foe", { reason: "He draws on Mira." });
  assert.equal(moved.ok, true, moved.error);
  assert.equal(moved.side, "foe");
  assert.equal(moved.changed, true);
  assert.equal(sideOf(world.encounter(), "sheet", aldric.id), "foe");
  assert.equal(activePublicEncounter(world.campaignId).sides?.[aldric.id], "foe");
  assert.ok(world.sheet(aldric.id), "the sheet is kept");
  kit.giveTurn(hero.id);
  // 18 + 3 + 2 against AC 14; a longsword's d8 of 6, +3.
  const swing = await kit.swing(hero.id, aldric.id, [18, 6]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.result.hit, true);
  assert.equal(world.sheet(aldric.id).currentHp, 30 - 9);
});

await test("A turncoat's pc_attack lands on a party member's sheet, against that character's own Armor Class.", async () => {
  await stage();
  moveToSide(world.campaign(), aldric.id, "foe");
  kit.giveTurn(aldric.id);
  const swing = await kit.swing(aldric.id, hero.id, [10, 5]);
  assert.equal(swing.ok, true, swing.error);
  // 10 + 3 + 2 = 15 against Mira's 12: a hit for 5 + 3.
  assert.equal(swing.result.hit, true);
  assert.equal(world.sheet(hero.id).currentHp, 40 - 8);
  const miss = await (async () => {
    kit.freshTurn();
    return kit.swing(aldric.id, hero.id, [2]);
  })();
  assert.equal(miss.result.hit, false);
});

await test("Victory waits for the turncoat: the last enemy's fall leaves the fight open, the turncoat's ends it, and only the party shares the XP, the turncoat's worth included.", async () => {
  const enemy = await stage();
  moveToSide(world.campaign(), aldric.id, "foe");
  const xpBefore = { hero: world.sheet(hero.id).xp, friend: world.sheet(friend.id).xp };
  kit.setEnemy(enemy.id, { currentHp: 1 });
  kit.place(enemy.id, 6, 5);
  kit.giveTurn(hero.id);
  const slay = await kit.swing(hero.id, enemy.id, [18, 4]);
  assert.equal(slay.ok, true, slay.error);
  assert.equal(slay.result.dead, true);
  assert.ok(world.encounter(), "the fight goes on while the turncoat stands");
  world.patch(aldric.id, { currentHp: 1 });
  // What the turncoat is worth, read as the stat block its sheet makes.
  const worth = sheetEnemyStats(world.sheet(aldric.id)).xp;
  assert.ok(worth > 0);
  kit.giveTurn(friend.id);
  kit.place(friend.id, 4, 6);
  const drop = await kit.swing(friend.id, aldric.id, [18, 4]);
  assert.equal(drop.ok, true, drop.error);
  // A guest leaves with its fight, so the fall is read off the blow.
  assert.equal(drop.result.down, true, JSON.stringify(drop.result));
  assert.notEqual(drop.result.dead, true, "a turncoat at 0 is dying, not dead");
  assert.equal(world.encounter(), null, "the fight ends when the last foe falls");
  const ended = encounters.getLatestEndedEncounter(world.campaignId);
  assert.equal(ended.outcome, "victory");
  // Two shares, not three: the turncoat has none of its own defeat.
  const gained = world.sheet(hero.id).xp - xpBefore.hero;
  assert.equal(gained, Math.floor((50 + worth) / 2));
  assert.equal(world.sheet(friend.id).xp - xpBefore.friend, gained);
});

await test("The party's fall counts the party's side: with every party member dead, a turncoat standing is the side that won.", async () => {
  await stage();
  moveToSide(world.campaign(), aldric.id, "foe");
  for (const sheet of [hero, friend]) {
    world.patch(sheet.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  }
  tools.skipCurrentTurn(world.campaignId);
  assert.equal(world.encounter(), null);
  assert.equal(encounters.getLatestEndedEncounter(world.campaignId).outcome, "party_defeated");
});

await test("A player's command over a companion lapses while it fights on the foes' side and holds again when it comes back.", async () => {
  await stage();
  setCompanionCommander(aldric.id, friend.userId);
  assert.equal(commanderOf(world.campaign(), world.sheet(aldric.id)), friend.userId);
  moveToSide(world.campaign(), aldric.id, "foe");
  assert.equal(commanderOf(world.campaign(), world.sheet(aldric.id)), null);
  const back = moveToSide(world.campaign(), aldric.id, "party", { reason: "He lowers his blade." });
  assert.equal(back.ok, true);
  assert.equal(back.side, "party");
  assert.equal(activePublicEncounter(world.campaignId).sides, undefined, "nobody is off their side");
  assert.equal(commanderOf(world.campaign(), world.sheet(aldric.id)), friend.userId);
  setCompanionCommander(aldric.id, null);
});

await test("A sheet not in the fight's order is rolled in and put on the board when it is moved to a side.", async () => {
  await stage();
  const late = await recruit("Corvin");
  // Out of the order and off the board, as a sheet the fight never staged.
  const encounter = world.encounter();
  kit.saveEncounter({ ...encounter, order: encounter.order.filter((entry) => entry.characterId !== late.id) });
  maps.removeTokenByRef(kit.map().id, late.id);
  assert.ok(!world.encounter().order.some((entry) => entry.characterId === late.id), "not in the order yet");
  const moved = moveToSide(world.campaign(), late.id, "foe");
  assert.equal(moved.ok, true, moved.error);
  assert.ok(world.encounter().order.some((entry) => entry.characterId === late.id), "rolled into the order");
  assert.ok(kit.token(late.id), "put on the board");
  await kit.endFight();
  await world.invoke("dismiss_companion", { characterId: late.id });
});

await kit.endFight();
finish();
