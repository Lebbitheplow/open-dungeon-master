// The player's screens for what the engine gained after the first UI pass
// (workstream final-ui of the second rules-enforcement repair,
// /tmp/odm-enf2/fixes/final-ui.md): Inspiration, Stroke of Luck, Hurl
// Through Hell and Open Hand Technique on an attack card, a subclass's bonus
// attack, Fast Hands, Ready with a spell, the choice a spell asks for, the
// subclass spends and reactions, Absorb Elements gone from the reaction
// prompt, end-of-turn condition notes, the new condition glyphs, initiative
// rows keyed by position, the sheet's counters and choices, Inspiration on a
// parked roll, the climb brush. Every gate is the engine's own pure function.
// Pure: no database, no server.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { previewRows, composeSentence, intentBody, toggleOption } = await import("../src/lib/battlemap/hand-play.ts");
const { reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { spellChoice } = await import("../src/lib/battlemap/hand-spells.ts");
const { featureChoices } = await import("../src/lib/battlemap/hand-subclass.ts");
const { conditionNote, conditionNoteLine } = await import("../src/lib/battlemap/condition-notes.ts");
const { glyphFor } = await import("../src/lib/battlemap/condition-glyphs.ts");
const { orderRowKey, currentOrderIndex } = await import("../src/lib/battlemap/initiative-rows.ts");
const { BRUSHES, paintTerrain } = await import("../src/lib/battlemap/paint.ts");
const { TERRAIN, moveCost } = await import("../src/lib/battlemap/types.ts");
const { messageIntentSchema, describeIntent } = await import("../src/lib/dm/intent-logic.ts");
const { OPEN_HAND_CHOICES, OPEN_HAND_NOT_FLURRY } = await import("../src/lib/dm/attack-choice-rules.ts");
const { inspiredRoll } = await import("../src/lib/dm/pending-inspiration.ts");
const { spellMechFor } = await import("../src/lib/srd/spell-mechanics.ts");
const { counterView, otherSpeedsLine } = await import("../src/components/sheet/sheet-state.ts");
const { COMBAT_ADJUDICATIONS } = await import("../src/lib/dm/catalog-combat.ts");

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
    name: "Kael", race: "human", class: "fighter", subclass: "", background: "", alignment: "", gender: "",
    level: 4, xp: 0,
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 14, cha: 12 },
    maxHp: 36, currentHp: 36, tempHp: 0, ac: 16, acOverride: false, speed: 30,
    hitDice: { die: "d10", total: 4, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], expertise: [], languages: [], tools: [], armor: [], weapons: ["simple", "martial"] },
    equipment: [], gold: 0, copper: 0, feats: [], features: [], spellcasting: null,
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}
const item = (name, extra = {}) => ({ name, qty: 1, ...extra });
const feature = (name) => ({ name, source: "class" });
const byId = (cards, id) => cards.find((card) => card.id === id);
const option = (card, id) => card.options?.find((entry) => entry.id === id);
const mine = (extra = {}) => ({
  ...FRESH_TURN,
  table: { round: 2, orderReady: true, acting: { id: "s1", name: "Kael" }, surprised: { acting: [], reacting: [] } },
  ...extra,
});
const aimAt = { id: "e1", name: "Goblin 1", kind: "enemy", cr: 0.25, conditions: [] };

const SPELLS = {
  "fire bolt": { level: 0, school: "evocation", castingTime: "1 action", range: "120 feet", concentration: false, desc: "Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage.", higherLevel: "" },
  command: { level: 1, school: "enchantment", castingTime: "1 action", range: "60 feet", concentration: false, desc: "You speak a one-word command to a creature you can see within range. The target must succeed on a Wisdom saving throw.", higherLevel: "" },
  "heat metal": { level: 2, school: "transmutation", castingTime: "1 action", range: "60 feet", concentration: true, desc: "Choose a manufactured metal object. It deals 2d8 fire damage.", higherLevel: "" },
  "absorb elements": { level: 1, school: "abjuration", castingTime: "1 reaction", range: "Self", concentration: false, desc: "The spell captures some of the incoming energy.", higherLevel: "" },
};

