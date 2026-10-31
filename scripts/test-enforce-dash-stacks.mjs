// Every Dash adds the creature's speed to the movement left this turn
// (SRD 5.1, Dash: "you gain extra movement for the current turn ... equal
// to your speed"). The action, a Cunning Action bonus action and Action
// Surge's extra action each count, so a fighter-rogue with 30 ft speed who
// takes all three moves up to 120 ft. The board's lit squares, the move
// route, the GM's GAME STATE line and take_action's own reply all read the
// same number (src/lib/battlemap/view.ts pcMoveBudget).
//
// The playtest this guards: a second Dash and an Action Surge Dash bought
// nothing, because the turn kept one "dashed" flag; the surge was spent and
// the character stayed short.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-enforce-dash-stacks");
const world = await openWorld();
const kit = await combatKit(world);
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { describeBudget } = await import("../src/lib/dm/action-budget.ts");

// Somebody to Dash to (issue #666), parked out of every walk's way.
const vesper = world.addHero({ name: "Vesper", abilities: { dex: 10 } });

// Action Surge from the fighter levels, Cunning Action from the rogue ones.
const krag = world.addHero({
  name: "Krag", class: "fighter", level: 5, abilities: { str: 16, dex: 12 }, proficiencies: TRAINED,
  speed: 30, maxHp: 47, ac: 19, acOverride: true,
  classes: [{ id: "fighter", subclass: "Champion", level: 3 }, { id: "rogue", subclass: "", level: 2 }],
  equipment: [{ name: "Longsword", qty: 1 }],
});

async function stage() {
  await kit.endFight();
  world.patch(krag.id, {
    currentHp: 47, conditions: [], conditionMeta: {},
    resources: { ...world.sheet(krag.id).resources, action_surge: { max: 1, used: 0 } },
  });
  await kit.fight(1, { heroFaces: { [krag.id]: 19 } });
  const [enemy] = world.enemies();
  kit.openField();
  kit.giveTurn(krag.id);
  kit.place(krag.id, 1, 1);
  // Far across the board, out of the way of every walk below.
  kit.place(enemy.id, 22, 14);
  kit.place(vesper.id, 1, 14);
  return enemy;
}

const view = () => buildPlayerMapView(world.campaignId, krag.userId);
const feetLeft = () => view().budgetLeft * 5;
const act = (action, args = {}) => world.invoke("take_action", { characterId: krag.id, action, ...args });

await test("The Dash action adds the speed once: 30 ft becomes 60 ft.", async () => {
  await stage();
  assert.equal(feetLeft(), 30);
  const dash = await act("dash");
  assert.equal(dash.ok, true, dash.error);
  assert.equal(feetLeft(), 60);
  assert.match(dash.result.applied, /Movement left this turn: 60 ft/);
});

await test("A Cunning Action Dash after the Dash action adds the speed again: 90 ft, not 60.", async () => {
  await stage();
  assert.equal((await act("dash")).ok, true);
  const bonus = await act("dash", { bonus: true });
  assert.equal(bonus.ok, true, bonus.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  assert.equal(feetLeft(), 90);
  assert.match(bonus.result.applied, /Movement left this turn: 90 ft/);
  assert.match(describeBudget(world.encounter().turnBudget), /3 times their speed/);
});

await test("Action Surge's extra action may Dash, and it adds the speed a third time: 120 ft.", async () => {
  await stage();
  assert.equal((await act("dash")).ok, true);
  assert.equal((await act("dash", { bonus: true })).ok, true);
  const surge = await world.invoke("use_resource", { characterId: krag.id, resource: "Action Surge" });
  assert.equal(surge.ok, true, surge.error);
  const third = await act("dash");
  assert.equal(third.ok, true, third.error);
  assert.equal(world.encounter().turnBudget.grantedActions, 0, "the surge's action was spent on the Dash");
  assert.equal(feetLeft(), 120, "the surge was spent and bought no movement");
  assert.match(third.result.applied, /Movement left this turn: 120 ft/);
});

await test("The move route lets the stacked Dashes be walked, and the walk is charged against them.", async () => {
  await stage();
  // 50 ft walked first, then the Dashes: 30 + 30 + 30 = 90 ft in all.
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  const walk = async (x, y) => {
    world.signIn({ id: krag.userId });
    const response = await route.POST(
      new Request("http://odm.test/move", { method: "POST", body: JSON.stringify({ x, y }) }),
      { params: Promise.resolve({ campaignId: world.campaignId }) },
    );
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await walk(7, 1)).status, 200, "the first 30 ft");
  assert.equal(feetLeft(), 0);
  assert.equal((await act("dash")).ok, true);
  assert.equal((await act("dash", { bonus: true })).ok, true);
  assert.equal(feetLeft(), 60);
  const far = await walk(19, 1);
  assert.equal(far.status, 200, JSON.stringify(far.body));
  assert.deepEqual({ x: kit.token(krag.id).x, y: kit.token(krag.id).y }, { x: 19, y: 1 });
  assert.equal(feetLeft(), 0);
});

