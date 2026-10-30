// The fixed scenarios the card scorer plays (scripts/score-cards.mjs, issue
// 570): one card from the Hand each, at a table staged the same way every
// run, with the dice seeded. Each names the party (the actor first), where
// everyone stands, the card by the name on its face, and whom it is aimed
// at. The card itself is dealt by the Hand (deriveHand) and posted with the
// sentence the Hand composes (hand-play.ts), so a scenario plays exactly
// what a player would, and a card the Hand will not deal is a staging error
// to fix, not a model failure to count.
//
// What is measured is the tool call, never the prose: intentTools() names
// the tool each card resolves with, and card-score-logic.ts reads the turn.
//
// Groups: attack, spell, feature, basic, reaction, gear. A scenario out of a
// fight (outOfFight) measures the cards played between fights, which the
// engine's direct path never takes.

// ---- the party -------------------------------------------------------------
// Level 5, so every caster has a third-level slot and every martial their
// class's first features. Hit points and AC are stated so the staging owes
// nothing to the builder.
const SAVES_NONE = { saves: [], skills: [], expertise: [], languages: ["Common"], tools: [], armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] };

const SLOTS_5 = { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } };

export const HEROES = {
  fighter: {
    name: "Kara",
    class: "fighter",
    level: 5,
    maxHp: 44,
    ac: 18,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 11, cha: 10 },
    proficiencies: SAVES_NONE,
    equipment: [
      { name: "Longsword", qty: 1, equipped: true },
      { name: "Shield", qty: 1, equipped: true },
      { name: "Dagger", qty: 1 },
      { name: "Potion of Healing", qty: 2 },
    ],
  },
  rogue: {
    name: "Rook",
    class: "rogue",
    level: 5,
    maxHp: 33,
    ac: 15,
    abilities: { str: 10, dex: 17, con: 12, int: 12, wis: 13, cha: 11 },
    proficiencies: { ...SAVES_NONE, skills: ["stealth", "perception"] },
    equipment: [
      { name: "Shortsword", qty: 1 },
      { name: "Shortbow", qty: 1, equipped: true },
      { name: "Arrows", qty: 20 },
      { name: "Dagger", qty: 1 },
    ],
  },
  wizard: {
    name: "Iris",
    class: "wizard",
    level: 5,
    maxHp: 27,
    ac: 12,
    abilities: { str: 8, dex: 14, con: 12, int: 17, wis: 12, cha: 10 },
    proficiencies: { ...SAVES_NONE, armor: [], weapons: ["daggers", "quarterstaffs"] },
    equipment: [{ name: "Quarterstaff", qty: 1, equipped: true }, { name: "Dagger", qty: 1 }],
    spellcasting: {
      ability: "int",
      slots: SLOTS_5,
      known: [],
      prepared: ["Magic Missile", "Shield", "Mage Armor", "Burning Hands", "Hold Person", "Fireball", "Web"],
      cantrips: ["Fire Bolt", "Ray of Frost"],
      spellbook: ["Magic Missile", "Shield", "Mage Armor", "Burning Hands", "Hold Person", "Fireball", "Web"],
    },
  },
  cleric: {
    name: "Sefa",
    class: "cleric",
    level: 5,
    maxHp: 38,
    ac: 16,
    abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
    proficiencies: SAVES_NONE,
    equipment: [{ name: "Mace", qty: 1, equipped: true }, { name: "Shield", qty: 1 }],
    spellcasting: {
      ability: "wis",
      slots: SLOTS_5,
      known: [],
      prepared: ["Cure Wounds", "Healing Word", "Bless", "Guiding Bolt", "Shield of Faith", "Hold Person"],
      cantrips: ["Sacred Flame"],
    },
  },
  barbarian: {
    name: "Brom",
    class: "barbarian",
    level: 5,
    maxHp: 55,
    ac: 14,
    abilities: { str: 17, dex: 13, con: 16, int: 8, wis: 10, cha: 9 },
    proficiencies: SAVES_NONE,
    equipment: [{ name: "Greataxe", qty: 1, equipped: true }, { name: "Handaxe", qty: 2 }],
  },
};

// The ally beside the actor: a fighter for everyone, a cleric for the fighter.
export function allyOf(actor) {
  return actor === "fighter" ? "cleric" : "fighter";
}

// ---- the scenarios ---------------------------------------------------------
// place: "melee" stands the actor next to the first enemy, "ranged" six
// squares (30 ft) away; the ally always stands next to the actor.
// wounded: hit points to set before the card, by role.
// aim: "enemy" (the first living enemy), "ally", "self" or null.
// equipped: the only items in the actor's hands for this scenario.
// choices: the Hand's own picks (an attack option, a chosen item, an area).
const S = (id, group, actor, card, extra = {}) => ({ id, group, actor, card, place: "melee", aim: null, ...extra });

