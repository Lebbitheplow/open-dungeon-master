// Whose dice the engine believes.
//
// The server rolls every die (src/lib/dice.ts) unless a roll is PARKED for a
// player to answer. Two things park a roll (src/lib/dice/held-rolls.ts): the
// player rolls real dice at a table whose dice policy allows them, or the
// player asked to hold their rolls and release them with a tap. The first is
// trust the table chose. The second is not trust at all: "the server still
// draws every number, so no policy gates it".
//
// The rules held:
//   a parked roll is answered by the player it waits on, once, with as many
//   faces as the expression has dice and each face on its die;
//   whoever runs the story may roll it digitally for an absent player, and
//   may not type its faces;
//   the target's armor class never rides to the player with the parked roll;
//   a manual roll from the dice tray is the caller's own character's, its
//   total is the server's, and it never carries a DC or a success.
//
// ODM's rule pinned here: at a real-dice table the typed faces are believed
// (docs/ROADMAP.md: "a trust feature, as tabletop dice always have been").
// A parked roll records which of the two reasons parked it, and typed faces
// are taken for the first reason only.
import assert from "node:assert/strict";
import { call, seats, standBeside } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-rolls-trust");
const { listOpenPendingRolls, getPendingRoll } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const first = await openWorld();
const route = {
  me: await first.route("campaigns/[campaignId]/members/me"),
  pending: await first.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
  rolls: await first.route("campaigns/[campaignId]/rolls"),
  campaign: await first.route("campaigns/[campaignId]"),
};

// A human-run table with its seats filled, under the given dice policy.
async function table(dicePolicy, heroes = {}) {
  const world = await openWorld({ gameSettings: { dicePolicy } });
  const who = await seats(world);
  const params = { campaignId: world.campaignId };
  for (const [sheetId, patch] of Object.entries(heroes)) {
    world.patch(who[sheetId].id, patch);
  }
  const answer = (id, body, user = who.player) => {
    world.signIn(user);
    return call(route.pending, "POST", body, { ...params, pendingRollId: id });
  };
  const prefer = (body, user = who.player) => {
    world.signIn(user);
    return call(route.me, "PATCH", body, params);
  };
  const ask = (args = {}) =>
    world.invoke("request_roll", {
      characterId: who.sheet.id,
      kind: "ability_check",
      ability: "str",
      dc: 15,
      reason: "lift the gate",
      ...args,
    });
  const open = () => listOpenPendingRolls(world.campaignId);
  const stored = () => listRecentRolls(world.campaignId, 50).length;
  return { world, who, params, answer, prefer, ask, open, stored };
}

// ---- the policy gate ----

await test("real dice are refused at a digital-only table and allowed where the table said so", async () => {
  const digital = await table("digital_only");
  const refused = await digital.prefer({ useRealDice: true });
  assert.equal(refused.status, 400);
  // The engine rolls for them at once: nothing is parked.
  digital.world.dice(12);
  const rolled = await digital.ask();
  assert.equal(rolled.ok, true, rolled.error);
  assert.equal(rolled.result.total, 12);
  assert.equal(digital.open().length, 0);

  const real = await table("real_allowed");
  assert.equal((await real.prefer({ useRealDice: true })).status, 200);
  const parked = await real.ask();
  assert.equal(parked.ok, true, parked.error);
  assert.equal(parked.result.parked, true);
  assert.equal(real.open().length, 1);
  assert.equal(real.open()[0].userId, real.who.player.id);
});

await test("a real-dice preference kept from before stops counting when the policy closes", async () => {
  const world = await table("real_allowed");
  await world.prefer({ useRealDice: true });
  const campaigns = await import("../src/lib/db/campaigns.ts");
  campaigns.updateGameSettings(world.world.campaignId, { dicePolicy: "digital_only" });
  world.world.dice(9);
  const rolled = await world.ask();
  assert.equal(rolled.result.total, 9);
  assert.equal(world.open().length, 0);
});

// ---- answering a parked roll ----

await test("typed faces are believed at a real-dice table, labelled as physical", async () => {
  // ODM's rule: table trust, chosen by the table through its dice policy.
  const real = await table("real_allowed");
  await real.prefer({ useRealDice: true });
  await real.ask();
  const [pending] = real.open();
  const answered = await real.answer(pending.id, { dice: [17] });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  assert.equal(answered.json.roll.total, 17);
  assert.equal(answered.json.roll.dc, 15);
  assert.equal(answered.json.roll.success, true);
  assert.match(answered.json.roll.detail, /physical/);
  assert.equal(getPendingRoll(pending.id).status, "submitted");
});

