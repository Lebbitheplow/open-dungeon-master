// Issue #424: gear in a fight, as the Hand deals it and the rules charge it.
//
// SRD 5.1, Actions in Combat: one object interaction a turn is free (draw or
// stow a weapon, pick something up, hand it over); a second takes the Use an
// Object action. Dropping something costs nothing. A shield takes an action
// to don or doff. Dual Wielder draws or stows two one-handed weapons where
// one would go. The cards here are judged by the same spend functions the
// tools call (src/lib/dm/gear-hands.ts), so a card never promises a cost the
// engine would not charge.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { composeSentence, intentBody, afterCommit } = await import("../src/lib/battlemap/hand-play.ts");
const { spendInteraction, drawRow, holdIfFree } = await import("../src/lib/dm/gear-hands.ts");
const { describeBudget } = await import("../src/lib/dm/action-budget.ts");
const { intentTools, describeIntent, messageIntentSchema } = await import("../src/lib/dm/intent-logic.ts");
const { autoGroups } = await import("../src/lib/dm/tool-profiles.ts");
const { handedOverRow, addRowMath } = await import("../src/lib/dm/mutation-math.ts");
const { resolveAttackWeapon } = await import("../src/lib/dm/attack-logic.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
  passed += 1;
}

function sheet(overrides = {}) {
  return {
    id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
    name: "Kael", race: "human", class: "fighter", subclass: "", background: "", alignment: "", gender: "",
    level: 4, xp: 0,
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    maxHp: 36, currentHp: 36, tempHp: 0, ac: 16, acOverride: false, speed: 30,
    hitDice: { die: "d10", total: 4, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], expertise: [], languages: [], tools: [], armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] },
    equipment: [], gold: 0, copper: 0, feats: [], features: [], spellcasting: null,
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}
const byId = (cards, id) => cards.find((card) => card.id === id);
const budget = (overrides = {}) => ({
  ownerId: "s1", round: 1, actionUsed: false, bonusUsed: false, reactionUsed: false,
  attacksMade: 0, attacksAllowed: 1, oncePerTurn: [], dashed: false, disengaged: false, ...overrides,
});

// A fighter who says what they hold: a longsword in hand and a shield on
// the arm, a dagger and a greatsword stowed, a potion in the pack.
const ARMED = [
  { name: "Chain Mail", qty: 1, equipped: true },
  { name: "Shield", qty: 1, equipped: true },
  { name: "Longsword", qty: 1, equipped: true },
  { name: "Dagger", qty: 2, equipped: false },
  { name: "Greatsword", qty: 1, equipped: false },
  { name: "Potion of Healing", qty: 2 },
];

// ---- the interaction ----

test("the first object interaction a turn is free; a second takes the Use an Object action; with the action gone it waits", () => {
  const first = spendInteraction(budget(), { what: "drawing a dagger", who: "Kael" });
  assert.equal(first.ok, true);
  assert.equal(first.budget.actionUsed, false);
  assert.deepEqual(first.budget.interaction, { what: "drawing a dagger", weapons: 0 });
  const second = spendInteraction(first.budget, { what: "picking up a torch", who: "Kael" });
  assert.equal(second.ok, true);
  assert.equal(second.budget.actionUsed, true);
  const third = spendInteraction(second.budget, { what: "stowing a dagger", who: "Kael" });
  assert.equal(third.ok, false);
  assert.match(third.error, /Use an Object action, which Kael has already spent/);
});

test("Dual Wielder draws a second one-handed weapon with the same interaction; a third is the action", () => {
  const first = spendInteraction(budget(), { what: "drawing a rapier", who: "Kael", oneHandedWeapon: true, dualWielder: true });
  const second = spendInteraction(first.budget, { what: "drawing a dagger", who: "Kael", oneHandedWeapon: true, dualWielder: true });
  assert.equal(second.ok, true);
  assert.equal(second.budget.actionUsed, false);
  assert.match(second.note, /Dual Wielder/);
  const third = spendInteraction(second.budget, { what: "drawing a handaxe", who: "Kael", oneHandedWeapon: true, dualWielder: true });
  assert.equal(third.budget.actionUsed, true);
});

