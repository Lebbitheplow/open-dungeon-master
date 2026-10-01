// Aiming a spell's area and moving on the board, the player's and the DM's
// screens (workstream zones-ui, /tmp/odm-enf2/fixes/zones-ui.md): the Hand's
// area pick (src/lib/battlemap/hand-area.ts) and what it sends, the drag
// ruler reading the server's costs and the notes after a move
// (src/lib/battlemap/board-move.ts), and the console's placement fields.
// Pure: no database, no server. scripts/test-enforce-zones-ui.mjs holds the
// same picks against the engine.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { composeSentence, intentBody } = await import("../src/lib/battlemap/hand-play.ts");
const area = await import("../src/lib/battlemap/hand-area.ts");
const { rulerFor, moveNotesFrom, proneCharge } = await import("../src/lib/battlemap/board-move.ts");
const { layZone } = await import("../src/lib/battlemap/zones.ts");
const { zoneRowFor } = await import("../src/lib/battlemap/zones-spells.ts");
const { parseMessageIntent, describeIntent, intentCorrection } = await import("../src/lib/dm/intent-logic.ts");
const { adjudication } = await import("../src/lib/dm/invoke-catalog.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL: ${name}`);
    throw error;
  }
  passed += 1;
}

function sheet(overrides = {}) {
  return {
    id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
    name: "Mira", race: "human", class: "wizard", subclass: "", background: "", alignment: "", gender: "",
    level: 11, xp: 0,
    abilities: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 },
    maxHp: 60, currentHp: 60, tempHp: 0, ac: 12, acOverride: false, speed: 30,
    hitDice: { die: "d6", total: 11, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["simple"] },
    equipment: [], gold: 0, copper: 0, feats: [], features: [],
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 0 }, 4: { max: 3, used: 0 } },
      prepared: ["Web", "Wall of Fire", "Gust of Wind", "Spirit Guardians", "Fireball"],
      known: [],
    },
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}

const fact = (level, extra = {}) => ({
  level, school: "evocation", castingTime: "1 action", range: "60 feet", desc: "", higherLevel: "", concentration: true, ...extra,
});
const SPELLS = {
  web: fact(2, { school: "conjuration", desc: "Each creature that starts its turn in the webs or that enters them during its turn must make a Dexterity saving throw. On a failed save, the creature is restrained." }),
  "wall of fire": fact(4, { range: "120 feet", desc: "Each creature in the wall's area must make a Dexterity saving throw. A creature takes 5d8 fire damage on a failed save, or half as much damage on a successful one." }),
  "gust of wind": fact(2, { range: "Self (60-foot line)", desc: "Each creature that starts its turn in the line must succeed on a Strength saving throw or be pushed 15 feet away from you." }),
  "spirit guardians": fact(3, { range: "Self (15-foot radius)", desc: "An affected creature's speed is halved in the area, and when the creature enters the area for the first time on a turn or starts its turn there, it must make a Wisdom saving throw. On a failed save, the creature takes 3d8 radiant damage." }),
  fireball: fact(3, { range: "150 feet", concentration: false, desc: "Each creature in a 20-foot-radius sphere must make a Dexterity saving throw. A target takes 8d6 fire damage on a failed save, or half as much damage on a successful one." }),
};
const card = (name) => deriveHand(sheet(), FRESH_TURN, { spells: SPELLS }).find((entry) => entry.name === name);
const MAP = { terrain: ".".repeat(24 * 9), width: 24, height: 9 };

test("an area spell's card carries its area, and a spell with none does not", () => {
  assert.equal(card("Web").area?.pick, "point");
  assert.equal(card("Wall of Fire").area?.pick, "wall");
  assert.equal(card("Gust of Wind").area?.pick, "direction");
  assert.equal(card("Fireball").area, undefined, "Fireball leaves nothing on the ground");
  assert.equal(area.areaFor("Spirit Guardians").pick, "none");
  assert.equal(area.areaFor("Globe of Invulnerability").pick, "none");
  assert.equal(area.areaFor("Light"), null, "Light lights the caster's token; there is nothing to aim");
});