await test("a face is on its die, and the faces number what the expression rolls", async () => {
  const real = await table("real_allowed");
  await real.prefer({ useRealDice: true });
  await real.ask({ advantage: "advantage" });
  const [pending] = real.open();
  assert.equal(pending.expression, "2d20kh1");
  const before = real.stored();
  for (const dice of [[0, 5], [21, 5], [5, 21], [-3, 5], [1.5, 5], ["20", 5], [20], [20, 20, 20], []]) {
    const refused = await real.answer(pending.id, { dice });
    assert.equal(refused.status, 400, JSON.stringify(dice));
  }
  for (const body of [{}, { dice: "20" }, { total: 20 }, { fallback: "physical" }, { dice: [20, 20], total: 40 }]) {
    const response = await real.answer(pending.id, body);
    if ("dice" in body && Array.isArray(body.dice)) {
      // The extra key is dropped; the faces themselves are legal.
      assert.equal(response.status, 200);
      assert.equal(response.json.roll.total, 20);
    } else {
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  }
  assert.equal(real.stored(), before + 1);
  assert.equal(real.open().length, 0);
});

await test("a parked roll is answered once, by the player it waits on", async () => {
  const real = await table("real_allowed");
  await real.prefer({ useRealDice: true });
  await real.ask();
  const [pending] = real.open();
  const before = real.stored();

  for (const user of [real.who.other, real.who.lead, real.who.bare]) {
    assert.equal((await real.answer(pending.id, { dice: [20] }, user)).status, 403);
    assert.equal((await real.answer(pending.id, { fallback: "digital" }, user)).status, 403);
  }
  assert.equal((await real.answer(pending.id, { dice: [20] }, real.who.stranger)).status, 404);
  // Whoever runs the story may roll it for them, never type it for them.
  assert.equal((await real.answer(pending.id, { dice: [20] }, real.who.dm)).status, 403);
  assert.equal(real.stored(), before);
  assert.equal(getPendingRoll(pending.id).status, "pending");

  real.world.dice(6);
  const forced = await real.answer(pending.id, { fallback: "digital" }, real.who.assistant);
  assert.equal(forced.status, 200, JSON.stringify(forced.json));
  assert.equal(forced.json.roll.total, 6);
  assert.doesNotMatch(forced.json.roll.detail, /physical/);

  const late = await real.answer(pending.id, { dice: [20] });
  assert.equal(late.status, 409);
  assert.equal(real.stored(), before + 1);
});

await test("a parked roll from another table is not answered through this one", async () => {
  const here = await table("real_allowed");
  const there = await table("real_allowed");
  await there.prefer({ useRealDice: true });
  await there.ask();
  const [pending] = there.open();
  here.world.signIn(here.who.player);
  const crossed = await call(route.pending, "POST", { dice: [20] }, {
    campaignId: here.world.campaignId,
    pendingRollId: pending.id,
  });
  assert.equal(crossed.status, 404);
  assert.equal(getPendingRoll(pending.id).status, "pending");
});

await test("a parked attack is judged against the stored armor class, which the player never sees", async () => {
  const real = await table("real_allowed", {
    sheet: {
      abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      equipment: [{ name: "Longsword", qty: 1, equipped: true }],
      proficiencies: {
        saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [],
        weapons: ["simple", "martial"],
      },
    },
  });
  const { world, who } = real;
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [who.sheet.id]: 20 } });
  const [enemy] = world.enemies();
  getDatabase()
    .prepare(`UPDATE encounter_enemies SET ac = 14, max_hp = 60, current_hp = 60 WHERE id = ?`)
    .run(enemy.id);
  await standBeside(world, who.sheet.id, enemy.id);
  await real.prefer({ useRealDice: true });
  const swing = await world.invoke("pc_attack", {
    characterId: who.sheet.id,
    enemyId: enemy.id,
    targetEnemyId: enemy.id,
    weapon: "Longsword",
  });
  assert.equal(swing.ok, true, swing.error);
  const [toHit] = real.open();
  assert.equal(toHit.kind, "attack");
  assert.equal(toHit.attack.targetAc, 14);

  world.signIn(who.player);
  const snapshot = await call(route.campaign, "GET", undefined, real.params);
  const shown = snapshot.json.pendingRolls.find((entry) => entry.id === toHit.id);
  assert.ok(shown);
  assert.equal(shown.attack, undefined);
  assert.equal(shown.combatNote, undefined);
  assert.ok(!JSON.stringify(shown).includes("targetAc"));

  // A natural 8 with +5 is 13 against AC 14: a miss, and no damage roll.
  const missed = await real.answer(toHit.id, { dice: [8] });
  assert.equal(missed.status, 200, JSON.stringify(missed.json));
  assert.equal(world.enemies()[0].currentHp, 60);
  assert.equal(real.open().filter((entry) => entry.kind === "damage").length, 0);
});