test("a thief's Fast Hands pays the second interaction with the bonus action once the action is gone", () => {
  const used = budget({ interaction: { what: "drawing a dagger", weapons: 1 }, actionUsed: true });
  const fast = spendInteraction(used, { what: "picking up a key", who: "Vex", fastHands: true });
  assert.equal(fast.ok, true);
  assert.equal(fast.budget.bonusUsed, true);
});

test("an attack cannot draw a second weapon: the Attack action is not also Use an Object", () => {
  const used = budget({ interaction: { what: "drawing a dagger", weapons: 1 } });
  const refused = spendInteraction(used, { what: "drawing Greatsword", who: "Kael", withAction: false });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /an attack cannot draw it as well/);
});

test("the GAME STATE budget line says the interaction is still free, and stops saying so once it is spent", () => {
  assert.match(describeBudget(budget()), /free object interaction/);
  assert.doesNotMatch(describeBudget(budget({ interaction: { what: "x", weapons: 0 } })), /free object interaction/);
});

// ---- the hands ----

test("a draw needs a free hand: with a sword and a shield in hand nothing more is drawn, and putting one away is never folded into it", () => {
  const great = ARMED.find((item) => item.name === "Greatsword");
  const refused = drawRow(ARMED, great, null);
  assert.deepEqual(refused.full, ["Shield", "Longsword"]);
  assert.deepEqual(refused.equipment, ARMED);
  // With the longsword dropped (free), the dagger fits beside the shield.
  const freed = ARMED.filter((item) => item.name !== "Longsword");
  const dagger = freed.find((item) => item.name === "Dagger");
  const drawn = drawRow(freed, dagger, null);
  assert.deepEqual(drawn.full, []);
  assert.equal(drawn.equipment.find((item) => item.name === "Dagger").equipped, true);
  // A greatsword takes both hands: not with the shield on.
  assert.deepEqual(drawRow(freed, freed.find((item) => item.name === "Greatsword"), null).full, ["Shield"]);
});

test("a weapon picked up or handed over is held when a hand is free, and goes to the pack when both are full", () => {
  const oneFree = [{ name: "Chain Mail", qty: 1, equipped: true }, { name: "Longsword", qty: 1, equipped: true }, { name: "Mace", qty: 1 }];
  const held = holdIfFree(oneFree, "Mace");
  assert.equal(held.held, true);
  assert.equal(held.equipment.find((item) => item.name === "Mace").equipped, true);
  const full = holdIfFree(ARMED.concat([{ name: "Mace", qty: 1 }]), "Mace");
  assert.equal(full.held, false);
});

test("an item handed over keeps what it is (a scroll's spell, a wand's charges, its tags) and drops what was the giver's (worn, attuned)", () => {
  const scroll = { name: "Spell Scroll", qty: 2, srdName: "Spell Scroll (1st Level)", spell: "Cure Wounds", tags: ["scroll"], equipped: true, attuned: true };
  const given = handedOverRow(scroll, 1);
  assert.equal(given.qty, 1);
  assert.equal(given.spell, "Cure Wounds");
  assert.equal(given.srdName, "Spell Scroll (1st Level)");
  assert.deepEqual(given.tags, ["scroll"]);
  assert.equal(given.equipped, undefined);
  assert.equal(given.attuned, undefined);
  const wand = { name: "Wand of Magic Missiles", qty: 1, charges: { max: 7, used: 2 } };
  assert.deepEqual(handedOverRow(wand, 1).charges, { max: 7, used: 2 });
  // Two scrolls of different spells stay two rows.
  const merged = addRowMath([{ name: "Spell Scroll", qty: 1, spell: "Shield" }], given);
  assert.equal(merged.length, 2);
});

test("an attack that names no weapon swings what is in hand before a better blade still sheathed", () => {
  const gear = [
    { name: "Leather Armor", qty: 1, equipped: true },
    { name: "Dagger", qty: 1, equipped: true },
    { name: "Greataxe", qty: 1, equipped: false },
  ];
  assert.equal(resolveAttackWeapon(gear, ["simple", "martial"], undefined).displayName, "Dagger");
  // A sheet that never said what it holds still takes the best it carries.
  const loose = gear.map((item) => ({ name: item.name, qty: item.qty }));
  assert.equal(resolveAttackWeapon(loose, ["simple", "martial"], undefined).displayName, "Greataxe");
});

// ---- the cards ----

