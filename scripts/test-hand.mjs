// The Hand: combat options as cards. Nothing here rolls a die; what it
// decides is which cards a sheet holds, what each one costs and rolls, when a
// card is spent, and the sentence the engine is sent. A wrong number on a
// card is a promise the engine will not keep, so the arithmetic is pinned
// against the same helpers pc_attack and the cast tools use.
// See docs/visual-overhaul-plan.md 5.2, 5.3 and 5.8.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { deriveHand, splitHand, lowestSlot, attacksAllowed, FRESH_TURN, HAND_FAN_CAP } = await import(
  "../src/lib/battlemap/hand.ts"
);
const { previewRows, composeSentence, intentBody, afterCommit, targetFromComposedText, typicalAcForCr } =
  await import("../src/lib/battlemap/hand-play.ts");
const { attackOdds, asPercent } = await import("../src/lib/srd/odds.ts");
const { populateResources } = await import("../src/lib/srd/class-resources.ts");

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
const item = (name, qty = 1) => ({ name, qty });
const byId = (cards, id) => cards.find((card) => card.id === id);

const FACTS = {
  "fire bolt": {
    level: 0, school: "evocation", castingTime: "1 action", range: "120 feet", concentration: false,
    desc: "You hurl a mote of fire at a creature or object within range. Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage.",
    higherLevel: "This spell's damage increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10).",
  },
  "healing word": {
    level: 1, school: "evocation", castingTime: "1 bonus action", range: "60 feet", concentration: false,
    desc: "A creature of your choice that you can see within range regains hit points equal to 1d4 + your spellcasting ability modifier.",
    higherLevel: "When you cast this spell using a spell slot of 2nd level or higher, the healing increases by 1d4 for each slot level above 1st.",
  },
  "hold person": {
    level: 2, school: "enchantment", castingTime: "1 action", range: "60 feet", concentration: true,
    desc: "Choose a humanoid that you can see within range. The target must succeed on a Wisdom saving throw or be paralyzed for the duration.",
    higherLevel: "",
  },
  shield: {
    level: 1, school: "abjuration", castingTime: "1 reaction, which you take when you are hit by an attack", range: "Self", concentration: false,
    desc: "An invisible barrier of magical force appears and protects you.", higherLevel: "",
  },
  "detect magic": {
    level: 1, school: "divination", castingTime: "1 action", range: "Self", concentration: true,
    desc: "For the duration, you sense the presence of magic within 30 feet of you.", higherLevel: "",
  },
  identify: {
    level: 1, school: "divination", castingTime: "1 minute", range: "Touch", concentration: false,
    desc: "You choose one object that you must touch throughout the casting of the spell.", higherLevel: "",
  },
};
const caster = (overrides = {}) =>
  sheet({
    name: "Lys", class: "wizard",
    abilities: { str: 8, dex: 14, con: 12, int: 18, wis: 12, cha: 10 },
    proficiencies: { saves: ["int", "wis"], skills: [], expertise: [], languages: [], tools: [], armor: [], weapons: ["daggers", "quarterstaffs"] },
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 } },
      prepared: ["Fire Bolt", "Healing Word", "Hold Person", "Shield", "Detect Magic", "Identify"],
      known: [],
    },
    ...overrides,
  });

// ---- attacks ----

test("a weapon card carries the engine's own to-hit and damage", () => {
  const cards = deriveHand(sheet({ equipment: [item("Longsword"), item("Shield"), item("Scale Mail")] }));
  const sword = byId(cards, "attack:longsword");
  // STR +3, proficiency +2 at level 4.
  assert.equal(sword.toHit, 5);
  assert.equal(sword.roll, "+5 to hit");
  assert.equal(sword.dice, "1d8+3 slashing");
  assert.equal(sword.range, "5 ft");
  assert.equal(sword.cost, "action");
  assert.equal(sword.target, "enemy");
  assert.equal(sword.disabled, null);
  // Armour and a shield are not weapons.
  assert.equal(cards.filter((card) => card.type === "attack").length, 2);
  assert.ok(byId(cards, "attack:unarmed strike"));
});

test("a magic weapon adds its bonus, a finesse weapon takes the better modifier", () => {
  const cards = deriveHand(sheet({ abilities: { str: 10, dex: 18, con: 10, int: 10, wis: 10, cha: 10 }, equipment: [item("+1 Rapier")] }));
  const rapier = byId(cards, "attack:+1 rapier");
  assert.equal(rapier.toHit, 4 + 2 + 1);
  assert.equal(rapier.dice, "1d8+5 piercing");
  assert.equal(rapier.intent.weapon, "+1 Rapier");
});

