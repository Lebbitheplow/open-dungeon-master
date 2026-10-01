// The board's move modes tell the move route's truth (workstream zones-ui,
// /tmp/odm-enf2/fixes/zones-ui.md): the view's jump reach and drag cost
// (PlayerMapView.moves) are the numbers the route charges, the jump and drag
// rulers (src/lib/battlemap/board-move.ts) price a move as the route does,
// and the note after a jump is the route's own answer. SRD 5.1: a long jump
// covers up to the Strength score in feet after a 10-foot run, half that
// standing, each foot a foot of movement; dragging a grappled creature halves
// the speed unless it is two or more sizes smaller.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { monsterKit } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-enforce-board-moves");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { publicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { jumpRulerFor, moveNotesFrom, rulerFor } = await import("../src/lib/battlemap/board-move.ts");

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

async function move(body) {
  const route = await world.route("campaigns/[campaignId]/battle-map/move");
  world.signIn({ id: fighter.userId });
  const response = await route.POST(
    new Request("http://odm.test/move", { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

const view = () => buildPlayerMapView(world.campaignId, fighter.userId);
const moved = () => kit.token(fighter.id).movedThisRound;

await test("The board's jump reach is the Strength score in feet after a 10-foot run, half standing, as the move route counts it.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 4, 4);
  kit.place(enemy.id, 20, 12);
  assert.equal(view().moves.runningStart, false);
  assert.equal(view().moves.jumpFeet, 8, "a standing long jump is half the Strength score");
  const walked = await move({ x: 6, y: 4 });
  assert.equal(walked.status, 200, JSON.stringify(walked.body));
  const seen = view();
  assert.equal(seen.moves.runningStart, true);
  assert.equal(seen.moves.jumpFeet, 16);
  assert.equal(seen.moves.highJumpFeet, 6);
  const ruler = jumpRulerFor(seen, seen.myTokenId, { x: 9, y: 4 }, seen.moves.jumpFeet);
  assert.equal(ruler.label, "15 ft jump");
  assert.equal(ruler.overBudget, false);
  const before = moved();
  const leap = await move({ x: 9, y: 4, jump: true });
  assert.equal(leap.status, 200, JSON.stringify(leap.body));
  assert.equal((moved() - before) * 5, 15, "the route charged another length than the ruler showed");
  const notes = moveNotesFrom(leap.body);
  assert.equal(notes[0].tone, "move");
  assert.match(notes[0].text, /^Jumped 15 feet and landed on their feet\. A high jump reaches 6 feet\.$/);
  // Past the reach the ruler turns red, and the route refuses in its own words.
  const far = view();
  assert.equal(jumpRulerFor(far, far.myTokenId, { x: 13, y: 4 }, far.moves.jumpFeet).overBudget, true);
});

await test("While a character grapples someone the board offers the drag at the route's price: every square doubled.", async () => {
  const enemy = await stage();
  kit.place(fighter.id, 5, 6);
  kit.place(enemy.id, 5, 7);
  assert.equal(view().moves.drag, null, "a drag was offered with nobody held");
  kit.setEnemy(enemy.id, { conditions: ["grappled"], conditionMeta: { grappled: { source: fighter.id } } });
  const seen = view();
  assert.equal(seen.moves.drag.factor, 2);
  assert.deepEqual(seen.moves.drag.names.length, 1);
  const ruler = rulerFor(seen, seen.myTokenId, { x: 5, y: 5 }, true, seen.moves.drag.factor);
  const out = await move({ x: 5, y: 5, drag: true });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(ruler.label, `${moved() * 5} ft dragging`);
  assert.equal(ruler.label, "10 ft dragging");
  // Beyond half speed the ruler is red, as the route refuses it.
  const after = view();
  const beyond = rulerFor(after, after.myTokenId, { x: 5, y: 0 }, true, after.moves.drag.factor);
  assert.equal(beyond.overBudget, true);
  const refused = await move({ x: 5, y: 0, drag: true });
  assert.equal(refused.status, 400);
});

// A troll cut down lies at 0 until its turn (src/lib/dm/regeneration.ts): the
// encounter panel and the board say "regenerates at its turn", never dead,
// and "dies at its turn" once fire has landed.
const TROLL = {
  name: "Troll", size: "Large", type: "Giant", armor_class: 15, hit_points: 84, cr: 5,
  actions: [{ name: "Claw", desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 11 (2d6 + 4) slashing damage.", attack_bonus: 7, damage_dice: "2d6", damage_bonus: 4 }],
  special_abilities: [{ name: "Regeneration", desc: "The troll regains 10 hit points at the start of its turn. If the troll takes acid or fire damage, this trait doesn't function at the start of the troll's next turn. The troll dies only if it starts its turn with 0 hit points and doesn't regenerate." }],
};

await test("A troll down at 0 shows on the encounter panel and the board as regenerating at its turn, and as dying at its turn once burned.", async () => {
  const troll = await stage();
  mk.stage(troll.id, TROLL);
  kit.place(fighter.id, 4, 4);
  kit.place(troll.id, 8, 8);
  await world.invoke("damage_enemy", { enemyId: troll.id, amount: 200, type: "slashing" });
  assert.equal(kit.enemy(troll.id).status, "alive");
  const shown = () => publicEncounter(world.encounter(), world.enemies()).enemies.find((enemy) => enemy.id === troll.id);
  assert.deepEqual(shown().regenerating, { stopped: false });
  const rowOf = () => {
    const seen = view();
    const token = seen.tokens.find((entry) => entry.refId === troll.id);
    return (seen.tokenConditions[token.id] ?? []).find((row) => row.id === "unconscious");
  };
  assert.equal(rowOf().label, "Down, regenerating");
  await world.invoke("damage_enemy", { enemyId: troll.id, amount: 5, type: "fire" });
  assert.deepEqual(shown().regenerating, { stopped: true });
  assert.equal(rowOf().label, "Down, dies at its turn");
});

await kit.endFight();
world.close();
finish();