test("with both hands full the Draw card waits and says how to free one; the stowed weapon's attack card says the same", () => {
  const cards = deriveHand(sheet({ equipment: ARMED }), FRESH_TURN);
  assert.match(byId(cards, "gear:draw").disabled ?? "", /hands are full \(Shield and Longsword\).*Dropping one is free/);
  assert.match(byId(cards, "attack:dagger").disabled ?? "", /hands are full/);
  assert.equal(byId(cards, "attack:longsword").disabled, null);
});

// The same fighter with the shield slung: one hand free.
const ONE_FREE = ARMED.map((item) => (item.name === "Shield" ? { ...item, equipped: false } : item));

test("the Hand deals the gear cards an armed fighter can use: the shield (an action), draw and stow (the free interaction), drop (free)", () => {
  const cards = deriveHand(sheet({ equipment: ONE_FREE }), FRESH_TURN);
  const shield = byId(cards, "gear:don-shield");
  assert.equal(shield.cost, "action");
  assert.equal(shield.name, "Strap on Shield");
  const draw = byId(cards, "gear:draw");
  assert.equal(draw.cost, "free");
  assert.equal(draw.resource, "Interaction");
  assert.equal(draw.disabled, null);
  // The greatsword wants both hands, and one holds the longsword.
  assert.deepEqual(draw.choice.options.map((option) => option.value), ["Dagger"]);
  const stow = byId(cards, "gear:stow");
  assert.deepEqual(stow.choice.options.map((option) => option.value), ["Longsword"]);
  const drop = byId(cards, "gear:drop");
  assert.equal(drop.cost, "free");
  assert.equal(drop.disabled, null);
  const potion = byId(cards, "gear:potion");
  assert.equal(potion.cost, "action");
  assert.equal(potion.target, "ally");
});

test("a sheet that never said what it holds holds everything, so there is nothing to draw", () => {
  const cards = deriveHand(sheet({ equipment: [{ name: "Longsword", qty: 1 }, { name: "Dagger", qty: 1 }] }), FRESH_TURN);
  assert.equal(byId(cards, "gear:draw"), undefined);
  assert.ok(byId(cards, "gear:stow"));
});

test("once the interaction is spent, drawing costs the Use an Object action, and with the action gone too the card waits", () => {
  const spent = { ...FRESH_TURN, interactionUsed: true };
  const draw = byId(deriveHand(sheet({ equipment: ONE_FREE }), spent), "gear:draw");
  assert.equal(draw.cost, "action");
  assert.equal(draw.disabled, null);
  assert.match(draw.rules, /Use an Object action/);
  const none = byId(deriveHand(sheet({ equipment: ONE_FREE }), { ...spent, actionUsed: true }), "gear:draw");
  assert.ok(none.disabled);
  assert.equal(none.spent, true);
  // Dropping stays free.
  assert.equal(byId(deriveHand(sheet({ equipment: ARMED }), { ...spent, actionUsed: true }), "gear:drop").disabled, null);
});

test("a stowed weapon's attack card waits once the interaction is spent; the one in hand still swings", () => {
  const spent = { ...FRESH_TURN, interactionUsed: true };
  const cards = deriveHand(sheet({ equipment: ONE_FREE }), spent);
  assert.match(byId(cards, "attack:dagger").disabled ?? "", /an attack cannot draw it as well/);
  assert.equal(byId(cards, "attack:longsword").disabled, null);
  // With the interaction free, the attack draws it (pc-attack-plan.ts).
  assert.equal(byId(deriveHand(sheet({ equipment: ONE_FREE }), FRESH_TURN), "attack:dagger").disabled, null);
});

test("Pick up appears for what lies within 5 ft, Hand to an ally only with an ally, Stabilize for a dying ally, Dismount when mounted", () => {
  const gear = {
    drops: [{ id: "d1", name: "Handaxe", reach: true }, { id: "d2", name: "Torch", reach: false }],
    allies: 1,
    dying: [{ id: "s2", name: "Mira" }],
    mount: "Warhorse",
  };
  const cards = deriveHand(sheet({ equipment: ARMED }), FRESH_TURN, { gear });
  assert.deepEqual(byId(cards, "gear:pick-up").choice.options, [{ value: "d1", label: "Handaxe" }]);
  assert.equal(byId(cards, "gear:hand").target, "ally");
  assert.equal(byId(cards, "basic:stabilize").cost, "action");
  assert.equal(byId(cards, "basic:dismount").cost, "free");
  const alone = deriveHand(sheet({ equipment: ARMED }), FRESH_TURN, { gear: { allies: 0 } });
  for (const id of ["gear:pick-up", "gear:hand", "basic:stabilize", "basic:dismount"]) {
    assert.equal(byId(alone, id), undefined, id);
  }
});