test("a bow reads its range and its quiver; an empty quiver only refuses when the table tracks ammunition", () => {
  const stocked = deriveHand(sheet({ equipment: [item("Longbow"), item("Arrows", 20)] }));
  const bow = byId(stocked, "attack:longbow");
  assert.equal(bow.range, "150 ft");
  assert.match(bow.resource, /20$/);
  assert.equal(bow.melee, false);
  const dry = deriveHand(sheet({ equipment: [item("Longbow")] }));
  assert.match(byId(dry, "attack:longbow").resource, /^No /);
  assert.equal(byId(dry, "attack:longbow").disabled, null);
  const tracked = deriveHand(sheet({ equipment: [item("Longbow")] }), FRESH_TURN, { trackAmmo: true });
  assert.match(byId(tracked, "attack:longbow").disabled, /Out of/);
  assert.equal(byId(tracked, "attack:longbow").spent, true);
});

test("Extra Attack is on the card and keeps the action open for the second swing", () => {
  const fighter = sheet({ level: 5, equipment: [item("Longsword")], features: [{ name: "Extra Attack", source: "class" }] });
  assert.equal(attacksAllowed(fighter), 2);
  const first = byId(deriveHand(fighter), "attack:longsword");
  assert.match(first.rules, /Extra Attack: 2 swings/);
  const afterOne = afterCommit(FRESH_TURN, first, 2);
  assert.equal(afterOne.actionUsed, true);
  assert.equal(afterOne.attacksMade, 1);
  const second = deriveHand(fighter, afterOne);
  assert.equal(byId(second, "attack:longsword").disabled, null);
  // The Attack action is taken, so Dodge is gone.
  assert.match(byId(second, "basic:dodge").disabled, /action is spent/);
  const afterTwo = afterCommit(afterOne, first, 2);
  const third = byId(deriveHand(fighter, afterTwo), "attack:longsword");
  assert.match(third.disabled, /All 2 attacks/);
  assert.equal(third.spent, true);
});

test("rage adds its damage to Strength melee and shuts spellcasting", () => {
  const barbarian = sheet({ class: "barbarian", equipment: [item("Greataxe"), item("Longbow"), item("Arrows", 5)], conditions: ["raging"] });
  const cards = deriveHand(barbarian);
  assert.equal(byId(cards, "attack:greataxe").dice, "1d12+3+2 slashing");
  assert.equal(byId(cards, "attack:longbow").dice, "1d8+2 piercing");
  const ragingCaster = deriveHand(caster({ conditions: ["raging"] }), FRESH_TURN, { spells: FACTS });
  assert.match(byId(ragingCaster, "spell:fire bolt").disabled, /raging/);
});

test("two light weapons buy an off-hand swing, after the first attack", () => {
  const rogue = sheet({ class: "rogue", equipment: [item("Shortsword"), item("Dagger")] });
  const before = byId(deriveHand(rogue), "offhand:dagger");
  assert.equal(before.cost, "bonus");
  assert.match(before.disabled, /light weapon first/);
  // No ability modifier on the off-hand damage without the fighting style.
  assert.equal(before.dice, "1d4 piercing");
  const turn = afterCommit(FRESH_TURN, byId(deriveHand(rogue), "attack:shortsword"));
  assert.equal(byId(deriveHand(rogue, turn), "offhand:dagger").disabled, null);
  assert.equal(byId(deriveHand(sheet({ equipment: [item("Longsword"), item("Dagger")] })), "offhand:dagger"), undefined);
});

test("a beast form swings with its own statblock", () => {
  const druid = caster({
    class: "druid",
    equipment: [item("Quarterstaff")],
    wildShape: { form: "Brown Bear", beastHp: 34, beastMaxHp: 34, beastAc: 11, attacks: [{ name: "Claws", toHit: 6, damage: "2d6+4", type: "slashing" }] },
  });
  const cards = deriveHand(druid, FRESH_TURN, { spells: FACTS });
  assert.equal(byId(cards, "attack:claws").toHit, 6);
  assert.equal(byId(cards, "attack:quarterstaff"), undefined);
  assert.match(byId(cards, "spell:fire bolt").disabled, /Brown Bear form/);
});