await test("a parked hit parks its damage, and the damage faces are on the weapon's die", async () => {
  const real = await table("real_allowed", {
    sheet: {
      abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      equipment: [{ name: "Longsword", qty: 1, equipped: true }],
      proficiencies: {
        saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [],
        weapons: ["simple", "martial"],
      },
    },
  });
  const { world, who } = real;
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [who.sheet.id]: 20 } });
  const [enemy] = world.enemies();
  getDatabase()
    .prepare(`UPDATE encounter_enemies SET ac = 14, max_hp = 60, current_hp = 60 WHERE id = ?`)
    .run(enemy.id);
  await standBeside(world, who.sheet.id, enemy.id);
  await real.prefer({ useRealDice: true });
  await world.invoke("pc_attack", {
    characterId: who.sheet.id,
    enemyId: enemy.id,
    targetEnemyId: enemy.id,
    weapon: "Longsword",
  });
  const [toHit] = real.open();
  assert.equal((await real.answer(toHit.id, { dice: [9] })).status, 200);
  const damage = real.open().find((entry) => entry.kind === "damage");
  assert.ok(damage, "a hit on 14 parked the damage roll");
  assert.equal(damage.expression.replace(/\s+/g, ""), "1d8+3");
  assert.equal((await real.answer(damage.id, { dice: [9] })).status, 400);
  assert.equal((await real.answer(damage.id, { dice: [8, 8] })).status, 400);
  assert.equal(world.enemies()[0].currentHp, 60);
  assert.equal((await real.answer(damage.id, { dice: [5] })).status, 200);
  assert.equal(world.enemies()[0].currentHp, 60 - (5 + 3));
});

// A real-dice fighter swinging at a goblin dressed with the given stat block
// lines; the to-hit is answered with `toHitFace` and the damage roll is
// returned still parked.
async function parkedBlow({ weapon = "Longsword", conditions = [], resist = "", toHitFace = 15 }) {
  const real = await table("real_allowed", {
    sheet: {
      abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      equipment: [{ name: weapon, qty: 1, equipped: true }],
      conditions,
      proficiencies: {
        saves: [], skills: [], expertise: [], languages: [], tools: [], armor: [],
        weapons: ["simple", "martial"],
      },
    },
  });
  const { world, who } = real;
  await world.beginFight([{ monster: "goblin", count: 1 }], { heroFaces: { [who.sheet.id]: 20 } });
  const [enemy] = world.enemies();
  const stats = { ...enemy.stats, resist, immune: "", vulnerable: "" };
  getDatabase()
    .prepare(`UPDATE encounter_enemies SET ac = 14, max_hp = 60, current_hp = 60, stat_json = ? WHERE id = ?`)
    .run(JSON.stringify(stats), enemy.id);
  await standBeside(world, who.sheet.id, enemy.id);
  await real.prefer({ useRealDice: true });
  const swing = await world.invoke("pc_attack", {
    characterId: who.sheet.id,
    enemyId: enemy.id,
    targetEnemyId: enemy.id,
    weapon,
  });
  assert.equal(swing.ok, true, swing.error);
  const [toHit] = real.open();
  assert.equal((await real.answer(toHit.id, { dice: [toHitFace] })).status, 200);
  const damage = real.open().find((entry) => entry.kind === "damage");
  assert.ok(damage, "the hit parked its damage roll");
  return { real, world, damage };
}

// The faces for a parked expression: every d8 shows `d8`, every d4 shows `d4`.
function facesFor(expression, { d8, d4 }) {
  const faces = [];
  for (const [, count, sides] of expression.matchAll(/(\d+)d(\d+)/g)) {
    for (let index = 0; index < Number(count); index += 1) {
      faces.push(Number(sides) === 8 ? d8 : d4);
    }
  }
  return faces;
}

