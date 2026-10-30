// What a person corrected after reading the generated magic item rows against
// each item's own text. scripts/generate-magic-items.mjs applies these after
// parsing, so the committed table is the parser's output with these rows
// dropped, replaced or added, and a re-run reproduces it.
//
// The parser reads one sentence at a time and keeps only standing benefits to
// the wearer. What it still cannot tell from the words is listed here with the
// reason, so the next reader can check the call against the item.

const DAMAGE_TYPES = [
  "acid",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "poison",
  "psychic",
  "radiant",
  "thunder",
];

const title = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// Rows the parser produces that the item's text does not support. Keyed by
// the item's name in lower case.
export const DROPPED = {
  // Conditional on having helped slay an elemental of that kind.
  "ring of elemental command": "its resistances are earned by slaying elementals, not worn",
  // Needs a second item worn with it.
  "knight-sergeant's surcoat": "the Charisma score needs the argent mantle worn as well",
  // Snapped as a reaction, and the bubble lasts a minute.
  "bubble wand": "the armor class comes from a bubble that lasts one minute",
  // One entry for several different masks.
  "mask of the war chief": "each mask does something different",
  // The benefits belong to the wearer risen as undead, not to the living one.
  "retribution armor": "its resistances apply only after the wearer has died and risen",
  // A construct the wearer pilots, with a body of its own.
  "serveros war engine": "the score is the construct's while it is piloted",
  // One row for a family of different stones: the benefit depends on which.
  "ioun stone": "each stone does something different; the named stones have their own rows",
  // The type depends on the gem, the dragon or the suit; see the families.
  "ring of resistance": "the damage type is the gem's; the named rings have their own rows",
  "armor of resistance": "the damage type is the suit's; the named suits have their own rows",
  "dragon scale mail": "the damage type is the dragon's; the named suits have their own rows",
  "belt of giant strength": "the score is the giant's; the named belts have their own rows",
};

// Rows whose effects are replaced outright.
export const REPLACED = {
  // Immunity while held; resistance is the nearest thing the engine has.
  "lightning rod": [{ kind: "resistance", types: ["lightning"] }],
  // "If you are a good cleric or paladin, you can use the talisman as a holy
  // symbol, and you gain a +2 bonus to spell attack rolls": the attunement
  // asks only the alignment, the bonus the class as well.
  "talisman of pure good": [{ kind: "spell_attack_bonus", amount: 2, classes: ["cleric", "paladin"] }],
  "talisman of ultimate evil": [{ kind: "spell_attack_bonus", amount: 2, classes: ["cleric", "paladin"] }],
};

// Effects an SRD item's text grants in words the parser does not read,
// added to what it does read. Keyed like DROPPED.
export const EXTRA = {
  // "Your spell save DC and spell attack bonus each increase by 2." and "You
  // have advantage on saving throws against spells and other magical
  // effects." (the parser reads "against spells").
  "robe of the archmagi": [
    { kind: "spell_attack_bonus", amount: 2 },
    { kind: "spell_dc_bonus", amount: 2 },
  ],
  // "you gain a bonus to spell attack rolls determined by the wand's
  // rarity": the +1, +2 or +3 its row's name carries.
  "wand of the war mage, +1, +2, or +3": [{ kind: "spell_attack_bonus", amount: "named" }],
  // "You are immune to the poisoned condition and have immunity to poison
  // damage."
  "periapt of proof against poison": [
    { kind: "immunity", types: ["poison"] },
    { kind: "condition_immunity", conditions: ["poisoned"] },
  ],
  // "you have proficiency with the longbow and shortbow, and you gain a +2
  // bonus to damage rolls on ranged attacks made with such weapons."
  "bracers of archery": [{ kind: "weapon_rider", weapons: ["longbow", "shortbow"], ranged: true, damage: 2, proficient: true }],
};

// Other names a sheet writes an SRD row by: a family's row is named with
// every bonus it comes in ("Wand of the War Mage, +1, +2, or +3"), and a
// sheet names the one it holds ("+2 Wand of the War Mage").
export const ALIASES = {
  "wand of the war mage, +1, +2, or +3": [
    "Wand of the War Mage",
    "Wand of the War Mage +1",
    "Wand of the War Mage +2",
    "Wand of the War Mage +3",
  ],
};

const attuned = (name, effects, aliases = []) => ({
  name,
  requiresAttunement: true,
  effects,
  ...(aliases.length ? { aliases } : {}),
});

// SRD 5.1 items that are a family under one entry in the pack: the row a
// sheet carries names which member it is.
export const ADDED = [
  ...[
    ["Hill", 21],
    ["Stone", 23],
    ["Frost", 23],
    ["Fire", 25],
    ["Cloud", 27],
    ["Storm", 29],
  ].map(([giant, score]) =>
    attuned(`Belt of ${giant} Giant Strength`, [{ kind: "set_ability", ability: "str", score }]),
  ),
  ...DAMAGE_TYPES.map((type) =>
    attuned(
      `Ring of ${title(type)} Resistance`,
      [{ kind: "resistance", types: [type] }],
      [`Ring of Resistance (${title(type)})`],
    ),
  ),
  // Leather unless a sheet row names its suit ("Chain Mail of Fire
  // Resistance"), from the family of the pack's Armor of Resistance row
  // (src/lib/srd/magic-gear.ts reads it as the SRD's "light, medium, or
  // heavy").
  ...DAMAGE_TYPES.map((type) => ({
    ...attuned(
      `Armor of ${title(type)} Resistance`,
      [{ kind: "resistance", types: [type] }],
      [`Armor of Resistance (${title(type)})`],
    ),
    base: { kind: "armor", name: "Leather", any: "light" },
  })),
  ...[
    ["Black", "acid"],
    ["Blue", "lightning"],
    ["Brass", "fire"],
    ["Bronze", "lightning"],
    ["Copper", "acid"],
    ["Gold", "fire"],
    ["Green", "poison"],
    ["Red", "fire"],
    ["Silver", "cold"],
    ["White", "cold"],
  ].map(([dragon, type]) => ({
    ...attuned(
      `${dragon} Dragon Scale Mail`,
      [
        { kind: "ac_bonus", amount: 1 },
        { kind: "resistance", types: [type] },
      ],
      [`Dragon Scale Mail (${dragon})`],
    ),
    base: { kind: "armor", name: "Scale Mail" },
  })),
  attuned("Ioun Stone of Protection", [{ kind: "ac_bonus", amount: 1 }], ["Ioun Stone (Protection)"]),
  // SRD 5.1, Ioun Stone: "Your <ability> score increases by 2, to a maximum
  // of 20, while this ... stone orbits your head."
  ...[
    ["Agility", "dex"],
    ["Fortitude", "con"],
    ["Insight", "wis"],
    ["Intellect", "int"],
    ["Leadership", "cha"],
    ["Strength", "str"],
  ].map(([stone, ability]) =>
    attuned(`Ioun Stone of ${stone}`, [{ kind: "increase_ability", ability, amount: 2, max: 20 }], [`Ioun Stone (${stone})`]),
  ),
];
