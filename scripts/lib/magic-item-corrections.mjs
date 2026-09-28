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
  ...DAMAGE_TYPES.map((type) =>
    attuned(
      `Armor of ${title(type)} Resistance`,
      [{ kind: "resistance", types: [type] }],
      [`Armor of Resistance (${title(type)})`],
    ),
  ),
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
  ].map(([dragon, type]) =>
    attuned(
      `${dragon} Dragon Scale Mail`,
      [
        { kind: "ac_bonus", amount: 1 },
        { kind: "resistance", types: [type] },
      ],
      [`Dragon Scale Mail (${dragon})`],
    ),
  ),
  attuned("Ioun Stone of Protection", [{ kind: "ac_bonus", amount: 1 }], ["Ioun Stone (Protection)"]),
];