await test("a magic weapon's parked damage passes resistance to nonmagical attacks, as the digital roll does", async () => {
  const { real, world, damage } = await parkedBlow({
    weapon: "Longsword +1",
    resist: "bludgeoning, piercing, and slashing from nonmagical attacks",
  });
  assert.equal(damage.attack?.magical, true);
  assert.equal(damage.expression.replace(/\s+/g, ""), "1d8+4");
  assert.equal((await real.answer(damage.id, { dice: [5] })).status, 200);
  assert.equal(world.enemies()[0].currentHp, 60 - 9, "a +1 sword's 9 slashing lands whole");
});

await test("a plain weapon's parked damage is still halved by resistance to nonmagical attacks", async () => {
  const { real, world, damage } = await parkedBlow({
    resist: "bludgeoning, piercing, and slashing from nonmagical attacks",
  });
  assert.equal(damage.attack?.magical, false);
  assert.equal((await real.answer(damage.id, { dice: [5] })).status, 200);
  assert.equal(world.enemies()[0].currentHp, 60 - 4, "8 nonmagical slashing is halved to 4");
});

await test("a parked damage roll resolves its riders per type: slashing resistance does not halve Divine Favor's radiant", async () => {
  const { real, world, damage } = await parkedBlow({ conditions: ["divine favor"], resist: "slashing" });
  assert.deepEqual(damage.attack?.riders, [{ dice: "1d4", type: "radiant" }]);
  const answered = await real.answer(damage.id, { dice: facesFor(damage.expression, { d8: 6, d4: 4 }) });
  assert.equal(answered.status, 200, JSON.stringify(answered.json));
  // Slashing 6 + 3 halved is 4, and the 4 radiant lands whole.
  assert.equal(world.enemies()[0].currentHp, 60 - 8);
  const note = getPendingRoll(damage.id).combatNote ?? "";
  assert.match(note, /radiant/, note);
});

await test("a parked critical's doubled rider dice stay the rider's", async () => {
  const { real, world, damage } = await parkedBlow({
    conditions: ["divine favor"],
    resist: "slashing",
    toHitFace: 20,
  });
  assert.equal(damage.attack?.crit, true);
  const faces = facesFor(damage.expression, { d8: 4, d4: 2 });
  assert.equal(faces.length, 4, damage.expression);
  assert.equal((await real.answer(damage.id, { dice: faces })).status, 200);
  // Slashing 4 + 4 + 3 = 11 halved is 5; radiant 2 + 2 = 4 whole.
  assert.equal(world.enemies()[0].currentHp, 60 - 9);
});

await test("at a digital-only table a held roll is released, never chosen", async () => {
  const digital = await table("digital_only");
  assert.equal((await digital.prefer({ holdRolls: true })).status, 200);
  const parked = await digital.ask({ dc: 25 });
  assert.equal(parked.result.parked, true);
  const [pending] = digital.open();
  assert.equal(pending.parkedFor, "held");
  const before = digital.stored();
  const typed = await digital.answer(pending.id, { dice: [20] });
  assert.notEqual(typed.status, 200, `a typed 20 was stored as "${typed.json.roll?.detail}" with total ${typed.json.roll?.total}`);
  assert.equal(getPendingRoll(pending.id).status, "pending");
  assert.equal(digital.stored(), before);
});

await test("a roll records why it was parked, and only a real-dice park takes typed faces", async () => {
  // Both preferences at a table that allows real dice: the dice in hand win.
  const real = await table("real_allowed");
  await real.prefer({ useRealDice: true, holdRolls: true });
  await real.ask();
  assert.equal(real.open()[0].parkedFor, "real_dice");

  // A held roll at the same table is still the server's to throw.
  const held = await table("real_allowed");
  await held.prefer({ holdRolls: true });
  await held.ask({ advantage: "advantage" });
  const [pending] = held.open();
  assert.equal(pending.parkedFor, "held");
  assert.equal((await held.answer(pending.id, { dice: [20, 20] })).status, 403);
  // One typed face among released ones is a chosen face all the same.
  assert.equal((await held.answer(pending.id, { dice: ["digital", 20] })).status, 403);
  assert.equal(getPendingRoll(pending.id).status, "pending");
  held.world.dice(7, 3);
  const released = await held.answer(pending.id, { dice: ["digital", "digital"] });
  assert.equal(released.status, 200, JSON.stringify(released.json));
  assert.equal(released.json.roll.total, 7);
  assert.doesNotMatch(released.json.roll.detail, /physical/);
});

