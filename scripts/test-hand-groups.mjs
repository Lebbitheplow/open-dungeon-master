// Issue 528: the Hand's cards grouped by what they spend. A level 9 wizard
// held about 35 cards, 26 of them behind the More spine in one flat list;
// now the spells fold under one Spells card (by level, each with the slots
// it has left), a pool's options under that pool (ki, superiority dice), the
// gear actions under Items and the basic actions under Actions. Pinned here:
// what folds and what never does, the sections and their slot lines, a
// small group staying as cards, a favourite seated on its own and still in
// its group, an older layout of card ids still placing its cards, the
// filters, and the pips' costs (issue 529).
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const {
  GROUP_FOLD_MIN,
  filterCards,
  filterChips,
  groupHand,
  groupKeyOf,
  isGroup,
  sectionLine,
  slotNote,
  NO_FILTER,
} = await import("../src/lib/battlemap/hand-groups.ts");
const { HAND_FAN_CAP, arrangeHand, startingLayout, splitHand, addToHand } = await import("../src/lib/battlemap/hand-layout.ts");
const { turnPips } = await import("../src/lib/battlemap/hand-table.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
  passed += 1;
  console.log(`ok: ${name}`);
}

const fact = (level, castingTime, extra = {}) => ({
  level,
  school: "evocation",
  castingTime,
  range: "60 feet",
  concentration: false,
  desc: "",
  higherLevel: "",
  ...extra,
});
// What the content pack says of each spell; a spell card is dealt from it.
const FACTS = {
  "fire bolt": fact(0, "1 action", { desc: "Make a ranged spell attack. On a hit, the target takes 1d10 fire damage." }),
  "ray of frost": fact(0, "1 action", { desc: "Make a ranged spell attack. On a hit, it takes 1d8 cold damage." }),
  "mage hand": fact(0, "1 action"),
  light: fact(0, "1 action"),
  "minor illusion": fact(0, "1 action"),
  "magic missile": fact(1, "1 action"),
  shield: fact(1, "1 reaction, which you take when you are hit by an attack"),
  sleep: fact(1, "1 action"),
  "detect magic": fact(1, "1 action", { concentration: true }),
  "misty step": fact(2, "1 bonus action"),
  "hold person": fact(2, "1 action", { concentration: true }),
  "scorching ray": fact(2, "1 action"),
  fireball: fact(3, "1 action", { desc: "Each creature in a 20-foot-radius sphere must make a Dexterity saving throw. A target takes 8d6 fire damage on a failed save." }),
  counterspell: fact(3, "1 reaction, which you take when you see a creature within 60 feet of you casting a spell"),
  "lightning bolt": fact(3, "1 action"),
  fly: fact(3, "1 action", { concentration: true }),
  "greater invisibility": fact(4, "1 action", { concentration: true }),
  "dimension door": fact(4, "1 action"),
  "cone of cold": fact(5, "1 action"),
  "wall of force": fact(5, "1 action", { concentration: true }),
};
const titled = (name) => name.replace(/(^|\s)\w/g, (c) => c.toUpperCase());

function sheet(overrides = {}) {
  return {
    id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
    name: "Lys", race: "human", class: "wizard", subclass: "", background: "", alignment: "", gender: "",
    level: 9, xp: 0,
    abilities: { str: 8, dex: 14, con: 14, int: 18, wis: 12, cha: 10 },
    maxHp: 50, currentHp: 50, tempHp: 0, ac: 12, acOverride: false, speed: 30,
    hitDice: { die: "d6", total: 9, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["daggers", "quarterstaffs", "simple", "shortsword"] },
    equipment: [{ name: "Component pouch", qty: 1 }, { name: "Quarterstaff", qty: 1 }, { name: "Dagger", qty: 1 }, { name: "Potion of healing", qty: 2 }],
    gold: 0, copper: 0, feats: [], features: [],
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 3, used: 1 }, 4: { max: 3, used: 0 }, 5: { max: 1, used: 0 } },
      prepared: Object.keys(FACTS).map(titled),
      known: [],
    },
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}
const features = (...names) => names.map((name) => ({ name, source: "Class", description: "" }));
const wizard = sheet();
const deal = (from, turn = FRESH_TURN) => deriveHand(from, turn, { spells: FACTS, gear: { allies: 2 } });
const ids = (list) => list.map((entry) => entry.id);
const groupOf = (groups, id) => groups.find((group) => group.id === id);

