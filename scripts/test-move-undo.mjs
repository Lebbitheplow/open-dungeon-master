// Taking back a move on the battle map (src/lib/battlemap/move-undo.ts,
// POST battle-map/undo): a walk nothing answered goes back square for square
// with its movement returned, one press per walk, until anything else happens
// in the fight. A walk that drew an opportunity attack, brought a creature
// into sight, uncovered a square of the map, or came before an action, the
// end of the turn or another figure's move stands. Standing up from prone is
// undone with the walk.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";

const { test, finish } = suite("test-move-undo");
const world = await openWorld();
const kit = await combatKit(world);
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");

const fighter = world.addHero({
  name: "Fighter", class: "fighter", level: 5, abilities: { str: 16, dex: 10 }, proficiencies: TRAINED,
  maxHp: 60, ac: 10, acOverride: true, equipment: [{ name: "Longsword", qty: 1 }],
});
const other = world.addHero({ name: "Other", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 60, ac: 10, acOverride: true });

async function stage() {
  await kit.endFight();
  for (const hero of [fighter, other]) {
    world.patch(hero.id, { currentHp: 60, conditions: [], conditionMeta: {}, deathSaves: null });
  }
  await kit.fight(1, { heroFaces: { [fighter.id]: 19, [other.id]: 18 } });
  const [enemy] = world.enemies();
  kit.giveTurn(fighter.id);
  kit.place(other.id, 15, 15);
  return kit.enemy(enemy.id);
}

async function post(path, body, who = fighter) {
  const route = await world.route(`campaigns/[campaignId]/battle-map/${path}`);
  world.signIn({ id: who.userId });
  const response = await route.POST(
    new Request(`http://odm.test/${path}`, { method: "POST", body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

const move = (body) => post("move", body);
const undo = (who) => post("undo", {}, who);
const view = () => buildPlayerMapView(world.campaignId, fighter.userId);
const at = (sheet) => {
  const token = kit.token(sheet.id);
  return { x: token.x, y: token.y, moved: token.movedThisRound };
};

await test("A walk nothing answered is taken back: the figure returns and the movement comes back.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 4, 4);
  kit.place(enemy.id, 20, 12);
  const walked = await move({ x: 6, y: 4 });
  assert.equal(walked.status, 200, JSON.stringify(walked.body));
  assert.deepEqual(walked.body.view.undoMove, { feet: 10 }, "the move's own answer offers the undo");
  assert.deepEqual(view().undoMove, { feet: 10 });
  assert.deepEqual(at(fighter), { x: 6, y: 4, moved: 2 });
  const back = await undo();
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.deepEqual(back.body.undone, { feet: 10 });
  assert.deepEqual(at(fighter), { x: 4, y: 4, moved: 0 });
  assert.equal(back.body.view.budgetLeft, view().budgetLeft);
  assert.equal(view().undoMove, undefined, "one walk is one step back");
  assert.equal((await undo()).status, 409, "a second press with nothing left to take back is refused");
});

await test("Each walk is its own step back, latest first.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 4, 4);
  kit.place(enemy.id, 20, 12);
  assert.equal((await move({ x: 5, y: 4 })).status, 200);
  assert.equal((await move({ x: 5, y: 7 })).status, 200);
  assert.deepEqual(view().undoMove, { feet: 15 });
  assert.equal((await undo()).status, 200);
  assert.deepEqual(at(fighter), { x: 5, y: 4, moved: 1 });
  assert.deepEqual(view().undoMove, { feet: 5 });
  assert.equal((await undo()).status, 200);
  assert.deepEqual(at(fighter), { x: 4, y: 4, moved: 0 });
});

await test("An action after the walk makes it stand.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 4, 4);
  kit.place(enemy.id, 20, 12);
  assert.equal((await move({ x: 6, y: 4 })).status, 200);
  const dashed = await world.invoke("take_action", { characterId: fighter.id, action: "dash" });
  assert.equal(dashed.ok, true, JSON.stringify(dashed));
  assert.equal(view().undoMove, undefined);
  const refused = await undo();
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /^That move stands/);
  assert.deepEqual(at(fighter), { x: 6, y: 4, moved: 2 });
});