// ---- riders ----

test("Divine Smite rides the lowest slot with the engine's dice, and dims with no slot", () => {
  const paladin = caster({
    class: "paladin", features: [{ name: "Divine Smite", source: "class" }],
    spellcasting: { ability: "cha", slots: { 1: { max: 3, used: 3 }, 2: { max: 2, used: 0 } }, prepared: [], known: [] },
  });
  const smite = byId(deriveHand(paladin), "rider:divine smite");
  assert.equal(smite.cost, "rider");
  // A level 2 slot: 3d8.
  assert.equal(smite.dice, "+3d8 radiant");
  assert.equal(smite.resource, "Slot 2 · 2/2");
  assert.equal(smite.intent.slotLevel, 2);
  const dry = caster({
    class: "paladin", features: [{ name: "Divine Smite", source: "class" }],
    spellcasting: { ability: "cha", slots: { 1: { max: 3, used: 3 } }, prepared: [], known: [] },
  });
  const spentSmite = byId(deriveHand(dry), "rider:divine smite");
  assert.match(spentSmite.disabled, /No spell slot/);
  assert.equal(spentSmite.spent, true);
});

test("Battle Master maneuvers ride attacks on the superiority pool", () => {
  const master = sheet({
    equipment: [item("Longsword")],
    features: [{ name: "Combat Superiority", source: "class" }, { name: "Maneuver: Trip Attack", source: "choice" }],
    resources: { sub_superiority_dice: { max: 4, used: 1 } },
  });
  const trip = byId(deriveHand(master), "rider:trip attack");
  assert.equal(trip.dice, "+1d8");
  assert.equal(trip.resource, "Dice 3/4");
  assert.equal(byId(deriveHand(master), "feature:sub_superiority_dice"), undefined);
});

// ---- spells ----

test("spell cards read cost, range, dice and DC from the sheet and the spell", () => {
  const cards = deriveHand(caster(), FRESH_TURN, { spells: FACTS });
  const bolt = byId(cards, "spell:fire bolt");
  // INT +4, proficiency +2.
  assert.equal(bolt.toHit, 6);
  assert.equal(bolt.dice, "1d10 fire");
  assert.equal(bolt.range, "120 ft");
  assert.equal(bolt.resource, "Cantrip");
  assert.equal(bolt.target, "enemy");
  const word = byId(cards, "spell:healing word");
  assert.equal(word.cost, "bonus");
  assert.equal(word.type, "mend");
  assert.equal(word.dice, "heals 1d4+4");
  assert.equal(word.target, "ally");
  assert.equal(word.resource, "Slot 1 · 4/4");
  const hold = byId(cards, "spell:hold person");
  assert.equal(hold.type, "control");
  assert.deepEqual(hold.save, { ability: "WIS", dc: 14 });
  assert.equal(hold.resource, "Slot 2 · 3/3");
  assert.equal(byId(cards, "spell:shield").cost, "reaction");
  // A one minute casting does not fit in a turn.
  assert.equal(byId(cards, "spell:identify"), undefined);
});

test("a cantrip scales with character level", () => {
  const cards = deriveHand(caster({ level: 11 }), FRESH_TURN, { spells: FACTS });
  assert.equal(byId(cards, "spell:fire bolt").dice, "3d10 fire");
});

test("a spent slot level upcasts to the next one, and no slots dims the card", () => {
  const upcast = caster({ spellcasting: { ability: "int", slots: { 1: { max: 4, used: 4 }, 2: { max: 3, used: 1 } }, prepared: ["Healing Word"], known: [] } });
  assert.deepEqual(lowestSlot(upcast, 1), { level: 2, left: 2, max: 3, pact: false });
  const word = byId(deriveHand(upcast, FRESH_TURN, { spells: FACTS }), "spell:healing word");
  assert.equal(word.dice, "heals 2d4+4");
  assert.equal(word.intent.slotLevel, 2);
  const dry = caster({ spellcasting: { ability: "int", slots: { 1: { max: 4, used: 4 } }, prepared: ["Healing Word", "Fire Bolt"], known: [] } });
  const cards = deriveHand(dry, FRESH_TURN, { spells: FACTS });
  assert.match(byId(cards, "spell:healing word").disabled, /No spell slot of level 1/);
  assert.equal(byId(cards, "spell:healing word").spent, true);
  assert.equal(byId(cards, "spell:fire bolt").disabled, null);
});

