// The player's own named roll (POST /rolls with a kind) is resolved the way
// the DM's request_roll resolves it, through resolveRollExpression and the
// same extras (table function audit 2026-10-26, T08): a lasting effect's
// bonus and its advantage, a condition's disadvantage or automatic failure,
// exhaustion, Bless and Guidance, a paladin's aura, and the held die a roll
// spends. Loose dice from the tray stay exactly the dice asked for, and a
// roll answers and is seen as it always was. The same d20 faces are forced
// down both paths and the stored rolls compared.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { call } from "./lib/enforce-campaign.mjs";

const { test, finish } = suite("test-enforce-named-rolls");
const { listRecentRolls } = await import("../src/lib/db/rolls.ts");

// A human-run table, a player and their fighter of 10s (every check and
// save +0), and the two ways to roll for it.
async function table() {
  const world = await openWorld({ gameSettings: { dmMode: "human" } });
  const player = world.addUser("roller");
  const hero = world.addHero({ user: player, name: "Roller" });
  const rolls = await world.route("campaigns/[campaignId]/rolls");
  const params = { campaignId: world.campaignId };
  const stored = () => listRecentRolls(world.campaignId, 1000).length;
  // The player's own roll on these faces; `left` is how many it did not
  // take, so one d20 left of two queued means one d20 was thrown.
  async function mine(body, faces) {
    world.clearDice();
    world.dice(...faces);
    world.signIn(player);
    const out = await call(rolls, "POST", { characterId: hero.id, ...body }, params);
    return { ...out, left: world.clearDice() };
  }
  // The DM's request_roll for the same roll on the same faces, and its row.
  async function theirs(body, faces) {
    world.clearDice();
    world.dice(...faces);
    const out = await world.invoke("request_roll", { characterId: hero.id, reason: "the same roll", ...body });
    const left = world.clearDice();
    assert.equal(out.ok, true, out.error);
    return { result: out.result, left, roll: out.result.autoFailed ? null : listRecentRolls(world.campaignId, 1)[0] };
  }
  // Both, agreeing on the number, the expression the card prints and the
  // dice thrown.
  async function agree(body, faces, total) {
    const own = await mine(body, faces);
    assert.equal(own.status, 201, JSON.stringify(own.json));
    const asked = await theirs(body, faces);
    assert.equal(own.json.roll.total, total, `${JSON.stringify(body)}: the player's own roll`);
    assert.equal(asked.result.total, total, `${JSON.stringify(body)}: the DM's request`);
    assert.equal(own.json.roll.expression, asked.roll.expression);
    assert.equal(own.left, asked.left);
    return own;
  }
  return { world, hero, stored, mine, theirs, agree };
}

await test("a lasting effect's bonus rides the player's own check as it rides the DM's", async () => {
  const t = await table();
  const set = await t.world.invoke("set_effect", { characterId: t.hero.id, name: "Shrine's Blessing", modifiers: [{ field: "check", mode: "add", value: 5 }], visible: true });
  assert.equal(set.ok, true, set.error);
  const own = await t.agree({ kind: "skill_check", skill: "athletics" }, [10], 15);
  assert.equal(own.json.roll.expression, "1d20+5");
  await t.agree({ kind: "ability_check", ability: "str" }, [10], 15);
  await t.agree({ kind: "saving_throw", ability: "str" }, [10], 10);
});

await test("a save effect, Bless and a paladin's aura ride the player's own save", async () => {
  const t = await table();
  await t.world.invoke("set_effect", { characterId: t.hero.id, name: "Warding Charm", modifiers: [{ field: "save", mode: "add", value: 2 }], visible: true });
  await t.agree({ kind: "saving_throw", ability: "wis" }, [10], 12);
  t.world.patch(t.hero.id, { conditions: ["blessed"] });
  await t.agree({ kind: "saving_throw", ability: "wis" }, [10, 3], 15);
  t.world.patch(t.hero.id, { conditions: [] });
  // Off the board the party stands together, so the paladin covers them (aura.ts).
  t.world.addHero({ class: "paladin", level: 6, abilities: { cha: 16 }, features: [{ name: "Aura of Protection", source: "class", classId: "paladin" }] });
  await t.agree({ kind: "saving_throw", ability: "wis" }, [10], 15);
});

await test("advantage and disadvantage come from every source and cancel as the engine cancels them", async () => {
  const t = await table();
  await t.world.invoke("set_effect", { characterId: t.hero.id, name: "Keen Eye", modifiers: [{ field: "check", mode: "advantage" }], visible: true });
  assert.match((await t.agree({ kind: "skill_check", skill: "perception" }, [4, 15], 15)).json.roll.expression, /^2d20kh1/);
  await t.world.invoke("clear_effect", { characterId: t.hero.id, name: "Keen Eye" });
  t.world.patch(t.hero.id, { conditions: ["poisoned"] });
  assert.match((await t.agree({ kind: "ability_check", ability: "dex" }, [15, 4], 4)).json.roll.expression, /^2d20kl1/);
  // The player's advantage is one source among the rest: with poisoned they cancel.
  assert.equal((await t.agree({ kind: "ability_check", ability: "dex", advantage: "advantage" }, [7, 20], 7)).left, 1);
  t.world.patch(t.hero.id, { conditions: [], exhaustion: 1 });
  await t.agree({ kind: "skill_check", skill: "stealth" }, [15, 4], 4);
});