test("a burst is centred where the board is tapped, and a new tap moves it", () => {
  const web = card("Web").area;
  let pick = area.nextPick(web, {}, { x: 12, y: 2 });
  assert.deepEqual(area.areaArgs(web, pick), { atX: 12, atY: 2 });
  pick = area.nextPick(web, pick, { x: 5, y: 5 });
  assert.deepEqual(area.areaArgs(web, pick), { atX: 5, atY: 5 });
  const laid = area.areaCells(web, pick, MAP, { x: 1, y: 1 });
  assert.deepEqual(laid.cells.sort((a, b) => a - b), layZone(zoneRowFor("Web"), { origin: { x: 5, y: 5 }, toward: null, caster: { x: 1, y: 1 }, slotLevel: 2 }, MAP).cells.sort((a, b) => a - b));
  assert.equal(area.describePick(web, pick), "centred on (5,5)");
});

test("a wall takes its first square, then where it runs; a third tap starts it over", () => {
  const wall = card("Wall of Fire").area;
  let pick = area.nextPick(wall, {}, { x: 10, y: 1 });
  assert.deepEqual(area.areaArgs(wall, pick), { atX: 10, atY: 1 });
  // While the second square is being chosen the pointer turns the wall.
  assert.deepEqual(area.hoverPick(wall, pick, { x: 10, y: 7 }), { at: { x: 10, y: 1 }, toward: { x: 10, y: 7 } });
  pick = area.nextPick(wall, pick, { x: 10, y: 7 });
  assert.deepEqual(area.areaArgs(wall, pick), { atX: 10, atY: 1, towardX: 10, towardY: 7 });
  assert.equal(area.describePick(wall, pick), "from (10,1) toward (10,7)");
  assert.deepEqual(area.nextPick(wall, pick, { x: 3, y: 3 }), { at: { x: 3, y: 3 } });
  // Wall of Fire has a burning side, laid away from the caster.
  assert.ok(area.areaCells(wall, pick, MAP, { x: 4, y: 4 }).hot.length > 0);
});

test("a line blows from the caster toward the square tapped; an aura needs no tap", () => {
  const gust = card("Gust of Wind").area;
  const pick = area.nextPick(gust, {}, { x: 20, y: 4 });
  assert.deepEqual(area.areaArgs(gust, pick), { towardX: 20, towardY: 4 });
  assert.equal(area.areaCells(gust, {}, MAP, { x: 4, y: 4 }), null, "no direction yet, nothing to draw");
  assert.ok(area.areaCells(gust, pick, MAP, { x: 4, y: 4 }).cells.length > 0);
  const guardians = area.areaFor("Spirit Guardians", 3);
  assert.deepEqual(area.nextPick(guardians, {}, { x: 9, y: 9 }), {});
  assert.deepEqual(area.areaArgs(guardians, { at: { x: 9, y: 9 } }), {});
  assert.ok(area.areaCells(guardians, {}, MAP, { x: 4, y: 4 }).cells.includes(4 * 24 + 4), "the aura sits on the caster");
});

test("the card sends the pick as the tool's placement arguments and says it in the sentence", () => {
  const web = card("Web");
  const choices = { area: { at: { x: 12, y: 2 } } };
  const body = intentBody(web, null, [], choices);
  assert.equal(body.atX, 12);
  assert.equal(body.atY, 2);
  assert.equal(composeSentence(web, null, [], choices), "I cast Web centred on (12,2) using a level 2 slot.");
  // The message schema keeps it, and the card line and the correction show it.
  const intent = parseMessageIntent(body);
  assert.equal(intent.atX, 12);
  assert.match(describeIntent(intent, "s1"), /atX=12, atY=2/);
  assert.match(intentCorrection(intent, "s1", "Mira"), /atX=12, atY=2/);
  // With nothing picked the card sends no placement at all.
  const bare = intentBody(web, null, [], {});
  assert.equal("atX" in bare, false);
});