// ---- the new attack options ----

test("Inspiration is a toggle on the attack card while it is held, sends useInspiration and previews advantage", () => {
  const held = sheet({ equipment: [item("Longsword")], resources: { inspiration: { max: 1, used: 0 } } });
  const card = byId(deriveHand(held, mine()), "attack:longsword");
  const inspire = option(card, "useInspiration");
  assert.ok(inspire, "the toggle is offered");
  assert.equal(inspire.disabled, null);
  const body = intentBody(card, aimAt, [], { options: ["useInspiration"] });
  assert.equal(body.attack.useInspiration, true);
  assert.match(composeSentence(card, aimAt, [], { options: ["useInspiration"] }), /I spend my Inspiration on it\./);
  const toHit = previewRows(card, aimAt, [], { options: ["useInspiration"] }).find((row) => row.key === "To hit");
  assert.match(toHit.value, /advantage/);
  const none = sheet({ equipment: [item("Longsword")] });
  assert.equal(option(byId(deriveHand(none, mine()), "attack:longsword"), "useInspiration"), undefined);
});

test("Stroke of Luck is offered to a rogue 20 and carries the engine's refusal once it is spent", () => {
  const rogue = sheet({
    class: "rogue", level: 20, classes: [{ id: "rogue", level: 20 }], equipment: [item("Rapier")],
    resources: { stroke_of_luck: { max: 1, used: 1 } },
  });
  const luck = option(byId(deriveHand(rogue, mine()), "attack:rapier"), "strokeOfLuck");
  assert.ok(luck);
  assert.match(luck.disabled, /has used Stroke of Luck; it comes back on a short or long rest/);
  const fresh = { ...rogue, resources: { stroke_of_luck: { max: 1, used: 0 } } };
  const ready = byId(deriveHand(fresh, mine()), "attack:rapier");
  assert.equal(option(ready, "strokeOfLuck").disabled, null);
  assert.equal(intentBody(ready, aimAt, [], { options: ["strokeOfLuck"] }).attack.strokeOfLuck, true);
});

test("Hurl Through Hell is a toggle for a Fiend warlock 14 with the use left, refused once it is spent", () => {
  const warlock = sheet({
    class: "warlock", subclass: "The Fiend", level: 14, classes: [{ id: "warlock", level: 14 }], equipment: [item("Dagger")],
    resources: { hurl_through_hell: { max: 1, used: 0 } },
  });
  const card = byId(deriveHand(warlock, mine()), "attack:dagger");
  assert.equal(option(card, "hurlThroughHell").disabled, null);
  assert.equal(intentBody(card, aimAt, [], { options: ["hurlThroughHell"] }).attack.hurlThroughHell, true);
  const spent = { ...warlock, resources: { hurl_through_hell: { max: 1, used: 1 } } };
  assert.match(option(byId(deriveHand(spent, mine()), "attack:dagger"), "hurlThroughHell").disabled, /has used Hurl Through Hell/);
});

