// What every seat at the table is told, in what order, and what it is not
// told.
//
// The engine writes to the database and then publishes (src/lib/events.ts):
// a persisted event carries the campaign's sequence number, is stored in
// campaign_events for replay, and is fanned out to every open stream. The
// stream route sends every member the same events, so whatever must stay
// with one seat has to be left out when the event is made.
//
// The rules held:
//   every engine mutation publishes, with a sequence number strictly above
//   the last, and the sheet it publishes is the sheet as stored;
//   a refused call publishes nothing;
//   what is replayed from the log is what was sent live, in the same order;
//   calls made at the same moment on one sheet or one enemy lose no update,
//   and a counter never passes its maximum however many spend it at once;
//   a player is never sent an enemy's hit points, armor class or stat block,
//   the number on a roll made blind, or the words of a whisper to somebody
//   else (src/lib/dm/viewer.ts is where ODM states who sees what);
//   a roll made for the DM alone or for one player is sent to the seats that
//   may read it and to no other, and a player's notes go to their owner and
//   the DM seats only (src/lib/table-delivery.ts).
import assert from "node:assert/strict";
import { call, seats } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-sync");

// A row without the keys a comparison leaves out (the write stamp, ids).
const withoutKeys = (row, keys) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
const { listEventsSince, forEachEventSince, subscribe } = await import("../src/lib/events.ts");
const { latestSeq, allocateSeq } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { insertItemProposal } = await import("../src/lib/db/item-proposals.ts");
const { listOpenPendingRolls } = await import("../src/lib/db/dm-turns.ts");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");

const world = await openWorld({ gameSettings: { dicePolicy: "real_allowed", inventoryApprovals: true } });
const who = await seats(world);
const campaignId = world.campaignId;
const params = { campaignId };
const route = {
  campaign: await world.route("campaigns/[campaignId]"),
  encounter: await world.route("campaigns/[campaignId]/encounter"),
  whispers: await world.route("campaigns/[campaignId]/whispers"),
  proposal: await world.route("campaigns/[campaignId]/item-proposals/[proposalId]"),
  pending: await world.route("campaigns/[campaignId]/pending-rolls/[pendingRollId]"),
  me: await world.route("campaigns/[campaignId]/members/me"),
};

// Everything sent live, as the stream route would write it.
const live = [];
subscribe(campaignId, (chunk) => live.push(chunk));
const liveIds = () =>
  live.map((chunk) => /^id: (\d+)\n/.exec(chunk)?.[1]).filter(Boolean).map(Number);
const since = (seq) => listEventsSince(campaignId, seq, 5000);
const stored = (id) => {
  return withoutKeys(world.sheet(id), ["updatedAt"]);
};

world.patch(who.sheet.id, {
  gold: 50,
  equipment: [{ name: "Rope", qty: 1 }],
  class: "wizard",
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 },
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } },
    prepared: ["Magic Missile"], known: [], cantrips: [], spellbook: ["Magic Missile"],
  },
});
const hero = who.sheet.id;
const fighter = who.otherSheet.id;

async function noMap() {
  const encounter = world.encounter();
  const db = getDatabase();
  db.prepare("DELETE FROM battle_tokens WHERE map_id IN (SELECT id FROM battle_maps WHERE encounter_id = ?)").run(encounter.id);
  db.prepare("DELETE FROM battle_maps WHERE encounter_id = ?").run(encounter.id);
  db.prepare("UPDATE encounter_enemies SET max_hp = 100, current_hp = 100 WHERE encounter_id = ?").run(encounter.id);
}

// ---- every mutation is announced ----

// Each call, and the event that must follow it.
const ANNOUNCED = [
  ["apply_damage", { characterId: hero, amount: 3 }, "sheet_updated"],
  ["heal", { characterId: hero, amount: 1 }, "sheet_updated"],
  ["heal", { characterId: hero, amount: 4, temp: true }, "sheet_updated"],
  ["award_xp", { characterIds: [hero], amount: 10 }, "sheet_updated"],
  ["modify_gold", { characterId: hero, delta: 5 }, "sheet_updated"],
  ["grant_item", { characterId: hero, name: "Torch" }, "sheet_updated"],
  ["remove_item", { characterId: hero, name: "Torch" }, "sheet_updated"],
  ["set_condition", { characterId: hero, condition: "poisoned", rounds: 3 }, "sheet_updated"],
  ["clear_condition", { characterId: hero, condition: "poisoned" }, "sheet_updated"],
  ["use_spell_slot", { characterId: hero, level: 1, spell: "Magic Missile" }, "sheet_updated"],
  // The console's form calls the spell `name`; the handler reads `spell`.
  ["learn_spell", { characterId: hero, action: "add", spell: "Shield", name: "Shield" }, "sheet_updated"],
  ["use_resource", { characterId: fighter, resource: "second_wind" }, "sheet_updated"],
  ["take_rest", { kind: "short" }, "sheet_updated"],
  ["request_roll", { characterId: fighter, kind: "ability_check", ability: "str", dc: 12, reason: "a door" }, "roll_result"],
  ["start_encounter", { enemies: [{ monster: "goblin", count: 1 }] }, "encounter_updated"],
];

