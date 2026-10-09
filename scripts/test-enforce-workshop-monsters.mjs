// A monster built in the workshop is fought with every number its block
// gives, the same as a published one (SRD 5.1, Monsters: Statistics,
// Actions, Recharge, Legendary Actions, Spellcasting). The workshop's
// bestiary used to keep only the six numbers and each attack's name, bonus,
// dice and type: a dragon copied from the books lost its breath's DC and
// recharge, a ghoul its paralysing claws, a mage its slots, a troll its
// regeneration, an owlbear its Multiattack routine, and every Large or
// Huge creature became Medium. Each rule here goes through the routes a DM
// uses (the bestiary's POST and GET) and the fight a table runs.
import assert from "node:assert/strict";
import { call } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { monsterKit, ROWS } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-workshop-monsters");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const rolls = await import("../src/lib/db/rolls.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");
const { borrowInto, borrowParts } = await import("../src/lib/bestiary/borrow.ts");
const { blankDraft } = await import("../src/lib/bestiary/monster-draft.ts");
const route = await world.route("campaigns/[campaignId]/dm/bestiary");
const params = { campaignId: world.campaignId };

const tank = world.addHero({
  name: "Tank", class: "fighter", level: 5, abilities: { str: 16 }, proficiencies: TRAINED,
  maxHp: 300, ac: 10, acOverride: true,
});

// The stats with sizes in one case: the pack prints "large", the workshop
// "Large", and every reader of a size lowers it first (statblock.ts sizeRank).
function comparable(stats) {
  return JSON.parse(
    JSON.stringify(stats, (key, value) => ((key === "size" || key === "maxSize") && typeof value === "string" ? value.toLowerCase() : value)),
  );
}

// The bestiary is the DM seat's: the owner takes it for the call, as a
// workshop's owner always holds it, and the table goes back to the AI DM
// the fight tools below are run as.
async function asDm(run) {
  campaigns.setDmMode(world.campaignId, "human", world.owner.id);
  world.signIn(world.owner);
  try {
    return await run();
  } finally {
    campaigns.setDmMode(world.campaignId, "ai", world.owner.id);
  }
}

async function build(name, stats) {
  const made = await asDm(() => call(route, "POST", { from: "draft", draft: { name, ...stats }, desc: "" }, params));
  assert.equal(made.status, 201, JSON.stringify(made.json));
  return made.json.monster;
}

async function listed(id) {
  const out = await asDm(() => call(route, "GET", undefined, params, `http://test/?q=`));
  return out.json.monsters.find((monster) => monster.id === id);
}

async function spawn(id) {
  await kit.endFight();
  world.patch(tank.id, { currentHp: 300, conditions: [], conditionMeta: {} });
  await world.beginFight([{ monster: `homebrew:${id}`, count: 1 }], { heroFaces: { [tank.id]: 19 } });
  kit.openField();
  const [enemy] = world.enemies();
  kit.place(tank.id, 5, 5);
  kit.place(enemy.id, 5, 6);
  kit.freshRound();
  return enemy;
}

const lastSave = () => rolls.listRecentRolls(world.campaignId, 20).filter((roll) => roll.kind === "saving_throw").at(-1);

await test("Every SRD block saved in the bestiary and read back is the block the engine reads from the book.", async () => {
  for (const [key, row] of Object.entries(ROWS)) {
    const published = mk.parse(row);
    const monster = await build(`${row.name} copy`, published);
    const back = (await listed(monster.id)).draft.stats;
    assert.deepEqual(comparable(back), comparable(published), `${key} changed on the way through the workshop`);
  }
});