test("pact slots carry a warlock's spells", () => {
  const warlock = caster({ class: "warlock", spellcasting: { ability: "cha", slots: {}, prepared: [], known: ["Hold Person"], pact: { level: 2, max: 2, used: 1 } } });
  assert.equal(byId(deriveHand(warlock, FRESH_TURN, { spells: FACTS }), "spell:hold person").resource, "Pact 2 · 1/2");
});

test("after a bonus action spell only a cantrip may follow", () => {
  const cards = deriveHand(caster(), FRESH_TURN, { spells: FACTS });
  const turn = afterCommit(FRESH_TURN, byId(cards, "spell:healing word"));
  assert.equal(turn.bonusUsed, true);
  assert.equal(turn.leveledSpell, "bonus");
  const next = deriveHand(caster(), turn, { spells: FACTS });
  assert.match(byId(next, "spell:hold person").disabled, /only a cantrip/);
  assert.equal(byId(next, "spell:fire bolt").disabled, null);
});

test("a second concentration spell warns on the card", () => {
  const cards = deriveHand(caster({ concentratingOn: "Bless" }), FRESH_TURN, { spells: FACTS });
  assert.match(byId(cards, "spell:hold person").rules, /Ends your concentration on Bless/);
});

test("a spell with no facts and no authored row stays off the hand rather than guessing", () => {
  const cards = deriveHand(caster({ spellcasting: { ability: "int", slots: {}, prepared: ["Zzyzx's Unknowable Hex"], known: [] } }));
  assert.equal(cards.filter((card) => card.intent.card === "spell").length, 0);
});

// ---- class features ----

test("limited-use features become cards with their uses and their cost", () => {
  const features = [{ name: "Second Wind", source: "class" }, { name: "Action Surge (1 use)", source: "class" }];
  const fighter = sheet({ features, resources: populateResources(features, 4, {}, { second_wind: { max: 1, used: 1 } }) });
  const cards = deriveHand(fighter);
  const wind = byId(cards, "feature:second_wind");
  assert.equal(wind.cost, "bonus");
  assert.equal(wind.dice, "heals 1d10+4");
  assert.equal(wind.resource, "Uses 0/1");
  assert.match(wind.disabled, /short rest/);
  assert.equal(wind.spent, true);
  const surge = byId(cards, "feature:action_surge");
  assert.equal(surge.cost, "free");
  assert.equal(surge.disabled, null);
  // Action Surge hands back an action.
  const spentAction = { ...FRESH_TURN, actionUsed: true, attacksMade: 1 };
  assert.match(byId(deriveHand(fighter, spentAction), "basic:dodge").disabled, /action is spent/);
  const surged = afterCommit(spentAction, surge);
  assert.equal(surged.extraActions, 1);
  assert.equal(byId(deriveHand(fighter, surged), "basic:dodge").disabled, null);
});

// ---- the basics, and what stops a hand ----

test("every character holds the ten basic actions", () => {
  const cards = deriveHand(sheet());
  for (const id of ["dodge", "dash", "disengage", "help", "hide", "ready", "grapple", "shove", "use-object", "end-turn"]) {
    assert.ok(byId(cards, `basic:${id}`), id);
  }
  assert.equal(byId(cards, "basic:grapple").dice, "Athletics +5");
  assert.equal(byId(cards, "basic:ready").compose, true);
});

test("Cunning Action moves Dash to the bonus action once the action is gone", () => {
  const rogue = sheet({ class: "rogue", features: [{ name: "Cunning Action", source: "class" }] });
  const turn = { ...FRESH_TURN, actionUsed: true, attacksMade: 1 };
  const dash = byId(deriveHand(rogue, turn), "basic:dash");
  assert.equal(dash.cost, "bonus");
  assert.equal(dash.disabled, null);
  assert.match(composeSentence(dash, null), /bonus action/);
  assert.match(byId(deriveHand(sheet(), turn), "basic:dash").disabled, /action is spent/);
});