test("a console form asks the board for one square and previews the area with the other", () => {
  const request = { requestId: "r", role: "toward", label: "Runs toward, column", area: area.areaFor("Wall of Fire", 4), at: { x: 10, y: 1 } };
  assert.deepEqual(area.requestPick(request, { x: 10, y: 6 }), { at: { x: 10, y: 1 }, toward: { x: 10, y: 6 } });
  const centre = { requestId: "r", role: "at", label: "Area centre, column", area: area.areaFor("Web", 2) };
  assert.deepEqual(area.requestPick(centre, { x: 3, y: 3 }), { at: { x: 3, y: 3 } });
  for (const name of ["use_spell_slot", "aoe_damage", "cast_at_enemy"]) {
    const fields = adjudication(name).fields;
    const at = fields.find((field) => field.name === "atX");
    const toward = fields.find((field) => field.name === "towardX");
    assert.deepEqual(at.square, { row: "atY", role: "at" }, name);
    assert.deepEqual(toward.square, { row: "towardY", role: "toward" }, name);
    assert.ok(fields.some((field) => field.name === "atY") && fields.some((field) => field.name === "towardY"), name);
  }
});

// ---- the ruler and the move notes ----

const VIEW = {
  terrain: ".".repeat(10 * 3),
  width: 10,
  height: 3,
  tokens: [{ id: "me", x: 0, y: 1 }],
  budgetLeft: 6,
  // Squares 1 and 2 along row 1 are plain; 3 and 4 cost double (a spell's
  // difficult ground the terrain string knows nothing about).
  reachable: [11, 12, 13, 14],
  reachableCost: [1, 2, 4, 6],
};

test("the ruler reads the server's cost for a lit square, not the terrain's", () => {
  const ruler = rulerFor(VIEW, "me", { x: 4, y: 1 }, true);
  assert.equal(ruler.label, "30 ft");
  assert.equal(ruler.overBudget, false);
  assert.deepEqual(ruler.path, [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }]);
  // The old price, the terrain alone, would have read 20 ft here.
  assert.equal(rulerFor({ ...VIEW, reachableCost: undefined }, "me", { x: 4, y: 1 }, true).label, "20 ft");
});

test("a square the server does not light is out of reach, whatever the terrain says", () => {
  const ruler = rulerFor(VIEW, "me", { x: 5, y: 1 }, true);
  assert.equal(ruler.overBudget, true);
  assert.equal(ruler.label, "out of reach");
  const far = rulerFor(VIEW, "me", { x: 9, y: 1 }, true);
  assert.equal(far.label, "45 ft");
  assert.equal(far.overBudget, true);
  // The DM moves pieces for free: never over budget.
  assert.equal(rulerFor(VIEW, "me", { x: 9, y: 1 }, false).overBudget, false);
});

test("a prone character pays to stand or crawls at double, as the move route charges", () => {
  assert.deepEqual(proneCharge(2, 3, 6), { cost: 5, stands: true });
  assert.deepEqual(proneCharge(3, 4, 6), { cost: 6, stands: false });
  assert.equal(proneCharge(4, 3, 6), null);
});

test("the notes after a move are the route's own lines, the attacks first", () => {
  const notes = moveNotesFrom({
    view: {},
    zoneEffects: ["Spike Growth: 2d4 piercing, 5 damage to Kael."],
    opportunityAttacks: ["Goblin 1 strikes as Kael leaves: 6 slashing."],
  });
  assert.deepEqual(notes, [
    { text: "Goblin 1 strikes as Kael leaves: 6 slashing.", tone: "struck" },
    { text: "Spike Growth: 2d4 piercing, 5 damage to Kael.", tone: "ground" },
  ]);
  assert.deepEqual(moveNotesFrom({ view: {} }), []);
  assert.deepEqual(moveNotesFrom(null), []);
});

const { dragReach } = await import("../src/lib/battlemap/board-move.ts");
const { enemyStageRows } = await import("../src/lib/battlemap/view-stage.ts");

test("dragging lights only the squares the doubled walk still reaches", () => {
  const dragged = dragReach(VIEW, 2);
  assert.deepEqual(dragged.reachable, [11, 12]);
  assert.equal(dragReach(VIEW, 1), VIEW);
  // The ruler prices the drag as the route charges it.
  assert.equal(rulerFor(VIEW, "me", { x: 2, y: 1 }, true, 2).label, "20 ft dragging");
  assert.equal(rulerFor(VIEW, "me", { x: 3, y: 1 }, true, 2).overBudget, true);
});