await test("A walk that draws an opportunity attack stands.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 4, 4);
  kit.place(enemy.id, 5, 4);
  const walked = await move({ x: 2, y: 4 });
  assert.equal(walked.status, 200, JSON.stringify(walked.body));
  assert.ok(walked.body.opportunityAttacks?.length, "the walk out of reach drew no attack, so the test proves nothing");
  assert.equal(walked.body.view.undoMove, undefined);
  assert.equal((await undo()).status, 409);
});

await test("A walk that brings an enemy into sight stands; one behind the same wall that sees nothing new does not.", async () => {
  const enemy = await stage();
  // A wall down column 4 from the top edge to row 4; the enemy behind it.
  kit.openField([0, 1, 2, 3, 4].map((y) => [4, y, "#"]));
  kit.place(fighter.id, 2, 1);
  kit.place(enemy.id, 6, 1);
  const tokenOf = () => kit.token(enemy.id).id;
  assert.ok(!view().tokens.some((token) => token.id === tokenOf()), "the enemy was in sight before the walk");
  // A step toward the wall: it sees nothing the first square did not.
  const hidden = await move({ x: 3, y: 1 });
  assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
  assert.ok(!hidden.body.view.tokens.some((token) => token.id === tokenOf()));
  assert.deepEqual(hidden.body.view.undoMove, { feet: 5 }, "a walk that saw nothing new is kept");
  const seen = await move({ x: 4, y: 6 });
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  assert.ok(seen.body.view.tokens.some((token) => token.id === tokenOf()), "the walk round the wall did not bring the enemy into sight");
  assert.equal(seen.body.view.undoMove, undefined);
  assert.equal((await undo()).status, 409, "nothing before the sighting can be taken back either");
});

await test("A walk that uncovers new squares of the map stands, with no creature newly seen (issue 504).", async () => {
  const enemy = await stage();
  // A wall down column 6 with a doorway at row 4; the room behind it is
  // empty, and the enemy stands in plain sight on this side.
  kit.openField(Array.from({ length: 30 }, (_, y) => y).filter((y) => y !== 4).map((y) => [6, y, "#"]));
  kit.place(fighter.id, 3, 4);
  kit.place(enemy.id, 1, 1);
  const before = view();
  assert.ok(before.tokens.some((token) => token.id === kit.token(enemy.id).id), "the enemy was not in sight before the walk");
  const looked = await move({ x: 6, y: 4 });
  assert.equal(looked.status, 200, JSON.stringify(looked.body));
  assert.ok(looked.body.view.explored.length > before.explored.length, "stepping into the doorway uncovered nothing, so the test proves nothing");
  assert.equal(looked.body.view.undoMove, undefined, "a walk that uncovered the room behind the doorway was kept");
  assert.equal((await undo()).status, 409);
  assert.deepEqual(at(fighter), { x: 6, y: 4, moved: 3 });
});

await test("Standing up from prone is undone with the walk: prone again, the movement back.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 4, 4);
  kit.place(enemy.id, 20, 12);
  world.patch(fighter.id, { conditions: ["prone"], conditionMeta: {} });
  const walked = await move({ x: 5, y: 4 });
  assert.equal(walked.status, 200, JSON.stringify(walked.body));
  assert.ok(!world.sheet(fighter.id).conditions.includes("prone"), "the walk did not stand them up");
  assert.ok(walked.body.view.undoMove, "the stand and the walk were not kept");
  assert.equal((await undo()).status, 200);
  assert.ok(world.sheet(fighter.id).conditions.includes("prone"));
  assert.deepEqual(at(fighter), { x: 4, y: 4, moved: 0 });
});

await test("The end of the turn makes the walk stand, and nobody else may take it back.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 4, 4);
  kit.place(enemy.id, 20, 12);
  assert.equal((await move({ x: 6, y: 4 })).status, 200);
  assert.equal((await undo(other)).status, 409, "another player took back the fighter's walk");
  assert.deepEqual(at(fighter), { x: 6, y: 4, moved: 2 });
  kit.endTurn(fighter.userId);
  assert.equal(view().undoMove, undefined);
  assert.equal((await undo()).status, 409);
});

await test("Another figure moving after the walk makes it stand.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 4, 4);
  kit.place(enemy.id, 20, 12);
  assert.equal((await move({ x: 6, y: 4 })).status, 200);
  kit.place(enemy.id, 4, 4);
  assert.equal(view().undoMove, undefined);
  assert.equal((await undo()).status, 409, "the walk went back onto a square somebody else now holds");
});

finish();