await test("a policy closed while a real-dice roll waits closes the typing too", async () => {
  const real = await table("real_allowed");
  await real.prefer({ useRealDice: true });
  await real.ask();
  const [pending] = real.open();
  assert.equal(pending.parkedFor, "real_dice");
  const campaigns = await import("../src/lib/db/campaigns.ts");
  campaigns.updateGameSettings(real.world.campaignId, { dicePolicy: "digital_only" });
  assert.equal((await real.answer(pending.id, { dice: [20] })).status, 403);
  assert.equal(getPendingRoll(pending.id).status, "pending");
  // The roll is not stranded: the server throws it for them.
  real.world.dice(5);
  const released = await real.answer(pending.id, { fallback: "digital" });
  assert.equal(released.status, 200, JSON.stringify(released.json));
  assert.equal(released.json.roll.total, 5);
});

await test("a roll parked before the reason was recorded is judged by the table as it stands", async () => {
  const real = await table("real_allowed");
  await real.prefer({ useRealDice: true });
  await real.ask();
  const digital = await table("digital_only");
  await digital.prefer({ holdRolls: true });
  await digital.ask();
  getDatabase().prepare(`UPDATE pending_rolls SET parked_for = NULL`).run();
  const [old] = real.open();
  assert.equal(old.parkedFor, null);
  assert.equal((await real.answer(old.id, { dice: [11] })).status, 200);
  const [held] = digital.open();
  assert.equal((await digital.answer(held.id, { dice: [20] })).status, 403);
  assert.equal(getPendingRoll(held.id).status, "pending");
});

await test("a held roll released digitally is drawn by the server", async () => {
  const digital = await table("digital_only");
  await digital.prefer({ holdRolls: true });
  await digital.ask();
  const [pending] = digital.open();
  digital.world.dice(4);
  const released = await digital.answer(pending.id, { dice: ["digital"] });
  assert.equal(released.status, 200, JSON.stringify(released.json));
  assert.equal(released.json.roll.total, 4);
  assert.equal(released.json.roll.success, false);
  assert.doesNotMatch(released.json.roll.detail, /physical/);
});

// ---- the dice tray ----

await test("a manual roll is the caller's own, and its total is the server's", async () => {
  const digital = await table("digital_only");
  const { world, who, params } = digital;
  world.signIn(who.player);
  world.dice(13);
  const aimed = await call(
    route.rolls,
    "POST",
    { expression: "1d20", total: 20, characterId: who.otherSheet.id, kind: "saving_throw", dc: 5, success: true },
    params,
  );
  assert.equal(aimed.status, 201);
  assert.equal(aimed.json.roll.total, 13);
  assert.equal(aimed.json.roll.characterId, who.sheet.id);
  assert.equal(aimed.json.roll.kind, "custom");
  assert.equal(aimed.json.roll.dc, null);
  assert.equal(aimed.json.roll.success, null);
  assert.equal(aimed.json.roll.requestedBy, "player");

  world.dice(11);
  const check = await call(
    route.rolls,
    "POST",
    { kind: "skill_check", skill: "stealth", characterId: who.otherSheet.id },
    params,
  );
  assert.equal(check.json.roll.characterId, who.sheet.id);
  assert.equal(check.json.roll.total, 11);
  assert.equal(check.json.roll.dc, null);

  for (const body of [
    { expression: "1d1+19" },
    { expression: "1d20+" },
    { expression: "drop table" },
    { kind: "skill_check", skill: "lockpicking" },
    { kind: "saving_throw" },
    { kind: "attack" },
  ]) {
    assert.equal((await call(route.rolls, "POST", body, params)).status, 400, JSON.stringify(body));
  }
});

await test("a seat without a character rolls loose dice and no checks", async () => {
  const digital = await table("digital_only");
  digital.world.signIn(digital.who.bare);
  digital.world.dice(3);
  const loose = await call(route.rolls, "POST", { expression: "1d6" }, digital.params);
  assert.equal(loose.status, 201);
  assert.equal(loose.json.roll.characterId, null);
  const check = await call(route.rolls, "POST", { kind: "ability_check", ability: "str" }, digital.params);
  assert.equal(check.status, 400);
  digital.world.signIn(digital.who.stranger);
  assert.equal((await call(route.rolls, "POST", { expression: "1d6" }, digital.params)).status, 404);
});