test("a condition that forbids acting stops every card but End turn", () => {
  const cards = deriveHand(sheet({ equipment: [item("Longsword")], conditions: ["Stunned"] }));
  for (const card of cards) {
    if (card.id === "basic:end-turn") assert.equal(card.disabled, null);
    else assert.match(card.disabled, /stunned and cannot act/, card.id);
  }
  const grappled = deriveHand(sheet({ conditions: ["grappled"] }));
  assert.match(byId(grappled, "basic:dash").disabled, /speed is 0/);
  assert.equal(byId(grappled, "basic:dodge").disabled, null);
});

test("it is somebody else's turn: the hand can be read, not played", () => {
  const cards = deriveHand(sheet({ equipment: [item("Longsword")] }), { ...FRESH_TURN, myTurn: false, currentName: "Talia" });
  assert.ok(cards.every((card) => card.disabled === "It is Talia's turn."));
});

test("a character at 0 hit points cannot act", () => {
  const cards = deriveHand(sheet({ currentHp: 0, equipment: [item("Longsword")] }));
  assert.match(byId(cards, "attack:longsword").disabled, /is down/);
});

test("a slowed character has no reaction", () => {
  const cards = deriveHand(caster({ conditions: ["slowed"] }), FRESH_TURN, { spells: FACTS });
  assert.match(byId(cards, "spell:shield").disabled, /No reactions/);
});

// ---- the preview ----

test("the preview's hit chance is odds.ts against the armour class, labelled when it is an estimate", () => {
  const sword = byId(deriveHand(sheet({ equipment: [item("Longsword")] })), "attack:longsword");
  const known = previewRows(sword, { id: "e1", name: "Wight 1", kind: "enemy", ac: 14 });
  const chance = asPercent(attackOdds({ attackBonus: 5, ac: 14 }).hit);
  assert.equal(known.find((row) => row.key === "To hit").value, `+5 vs AC 14 · ${chance}`);
  assert.equal(known.find((row) => row.key === "Expected dmg").value, "7.5");
  assert.equal(known.find((row) => row.key === "Type").value, "slashing");
  assert.equal(known.find((row) => row.key === "Cost").value, "Action");
  // A player sees the challenge, not the armour class.
  assert.equal(typicalAcForCr(3), 13);
  const guessed = previewRows(sword, { id: "e1", name: "Wight 1", kind: "enemy", cr: 3 });
  assert.match(guessed.find((row) => row.key === "To hit").value, /^\+5 vs AC ~13 · /);
  assert.equal(previewRows(sword, null).find((row) => row.key === "To hit").value, "+5");
});

test("conditions move the odds the way the engine will", () => {
  const sword = byId(deriveHand(sheet({ equipment: [item("Longsword")] })), "attack:longsword");
  const prone = previewRows(sword, { id: "e1", name: "Wight 1", kind: "enemy", ac: 14, conditions: ["prone"] });
  const adv = asPercent(attackOdds({ attackBonus: 5, ac: 14, advantage: "advantage" }).hit);
  assert.equal(prone.find((row) => row.key === "To hit").value, `+5 vs AC 14 · ${adv} · advantage`);
  const poisoned = previewRows(sword, { id: "e1", name: "Wight 1", kind: "enemy", ac: 14 }, ["poisoned"]);
  assert.match(poisoned.find((row) => row.key === "To hit").value, /disadvantage$/);
});

test("a save spell previews its DC, a heal its mean", () => {
  const cards = deriveHand(caster(), FRESH_TURN, { spells: FACTS });
  const hold = previewRows(byId(cards, "spell:hold person"), null);
  assert.equal(hold.find((row) => row.key === "Save").value, "WIS save vs DC 14");
  assert.equal(hold.find((row) => row.key === "Applies").value, "paralyzed");
  assert.equal(hold.find((row) => row.key === "Cost").value, "Action · Slot 2 · 3/3");
  const word = previewRows(byId(cards, "spell:healing word"), null);
  assert.equal(word.find((row) => row.key === "Restores").value, "heals 1d4+4");
  assert.equal(word.find((row) => row.key === "Expected").value, "+6.5");
});

// ---- the commit ----