await test("every mutation publishes, in order, the sheet as it is stored", async () => {
  for (const [name, args, expected] of ANNOUNCED) {
    const from = latestSeq(campaignId);
    world.dice(12);
    const result = await world.invoke(name, args);
    world.clearDice();
    assert.equal(result.ok, true, `${name}: ${result.error}`);
    const events = since(from);
    assert.ok(events.some((event) => event.type === expected), `${name} published ${events.map((event) => event.type).join(", ") || "nothing"}`);
    assert.ok(events.every((event) => event.seq > from), name);
    // Each sheet announced is the sheet a fresh read returns.
    const last = new Map();
    for (const event of events.filter((entry) => entry.type === "sheet_updated")) {
      last.set(event.payload.sheet.id, event.payload.sheet);
    }
    for (const [id, sheet] of last) {
      const sent = withoutKeys(sheet, ["updatedAt"]);
      assert.deepEqual(sent, JSON.parse(JSON.stringify(stored(id))), `${name}: the sheet sent is not the sheet stored`);
    }
  }
  await noMap();
  const [enemy] = world.enemies();
  for (const [name, args] of [
    ["damage_enemy", { enemyId: enemy.id, amount: 2 }],
    ["end_encounter", { outcome: "victory" }],
  ]) {
    const from = latestSeq(campaignId);
    assert.equal((await world.invoke(name, args)).ok, true, name);
    assert.ok(since(from).some((event) => event.type === "encounter_updated"), name);
  }
});

await test("sequence numbers rise strictly, and the replay is what was sent live", () => {
  const events = since(0);
  assert.ok(events.length > 30);
  for (let index = 1; index < events.length; index += 1) {
    assert.ok(events[index].seq > events[index - 1].seq, `${events[index].seq} after ${events[index - 1].seq}`);
  }
  // A listener who opened the stream at the start heard every one, in order.
  assert.deepEqual(liveIds(), events.map((event) => event.seq));
});

await test("a refused call publishes nothing", async () => {
  const refused = [
    ["apply_damage", { characterId: hero, amount: -5 }],
    ["apply_damage", { characterId: "nobody", amount: 5 }],
    ["use_spell_slot", { characterId: fighter, level: 1, spell: "Magic Missile" }],
    ["use_spell_slot", { characterId: hero, level: 9, spell: "Magic Missile" }],
    ["remove_item", { characterId: hero, name: "Holy Avenger" }],
    ["damage_enemy", { enemyId: "nothing", amount: 5 }],
    ["update_sheet", { characterId: hero, field: "level", value: 9, level: 9, reason: "please" }],
  ];
  for (const [name, args] of refused) {
    const from = latestSeq(campaignId);
    const sent = live.length;
    const result = await world.invoke(name, args);
    assert.equal(result.ok, false, name);
    assert.deepEqual(since(from), [], `${name} published after refusing`);
    assert.equal(live.length, sent, name);
  }
});

// ---- at the same moment ----