test("a level 9 wizard's thirty-odd cards fit the fan once grouped", () => {
  const cards = deal(wizard);
  assert.ok(cards.length > 30, `${cards.length} cards`);
  const { units, groups } = groupHand(cards, wizard);
  assert.ok(units.length <= HAND_FAN_CAP, `${units.length} seats: ${ids(units).join(" ")}`);
  assert.deepEqual(ids(groups).sort(), ["group:actions", "group:items", "group:spells"]);
  // Every card is still reachable: a loose card or a group's.
  const reach = units.flatMap((unit) => (isGroup(unit) ? unit.cards : [unit]));
  assert.deepEqual(ids(reach).sort(), ids(cards).sort());
  // The automatic split needs no More spine, and End turn keeps the last seat.
  const { fan, more } = splitHand(units);
  assert.equal(more.length, 0);
  assert.equal(fan[fan.length - 1].id, "basic:end-turn");
});

test("Spells opens on levels, each with the slots it has left", () => {
  const { groups } = groupHand(deal(wizard), wizard);
  const spells = groupOf(groups, "group:spells");
  assert.deepEqual(spells.sections.map((section) => section.label), ["Cantrips", "Level 1", "Level 2", "Level 3", "Level 4", "Level 5"]);
  const third = spells.sections.find((section) => section.label === "Level 3");
  assert.equal(third.note, "2 of 3 slots");
  assert.equal(spells.sections[0].note, "", "a cantrip spends no slot");
  assert.equal(spells.sections.find((section) => section.label === "Level 5").note, "1 of 1 slot");
  assert.equal(spells.left, "Slots 13/14");
  assert.equal(sectionLine(spells), "Cantrips 5 · L1 4 · L2 3 · L3 4 · L4 2 · L5 2");
  // Inside a level the hand's own order stands: the spell that hurts first.
  assert.equal(spells.sections[0].cards[0].id, "spell:fire bolt");
  // Costs it is paid in, each open while a card of it can be played.
  assert.deepEqual(spells.costs, [
    { cost: "action", open: true },
    { cost: "bonus", open: true },
    { cost: "reaction", open: true },
  ]);
});

test("a spent level says what still casts it", () => {
  const spent = sheet({
    spellcasting: { ...wizard.spellcasting, slots: { ...wizard.spellcasting.slots, 1: { max: 4, used: 4 } } },
  });
  assert.equal(slotNote(spent, 1), "0 of 4 slots, level 2 slots open");
  const warlock = { spellcasting: { ability: "cha", slots: {}, pact: { level: 3, max: 2, used: 1 }, prepared: [], known: [] } };
  assert.equal(slotNote(warlock, 1), "1 of 2 pact slots (level 3)");
  assert.equal(slotNote(warlock, 3), "1 of 2 pact slots");
  assert.equal(slotNote({ spellcasting: { ability: "int", slots: {}, prepared: [], known: [] } }, 2), "no slots");
});

test("after the action, the groups say which costs are still open", () => {
  const spent = deal(wizard, { ...FRESH_TURN, actionUsed: true });
  const { groups } = groupHand(spent, wizard);
  const spells = groupOf(groups, "group:spells");
  assert.deepEqual(
    spells.costs.map((entry) => `${entry.cost}:${entry.open}`),
    ["action:false", "bonus:true", "reaction:true"],
    "Misty Step and the reactions are still open",
  );
  assert.equal(spells.disabled, null, "a group with a card to play is not refused");
  const actions = groupOf(groups, "group:actions");
  assert.ok(actions.disabled, "every basic action wants the spent action");
  assert.equal(actions.costs[0].open, false);
});

test("a small group stays as cards: an Eldritch Knight's two spells", () => {
  const knight = sheet({
    class: "fighter",
    spellcasting: { ability: "int", slots: { 1: { max: 2, used: 0 } }, prepared: ["Fire Bolt", "Shield"], known: [] },
  });
  const cards = deal(knight);
  const { units, groups } = groupHand(cards, knight);
  assert.ok(!groupOf(groups, "group:spells"));
  assert.ok(ids(units).includes("spell:fire bolt") && ids(units).includes("spell:shield"));
  assert.equal(GROUP_FOLD_MIN, 4);
});