test("each card says its move in a plain sentence and sends the item with it", () => {
  const hero = sheet({ equipment: ARMED });
  const freeHand = deriveHand(sheet({ equipment: ONE_FREE }), FRESH_TURN);
  const gear = { drops: [{ id: "d1", name: "Handaxe", reach: true }], allies: 1, dying: [{ id: "s2", name: "Mira" }], mount: "Warhorse" };
  const cards = deriveHand(hero, FRESH_TURN, { gear });
  const mira = { id: "s2", name: "Mira", kind: "ally" };
  const me = { id: "s1", name: "Kael", kind: "self" };
  assert.equal(composeSentence(byId(freeHand, "gear:draw"), null, [], { choice: "Dagger" }), "I draw my Dagger.");
  assert.equal(composeSentence(byId(cards, "gear:stow"), null), "I stow my Longsword.");
  assert.equal(composeSentence(byId(cards, "gear:drop"), null), "I drop my Longsword.");
  assert.equal(composeSentence(byId(cards, "gear:doff-shield"), null), "I take off my Shield.");
  assert.equal(composeSentence(byId(cards, "gear:pick-up"), null), "I pick up the Handaxe.");
  assert.equal(composeSentence(byId(cards, "gear:hand"), mira, [], { choice: "Dagger" }), "I hand my Dagger to Mira.");
  assert.equal(composeSentence(byId(cards, "gear:potion"), me), "I drink my Potion of Healing.");
  assert.equal(composeSentence(byId(cards, "gear:potion"), mira), "I give Mira my Potion of Healing to drink.");
  assert.equal(composeSentence(byId(cards, "basic:stabilize"), mira), "I try to stabilize Mira.");
  assert.equal(composeSentence(byId(cards, "basic:dismount"), null), "I dismount.");
  const body = intentBody(byId(cards, "gear:pick-up"), null);
  assert.equal(body.card, "gear");
  assert.equal(body.action, "pick_up");
  assert.equal(body.item, "d1");
});

test("the server reads a gear card: it parses and names handle_item (use_item for a potion)", () => {
  const sent = { card: "gear", action: "equip", item: "Greatsword" };
  const parsed = messageIntentSchema.parse(sent);
  assert.equal(parsed.item, "Greatsword");
  assert.deepEqual(intentTools(parsed), ["handle_item"]);
  assert.deepEqual(intentTools(messageIntentSchema.parse({ card: "gear", action: "use", item: "Potion of Healing" })), ["use_item"]);
  assert.deepEqual(intentTools(messageIntentSchema.parse({ card: "basic", action: "stabilize", targetId: "s2" })), ["stabilize"]);
  assert.deepEqual(intentTools(messageIntentSchema.parse({ card: "basic", action: "dismount" })), ["dismount"]);
  const handed = messageIntentSchema.parse({ card: "gear", action: "hand", item: "Dagger", targetId: "s2", targetName: "Mira", targetKind: "ally" });
  assert.match(describeIntent(handed, "s1"), /toCharacterId=s2/);
});

test("playing a draw marks the interaction spent; playing a drop or the shield does not", () => {
  const hero = sheet({ equipment: ONE_FREE });
  const cards = deriveHand(hero, FRESH_TURN);
  assert.equal(afterCommit(FRESH_TURN, byId(cards, "gear:draw")).interactionUsed, true);
  assert.equal(afterCommit(FRESH_TURN, byId(cards, "gear:drop")).interactionUsed, undefined);
  const shield = afterCommit(FRESH_TURN, byId(cards, "gear:don-shield"));
  assert.equal(shield.interactionUsed, undefined);
  assert.equal(shield.actionUsed, true);
});

test("a played gear sentence opens the gear tools for a compact call", () => {
  for (const text of ["I draw my Greatsword.", "I take off my Shield.", "I drop my Longsword.", "I pick up the Handaxe.", "I hand my Dagger to Mira."]) {
    assert.ok(autoGroups({ inEncounter: true, englishPlayerText: text }).has("gear"), text);
  }
});

console.log(`test-hand-gear: ${passed} passed`);