await test("the dice tray throws dice: a bare number or an impossible bonus is not a roll", async () => {
  const digital = await table("digital_only");
  digital.world.signIn(digital.who.player);
  const before = digital.stored();
  for (const expression of ["20", "10+10", "1d20+100", "1d4-31", "1d20+20+11"]) {
    const written = await call(route.rolls, "POST", { expression }, digital.params);
    assert.equal(written.status, 400, `"${expression}" was stored as a roll totalling ${written.json.roll?.total}`);
  }
  assert.equal(digital.stored(), before);
  // Dice with a bonus a sheet can hold are rolled as before.
  digital.world.dice(4, 2);
  const rolled = await call(route.rolls, "POST", { expression: "2d6+5" }, digital.params);
  assert.equal(rolled.status, 201);
  assert.equal(rolled.json.roll.total, 11);
  assert.equal(digital.stored(), before + 1);
});

await test("a secret roll from the tray is the roller's and the DM's, and a DM's secret roll is the DM's alone", async () => {
  const digital = await table("digital_only");
  const { world, who, params } = digital;
  const seenBy = async (user, id) => {
    world.signIn(user);
    const listed = await call(route.rolls, "GET", undefined, params);
    return listed.json.rolls.find((roll) => roll.id === id) ?? null;
  };

  world.signIn(who.player);
  world.dice(14);
  const mine = await call(route.rolls, "POST", { expression: "1d20+2", secret: true }, params);
  assert.equal(mine.status, 201, JSON.stringify(mine.json));
  assert.equal(mine.json.roll.visibility, "self");
  assert.equal(mine.json.roll.total, 16, "the roller is answered with the number");
  assert.equal(mine.json.roll.requestedBy, "player");
  for (const user of [who.player, who.dm, who.assistant]) {
    assert.equal((await seenBy(user, mine.json.roll.id))?.total, 16, `${user.username} reads the player's secret roll`);
  }
  for (const user of [who.other, who.lead, who.bare]) {
    assert.equal(await seenBy(user, mine.json.roll.id), null, `${user.username} was shown the player's secret roll`);
  }

  world.signIn(who.dm);
  world.dice(5);
  const screened = await call(route.rolls, "POST", { expression: "1d6", secret: true }, params);
  assert.equal(screened.status, 201, JSON.stringify(screened.json));
  assert.equal(screened.json.roll.visibility, "dm");
  assert.equal(screened.json.roll.requestedBy, "dm");
  assert.equal(screened.json.roll.characterId, null);
  for (const user of [who.dm, who.assistant]) {
    assert.equal((await seenBy(user, screened.json.roll.id))?.total, 5, `${user.username} reads the DM's secret roll`);
  }
  for (const user of [who.player, who.other, who.lead, who.bare]) {
    assert.equal(await seenBy(user, screened.json.roll.id), null, `${user.username} was shown the DM's secret roll`);
  }

  // A check off the sheet goes behind the screen the same way; without the
  // flag every roll is the table's, as it always was.
  world.signIn(who.player);
  world.dice(9);
  const check = await call(route.rolls, "POST", { kind: "skill_check", skill: "insight", secret: true }, params);
  assert.equal(check.json.roll.visibility, "self");
  world.dice(9);
  const open = await call(route.rolls, "POST", { expression: "1d20" }, params);
  assert.equal(open.json.roll.visibility, "public");
  assert.equal((await seenBy(who.other, open.json.roll.id))?.total, 9);
  assert.equal((await call(route.rolls, "POST", { expression: "1d20", secret: "yes" }, params)).status, 400);
});

await test("a roll the DM asks for behind the screen stays behind it when the player answers with real dice", async () => {
  for (const visibility of ["dm", "self", "blind"]) {
    const real = await table("real_allowed");
    const { world, who, params } = real;
    assert.equal((await real.prefer({ useRealDice: true })).status, 200);
    const parked = await real.ask({ visibility });
    assert.equal(parked.result.parked, true, parked.error);
    const [pending] = real.open();
    assert.equal(pending.visibility, visibility);
    const answered = await real.answer(pending.id, { dice: [12] });
    assert.equal(answered.status, 200, JSON.stringify(answered.json));
    const landed = listRecentRolls(world.campaignId, 1)[0];
    assert.equal(landed.visibility, visibility, `${visibility}: the answer was stored as ${landed.visibility}`);
    world.signIn(who.other);
    const listed = await call(route.rolls, "GET", undefined, params);
    const seen = listed.json.rolls.find((roll) => roll.id === landed.id) ?? null;
    assert.ok(seen === null || seen.total === null, `${visibility}: another player read ${seen?.total}`);
  }
});

first.close();
finish();