await test("calls made together on one sheet and one enemy lose no update", async () => {
  await world.beginFight([{ monster: "goblin", count: 1 }]);
  await noMap();
  const [enemy] = world.enemies();
  world.patch(hero, { currentHp: 30, tempHp: 0, gold: 50, xp: 0, equipment: [] });
  const from = latestSeq(campaignId);
  const many = (count, name, args) => Array.from({ length: count }, () => world.invoke(name, args));
  const results = await Promise.all([
    ...many(10, "apply_damage", { characterId: hero, amount: 1 }),
    ...many(10, "modify_gold", { characterId: hero, delta: 1 }),
    ...many(10, "award_xp", { characterIds: [hero], amount: 1 }),
    ...many(10, "grant_item", { characterId: hero, name: "Arrow", qty: 1 }),
    ...many(10, "damage_enemy", { enemyId: enemy.id, amount: 1 }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 50);
  const after = world.sheet(hero);
  assert.equal(after.currentHp, 20);
  assert.equal(after.gold, 60);
  assert.equal(after.xp, 10);
  assert.deepEqual(after.equipment.map((item) => [item.name, item.qty]), [["Arrow", 10]]);
  assert.equal(world.enemies()[0].currentHp, 90);
  const seqs = since(from).map((event) => event.seq);
  assert.equal(new Set(seqs).size, seqs.length);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  await world.invoke("end_encounter", { outcome: "victory" });
});

await test("a counter spent by many at once never passes its maximum", async () => {
  world.patch(hero, {
    spellcasting: { ...world.sheet(hero).spellcasting, slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } } },
  });
  await world.invoke("take_rest", { kind: "long" });
  const casts = await Promise.all(
    Array.from({ length: 7 }, () =>
      world.invoke("use_spell_slot", { characterId: hero, level: 1, spell: "Magic Missile" })),
  );
  assert.equal(casts.filter((result) => result.ok).length, 4);
  assert.deepEqual(world.sheet(hero).spellcasting.slots[1], { max: 4, used: 4 });

  world.dice(...new Array(5).fill(5));
  const winds = await Promise.all(
    Array.from({ length: 5 }, () => world.invoke("use_resource", { characterId: fighter, resource: "second_wind" })),
  );
  world.clearDice();
  assert.equal(winds.filter((result) => result.ok).length, 1);
  assert.deepEqual(world.sheet(fighter).resources.second_wind, { max: 1, used: 1 });
});

await test("an offer approved twice at once pays once, and a parked roll answered twice is one roll", async () => {
  world.patch(hero, { gold: 0 });
  const offer = insertItemProposal({
    campaignId, turnId: null, characterId: hero, userId: who.player.id, toolName: "modify_gold",
    argsJson: JSON.stringify({ characterId: hero, delta: 25, reason: "a purse" }),
    summary: "25 gold", reason: "a purse", seq: allocateSeq(campaignId),
  });
  world.signIn(who.player);
  const target = { campaignId, proposalId: offer.id };
  const answers = await Promise.all([1, 2, 3].map(() => call(route.proposal, "POST", { action: "approve" }, target)));
  assert.equal(answers.filter((answer) => answer.status === 200).length, 1, answers.map((answer) => answer.status).join(","));
  assert.equal(world.sheet(hero).gold, 25);

  assert.equal((await call(route.me, "PATCH", { useRealDice: true }, params)).status, 200);
  const parked = await world.invoke("request_roll", {
    characterId: hero, kind: "ability_check", ability: "str", dc: 10, reason: "a gate",
  });
  assert.equal(parked.result?.parked, true, JSON.stringify(parked));
  const [pending] = listOpenPendingRolls(campaignId);
  const rolls = listRecentRolls(campaignId, 100).length;
  world.signIn(who.player);
  const twice = await Promise.all(
    [18, 19, 20].map((face) => call(route.pending, "POST", { dice: [face] }, { campaignId, pendingRollId: pending.id })),
  );
  assert.equal(twice.filter((answer) => answer.status === 200).length, 1, twice.map((answer) => answer.status).join(","));
  assert.equal(listRecentRolls(campaignId, 100).length, rolls + 1);
  assert.equal((await call(route.me, "PATCH", { useRealDice: false }, params)).status, 200);
});

// ---- what a seat is not told ----

const ENEMY_NUMBERS = ["currentHp", "maxHp", "ac", "stats", "hp"];

await test("no event and no player's snapshot carries an enemy's numbers", async () => {
  const from = latestSeq(campaignId);
  const sent = live.length;
  await world.beginFight([{ monster: "goblin", count: 2 }]);
  await noMap();
  const [enemy] = world.enemies();
  await world.invoke("damage_enemy", { enemyId: enemy.id, amount: 40 });
  await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "prone", rounds: 2 });
  const updates = since(from).filter((event) => event.type === "encounter_updated");
  assert.ok(updates.length >= 2);
  for (const event of updates) {
    for (const shown of event.payload.encounter.enemies) {
      for (const key of ENEMY_NUMBERS) {
        assert.equal(shown[key], undefined, `an event carried the enemy's ${key}`);
      }
    }
  }
  for (const chunk of live.slice(sent).filter((entry) => entry.includes("event: encounter_updated"))) {
    assert.doesNotMatch(chunk, /"(currentHp|maxHp|ac|stats)":/);
  }
  for (const user of [who.player, who.lead, who.bare]) {
    world.signIn(user);
    for (const mod of [route.campaign, route.encounter]) {
      const seen = await call(mod, "GET", undefined, params);
      assert.equal(seen.status, 200);
      for (const shown of seen.json.encounter.enemies) {
        for (const key of ENEMY_NUMBERS) {
          assert.equal(shown[key], undefined, `${user.username} was sent the enemy's ${key}`);
        }
      }
    }
  }
  for (const user of [who.dm, who.assistant]) {
    world.signIn(user);
    const seen = await call(route.encounter, "GET", undefined, params);
    assert.equal(seen.json.encounter.enemies[0].currentHp, 60);
    assert.equal(typeof seen.json.encounter.enemies[0].ac, "number");
  }
  await world.invoke("end_encounter", { outcome: "victory" });
});

