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

finish();