await test("A renamed copy of a dragon breathes with its own DC, dice and recharge, whatever the call sends.", async () => {
  const dragon = mk.parse(ROWS.adultRedDragon);
  // Rated low so the encounter budget lets one fight a level-5 fighter; the
  // rating changes no number the block carries.
  const monster = await build("Cinder Tyrant", { ...dragon, cr: 1 });
  const enemy = await spawn(monster.id);
  assert.equal(enemy.stats.size.toLowerCase(), "huge", "the copy shrank");
  assert.ok(enemy.stats.routines?.length, "the copy lost its Multiattack routine");
  const bite = enemy.stats.attacks.find((attack) => attack.name === "Bite");
  assert.equal(bite.reach, 10);
  assert.deepEqual(bite.riders, [{ dice: "2d6", type: "fire" }]);
  const out = await mk.forced([...new Array(18).fill(1), 1], () =>
    world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: enemy.id, ability: "Fire Breath", damage: "1d6", saveAbility: "str", dc: 5 }),
  );
  assert.equal(out.ok, true, out.error);
  assert.equal(out.result.dc, 21);
  assert.equal(out.result.saveAbility, "dex");
  assert.equal(out.rolled.filter((die) => die.sides === 6).length, 18, "the breath was not the block's 18d6");
  kit.freshRound();
  const again = await mk.forced([...new Array(18).fill(1), 1], () =>
    world.invoke("aoe_damage", { characterIds: [tank.id], casterEnemyId: enemy.id, ability: "Fire Breath", damage: "1d6", saveAbility: "dex", dc: 21 }),
  );
  assert.equal(again.ok, false, "a spent Recharge 5-6 breath came back without a recharge roll");
});

await test("A spider's bite copied into the workshop still poisons on a failed save, at its own DC.", async () => {
  const monster = await build("Webweaver", mk.parse(ROWS.giantSpider));
  const enemy = await spawn(monster.id);
  const bite = enemy.stats.attacks.find((attack) => attack.name === "Bite");
  assert.equal(bite.onHit?.save, "con");
  assert.equal(bite.onHit?.dc, 11);
  const hit = await mk.forced([15, 3, 1, 4, 4], () => world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: tank.id, attackName: "Bite" }));
  assert.equal(hit.ok, true, hit.error);
  const save = lastSave();
  assert.equal(save?.dc, 11, "the bite's save was not the block's DC 11");
});

await test("A part borrowed from a published monster lands whole on a hand-built one and survives its save.", async () => {
  const parts = borrowParts(mk.parse(ROWS.adultRedDragon));
  const breath = parts.find((part) => part.kind === "ability" && part.ability.name === "Fire Breath");
  assert.ok(breath, "the dragon's breath was not offered");
  assert.equal(breath.ability.dc, 21);
  assert.ok(breath.line, "the breath's trait line was not offered with it");
  const bite = parts.find((part) => part.kind === "attack" && part.attack.name === "Bite");
  let draft = { ...blankDraft(), name: "Ash Wyrmling" };
  draft = borrowInto(borrowInto(draft, breath), bite);
  const monster = await build(draft.name, draft.stats);
  const back = (await listed(monster.id)).draft.stats;
  assert.equal(back.specials?.find((ability) => ability.name === "Fire Breath")?.dc, 21);
  assert.equal(back.specials?.find((ability) => ability.name === "Fire Breath")?.recharge, 5);
  assert.deepEqual(back.attacks.find((attack) => attack.name === "Bite")?.riders, [{ dice: "2d6", type: "fire" }]);
});

await test("A block's numbers that the dice engine cannot roll are refused at the bestiary, not mid-fight.", async () => {
  const bad = await asDm(() => call(
    route,
    "POST",
    { from: "draft", draft: { name: "Glitch", ...mk.parse(ROWS.wolf), specials: [{ name: "Howl", damage: "banana" }] }, desc: "" },
    params,
  ));
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Howl/);
  const rider = await asDm(() => call(
    route,
    "POST",
    {
      from: "draft",
      draft: { name: "Glitch", ...mk.parse(ROWS.wolf), attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing", riders: [{ dice: "1d999x", type: "fire" }] }] },
      desc: "",
    },
    params,
  ));
  assert.equal(rider.status, 400);
});

finish();