test("Open Hand Technique is one pick of three, open only on a Flurry of Blows strike, and sent as pc_attack's openHand", () => {
  const monk = sheet({
    name: "Kael", class: "monk", subclass: "Way of the Open Hand", level: 5, classes: [{ id: "monk", level: 5 }],
    features: [feature("Martial Arts"), feature("Open Hand Technique")], resources: { ki: { max: 5, used: 0 } },
  });
  const before = byId(deriveHand(monk, mine({ attacksMade: 1, actionUsed: true })), "attack:unarmed strike");
  const riders = before.options.filter((entry) => entry.group === "openHand");
  assert.deepEqual(riders.map((entry) => entry.id.split(":")[1]), [...OPEN_HAND_CHOICES]);
  assert.ok(riders.every((entry) => entry.disabled === OPEN_HAND_NOT_FLURRY), "the engine's sentence off a flurry");
  const flurry = byId(
    deriveHand(monk, mine({ attacksMade: 1, actionUsed: true, bonusUsed: true, flurryStrikes: 2 })),
    "attack:unarmed strike",
  );
  assert.ok(flurry.options.filter((entry) => entry.group === "openHand").every((entry) => entry.disabled === null));
  // One pick of the group at a time; a second press takes it back.
  let chosen = toggleOption(flurry.options, [], "openHand:prone");
  chosen = toggleOption(flurry.options, chosen, "openHand:push");
  assert.deepEqual(chosen, ["openHand:push"]);
  assert.deepEqual(toggleOption(flurry.options, chosen, "openHand:push"), []);
  const body = intentBody(flurry, aimAt, [], { options: chosen });
  assert.equal(body.attack.openHand, "push");
  const parsed = messageIntentSchema.parse(body);
  assert.match(describeIntent(parsed, "s1"), /openHand=push/);
});

test("Rapid Strike is a toggle for a Samurai 15 and sends pc_attack's rapidStrike", () => {
  const samurai = sheet({
    subclass: "Samurai", level: 15, classes: [{ id: "fighter", level: 15 }], features: [feature("Rapid Strike")], equipment: [item("Longsword")],
  });
  const card = byId(deriveHand(samurai, mine()), "attack:longsword");
  assert.equal(option(card, "rapidStrike")?.disabled, null);
  assert.equal(intentBody(card, aimAt, [], { options: ["rapidStrike"] }).attack.rapidStrike, true);
  assert.equal(option(byId(deriveHand(sheet({ equipment: [item("Longsword")] }), mine()), "attack:longsword"), "rapidStrike"), undefined);
});

test("the console's Open Hand select offers exactly pc_attack's choices", () => {
  const form = COMBAT_ADJUDICATIONS.find((entry) => entry.name === "pc_attack");
  const field = form.fields.find((entry) => entry.name === "openHand");
  assert.deepEqual(field.options.map((entry) => entry.value), [...OPEN_HAND_CHOICES]);
  for (const name of ["useInspiration", "strokeOfLuck", "hurlThroughHell"]) {
    assert.equal(form.fields.find((entry) => entry.name === name)?.kind, "boolean", name);
  }
});

// ---- new cards ----