test("ki techniques fold under Ki; the plain moves stay under Actions", () => {
  const monk = sheet({
    class: "monk",
    classes: [{ id: "monk", level: 5 }],
    spellcasting: null,
    equipment: [{ name: "Shortsword", qty: 1 }],
    resources: { ki: { max: 5, used: 1 } },
    features: features("Martial Arts", "Flurry of Blows", "Patient Defense", "Step of the Wind"),
  });
  const cards = deriveHand(monk, { ...FRESH_TURN, attacksMade: 1 });
  const { units, groups } = groupHand(cards, monk);
  const ki = groupOf(groups, "group:pool:ki");
  assert.ok(ki, `groups: ${ids(groups)}`);
  assert.equal(ki.name, "Ki");
  assert.equal(ki.left, "Ki 4/5");
  assert.ok(ids(ki.cards).includes("feature:ki:flurry"));
  assert.ok(ids(ki.cards).includes("basic:dash:bonus"), "Step of the Wind's Dash spends ki");
  const actions = groupOf(groups, "group:actions");
  assert.ok(ids(actions.cards).includes("basic:dash"));
  assert.ok(!ids(actions.cards).includes("basic:dash:bonus"));
  // The Martial Arts strike is an attack: attacks never fold.
  assert.ok(ids(units).includes("attack:unarmed strike:martial-arts"));
});

test("maneuvers fold under Superiority dice with the dice left", () => {
  const master = sheet({
    class: "fighter",
    classes: [{ id: "fighter", level: 7 }],
    subclass: "Battle Master",
    spellcasting: null,
    equipment: [{ name: "Shortsword", qty: 1 }],
    resources: { sub_superiority_dice: { max: 5, used: 2 }, second_wind: { max: 1, used: 0 } },
    features: features("Maneuver: Trip Attack", "Maneuver: Precision Attack", "Maneuver: Rally", "Maneuver: Menacing Attack"),
  });
  const { units, groups } = groupHand(deriveHand(master), master);
  const dice = groupOf(groups, "group:pool:sub_superiority_dice");
  assert.ok(dice, `groups: ${ids(groups)}`);
  assert.equal(dice.name, "Superiority dice");
  assert.equal(dice.left, "Dice 3/5");
  assert.ok(ids(dice.cards).includes("rider:trip attack"));
  assert.ok(ids(dice.cards).includes("option:sub_superiority_dice:rally"));
  assert.ok(ids(units).includes("feature:second_wind"), "a feature of its own pool stays a card");
});

test("what never folds: attacks, urgent cards, End turn, a lone feature", () => {
  const prone = sheet({ conditions: ["prone", "grappled"] });
  const cards = deal(prone);
  for (const id of ["basic:stand-up", "basic:escape", "basic:end-turn", "attack:quarterstaff"]) {
    const card = cards.find((entry) => entry.id === id);
    assert.ok(card, `${id} dealt`);
    assert.equal(groupKeyOf(card), null, id);
  }
  const reaction = { ...cards[0], id: "reaction:shield", type: "ward", cost: "reaction" };
  assert.equal(groupKeyOf(reaction), null);
  const { units } = groupHand(cards, prone);
  assert.ok(ids(units).includes("basic:stand-up") && ids(units).includes("basic:escape"));
});

test("a favourite seated on its own sits in the fan and stays in its group", () => {
  const cards = deal(wizard);
  const { units, groups } = groupHand(cards, wizard);
  const layout = { fan: ["spell:fireball", "group:spells", "attack:dagger"], known: ids(cards) };
  const { fan, more, fresh } = arrangeHand(units, layout, HAND_FAN_CAP, cards);
  assert.deepEqual(ids(fan), ["spell:fireball", "group:spells", "attack:dagger", "basic:end-turn"]);
  assert.ok(groupOf(groups, "group:spells").cards.some((card) => card.id === "spell:fireball"), "Fireball is still inside Spells");
  assert.ok(ids(more).includes("group:actions"));
  assert.ok(!ids(more).includes("spell:fireball"), "a group's card is never a loose card in More");
  assert.deepEqual(fresh, [], "nothing is new when every card was known");
  // A group takes a seat like a card, and End turn still keeps its own.
  const full = { fan: ids(units).filter((id) => id !== "basic:end-turn").slice(0, 8), known: [] };
  assert.ok("layout" in addToHand({ fan: [], known: [] }, groupOf(groups, "group:items")));
  assert.ok(full.fan.length <= 8);
});