await test("a condition that decides a save outright throws no dice and logs no roll", async () => {
  const t = await table();
  t.world.patch(t.hero.id, { conditions: ["paralyzed"] });
  const before = t.stored();
  const own = await t.mine({ kind: "saving_throw", ability: "dex" }, [20]);
  assert.equal(own.status, 409, JSON.stringify(own.json));
  assert.equal(own.json.autoFailed, true);
  assert.match(own.json.error, /automatically fails/);
  assert.equal(own.left, 1, "no die was thrown");
  assert.equal(t.stored(), before, "nothing was logged");
  assert.equal((await t.theirs({ kind: "saving_throw", ability: "dex" }, [20])).result.autoFailed, true);
  await t.agree({ kind: "saving_throw", ability: "wis" }, [12], 12);
});

await test("a held die rides the player's own roll and is spent by it", async () => {
  const t = await table();
  t.world.patch(t.hero.id, { conditions: ["guidance"] });
  assert.equal((await t.mine({ kind: "skill_check", skill: "investigation" }, [10, 3])).json.roll.total, 13);
  assert.ok(!t.world.sheet(t.hero.id).conditions.includes("guidance"), "Guidance ends with the check it helped");
  assert.equal((await t.theirs({ kind: "skill_check", skill: "investigation" }, [10, 3])).result.total, 10, "and helps no second one");
  t.world.patch(t.hero.id, { conditions: ["bardic inspiration (d6)"] });
  assert.equal((await t.mine({ kind: "saving_throw", ability: "con" }, [10, 4])).json.roll.total, 14);
  assert.deepEqual(t.world.sheet(t.hero.id).conditions, []);
});

await test("a hidden effect counts in the number and is named nowhere in the answer", async () => {
  const t = await table();
  const secret = "HIDDEN-HEX-T08";
  await t.world.invoke("set_effect", { characterId: t.hero.id, name: secret, modifiers: [{ field: "check", mode: "add", value: -3 }], visible: false });
  const own = await t.agree({ kind: "ability_check", ability: "str" }, [12], 9);
  assert.equal(JSON.stringify(own.json).includes(secret), false);
});

await test("the dead make no rolls from their own sheet either", async () => {
  const t = await table();
  t.world.patch(t.hero.id, { currentHp: 0, deathSaves: { successes: 0, failures: 3, stable: false, dead: true } });
  const before = t.stored();
  const own = await t.mine({ kind: "skill_check", skill: "athletics" }, [10]);
  assert.equal(own.status, 409);
  assert.equal(own.left, 1);
  assert.equal(t.stored(), before);
});

await test("loose dice are the dice asked for, whatever rides the sheet", async () => {
  const t = await table();
  await t.world.invoke("set_effect", { characterId: t.hero.id, name: "Shrine's Blessing", modifiers: [{ field: "check", mode: "add", value: 5 }, { field: "save", mode: "add", value: 5 }], visible: true });
  t.world.patch(t.hero.id, { conditions: ["poisoned", "blessed", "guidance"], exhaustion: 3 });
  const d20 = await t.mine({ expression: "1d20" }, [9, 20]);
  assert.equal(d20.status, 201);
  assert.equal(d20.json.roll.total, 9);
  assert.equal(d20.json.roll.expression, "1d20");
  assert.equal(d20.json.roll.kind, "custom");
  assert.equal(d20.left, 1);
  assert.equal((await t.mine({ expression: "2d6+5" }, [4, 2])).json.roll.total, 11);
  assert.ok(t.world.sheet(t.hero.id).conditions.includes("guidance"), "loose dice spend nothing");
});

await test("a named roll answers and is seen as it always was", async () => {
  const t = await table();
  await t.world.invoke("set_effect", { characterId: t.hero.id, name: "Shrine's Blessing", modifiers: [{ field: "check", mode: "add", value: 5 }], visible: true });
  const open = await t.mine({ kind: "skill_check", skill: "insight" }, [9]);
  assert.deepEqual(Object.keys(open.json), ["roll"]);
  assert.equal(open.json.roll.visibility, "public");
  assert.equal(open.json.roll.requestedBy, "player");
  assert.equal(open.json.roll.kind, "skill_check");
  assert.equal(open.json.roll.detail, "insight");
  assert.equal(open.json.roll.dc, null);
  assert.equal(open.json.roll.success, null);
  const hidden = await t.mine({ kind: "skill_check", skill: "insight", secret: true }, [9]);
  assert.equal(hidden.json.roll.visibility, "self");
  assert.equal(hidden.json.roll.total, 14);
  for (const body of [{ kind: "skill_check", skill: "lockpicking" }, { kind: "saving_throw" }, { kind: "initiative" }]) {
    assert.equal((await t.mine(body, [])).status, 400, JSON.stringify(body));
  }
});

await finish();