export const SCENARIOS = [
  // Attacks. The engine resolves a complete attack card itself; these say so.
  S("attack-longsword", "attack", "fighter", "Longsword", { aim: "enemy" }),
  S("attack-shortbow-ranged", "attack", "rogue", "Shortbow", { aim: "enemy", place: "ranged" }),
  S("attack-greataxe-reckless", "attack", "barbarian", "Greataxe", { aim: "enemy", choices: { options: ["reckless"] } }),
  S("attack-dagger-thrown", "attack", "fighter", "Dagger", { aim: "enemy", place: "ranged", equipped: ["Dagger"] }),

  // Spells at one enemy: an attack roll, a save, an automatic hit.
  S("spell-fire-bolt", "spell", "wizard", "Fire Bolt", { aim: "enemy", place: "ranged" }),
  S("spell-ray-of-frost", "spell", "wizard", "Ray of Frost", { aim: "enemy", place: "ranged" }),
  S("spell-magic-missile", "spell", "wizard", "Magic Missile", { aim: "enemy", place: "ranged" }),
  S("spell-guiding-bolt", "spell", "cleric", "Guiding Bolt", { aim: "enemy", place: "ranged" }),
  S("spell-sacred-flame", "spell", "cleric", "Sacred Flame", { aim: "enemy", place: "ranged" }),
  S("spell-hold-person", "spell", "wizard", "Hold Person", { aim: "enemy", place: "ranged" }),

  // Healing and buffs on an ally or oneself.
  S("spell-cure-wounds", "spell", "cleric", "Cure Wounds", { aim: "ally", wounded: { ally: 10 } }),
  S("spell-healing-word", "spell", "cleric", "Healing Word", { aim: "ally", wounded: { ally: 10 } }),
  S("spell-bless", "spell", "cleric", "Bless", { aim: "ally" }),
  S("spell-shield-of-faith", "spell", "cleric", "Shield of Faith", { aim: "ally" }),
  S("spell-mage-armor-self", "spell", "wizard", "Mage Armor", { aim: "self" }),

  // Areas. The Hand lays no square for an instant burst or cone (only for a
  // zone that stays: Web, a wall), so the model names who stands in it, from
  // the card's aim at the first enemy and the board (issue 570 lists the
  // engine working this out itself as a gap).
  S("spell-fireball-area", "spell", "wizard", "Fireball", { place: "ranged", aim: "enemy", enemies: 3 }),
  S("spell-burning-hands-cone", "spell", "wizard", "Burning Hands", { aim: "enemy", enemies: 2 }),
  // A zone that stays is laid on a square picked on the board; the engine
  // leaves a laid area to the model (intent-logic.ts directCardCall).
  S("spell-web-area", "spell", "wizard", "Web", { place: "ranged", area: "enemy", enemies: 2 }),

  // Between fights: no initiative, no direct path.
  S("spell-cure-wounds-out-of-fight", "spell", "cleric", "Cure Wounds", { aim: "ally", wounded: { ally: 10 }, outOfFight: true }),
  S("spell-mage-armor-out-of-fight", "spell", "wizard", "Mage Armor", { aim: "self", outOfFight: true }),

  // Class features.
  S("feature-rage", "feature", "barbarian", "Rage"),
  S("feature-second-wind", "feature", "fighter", "Second Wind", { wounded: { actor: 20 } }),
  S("feature-action-surge", "feature", "fighter", "Action Surge"),
  S("feature-cunning-action-dash", "feature", "rogue", "Cunning Action: Dash"),

  // The basic actions.
  S("basic-dodge", "basic", "fighter", "Dodge"),
  S("basic-dash", "basic", "fighter", "Dash"),
  S("basic-disengage", "basic", "fighter", "Disengage"),
  S("basic-help", "basic", "fighter", "Help", { aim: "ally" }),
  S("basic-hide", "basic", "rogue", "Hide", { place: "ranged" }),
  S("basic-grapple", "basic", "fighter", "Grapple", { aim: "enemy" }),
  S("basic-shove", "basic", "fighter", "Shove", { aim: "enemy" }),
  S("basic-search", "basic", "rogue", "Search", { place: "ranged" }),
  S("basic-stand-up", "basic", "fighter", "Stand up", { conditions: ["prone"] }),

  // A reaction, off the actor's turn, to a hit the enemy just landed.
  S("reaction-shield", "reaction", "wizard", "Shield", { hit: true }),

  // Gear.
  S("gear-drink-potion", "gear", "fighter", "Drink a potion", { aim: "self", wounded: { actor: 20 }, choices: { choice: "Potion of Healing" } }),
  S("gear-drink-potion-out-of-fight", "gear", "fighter", "Drink a potion", { aim: "self", wounded: { actor: 20 }, choices: { choice: "Potion of Healing" }, outOfFight: true }),
  S("gear-hand-potion-to-ally", "gear", "fighter", "Hand to an ally", { aim: "ally", choices: { choice: "Potion of Healing" } }),
  S("gear-draw-dagger", "gear", "rogue", "Draw a weapon", { choices: { choice: "Dagger" }, equipped: [] }),
];

export function scenarioById(id) {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
