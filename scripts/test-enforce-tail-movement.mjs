// Moving past other creatures and over rough ground on the battle map
// (src/lib/battlemap/movement.ts, passage.ts, the move route and move_token).
//
// The rules, from SRD 5.1:
//   - Moving Around Other Creatures: you can move through a nonhostile
//     creature's space, and through a hostile creature's space only if it is
//     at least two sizes larger or smaller than you; another creature's
//     space is difficult terrain, and you can't willingly end your move in
//     it.
//   - Halfling Nimbleness: you can move through the space of any creature
//     that is of a size larger than yours.
//   - Squeezing into a Smaller Space: a creature can squeeze through a space
//     large enough for a creature one size smaller; each foot costs one
//     extra, and while squeezing it has disadvantage on attack rolls and
//     Dexterity saves, and attack rolls against it have advantage.
//   - Climbing costs one extra foot per foot unless the creature has a
//     climbing speed; Second-Story Work (Thief 3): climbing costs no extra
//     movement.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-tail-movement");
const world = await openWorld({ campaign: { maxPlayers: 8 } });
const kit = await combatKit(world);

const runner = world.addHero({ class: "fighter", level: 5, proficiencies: TRAINED, speed: 30 });
const friend = world.addHero({ class: "fighter", level: 5, proficiencies: TRAINED, speed: 30 });
const halfling = world.addHero({ class: "rogue", race: "lightfoot_halfling", level: 5, proficiencies: TRAINED, speed: 25 });
const thief = world.addHero({ class: "rogue", subclass: "Thief", level: 5, proficiencies: TRAINED, speed: 30 });
for (const [hero, names] of [[halfling, ["Halfling Nimbleness"]], [thief, ["Second-Story Work"]]]) {
  const held = world.sheet(hero.id).features;
  const added = names.filter((name) => !held.some((feature) => feature.name === name));
  world.patch(hero.id, { features: [...held, ...added.map((name) => ({ name, description: "" }))] });
}
const heroes = [runner, friend, halfling, thief];

const moveRoute = await world.route("campaigns/[campaignId]/battle-map/move");
async function walk(hero, x, y) {
  world.signIn({ id: world.sheet(hero.id).userId });
  const response = await moveRoute.POST(
    new Request(`http://odm.test/api/campaigns/${world.campaignId}/battle-map/move`, {
      method: "POST",
      body: JSON.stringify({ x, y }),
    }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// A corridor one square wide along row 2, `mover` at its west end, everyone
// else parked far off.
async function corridor(mover, paint = []) {
  await kit.endFight();
  const heroFaces = Object.fromEntries(heroes.map((entry) => [entry.id, entry.id === mover.id ? 19 : 3]));
  await kit.fight(1, { heroFaces });
  const walls = [];
  for (let x = 0; x < 20; x += 1) {
    walls.push([x, 1, "#"], [x, 3, "#"]);
  }
  kit.openField([...walls, ...paint]);
  heroes.forEach((hero, index) => kit.place(hero.id, 18 - index * 2, 10));
  kit.place(mover.id, 2, 2);
  const [enemy] = world.enemies();
  kit.setEnemy(enemy.id, { maxHp: 400 });
  kit.place(enemy.id, 18, 14);
  for (const hero of heroes) {
    world.patch(hero.id, { conditions: [], conditionMeta: {} });
  }
  assert.equal(kit.current().characterId, mover.id);
  return enemy;
}

const at = (id) => [kit.token(id).x, kit.token(id).y];

// ---- through an ally ----

await test("A character walks through an ally's space, which costs double, and cannot stop in it.", async () => {
  await corridor(runner);
  kit.place(friend.id, 4, 2);
  assert.ok((await walk(runner, 4, 2)).status >= 400, "stopped in the ally's space");
  const through = await walk(runner, 5, 2);
  assert.equal(through.status, 200, JSON.stringify(through.body));
  assert.deepEqual(at(runner.id), [5, 2]);
  assert.equal(kit.token(runner.id).movedThisRound, 4, "the ally's square did not cost double");
});

// ---- hostile creatures ----

await test("A character walks through a hostile creature two sizes smaller, never through one a size apart.", async () => {
  const enemy = await corridor(runner);
  kit.place(enemy.id, 4, 2);
  kit.setEnemy(enemy.id, { stats: { size: "Small" } });
  assert.ok((await walk(runner, 5, 2)).status >= 400, "walked through a Small hostile");
  kit.setEnemy(enemy.id, { stats: { size: "Tiny" } });
  const through = await walk(runner, 5, 2);
  assert.equal(through.status, 200, JSON.stringify(through.body));
});

await test("Halfling Nimbleness: a halfling walks through the space of a hostile creature larger than it.", async () => {
  const enemy = await corridor(halfling);
  kit.place(enemy.id, 4, 2);
  kit.setEnemy(enemy.id, { stats: { size: "Medium" } });
  const through = await walk(halfling, 5, 2);
  assert.equal(through.status, 200, JSON.stringify(through.body));
  const other = await corridor(runner);
  kit.place(other.id, 4, 2);
  kit.setEnemy(other.id, { stats: { size: "Medium" } });
  assert.ok((await walk(runner, 5, 2)).status >= 400, "a human walked through a Medium hostile");
});

// ---- squeezing ----

await test("A Large creature squeezes down a corridor one square wide at double cost, and is squeezing there.", async () => {
  const enemy = await corridor(runner);
  kit.place(runner.id, 10, 10);
  kit.setEnemy(enemy.id, { stats: { size: "Large", speed: "40 ft." } });
  // The corridor opens at its west end onto open ground where the ogre
  // stands.
  const walls = [];
  for (let x = 2; x < 20; x += 1) {
    walls.push([x, 1, "#"], [x, 3, "#"]);
  }
  kit.openField(walls);
  kit.place(enemy.id, 0, 4);
  const out = await world.invoke("move_token", { tokenName: enemy.id, x: 3, y: 2 });
  assert.equal(out.ok, true, out.error);
  assert.deepEqual(at(enemy.id), [3, 2]);
  assert.ok(kit.enemy(enemy.id).conditions.includes("squeezing"), "no squeezing condition");
});

await test("Attack rolls against a squeezing creature have advantage.", async () => {
  const enemy = await corridor(runner);
  kit.setEnemy(enemy.id, { conditions: ["squeezing"] });
  kit.place(enemy.id, 3, 2);
  world.patch(runner.id, { equipment: [{ name: "Longsword", qty: 1 }] });
  const swing = await kit.swing(runner.id, enemy.id, [3, 15, 4]);
  assert.equal(swing.ok, true, swing.error);
  assert.equal(swing.toHit?.breakdown?.terms?.find((term) => term.sides === 20)?.dice?.length, 2);
});

// ---- climbing ----

await test("Climbing costs double for a character with no climbing speed, and nothing extra for a Thief with Second-Story Work.", async () => {
  const climb = [[3, 2, "^"], [4, 2, "^"], [5, 2, "^"]];
  await corridor(runner, climb);
  assert.ok((await walk(runner, 8, 2)).status >= 400, "climbed three squares at no extra cost");
  await corridor(thief, climb);
  const up = await walk(thief, 8, 2);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(kit.token(thief.id).movedThisRound, 6);
});

await kit.endFight();
world.close();
finish();