test("a subclass's bonus weapon attack is a card, refused in the authored layer's words until the spell is cast", () => {
  const bard = sheet({
    name: "Kael", class: "bard", subclass: "College of Valor", level: 14, classes: [{ id: "bard", level: 14 }],
    features: [feature("Battle Magic")], equipment: [item("Rapier")],
  });
  const card = byId(deriveHand(bard, mine()), "attack:rapier:feature");
  assert.ok(card, "the Battle Magic card");
  assert.equal(card.cost, "bonus");
  assert.match(card.disabled, /Battle Magic's bonus-action weapon attack comes after they cast a spell with their action/);
  const cast = byId(deriveHand(bard, mine({ actionUsed: true, castThisAction: true })), "attack:rapier:feature");
  assert.equal(cast.disabled, null);
  assert.equal(intentBody(cast, aimAt).attack.bonusAttack, "feature");
  assert.match(composeSentence(cast, aimAt), /as a bonus action \(Battle Magic\)/);
  assert.ok(messageIntentSchema.safeParse(intentBody(cast, aimAt)).success, "the message schema takes bonusAttack feature");
});

test("Fast Hands gives a Thief a bonus-action Use an Object card; others have none", () => {
  const thief = sheet({ class: "rogue", subclass: "Thief", level: 3, classes: [{ id: "rogue", level: 3 }] });
  const card = byId(deriveHand(thief, mine()), "basic:use-object:bonus");
  assert.ok(card);
  assert.equal(card.cost, "bonus");
  assert.equal(card.intent.bonus, true);
  assert.match(composeSentence(card, null), /^I use an object as a bonus action \(Fast Hands\): /);
  assert.equal(byId(deriveHand(sheet(), mine()), "basic:use-object:bonus"), undefined);
});

test("Ready may hold a spell: the pick sends take_action's spell and level beside the trigger", () => {
  const wizard = sheet({
    name: "Kael", class: "wizard", abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Fire Bolt", "Command"], known: [] },
  });
  const ready = byId(deriveHand(wizard, mine(), { spells: SPELLS }), "basic:ready");
  assert.equal(ready.choice.arg, "readySpell");
  assert.ok(ready.choice.options.some((entry) => entry.value === "Fire Bolt"));
  assert.equal(ready.choice.levels.Command, 1);
  const choices = { trigger: "the ogre steps in", choice: "Command" };
  const body = intentBody(ready, null, [], choices);
  assert.equal(body.readySpell, "Command");
  assert.equal(body.readyLevel, 1);
  assert.equal(composeSentence(ready, null, [], choices), "I ready Command for when the ogre steps in.");
  assert.match(describeIntent(messageIntentSchema.parse(body), "s1"), /spell=Command, level=1/);
  // No pick: an attack, as before.
  assert.equal(intentBody(ready, null, [], { trigger: "x" }).readySpell, undefined);
});

test("a spell with a choice carries a picker that sends cast_at_enemy's condition (Command, Bestow Curse, Heat Metal)", () => {
  const command = spellChoice(spellMechFor(["Command"]));
  assert.equal(command.arg, "condition");
  assert.deepEqual(command.options.map((entry) => entry.value), ["grovel", "halt"]);
  const curse = spellChoice(spellMechFor(["Bestow Curse"]));
  assert.deepEqual(curse.options.map((entry) => entry.value), ["str", "dex", "con", "int", "wis", "cha", "attacks", "will", "necrotic"]);
  const eyebite = spellChoice(spellMechFor(["Eyebite"]));
  assert.deepEqual(eyebite.options.map((entry) => entry.value), ["unconscious", "frightened", "sickened"]);
  const heat = spellChoice(spellMechFor(["Heat Metal"]));
  assert.equal(heat.fallback, "");
  assert.ok(heat.options.some((entry) => entry.value === "armor"));
  const restore = spellChoice(spellMechFor(["Lesser Restoration"]));
  assert.equal(restore.arg, "variant");
  assert.ok(restore.options.some((entry) => entry.value === "poisoned"));

  const cleric = sheet({
    name: "Kael", class: "cleric", abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 18, cha: 10 },
    spellcasting: { ability: "wis", slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } }, prepared: ["Command", "Heat Metal"], known: [] },
  });
  const cards = deriveHand(cleric, mine(), { spells: SPELLS });
  const card = byId(cards, "spell:command");
  const body = intentBody(card, aimAt, [], { choice: "halt" });
  assert.equal(body.condition, "halt");
  assert.equal(composeSentence(card, aimAt, [], { choice: "halt" }), "I cast Command (Halt) at Goblin 1 using a level 1 slot.");
  assert.match(describeIntent(messageIntentSchema.parse(body), "s1"), /condition=halt/);
  // Heat Metal on a held object sends no condition; on armor, "armor".
  const heatCard = byId(cards, "spell:heat metal");
  assert.equal(intentBody(heatCard, aimAt).condition, undefined);
  assert.equal(intentBody(heatCard, aimAt, [], { choice: "armor" }).condition, "armor");
});

test("a subclass spend is a card played by the feature's own name (Shadow Step as a bonus action)", () => {
  const monk = sheet({ class: "monk", subclass: "Way of Shadow", level: 6, classes: [{ id: "monk", level: 6 }], features: [feature("Shadow Step")] });
  const card = deriveHand(monk, mine()).find((entry) => entry.name === "Shadow Step");
  assert.ok(card);
  assert.equal(card.cost, "bonus");
  assert.deepEqual(card.intent, { card: "feature", resourceId: "Shadow Step" });
});