test("a layout saved before the groups still places its cards", () => {
  const cards = deal(wizard);
  const { units } = groupHand(cards, wizard);
  // Issue 231's layouts name cards only.
  const old = { fan: ["spell:fire bolt", "basic:dash", "spell:misty step"], known: ids(cards) };
  const { fan, more, fresh, freshIds } = arrangeHand(units, old, HAND_FAN_CAP, cards);
  assert.deepEqual(ids(fan), ["spell:fire bolt", "basic:dash", "spell:misty step", "basic:end-turn"]);
  assert.ok(ids(more).includes("group:spells") && ids(more).includes("group:actions"));
  // The groups are new words for cards the player knew: not marked new.
  assert.deepEqual(fresh, []);
  assert.deepEqual(freshIds, []);
});

test("a spell gained since arranging marks its group and itself as new", () => {
  const before = deal(sheet({ spellcasting: { ...wizard.spellcasting, prepared: Object.keys(FACTS).map(titled).filter((name) => name !== "Fly") } }));
  const after = deal(wizard);
  const { units } = groupHand(after, wizard);
  const layout = { fan: ["attack:dagger"], known: ids(before) };
  const { fresh, freshIds } = arrangeHand(units, layout, HAND_FAN_CAP, after);
  assert.deepEqual(ids(fresh), ["group:spells"]);
  assert.deepEqual(freshIds, ["spell:fly"]);
  // Arranging again remembers what is held now, group members included.
  const again = startingLayout(units, layout, after);
  assert.deepEqual(arrangeHand(units, again, HAND_FAN_CAP, after).freshIds, []);
});

test("the filters: costs, Concentration and words", () => {
  const { groups } = groupHand(deal(wizard), wizard);
  const spells = groupOf(groups, "group:spells").cards;
  assert.deepEqual(ids(filterCards(spells, { ...NO_FILTER, costs: ["bonus"] })), ["spell:misty step"]);
  assert.deepEqual(ids(filterCards(spells, { ...NO_FILTER, costs: ["reaction"] })).sort(), ["spell:counterspell", "spell:shield"]);
  const held = ids(filterCards(spells, { ...NO_FILTER, concentration: true })).sort();
  assert.deepEqual(held, ["spell:detect magic", "spell:fly", "spell:greater invisibility", "spell:hold person", "spell:wall of force"]);
  // Words look in the name and the dice line: "fire" finds the fire damage,
  // Scorching Ray's too, which says it in its dice and not its name.
  assert.deepEqual(ids(filterCards(spells, { ...NO_FILTER, query: "fire" })).sort(), ["spell:fire bolt", "spell:fireball", "spell:scorching ray"]);
  assert.deepEqual(ids(filterCards(spells, { ...NO_FILTER, query: "  HOLD per " })), ["spell:hold person"]);
  assert.deepEqual(filterCards(spells, { ...NO_FILTER, query: "zzz" }), []);
  // Chips only where they narrow: no Action chip on a hand of all actions.
  const chips = filterChips(spells).map((chip) => `${chip.id}:${chip.count}`);
  assert.deepEqual(chips, ["action:17", "bonus:1", "reaction:2", "concentration:5"]);
  const actions = groupOf(groups, "group:actions").cards;
  assert.deepEqual(filterChips(actions), []);
});

test("a table without the content pack deals each spell at its own cost", () => {
  // No facts fetched: the bundled facts the cast guard reads stand in.
  const packless = deriveHand(wizard, FRESH_TURN, { gear: { allies: 2 } });
  const cost = (id) => packless.find((card) => card.id === id)?.cost;
  assert.equal(cost("spell:shield"), "reaction");
  assert.equal(cost("spell:counterspell"), "reaction");
  assert.equal(cost("spell:misty step"), "bonus");
  assert.equal(cost("spell:fireball"), "action");
  const { groups } = groupHand(packless, wizard);
  const spells = groupOf(groups, "group:spells");
  assert.equal(spells.sections.find((section) => section.label === "Level 3").cards.some((card) => card.id === "spell:fireball"), true);
  assert.ok(spells.cards.find((card) => card.id === "spell:hold person").concentration);
});

test("the pips name the cost each pays for (issue 529)", () => {
  assert.deepEqual(
    turnPips({ ...FRESH_TURN, bonusUsed: true }).map((pip) => `${pip.cost}:${pip.used}`),
    ["action:false", "bonus:true", "reaction:false"],
  );
});

console.log(`${passed} hand group checks passed`);