// A roll made where the table cannot read it, and who is shown its number.
// The roll is found in the rolls table: a roll made for one seat is not in
// the table's log at all.
async function rolled(visibility) {
  const from = latestSeq(campaignId);
  world.dice(17);
  const result = await world.invoke("request_roll", {
    characterId: fighter, kind: "ability_check", ability: "wis", dc: 15, reason: `a ${visibility} look`, visibility,
  });
  world.clearDice();
  assert.equal(result.ok, true, result.error);
  const events = since(from).filter((event) => event.type === "roll_result");
  const made = listRecentRolls(campaignId, 1)[0];
  assert.equal(made.visibility, visibility);
  const shownTo = async (user) => {
    world.signIn(user);
    const snapshot = await call(route.campaign, "GET", undefined, params);
    return snapshot.json.rolls.find((roll) => roll.id === made.id) ?? null;
  };
  return { events, shownTo, made, from };
}

await test("a roll made blind, for the DM or for one player keeps its number from everyone else", async () => {
  for (const visibility of ["blind", "dm", "self"]) {
    const { events, shownTo } = await rolled(visibility);
    for (const event of events) {
      const roll = event.payload.roll;
      assert.equal(roll.total, null, `${visibility}: the event carried the total`);
      assert.equal(roll.breakdown, null, visibility);
      assert.equal(roll.success, null, visibility);
      assert.equal(roll.dc, null, visibility);
    }
    // The player who was NOT rolled for, and a seat with no character.
    for (const user of [who.player, who.bare]) {
      const seen = await shownTo(user);
      assert.ok(seen === null || seen.total === null, `${visibility}: ${user.username} read ${seen?.total}`);
      if (visibility !== "blind") {
        assert.equal(seen, null, `${visibility}: ${user.username} was shown the roll`);
      }
    }
    for (const user of [who.dm, who.assistant]) {
      const seen = await shownTo(user);
      assert.equal(seen?.total, 17, `${visibility}: the DM seat reads the roll`);
    }
    const own = await shownTo(who.other);
    assert.equal(own?.total ?? null, visibility === "self" ? 17 : null, `${visibility}: the roller`);
  }
  assert.equal((await world.invoke("request_roll", {
    characterId: fighter, kind: "ability_check", ability: "wis", reason: "x", visibility: "hidden",
  })).ok, false);
});

await test(
  "a roll made for the DM alone or for one player alone is not announced to the other seats",
  async () => {
    for (const visibility of ["dm", "self"]) {
      const { events } = await rolled(visibility);
      assert.deepEqual(
        events.map((event) => `${event.payload.roll.kind} for ${event.payload.roll.characterId === fighter ? "the fighter" : "someone"}`),
        [],
        `a roll with visibility "${visibility}" was published to every seat`,
      );
    }
  },
);

await test("a whisper's words go to the seat it was whispered to", async () => {
  const from = latestSeq(campaignId);
  const sent = live.length;
  const words = "the innkeeper is the cultist";
  const result = await world.invoke("send_whisper", { characterIds: [hero], message: words, reason: "insight" });
  assert.equal(result.ok, true, result.error);
  assert.ok(!JSON.stringify(since(from)).includes(words), "the log holds the whisper");
  assert.ok(!live.slice(sent).join("").includes(words), "the stream carried the whisper");
  for (const user of [who.other, who.lead, who.bare]) {
    world.signIn(user);
    const theirs = await call(route.whispers, "GET", undefined, params);
    const snapshot = await call(route.campaign, "GET", undefined, params);
    assert.ok(!JSON.stringify(theirs.json).includes(words), `${user.username} read the whisper`);
    assert.ok(!JSON.stringify(snapshot.json).includes(words), `${user.username}'s snapshot holds the whisper`);
  }
  world.signIn(who.player);
  const mine = await call(route.whispers, "GET", undefined, params);
  assert.ok(JSON.stringify(mine.json).includes(words));
});

