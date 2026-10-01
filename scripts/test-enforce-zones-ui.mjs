// The screens that aim a spell's area and move a figure tell the engine's
// truth (workstream zones-ui, /tmp/odm-enf2/fixes/zones-ui.md):
//   - the area the board previews for a pick (src/lib/battlemap/hand-area.ts)
//     is the area the engine lays when the tool is called with the pick's
//     placement arguments, for a burst, a wall, a line and an aura;
//   - the drag ruler's cost (src/lib/battlemap/board-move.ts rulerFor over the
//     view's reachableCost) is what the move route then charges, through a
//     spell's difficult ground and for a prone character;
//   - the notes a move shows are the move route's own lines.
// Every check reads the board, the token, the view or the route's answer.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { caster, closeTables, FIGHTER } from "./lib/enforce-spell-kit.mjs";
import { onTurnOf } from "./lib/enforce-spells.mjs";
import { board, tokenOf, walk, zonesOf } from "./lib/enforce-zones.mjs";

const { test, finish } = suite("test-enforce-zones-ui");
const { buildPlayerMapView } = await import("../src/lib/battlemap/view.ts");
const { areaArgs, areaCells, areaFor, nextPick } = await import("../src/lib/battlemap/hand-area.ts");
const { moveNotesFrom, rulerFor } = await import("../src/lib/battlemap/board-move.ts");

const sorted = (cells) => [...cells].sort((a, b) => a - b);

// The caster's own board, as their screen holds it.
function viewOf(world, heroId) {
  return onTurnOf(world, heroId, () => buildPlayerMapView(world.campaignId, world.sheet(heroId).userId));
}

// Casts `spell` with the placement the taps make, and returns the area the
// engine laid beside the one the caster's board previewed.
async function laidAndPreviewed(world, heroId, tool, spell, level, taps, extra = {}) {
  const area = areaFor(spell, level);
  let pick = {};
  for (const tap of taps) {
    pick = nextPick(area, pick, tap);
  }
  const view = await viewOf(world, heroId);
  const me = view.tokens.find((token) => token.id === view.myTokenId);
  const preview = areaCells(area, pick, { terrain: view.terrain, width: view.width, height: view.height }, { x: me.x, y: me.y });
  const cast = await world.invoke(tool, { characterId: heroId, spell, level, ...areaArgs(area, pick), ...extra });
  assert.equal(cast.ok, true, cast.error);
  const laid = zonesOf(world).find((zone) => zone.spell.toLowerCase() === spell.toLowerCase());
  assert.ok(laid, `${spell} laid no area`);
  assert.ok(preview, `${spell}: the board previewed nothing`);
  return { laid, preview };
}

// ---- the area picked is the area laid ----

await test("A burst picked on the board (Web) is laid on exactly the squares the board previewed.", async () => {
  const { world, sheets: [wizard] } = await board([caster("wizard", "int", ["Web"])], [{ x: 2, y: 6 }]);
  const { laid, preview } = await laidAndPreviewed(world, wizard.id, "use_spell_slot", "Web", 2, [{ x: 12, y: 2 }]);
  assert.deepEqual(sorted(laid.cells), sorted(preview.cells));
  assert.deepEqual(laid.origin, { x: 12, y: 2 });
});

await test("A wall picked as a first square and a direction (Wall of Fire) is laid where the board drew it, burning side and all.", async () => {
  const { world, sheets: [wizard] } = await board([caster("wizard", "int", ["Wall of Fire"])], [{ x: 2, y: 6 }]);
  const { laid, preview } = await laidAndPreviewed(world, wizard.id, "use_spell_slot", "Wall of Fire", 4, [{ x: 10, y: 1 }, { x: 10, y: 7 }]);
  assert.deepEqual(sorted(laid.cells), sorted(preview.cells));
  assert.deepEqual(sorted(laid.hot ?? []), sorted(preview.hot ?? []));
});

await test("A wall given only its first square runs across the caster's view, as the board previewed it.", async () => {
  const { world, sheets: [wizard] } = await board([caster("wizard", "int", ["Wall of Fire"])], [{ x: 2, y: 2 }]);
  const { laid, preview } = await laidAndPreviewed(world, wizard.id, "use_spell_slot", "Wall of Fire", 4, [{ x: 12, y: 2 }]);
  assert.deepEqual(sorted(laid.cells), sorted(preview.cells));
});

await test("A line aimed by one square (Gust of Wind) blows from the caster the way the board drew it.", async () => {
  const { world, sheets: [druid] } = await board([caster("druid", "wis", ["Gust of Wind"])], [{ x: 4, y: 4 }]);
  const { laid, preview } = await laidAndPreviewed(world, druid.id, "use_spell_slot", "Gust of Wind", 2, [{ x: 20, y: 4 }]);
  assert.deepEqual(sorted(laid.cells), sorted(preview.cells));
});

await test("An aura (Spirit Guardians) needs no square: the board shows it on the caster, where the engine lays it.", async () => {
  const { world, sheets: [cleric] } = await board([caster("cleric", "wis", ["Spirit Guardians"])], [{ x: 6, y: 4 }]);
  const { laid, preview } = await laidAndPreviewed(world, cleric.id, "cast_buff", "Spirit Guardians", 3, [{ x: 20, y: 1 }]);
  assert.deepEqual(sorted(laid.cells), sorted(preview.cells));
});

// ---- the ruler's cost is the route's charge ----