test("a troll down at 0 reads as regenerating on the board, and as dying at its turn once burned", () => {
  const down = { id: "t", currentHp: 0, conditions: ["unconscious", "prone"], conditionMeta: { unconscious: { source: "regenerating" } } };
  const rows = enemyStageRows(down, () => null);
  assert.equal(rows.find((row) => row.id === "unconscious").label, "Down, regenerating");
  const burned = enemyStageRows({ ...down, conditions: [...down.conditions, "regeneration stopped"] }, () => null);
  assert.equal(burned.find((row) => row.id === "unconscious").label, "Down, dies at its turn");
});

test("the note after a jump is the route's answer", () => {
  assert.deepEqual(moveNotesFrom({ jump: { feet: 15, highJumpFeet: 6, landed: "prone (Acrobatics 7 against DC 10 in difficult terrain)" } }), [
    { text: "Jumped 15 feet and landed prone (Acrobatics 7 against DC 10 in difficult terrain). A high jump reaches 6 feet.", tone: "move" },
  ]);
});

const { glyphFor } = await import("../src/lib/battlemap/condition-glyphs.ts");
const { conditionNote, conditionNoteLine } = await import("../src/lib/battlemap/condition-notes.ts");
const { AFFLICTION_CONDITION_EFFECTS } = await import("../src/lib/srd/affliction-conditions.ts");
const { LAST_CONDITION_EFFECTS } = await import("../src/lib/srd/condition-effects-last.ts");
const { TAIL_CONDITION_EFFECTS } = await import("../src/lib/srd/condition-effects-tail.ts");
const { CONDITION_GLYPHS } = await import("../src/lib/battlemap/condition-glyphs.ts");

// A disease or a madness on a sheet (src/lib/dm/afflictions.ts), and every
// condition the late spell rows lay (Blink, Maze, Feeblemind, Spider Climb,
// Flesh to Stone...), shows a glyph of its own on the token and the chip, and
// the chip's note leads with what the engine says it does.
test("every disease, madness, remedy and late spell condition has its own glyph and the engine's summary as its note", () => {
  const rows = [...AFFLICTION_CONDITION_EFFECTS, ...LAST_CONDITION_EFFECTS, ...TAIL_CONDITION_EFFECTS];
  const names = rows.flatMap((row) => row.match);
  assert.ok(names.length >= 40, `only ${names.length} conditions found`);
  // The board draws each glyph once as a <symbol id="cond-..."> (BoardStage.tsx).
  const ids = Object.values(CONDITION_GLYPHS).map((glyph) => glyph.id);
  assert.equal(new Set(ids).size, ids.length, "two glyphs share a symbol id");
  for (const name of names) {
    assert.notEqual(glyphFor(name).id, "effect", `${name} falls back to the plain effect glyph`);
    const row = rows.find((entry) => entry.match.includes(name));
    assert.ok(conditionNoteLine(conditionNote(name, undefined, () => null)).startsWith(row.summary.trim().replace(/\.$/, "")),`${name}'s chip does not say what it does`);
  }
});

// A spell's hold is broken with take_action escape (src/lib/dm/spell-escape.ts):
// the Hand offers the Escape card for it and says what it rolls.
test("a character held by Maze, Irresistible Dance or Web gets an Escape card naming the spell and its roll", () => {
  const escapeOf = (conditions, conditionMeta) =>
    deriveHand(sheet({ conditions, conditionMeta }), FRESH_TURN, { spells: SPELLS }).find((entry) => entry.id === "basic:escape");
  assert.equal(escapeOf([], {}), undefined, "an Escape card with nothing holding them");
  const maze = escapeOf(["mazed"], { mazed: { spell: "Maze" } });
  assert.equal(maze.name, "Escape: Maze");
  assert.equal(maze.dice, "Intelligence +4");
  assert.match(maze.rules, /Intelligence check against DC 20/);
  const dance = escapeOf(["dancing"], { dancing: { spell: "Irresistible Dance" } });
  assert.equal(dance.roll, "saving throw");
  assert.match(dance.dice, /^Wisdom save \+/);
  const web = escapeOf(["restrained"], { restrained: { spell: "Web" } });
  assert.match(web.rules, /Strength check against the caster's spell save DC/);
  assert.equal(composeSentence(maze, {}, null), "I try to break free of Maze.");
  // A grapple is still the grapple's escape.
  assert.equal(escapeOf(["grappled", "mazed"], { mazed: { spell: "Maze" } }).name, "Escape");
});

console.log(`hand-area: ${passed} tests passed`);
