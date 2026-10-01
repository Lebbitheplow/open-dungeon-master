// The player's screens asking the engine: every gate on a Hand card, the
// token menu and the sheet is the engine's own pure function (canAct, the
// spend functions, the cast guard's rules, checkAttackOptions), so a card
// never offers what the engine will refuse and a refusal reads in the
// engine's words. Also the projections the screens read: the turn from the
// public encounter, the reaction prompt from the last-hit record, the board's
// condition notes and combat state, cover and flanking in the hit preview,
// and the sheet's effective hit points, speed, hit dice, charges and curses.
// Workstream ui-play of the second rules-enforcement repair
// (/tmp/odm-enf2/fixes/ui-play.md). Pure: no database, no server.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { previewRows, composeSentence, intentBody } = await import("../src/lib/battlemap/hand-play.ts");
const { reactionCards, reactionAim } = await import("../src/lib/battlemap/hand-react.ts");
const { turnFromEncounter, turnPips, turnHudBudget } = await import("../src/lib/battlemap/hand-table.ts");
const { hudGates } = await import("../src/lib/battlemap/hand-hud.ts");
const { conditionNote, conditionNoteLine, namesLookup } = await import("../src/lib/battlemap/condition-notes.ts");
const { characterStageRows, enemyStageRows } = await import("../src/lib/battlemap/view-stage.ts");
const { messageIntentSchema, describeIntent, intentCorrection, intentTools } = await import("../src/lib/dm/intent-logic.ts");
const { maxHpView, speedView, hitDiceRows, hitDiceLine, itemStatus, stateTags } = await import(
  "../src/components/sheet/sheet-state.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
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
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], expertise: [], languages: [], tools: [], armor: [], weapons: ["simple", "martial"] },
    equipment: [], gold: 0, copper: 0, feats: [], features: [], spellcasting: null,
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}
const item = (name, extra = {}) => ({ name, qty: 1, ...extra });
const byId = (cards, id) => cards.find((card) => card.id === id);
const feature = (name) => ({ name, source: "class" });

const FACTS = {
  "fire bolt": {
    level: 0, school: "evocation", castingTime: "1 action", range: "120 feet", concentration: false,
    desc: "You hurl a mote of fire at a creature or object within range. Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage.",
    higherLevel: "",
  },
  "shocking grasp": {
    level: 0, school: "evocation", castingTime: "1 action", range: "Touch", concentration: false,
    desc: "Lightning springs from your hand to deliver a shock to a creature you try to touch. Make a melee spell attack against the target. On a hit, the target takes 1d8 lightning damage.",
    higherLevel: "",
  },
  shield: {
    level: 1, school: "abjuration", castingTime: "1 reaction, which you take when you are hit by an attack", range: "Self", concentration: false,
    desc: "An invisible barrier of magical force appears and protects you.", higherLevel: "",
  },
};
const caster = (overrides = {}) =>
  sheet({
    name: "Lys", class: "wizard",
    abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
    proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["daggers", "quarterstaffs"] },
    spellcasting: { ability: "int", slots: { 1: { max: 4, used: 0 } }, prepared: ["Fire Bolt", "Shocking Grasp", "Shield"], known: [] },
    ...overrides,
  });
// Somebody else's turn, as the public encounter says it.
const talias = (extra = {}) => ({
  ...FRESH_TURN,
  myTurn: false,
  currentName: "Talia",
  table: { round: 2, orderReady: true, acting: { id: "s9", name: "Talia" }, surprised: { acting: [], reacting: [] } },
  ...extra,
});
const mine = (extra = {}) => ({
  ...FRESH_TURN,
  table: { round: 2, orderReady: true, acting: { id: "s1", name: "Kael" }, surprised: { acting: [], reacting: [] } },
  ...extra,
});

// ---- U:UA3 standing: the engine's canAct ----

test("a card off the character's turn is refused with canAct's own sentence, and a reaction stays open", () => {
  const cards = deriveHand(caster({ id: "s1" }), talias(), { spells: FACTS });
  assert.match(byId(cards, "spell:fire bolt").disabled, /^It is Talia's turn, not Lys's\. Off their own turn a character can only use their reaction\.$/);
  assert.equal(byId(cards, "spell:shield").disabled, null);
  assert.equal(byId(cards, "spell:shield").intent.card, "reaction");
});