test("Intimidating Presence is an action card aimed at an enemy with the barbarian's DC", () => {
  const barbarian = sheet({ class: "barbarian", level: 10, classes: [{ id: "barbarian", level: 10 }], features: [feature("Intimidating Presence")] });
  const card = byId(deriveHand(barbarian, mine()), "feature:intimidating-presence");
  assert.equal(card.target, "enemy");
  assert.deepEqual(card.save, { ability: "WIS", dc: 8 + 4 + 1 });
  assert.equal(card.intent.resourceId, "Intimidating Presence");
});

test("the sheet's feature choices come from the authored layer, and a renamed feature reads as chosen", () => {
  const open = featureChoices(sheet({ class: "barbarian", level: 3, features: [feature("Totem Spirit")] }));
  assert.deepEqual(open, [{ feature: "Totem Spirit", spend: "Totem Spirit", options: ["Bear", "Eagle", "Wolf"], chosen: null }]);
  const chosen = featureChoices(sheet({ class: "barbarian", level: 3, features: [feature("Totem Spirit (Bear)")] }));
  assert.equal(chosen[0].chosen, "bear");
});

// ---- the reaction prompt ----

const hit = (extra = {}) => ({
  characterId: "s1", attacker: "Fire Snake", attackerId: "e1", attack: "Bite", damage: 7, type: "fire",
  hit: true, ranged: false, source: "attack", answered: [], ...extra,
});

test("Absorb Elements is not offered after an elemental hit (not SRD 5.1, not resolved by use_reaction)", () => {
  const wizard = sheet({
    class: "wizard",
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Absorb Elements", "Shield"], known: [] },
  });
  const cards = reactionCards(wizard, { ...FRESH_TURN, myTurn: false }, [hit()], [wizard]);
  assert.equal(cards.some((card) => card.name === "Absorb Elements"), false);
  assert.ok(cards.some((card) => card.name === "Shield"));
});

test("a subclass reaction answers an ally's hit while its gate holds (Spirit Shield while raging)", () => {
  const barbarian = sheet({ id: "s2", name: "Bruna", class: "barbarian", level: 6, features: [feature("Spirit Shield")], conditions: ["raging"] });
  const ally = { id: "s1", name: "Kael" };
  const cards = reactionCards(barbarian, { ...FRESH_TURN, myTurn: false }, [hit()], [ally, barbarian]);
  const shield = cards.find((card) => card.name === "Spirit Shield");
  assert.ok(shield);
  assert.equal(shield.target, "ally");
  const calm = { ...barbarian, conditions: [] };
  assert.equal(reactionCards(calm, { ...FRESH_TURN, myTurn: false }, [hit()], [ally, calm]).some((card) => card.name === "Spirit Shield"), false);
});

// ---- conditions ----

test("a condition that lasts to the end of a turn says so, and a non-SRD one says what it does", () => {
  const nameOf = (id) => ({ s1: "Kael", e1: "Goblin 1" })[id] ?? null;
  assert.equal(conditionNote("stunned", { untilTurnEndOf: "s1" }, nameOf, "e1").duration, "until the end of Kael's next turn");
  assert.equal(conditionNote("stunned", { untilTurnEndOf: "s1", turnBegun: true }, nameOf, "e1").duration, "until the end of Kael's turn");
  assert.equal(conditionNote("dodging", { untilTurnEndOf: "e1" }, nameOf, "e1").duration, "until the end of their next turn");
  const halted = conditionNoteLine(conditionNote("halted", { rounds: 1 }, nameOf, "e1"));
  assert.ok(halted.length > "1 round".length && /halt|action/i.test(halted), halted);
  assert.equal(conditionNote("prone", undefined, nameOf).meaning, null);
});