await test("The drag ruler prices a walk through Entangle at what the move route then charges.", async () => {
  const { world, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Entangle"]), FIGHTER], [{ x: 2, y: 6 }, { x: 7, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Entangle", level: 1, atX: 12, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  const view = await viewOf(world, fighter.id);
  const ruler = rulerFor(view, view.myTokenId, { x: 11, y: 2 }, true);
  // The terrain alone (the ruler before) reads the entangled ground as open.
  const terrainOnly = rulerFor({ ...view, reachableCost: undefined }, view.myTokenId, { x: 11, y: 2 }, true);
  const out = await walk(world, fighter.id, 11, 2);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const charged = tokenOf(world, fighter.id).movedThisRound;
  assert.equal(ruler.label, `${charged * 5} ft`);
  assert.equal(ruler.overBudget, false);
  assert.notEqual(terrainOnly.label, ruler.label, "the entangled squares cost nothing extra on the terrain alone");
});

await test("A prone character's ruler counts standing up, as the move route charges it.", async () => {
  const { world, sheets: [fighter] } = await board([FIGHTER], [{ x: 4, y: 4 }]);
  const down = await world.invoke("set_condition", { characterId: fighter.id, condition: "prone" });
  assert.equal(down.ok ?? true, true, down.error);
  const view = await viewOf(world, fighter.id);
  const ruler = rulerFor(view, view.myTokenId, { x: 6, y: 4 }, true);
  // Two squares of walking alone: what the lit squares used to say.
  assert.notEqual(ruler.label, "10 ft", "the ruler priced the walk as if standing up were free");
  const out = await walk(world, fighter.id, 6, 4);
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.equal(ruler.label, `${tokenOf(world, fighter.id).movedThisRound * 5} ft`);
});

await test("A square the server will not let the character reach this round reads as out of reach on the ruler.", async () => {
  const { world, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Plant Growth"]), FIGHTER], [{ x: 2, y: 8 }, { x: 8, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Plant Growth", level: 3, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const view = await viewOf(world, fighter.id);
  // Four squares on: open ground by the terrain (20 feet of a 30-foot speed),
  // overgrowth by the spell.
  const ruler = rulerFor(view, view.myTokenId, { x: 12, y: 2 }, true);
  assert.equal(ruler.overBudget, true);
  const out = await walk(world, fighter.id, 12, 2);
  assert.notEqual(out.status, 200, "the route took a walk the ruler called out of reach");
});

// ---- what a figure standing in an area shows ----

await test("A character standing in Silence shows as deafened on the board, and one outside does not.", async () => {
  const { world, sheets: [cleric, fighter] } = await board([caster("cleric", "wis", ["Silence"]), FIGHTER], [{ x: 2, y: 2 }, { x: 14, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: cleric.id, spell: "Silence", level: 2, atX: 14, atY: 4 });
  assert.equal(cast.ok, true, cast.error);
  const view = await viewOf(world, fighter.id);
  const tokenOfRef = (refId) => view.tokens.find((token) => token.refId === refId);
  const inside = view.tokenConditions[tokenOfRef(fighter.id).id] ?? [];
  assert.ok(inside.some((row) => row.id === "deafened"), JSON.stringify(inside));
  const outside = view.tokenConditions[tokenOfRef(cleric.id).id] ?? [];
  assert.equal(outside.some((row) => row.id === "deafened"), false);
});

// ---- the notes after a move ----

await test("The notes a move shows are the move route's own lines about the spell areas walked into.", async () => {
  const { world, sheets: [druid, fighter] } = await board([caster("druid", "wis", ["Spike Growth"]), FIGHTER], [{ x: 2, y: 8 }, { x: 8, y: 2 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: druid.id, spell: "Spike Growth", level: 2, atX: 14, atY: 2 });
  assert.equal(cast.ok, true, cast.error);
  const before = world.sheet(fighter.id).currentHp;
  world.dice(1, 1, 1, 1);
  const out = await walk(world, fighter.id, 11, 2);
  world.clearDice();
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const notes = moveNotesFrom(out.body);
  assert.ok(notes.length > 0, "the walk into Spike Growth brought back no note");
  assert.deepEqual(notes.map((note) => note.text), out.body.zoneEffects);
  assert.ok(notes.every((note) => note.tone === "ground"));
  assert.ok(world.sheet(fighter.id).currentHp < before, "the note spoke of damage the sheet never took");
});

// ---- a sectioned wall's numbers ----

await test("The board numbers a Wall of Ice's sections as damage_object names them, and a broken section's number leaves the board.", async () => {
  const { world, sheets: [wizard, fighter] } = await board([caster("wizard", "int", ["Wall of Ice"], [], 11), FIGHTER], [{ x: 2, y: 8 }, { x: 10, y: 4 }]);
  const cast = await world.invoke("use_spell_slot", { characterId: wizard.id, spell: "Wall of Ice", level: 6, atX: 12, atY: 0, towardX: 12, towardY: 8 });
  assert.equal(cast.ok, true, cast.error);
  const wallIn = async () => (await viewOf(world, fighter.id)).spellZones.find((zone) => zone.spell === "Wall of Ice");
  const shown = (await wallIn()).sections.map((section) => section.n);
  // The refusal for an unnamed section lists the ones standing, in the engine's words.
  const refused = await world.invoke("damage_object", { name: "Wall of Ice", damage: "1", damageType: "fire" });
  assert.equal(refused.ok, false);
  assert.match(refused.error, new RegExp(`standing now: ${shown.join(", ")}\\)`));
  // Each badge sits on a square of its own section.
  const wall = await wallIn();
  assert.ok(wall.sections.every((section) => wall.cells.includes(section.at)));
  const broken = await world.invoke("damage_object", { name: `Wall of Ice section ${shown[1]}`, damage: "30", damageType: "bludgeoning" });
  assert.equal(broken.ok, true, broken.error);
  assert.deepEqual((await wallIn()).sections.map((section) => section.n), shown.filter((n) => n !== shown[1]));
});

closeTables();
finish();