await test(
  "a player's notes are in no event and in no other player's snapshot",
  async () => {
    const secret = "my character is the traitor";
    world.signIn(who.player);
    const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
    const from = latestSeq(campaignId);
    assert.equal((await call(sheetRoute, "PATCH", { notes: secret }, params)).status, 200);
    await world.invoke("modify_gold", { characterId: hero, delta: 1 });
    world.signIn(who.other);
    const snapshot = await call(route.campaign, "GET", undefined, params);
    const leaks = [
      JSON.stringify(since(from)).includes(secret) ? "the event log" : "",
      JSON.stringify(snapshot.json).includes(secret) ? "another player's snapshot" : "",
    ].filter(Boolean);
    world.patch(hero, { notes: "" });
    assert.deepEqual(leaks, [], `the notes were in ${leaks.join(" and ")}`);
  },
);

// A listener as the stream route registers it: the member's id rides along.
function listen(user) {
  const heard = [];
  const stop = subscribe(campaignId, (chunk) => heard.push(chunk), user.id);
  return { heard, stop, text: () => heard.filter((chunk) => !chunk.startsWith("event: presence")).join("") };
}

await test("a secret roll reaches the seats that may read it, with its number, live and on replay", async () => {
  for (const visibility of ["dm", "self"]) {
    const ears = {
      dm: listen(who.dm), assistant: listen(who.assistant), roller: listen(who.other),
      player: listen(who.player), bare: listen(who.bare),
    };
    const { made, from } = await rolled(visibility);
    for (const stream of Object.values(ears)) {
      stream.stop();
    }
    for (const seat of ["dm", "assistant"]) {
      assert.match(ears[seat].text(), new RegExp(`"id":"${made.id}"`), `${visibility}: the ${seat} seat heard nothing`);
      assert.match(ears[seat].text(), /"total":17/, `${visibility}: the ${seat} seat was sent no number`);
    }
    for (const seat of ["player", "bare"]) {
      assert.ok(!ears[seat].text().includes(made.id), `${visibility}: ${seat} was told of the roll`);
    }
    assert.equal(ears.roller.text().includes(made.id), visibility === "self", `${visibility}: the roller`);

    const replayed = (user) => {
      const events = [];
      forEachEventSince(campaignId, from, (event) => events.push(event), 500, user.id);
      return events.filter((event) => event.type === "roll_result" && event.payload.roll.id === made.id);
    };
    assert.equal(replayed(who.dm)[0]?.payload.roll.total, 17, visibility);
    assert.deepEqual(replayed(who.player), [], visibility);
    assert.equal(replayed(who.other).length, visibility === "self" ? 1 : 0, visibility);
  }
});

await test("the owner and the DM seats are sent the notes; the lead and the other players are not", async () => {
  const secret = "the map is sewn into my cloak";
  world.signIn(who.player);
  const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
  assert.equal((await call(sheetRoute, "PATCH", { notes: secret }, params)).status, 200);
  const ears = {
    owner: listen(who.player), dm: listen(who.dm), assistant: listen(who.assistant),
    other: listen(who.other), lead: listen(who.lead), bare: listen(who.bare),
  };
  const from = latestSeq(campaignId);
  assert.equal((await world.invoke("modify_gold", { characterId: hero, delta: 1 })).ok, true);
  for (const stream of Object.values(ears)) {
    stream.stop();
  }
  for (const [seat, stream] of Object.entries(ears)) {
    assert.match(stream.text(), /event: sheet_updated/, `${seat} heard no sheet`);
    assert.equal(stream.text().includes(secret), ["owner", "dm", "assistant"].includes(seat), `${seat}, live`);
  }
  for (const [user, reads] of [[who.player, true], [who.dm, true], [who.other, false], [who.lead, false]]) {
    const events = [];
    forEachEventSince(campaignId, from, (event) => events.push(event), 500, user.id);
    assert.equal(JSON.stringify(events).includes(secret), reads, `${user.username}, replayed`);
    world.signIn(user);
    const snapshot = await call(route.campaign, "GET", undefined, params);
    assert.equal(JSON.stringify(snapshot.json).includes(secret), reads, `${user.username}, snapshot`);
    // Nothing else about the sheet is kept back.
    const sent = snapshot.json.sheets.find((sheet) => sheet.id === hero);
    const rest = withoutKeys(sent, ["updatedAt", "notes"]);
    const whole = withoutKeys(JSON.parse(JSON.stringify(stored(hero))), ["notes"]);
    assert.deepEqual(rest, whole);
  }
  world.patch(hero, { notes: "" });
});

world.close();
finish();