test("the fallback sentence is the HUD's sentence with the weapon named", () => {
  const cards = deriveHand(sheet({ equipment: [item("Longsword")] }));
  const wight = { id: "e1", name: "Wight 1", kind: "enemy" };
  assert.equal(composeSentence(byId(cards, "attack:longsword"), wight), "I attack Wight 1 with my Longsword.");
  assert.equal(composeSentence(byId(cards, "attack:unarmed strike"), wight), "I attack Wight 1 with an unarmed strike.");
  assert.equal(composeSentence(byId(cards, "basic:dodge"), null), "I take the Dodge action.");
  assert.equal(composeSentence(byId(cards, "basic:dash"), null), "I Dash.");
  assert.equal(composeSentence(byId(cards, "basic:disengage"), null), "I Disengage and step away.");
  assert.equal(composeSentence(byId(cards, "basic:help"), { id: "s2", name: "Ysolde", kind: "ally" }), "I take the Help action for Ysolde.");
  assert.equal(composeSentence(byId(cards, "basic:shove"), wight), "I shove Wight 1.");
});

test("spell and rider sentences name the slot and the target", () => {
  const cards = deriveHand(caster(), FRESH_TURN, { spells: FACTS });
  const wight = { id: "e1", name: "Wight 1", kind: "enemy" };
  assert.equal(composeSentence(byId(cards, "spell:fire bolt"), wight), "I cast Fire Bolt at Wight 1.");
  assert.equal(
    composeSentence(byId(cards, "spell:healing word"), { id: "s2", name: "Durgan", kind: "ally" }),
    "I cast Healing Word on Durgan as a bonus action using a level 1 slot.",
  );
  assert.equal(composeSentence(byId(cards, "spell:healing word"), { id: "s1", name: "Lys", kind: "self" }), "I cast Healing Word on myself as a bonus action using a level 1 slot.");
  const paladin = caster({ class: "paladin", equipment: [item("Longsword")], features: [{ name: "Divine Smite", source: "class" }] });
  const hand = deriveHand(paladin);
  assert.equal(
    composeSentence(byId(hand, "attack:longsword"), wight, [byId(hand, "rider:divine smite")]),
    "I attack Wight 1 with my Longsword. If it hits, I use Divine Smite with a level 1 slot.",
  );
});

test("the structured intent rides beside the sentence", () => {
  const cards = deriveHand(sheet({ equipment: [item("Longsword")] }));
  assert.deepEqual(intentBody(byId(cards, "attack:longsword"), { id: "e1", name: "Wight 1", kind: "enemy" }), {
    card: "attack", weapon: "Longsword", targetId: "e1", targetName: "Wight 1", targetKind: "enemy",
  });
  assert.deepEqual(intentBody(byId(cards, "basic:dodge"), null), { card: "basic", action: "dodge" });
});

test("a target tapped on the board arrives as the HUD's sentence", () => {
  const names = ["Wight 1", "Wight 12", "Wight 2"];
  assert.equal(targetFromComposedText("I attack Wight 12.", names), "Wight 12");
  assert.equal(targetFromComposedText("I cast  at Wight 2.", names), "Wight 2");
  assert.equal(targetFromComposedText("I attack the door.", names), null);
  assert.equal(targetFromComposedText("I look around.", names), null);
});

// ---- the cap ----

test("nine cards fan out, the rest wait behind the spine, and End turn never leaves", () => {
  const full = caster({ equipment: [item("Quarterstaff"), item("Dagger")] });
  const cards = deriveHand(full, FRESH_TURN, { spells: FACTS });
  assert.ok(cards.length > HAND_FAN_CAP);
  const { fan, more } = splitHand(cards);
  assert.equal(fan.length, HAND_FAN_CAP);
  assert.equal(fan.length + more.length, cards.length);
  assert.equal(fan[fan.length - 1].id, "basic:end-turn");
  // Attacks, then spells by level, then the basics.
  const order = cards.map((card) => card.intent.card);
  assert.ok(order.indexOf("attack") < order.indexOf("spell"));
  assert.ok(order.lastIndexOf("spell") < order.indexOf("basic"));
  const levels = cards.filter((card) => card.intent.card === "spell").map((card) => (card.resource === "Cantrip" ? 0 : 1));
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b));
  const small = deriveHand(sheet()).slice(0, 5);
  assert.deepEqual(splitHand(small), { fan: small, more: [] });
});

test("a spent card gives its seat in the fan to one that can be played", () => {
  const turn = { ...FRESH_TURN, bonusUsed: true };
  const cards = deriveHand(caster({ equipment: [item("Dagger")] }), turn, { spells: FACTS });
  const { fan, more } = splitHand(cards);
  assert.ok(more.some((card) => card.id === "spell:healing word"));
  assert.ok(fan.every((card) => card.disabled === null));
});

console.log(`test-hand: ${passed} passed`);