test("every new condition the engine writes has its own glyph", () => {
  for (const [name, id] of [
    ["hurled through hell", "hurled"],
    ["no reactions (open hand)", "reeling"],
    ["undead dread (chill touch)", "dread"],
    ["poisoned weapon", "coated"],
    ["squeezing", "squeezing"],
    ["holy nimbus", "nimbus"],
    ["unmoved by intimidating presence", "unmoved"],
    ["halted", "halted"],
    ["retching", "retching"],
    ["enclosed", "enclosed"],
    ["inspiration", "inspiration"],
  ]) {
    assert.equal(glyphFor(name).id, id, name);
  }
});

// ---- initiative rows ----

test("a thief's second round-1 turn is its own row: keyed by position, the pointer found by position", () => {
  const order = [
    { id: "s1", name: "Kael" },
    { id: "e1", name: "Goblin 1" },
    { id: "s1", name: "Kael", reflex: true },
  ];
  const keys = order.map((row, index) => orderRowKey(row, index));
  assert.equal(new Set(keys).size, 3);
  assert.equal(currentOrderIndex(order, 2, { name: "Kael" }), 2);
  assert.equal(currentOrderIndex(order, 0, { name: "Kael" }), 0);
  // A hidden combatant left out of a player's order shifts the index: the name decides.
  assert.equal(currentOrderIndex([{ id: "e1", name: "Goblin 1" }], 1, { name: "Goblin 1" }), 0);
});

// ---- the sheet ----

test("the sheet reads an uncapped counter as uses since its rest and offers no minus for a passive one", () => {
  const over = counterView("overchannel", { max: 99, used: 2 });
  assert.equal(over.line, "used 2 times since a long rest");
  assert.equal(over.spendable, false);
  const signature = counterView("signature_spell_1", { max: 1, used: 0 });
  assert.equal(signature.line, "1/1");
  assert.equal(signature.spendable, false);
  assert.equal(counterView("rage", { max: 3, used: 1 }).spendable, true);
  assert.deepEqual(otherSpeedsLine({ fly: 60, swim: 30 }), ["Fly 60 ft", "Swim 30 ft"]);
  assert.deepEqual(otherSpeedsLine(undefined), []);
});

// ---- Inspiration on a parked roll ----

test("Inspiration on a parked d20 roll turns it to advantage, cancels disadvantage, and refuses what it cannot help", () => {
  const held = { name: "Kael", resources: { inspiration: { max: 1, used: 0 } } };
  assert.deepEqual(inspiredRoll({ kind: "skill_check", expression: "1d20+5", advantage: "none" }, held), { expression: "2d20kh1+5", advantage: "advantage" });
  assert.deepEqual(inspiredRoll({ kind: "saving_throw", expression: "2d20kl1+2", advantage: "disadvantage" }, held), { expression: "1d20+2", advantage: "none" });
  assert.deepEqual(inspiredRoll({ kind: "ability_check", expression: "1d20r1+3", advantage: "none" }, held), { expression: "2d20kh1r1+3", advantage: "advantage" });
  assert.match(inspiredRoll({ kind: "attack", expression: "2d20kh1+5", advantage: "advantage" }, held).error, /already has advantage/);
  assert.match(inspiredRoll({ kind: "damage", expression: "2d6+3", advantage: "none" }, held).error, /attack roll, a saving throw or an ability check/);
  assert.match(inspiredRoll({ kind: "skill_check", expression: "1d20+5", advantage: "none" }, { name: "Kael", resources: {} }).error, /holds no Inspiration/);
});

// ---- the climb brush ----

test("the map painter has a climb brush that writes the climbable tile the engine charges double for", () => {
  assert.ok(BRUSHES.includes("climb"));
  const terrain = "#####" + "#...#" + "#...#" + "#...#" + "#####";
  const painted = paintTerrain({ terrain, width: 5, height: 5, strokes: [{ x: 2, y: 2, brush: "climb" }] });
  assert.equal(painted.terrain[2 * 5 + 2], TERRAIN.climb);
  assert.equal(moveCost(TERRAIN.climb), 2);
  assert.equal(moveCost(TERRAIN.climb, { climbs: true }), 1);
});

console.log(`hand-final: ${passed} passed`);