test("surprise in round 1 refuses actions and the reaction the way the engine does", () => {
  const surprised = {
    ...mine(),
    table: { round: 1, orderReady: true, acting: { id: "s1", name: "Lys" }, surprised: { acting: ["s1"], reacting: ["s1"] } },
  };
  const cards = deriveHand(caster(), surprised, { spells: FACTS });
  assert.match(byId(cards, "spell:fire bolt").disabled, /is surprised and cannot cast a spell in the first round/);
  assert.match(byId(cards, "spell:shield").disabled, /is surprised and has no reaction/);
});

test("a wild-shaped character at 0 hit points cannot act either (the server never exempted it)", () => {
  const druid = sheet({
    currentHp: 0,
    wildShape: { form: "Wolf", beastHp: 0, beastMaxHp: 11, beastAc: 13, attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", type: "piercing" }] },
  });
  assert.match(byId(deriveHand(druid, mine()), "attack:bite").disabled, /is at 0 HP and cannot attack/);
});

// ---- U:UA1 / UA6 the turn from the engine ----

test("the Hand's turn and pips are the engine's count, and a spent reaction comes from reactionsUsed", () => {
  const encounter = {
    round: 3, orderReady: true,
    acting: { id: "s1", name: "Kael" },
    surprised: { acting: [], reacting: [] },
    reactionsUsed: ["s1"],
    turn: { ownerId: "s1", actionUsed: true, bonusUsed: false, reactionUsed: false, attacksMade: 1, attacksAllowed: 2, marks: ["martial-arts:attack-action"] },
  };
  const turn = turnFromEncounter(encounter, { id: "s1" }, { myTurn: false });
  assert.equal(turn.myTurn, true);
  assert.equal(turn.attacksMade, 1);
  assert.equal(turn.reactionUsed, true);
  assert.deepEqual(turn.marks, ["martial-arts:attack-action"]);
  assert.deepEqual(turnPips(turn).map((pip) => pip.used), [true, false, true]);
  assert.deepEqual(turnHudBudget(turn), { action: false, bonus: true, reaction: false });
  // Off their turn, another character's budget is not theirs.
  const other = turnFromEncounter({ ...encounter, acting: { id: "s9", name: "Talia" } }, { id: "s1" }, { myTurn: true });
  assert.equal(other.myTurn, false);
  assert.equal(other.actionUsed, false);
  assert.equal(turnHudBudget(other), null);
});

// ---- U:UA4 the cast guard's own refusals ----

test("the spell cards carry the cast guard's refusals: untrained armor, silence, a beast form without Beast Spells", () => {
  const armored = caster({ equipment: [item("Plate Armor", { equipped: true })] });
  assert.match(byId(deriveHand(armored, mine(), { spells: FACTS }), "spell:fire bolt").disabled, /armor they are not trained in/);
  const silenced = caster({ conditions: ["silenced"] });
  assert.match(byId(deriveHand(silenced, mine(), { spells: FACTS }), "spell:shocking grasp").disabled, /verbal component/);
  const shape = { form: "Wolf", beastHp: 11, beastMaxHp: 11, beastAc: 13, attacks: [] };
  const wolf = caster({ class: "druid", wildShape: shape });
  assert.match(byId(deriveHand(wolf, mine(), { spells: FACTS }), "spell:fire bolt").disabled, /wild shaped as a Wolf/);
  const archdruid = caster({ class: "druid", wildShape: shape, features: [feature("Beast Spells")] });
  assert.equal(byId(deriveHand(archdruid, mine(), { spells: FACTS }), "spell:fire bolt").disabled, null);
});

test("a touch spell is a melee spell attack with touch reach", () => {
  const grasp = byId(deriveHand(caster(), mine(), { spells: FACTS }), "spell:shocking grasp");
  assert.equal(grasp.melee, true);
  assert.equal(grasp.range, "Touch");
  assert.equal(byId(deriveHand(caster(), mine(), { spells: FACTS }), "spell:fire bolt").melee, false);
});

// ---- new cards ----

test("a monk's Step of the Wind and Patient Defense cost the bonus action and 1 ki, refused with no ki left", () => {
  const monk = sheet({ class: "monk", level: 3, features: [feature("Martial Arts"), feature("Ki")], resources: { ki: { max: 3, used: 0 } } });
  const cards = deriveHand(monk, mine());
  const step = byId(cards, "basic:dash:bonus");
  assert.equal(step.name, "Step of the Wind: Dash");
  assert.equal(step.cost, "bonus");
  assert.equal(step.disabled, null);
  assert.equal(byId(cards, "basic:dodge:bonus").name, "Patient Defense: Dodge");
  const dry = deriveHand({ ...monk, resources: { ki: { max: 3, used: 3 } } }, mine());
  assert.match(byId(dry, "basic:dash:bonus").disabled, /no ki point left/);
  assert.equal(byId(cards, "feature:ki"), undefined);
});

test("Flurry of Blows follows the Attack action; its strikes are played with the unarmed strike", () => {
  const monk = sheet({ class: "monk", level: 5, features: [feature("Martial Arts"), feature("Extra Attack")], resources: { ki: { max: 5, used: 0 } } });
  assert.match(byId(deriveHand(monk, mine()), "feature:ki:flurry").disabled, /follows the Attack action/);
  const attacked = mine({ actionUsed: true, attacksMade: 2 });
  const flurry = byId(deriveHand(monk, attacked), "feature:ki:flurry");
  assert.equal(flurry.disabled, null);
  assert.equal(flurry.intent.variant, "flurry of blows");
  // Both swings gone: the unarmed strike is refused until the flurry is bought.
  assert.match(byId(deriveHand(monk, attacked), "attack:unarmed strike").disabled, /already made all 2/);
  assert.equal(byId(deriveHand(monk, { ...attacked, bonusUsed: true, flurryStrikes: 2 }), "attack:unarmed strike").disabled, null);
});

test("Martial Arts' bonus strike waits for the Attack action with an unarmed strike or monk weapon", () => {
  const monk = sheet({ class: "monk", level: 2, features: [feature("Martial Arts")] });
  const before = byId(deriveHand(monk, mine()), "attack:unarmed strike:martial-arts");
  assert.equal(before.cost, "bonus");
  assert.match(before.disabled, /has not attacked that way this turn/);
  const after = byId(deriveHand(monk, mine({ actionUsed: true, attacksMade: 1, marks: ["martial-arts:attack-action"] })), "attack:unarmed strike:martial-arts");
  assert.equal(after.disabled, null);
  assert.deepEqual(after.intent.attack, { bonusAttack: "martial arts" });
  assert.equal(composeSentence(after, { id: "e1", name: "Goblin 1", kind: "enemy" }), "I attack Goblin 1 with an unarmed strike as a bonus action (Martial Arts).");
});

test("Frenzy's bonus attack is refused while the barbarian is not raging", () => {
  const berserker = sheet({ class: "barbarian", features: [feature("Rage"), feature("Frenzy")], equipment: [item("Greataxe")] });
  assert.match(byId(deriveHand(berserker, mine()), "attack:greataxe:frenzy").disabled, /is not raging/);
  assert.equal(byId(deriveHand({ ...berserker, conditions: ["raging"] }, mine()), "attack:greataxe:frenzy").disabled, null);
});

test("Reckless Attack is offered on the first Strength melee attack only; knock out on melee only", () => {
  const barbarian = sheet({ class: "barbarian", features: [feature("Reckless Attack")], equipment: [item("Greataxe"), item("Longbow")] });
  const axe = byId(deriveHand(barbarian, mine()), "attack:greataxe");
  const reckless = axe.options.find((option) => option.id === "reckless");
  assert.equal(reckless.disabled, null);
  assert.ok(axe.options.some((option) => option.id === "nonlethal"));
  const later = byId(deriveHand(barbarian, mine({ actionUsed: true, attacksMade: 1 })), "attack:greataxe");
  assert.match(later.options.find((option) => option.id === "reckless").disabled, /decided on the first attack/);
  assert.equal(byId(deriveHand(barbarian, mine()), "attack:longbow").options.length, 0);
  // The option rides the intent under pc_attack's own argument name.
  const body = intentBody(axe, { id: "e1", name: "Ogre", kind: "enemy" }, [], { options: ["reckless", "nonlethal"] });
  assert.deepEqual(body.attack, { reckless: true, nonlethal: true });
  assert.equal(
    composeSentence(axe, { id: "e1", name: "Ogre", kind: "enemy" }, [], { options: ["reckless"] }),
    "I attack Ogre with my Greataxe. I attack recklessly.",
  );
});

test("Ready asks for its trigger and carries it; Search and Escape are cards", () => {
  const ready = byId(deriveHand(sheet(), mine()), "basic:ready");
  assert.equal(ready.asks, "trigger");
  assert.equal(composeSentence(ready, null, [], { trigger: "the ogre steps through the door" }), "I ready an attack for when the ogre steps through the door.");
  assert.equal(intentBody(ready, null, [], { trigger: "the ogre steps through" }).trigger, "the ogre steps through");
  assert.ok(byId(deriveHand(sheet(), mine()), "basic:search"));
  const grappled = deriveHand(sheet({ conditions: ["grappled"], conditionMeta: { grappled: { source: "e1" } } }), mine());
  assert.equal(byId(grappled, "basic:escape").disabled, null);
});

// ---- U:UA2 reactions after a hit ----

const HIT = { characterId: "s1", attacker: "Goblin 2", attackerId: "e2", attack: "Scimitar", type: "slashing", ranged: false, source: "attack", hit: true, damage: 7, answered: [] };

test("a fresh hit offers the reactions the character holds, off their turn, as use_reaction cards", () => {
  const lys = caster({ id: "s1" });
  const cards = reactionCards(lys, talias(), [HIT], [{ id: "s1", name: "Lys" }]);
  const shield = byId(cards, "reaction:shield");
  assert.equal(shield.disabled, null);
  assert.equal(shield.prompt, "Goblin 2's Scimitar hit you for 7 slashing");
  assert.deepEqual(shield.intent, { card: "reaction", feature: "Shield", spell: "Shield", slotLevel: 1 });
  const rogue = sheet({ class: "rogue", level: 5, features: [feature("Uncanny Dodge")] });
  assert.ok(byId(reactionCards(rogue, talias(), [HIT], []), "reaction:uncanny-dodge:s1"));
  // Deflect Missiles answers a ranged hit only.
  const monk = sheet({ class: "monk", level: 3, features: [feature("Deflect Missiles")] });
  assert.equal(reactionCards(monk, talias(), [HIT], []).length, 0);
  assert.equal(reactionCards(monk, talias(), [{ ...HIT, ranged: true }], []).length, 1);
  // Answered already, spent reaction, or no fresh record: nothing, or refused.
  assert.equal(reactionCards(rogue, talias(), [{ ...HIT, answered: ["Uncanny Dodge"] }], []).length, 0);
  assert.match(byId(reactionCards(rogue, talias({ reactionUsed: true }), [HIT], []), "reaction:uncanny-dodge:s1").disabled, /already used their reaction/);
  assert.equal(reactionCards(rogue, talias(), [], []).length, 0);
});

test("Cutting Words answers an ally's hit, aimed at that ally", () => {
  const bard = sheet({ id: "s3", name: "Wren", class: "bard", features: [feature("Cutting Words")], resources: { bardic_inspiration: { max: 3, used: 0 } } });
  const party = [{ id: "s1", name: "Kael" }, { id: "s3", name: "Wren" }];
  const cards = reactionCards(bard, talias(), [HIT], party);
  const words = byId(cards, "reaction:cutting-words:s1");
  assert.equal(words.target, "ally");
  assert.deepEqual(reactionAim(words, [HIT], "s3", party), { id: "s1", name: "Kael", kind: "ally" });
  const body = intentBody(words, { id: "s1", name: "Kael", kind: "ally" });
  const parsed = messageIntentSchema.parse(body);
  assert.deepEqual(intentTools(parsed), ["use_reaction"]);
  assert.match(describeIntent(parsed, "s3"), /the reaction Cutting Words on Kael \(characterId=s1\) \(feature=Cutting Words\)\. Resolve it with use_reaction/);
});

// ---- the intent reaches the model as the tool's own arguments ----

test("the message schema keeps the Hand's new fields and names them as tool arguments", () => {
  const parsed = messageIntentSchema.parse({
    card: "basic", action: "dash", bonus: true,
  });
  assert.equal(parsed.bonus, true);
  assert.match(describeIntent(parsed, "s1"), /the dash action \(bonus=true\)\. Resolve it with take_action/);
  const attack = messageIntentSchema.parse({ card: "attack", weapon: "Unarmed strike", attack: { bonusAttack: "martial arts", stunningStrike: true }, targetId: "e1", targetKind: "enemy", targetName: "Goblin 1" });
  assert.match(intentCorrection(attack, "s1", "Kael"), /bonusAttack=martial arts, stunningStrike=true/);
  assert.equal(messageIntentSchema.parse({ card: "basic", action: "search", skill: "investigation" }).skill, "investigation");
  assert.equal(messageIntentSchema.parse({ card: "basic", action: "ready", trigger: "it moves" }).trigger, "it moves");
});

// ---- U:UA10 cover and flanking in the preview ----

test("the board's cover raises the AC the odds are worked against, and flanking gives advantage", () => {
  const sword = byId(deriveHand(sheet({ equipment: [item("Longsword")] }), mine()), "attack:longsword");
  const covered = previewRows(sword, { id: "e1", name: "Wight 1", kind: "enemy", ac: 14, edge: { cover: 2, flanking: false, adjacent: false } });
  assert.match(covered.find((row) => row.key === "To hit").value, /vs AC 16/);
  assert.equal(covered.find((row) => row.key === "Cover").value, "half +2 AC");
  const flanked = previewRows(sword, { id: "e1", name: "Wight 1", kind: "enemy", ac: 14, edge: { cover: 0, flanking: true, adjacent: true } });
  assert.match(flanked.find((row) => row.key === "To hit").value, /advantage$/);
  const bow = byId(deriveHand(sheet({ equipment: [item("Longbow")] }), mine()), "attack:longbow");
  const crowded = previewRows(bow, { id: "e1", name: "Wight 1", kind: "enemy", ac: 14, edge: { cover: 0, flanking: false, adjacent: false, hostileBeside: true } });
  assert.match(crowded.find((row) => row.key === "To hit").value, /disadvantage$/);
  const walled = previewRows(bow, { id: "e1", name: "Wight 1", kind: "enemy", ac: 14, edge: { cover: 0, flanking: false, adjacent: false, blocked: true } });
  assert.equal(walled.find((row) => row.key === "To hit").value, "no line to it (total cover)");
});

// ---- U:UA5 the token menu ----

test("the token menu's sigils carry the engine's refusals", () => {
  const off = hudGates(sheet({ equipment: [item("Longsword")] }), talias());
  assert.match(off.attack, /It is Talia's turn/);
  assert.match(off.dodge, /It is Talia's turn/);
  const own = hudGates(sheet(), mine({ actionUsed: true, attacksMade: 1 }));
  assert.match(own.cast, /has no spells to cast/);
  assert.match(own.dodge, /already used their action/);
  assert.equal(hudGates(caster(), mine()).cast, null);
});

// ---- U:UA8 / UA9 / UC9 condition notes and the board's combat state ----

test("a condition's note says until whose turn, the save that ends it, and who laid it", () => {
  const nameOf = namesLookup([{ id: "s1", name: "Kael" }, { id: "e1", name: "Goblin 2" }]);
  assert.equal(conditionNoteLine(conditionNote("stunned", { untilTurnOf: "s1", source: "s1" }, nameOf, "e1")), "until Kael's turn, from Kael");
  assert.equal(conditionNoteLine(conditionNote("dodging", { untilTurnOf: "s1" }, nameOf, "s1")), "until their next turn");
  assert.equal(conditionNoteLine(conditionNote("paralyzed", { rounds: 10, saveEnds: { ability: "wis", dc: 13 } }, nameOf)), "1 min, save ends (WIS 13)");
  assert.equal(conditionNoteLine(conditionNote("paralyzed", { rounds: 3 }, nameOf), { skipCounted: true }), "");
  assert.equal(conditionNoteLine(conditionNote("readied", { untilTurnOf: "s1", source: "the ogre moves" }, nameOf, "s1")), "until their next turn, trigger: the ogre moves");
  assert.equal(conditionNoteLine(conditionNote("unconscious", { source: "knocked out" }, nameOf)), "knocked out");
});

test("a character's token rows carry concentration, exhaustion and the death track; a knocked-out enemy says so", () => {
  const rows = characterStageRows(
    { id: "s1", conditions: ["unconscious"], conditionMeta: {}, concentratingOn: "Bless", exhaustion: 2, deathSaves: { successes: 1, failures: 2 }, currentHp: 0 },
    () => null,
  );
  assert.deepEqual(rows.map((row) => row.label), ["unconscious", "Concentrating: Bless", "Exhaustion 2", "Dying 1/2"]);
  assert.match(rows[2].note, /speed halved/);
  const enemy = enemyStageRows({ id: "e1", conditions: ["unconscious", "prone"], conditionMeta: { unconscious: { source: "knocked out" } }, currentHp: 0 }, () => null);
  assert.equal(enemy[0].label, "Knocked out");
});

// ---- U:UC2 UC3 UC4 UC6 UC13 and the sheet's gear ----

test("the sheet's hit points and speed are the engine's effective ones, with the reason", () => {
  const worn = sheet({ maxHp: 40, currentHp: 18, exhaustion: 4 });
  const hp = maxHpView(worn);
  assert.equal(hp.max, 20);
  assert.match(hp.note, /halved by exhaustion 4/);
  assert.equal(speedView(sheet({ conditions: ["grappled"] })).speed, 0);
  assert.match(speedView(sheet({ conditions: ["grappled"] })).notes.join(" "), /grappled: speed 0/);
  assert.equal(speedView(sheet({ exhaustion: 2 })).speed, 15);
  assert.match(speedView(sheet({ exhaustion: 2 })).notes.join(" "), /Exhaustion 2: speed halved/);
});

test("the sheet's state row: the death track, exhaustion's effects, concentration, a readied trigger, Inspiration", () => {
  const tags = stateTags(
    sheet({
      currentHp: 0,
      deathSaves: { successes: 2, failures: 1 },
      exhaustion: 3,
      concentratingOn: "Hold Person",
      conditions: ["readied"],
      conditionMeta: { readied: { untilTurnOf: "s1", source: "the door opens" } },
      resources: { inspiration: { max: 1, used: 0 } },
    }),
  );
  assert.deepEqual(tags.map((tag) => tag.id), ["dying", "exhaustion", "concentration", "readied", "inspiration"]);
  assert.match(tags[1].note, /disadvantage on attacks and saves/);
  assert.match(tags[3].note, /the door opens/);
});

test("every hit die pool of a multiclass character is shown", () => {
  const multi = sheet({
    hitDicePools: [
      { classId: "fighter", die: "d10", total: 3, spent: 1 },
      { classId: "wizard", die: "d6", total: 2, spent: 0 },
    ],
  });
  assert.equal(hitDiceRows(multi).length, 2);
  assert.equal(hitDiceLine(multi), "2/3d10 + 2/2d6");
  assert.equal(hitDiceLine(sheet()), "4/4d10");
});

test("a charged item shows its count, a pending attunement shows, and a cursed one refuses to let go", () => {
  const wand = item("Wand of Magic Missiles");
  assert.equal(itemStatus(sheet({ equipment: [wand] }), wand).charges, "7/7 charges");
  const used = item("Wand of Magic Missiles", { charges: 4 });
  assert.equal(itemStatus(sheet({ equipment: [used] }), used).charges, "4/7 charges");
  const pending = item("Ring of Protection", { attuning: true });
  assert.equal(itemStatus(sheet({ equipment: [pending] }), pending).attuning, true);
  const axe = item("Berserker Axe", { equipped: true, attuned: true });
  const status = itemStatus(sheet({ equipment: [axe] }), axe);
  assert.equal(status.cursed, true);
  assert.match(status.attuneRefusal, /is cursed/);
});

console.log(`test-hand-engine: ${passed} passed`);