await test("A turn with one Dash still reads as doubled movement for the GM.", () => {
  const budget = { ...world.encounter().turnBudget, dashed: true, dashes: 1 };
  assert.match(describeBudget(budget), /doubled movement \(Dash\)/);
  // A budget stored before the count existed reads as one Dash.
  const older = { ...budget };
  delete older.dashes;
  assert.match(describeBudget(older), /doubled movement \(Dash\)/);
});

// Issue #666: the Dash added speed and said the board allowed the distance;
// the walk needed a move_token the GM never made.
const apart = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
// The move is the player's to declare: the GM walks a player's token only
// for the move their player just said (map-tools.ts).
const declares = (line) => world.say("player", line, world.sheet(krag.id));
const { invokeEngine } = await import("../src/lib/dm/invoke.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
// The AI GM's take_action, in one DM turn per call.
const aiAct = (action, args = {}) =>
  invokeEngine(world.campaign(), { kind: "ai", turnId: createDmTurn(world.campaignId, [], "ai").id }, { name: "take_action", args: { characterId: krag.id, action, ...args } });

await test("A Dash toward an ally walks to the open square beside them in the same call, the walk charged against the Dash", async () => {
  await stage();
  kit.place(vesper.id, 11, 1);
  declares("Krag dashes to Vesper.");
  const dash = await aiAct("dash", { toward: "Vesper" });
  assert.equal(dash.ok, true, dash.error);
  assert.equal(dash.result.walked?.toward, "Vesper", JSON.stringify(dash.result));
  assert.equal(apart(kit.token(krag.id), kit.token(vesper.id)), 1, "Krag stands beside Vesper");
  assert.equal(feetLeft(), 60 - 9 * 5, "nine squares of the sixty feet walked");
  assert.equal(dash.result.moveOwed, undefined);
});

await test("A Dash toward someone too far goes as far as the movement does, and says where it stopped", async () => {
  await stage();
  kit.place(vesper.id, 20, 1);
  declares("Krag dashes to Vesper.");
  const dash = await aiAct("dash", { toward: vesper.id });
  assert.equal(dash.ok, true, dash.error);
  assert.match(String(dash.result.walked?.note), /Speed limited the move/);
  assert.equal(kit.token(krag.id).x, 13, "twelve squares, sixty feet");
  assert.equal(feetLeft(), 0);
});

await test("A Cunning Action Dash toward someone walks too, on the speed both Dashes added", async () => {
  await stage();
  kit.place(vesper.id, 1, 14);
  declares("Krag dashes, then dashes again to Vesper.");
  assert.equal((await aiAct("dash")).ok, true);
  const bonus = await aiAct("dash", { bonus: true, toward: "Vesper" });
  assert.equal(bonus.ok, true, bonus.error);
  assert.equal(world.encounter().turnBudget.bonusUsed, true);
  assert.equal(apart(kit.token(krag.id), kit.token(vesper.id)), 1, "twelve squares on ninety feet");
});

await test("A Disengage toward an ally walks out of an enemy's reach and draws no opportunity attack", async () => {
  const enemy = await stage();
  kit.place(enemy.id, 2, 1);
  kit.place(vesper.id, 1, 6);
  declares("Krag disengages and falls back to Vesper.");
  const before = kit.lastRolls(500).length;
  const away = await aiAct("disengage", { toward: "Vesper" });
  assert.equal(away.ok, true, away.error);
  assert.equal(apart(kit.token(krag.id), kit.token(vesper.id)), 1);
  assert.equal(away.result.walked?.opportunityAttacks, undefined, JSON.stringify(away.result.walked));
  assert.equal(kit.lastRolls(500).length, before, "no opportunity attack was rolled");
});

await test("A destination the call cannot use is refused with nothing spent; a Dash with none says nothing has moved", async () => {
  await stage();
  const unknown = await aiAct("dash", { toward: "the ogre" });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /names nobody else on the board/);
  const dodge = await aiAct("dodge", { toward: "Vesper" });
  assert.equal(dodge.ok, false);
  assert.match(dodge.error, /toward goes with a Dash or a Disengage only/);
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false, "the action is still Krag's");
  const plain = await aiAct("dash");
  assert.equal(plain.ok, true, plain.error);
  assert.match(String(plain.result.moveOwed), /their player moves their own token/);
});

// The console's Move beside field shows for every actor (a field cannot hide
// itself by the actor's kind): for a player character it is refused before
// the Dash is spent, in words that say why, instead of the walk failing
// after it.
await test("A person at the console Dashing a player character toward someone is told their player moves their own token, and nothing is spent", async () => {
  await stage();
  kit.place(vesper.id, 11, 1);
  const refused = await act("dash", { toward: "Vesper" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, "Krag is a player character, and their player moves their own token: take the dash without someone to move beside, and they walk it on the board. Nothing was spent.");
  assert.equal(world.encounter().turnBudget?.actionUsed ?? false, false, "the action is still Krag's");
  assert.deepEqual([kit.token(krag.id).x, kit.token(krag.id).y], [1, 1]);
  // The AI GM's Dash with no word from Krag's player since the last
  // narration is refused the same way.
  world.say("dm", "The torches gutter.");
  const unasked = await aiAct("dash", { toward: "Vesper" });
  assert.equal(unasked.ok, false);
});

finish();
