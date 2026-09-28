// The SRD 5.1 class progression, written out by hand, for the
// scripts/test-enforce-*.mjs suites that guard levelling.
//
// Nothing here is read from src/lib/srd: a test that compared the engine to
// its own JSON would prove nothing. Each table is the class table the SRD
// prints, with Ability Score Improvements kept apart in `asi` because ODM
// tracks them in src/lib/srd/asi.ts rather than as features.
//
// Spelling follows ODM where the SRD only differs in wording a count
// ("Action Surge (1 use)" for the SRD's "one use"): how a name is spelled is
// not a rule. A feature the SRD table repeats (Expertise, Magical Secrets)
// is listed at every level it appears; a sheet holds it once.
//
// The artificer is not in SRD 5.1. ODM ships it, so its published table is
// here too and the suites say so where they use it.

export const PROFICIENCY_BY_LEVEL = [
  2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6,
];

// Total experience needed to BE each level, index = level - 1.
export const XP_BY_LEVEL = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000,
  305000, 355000,
];

export const STANDARD_ASI_LEVELS = [4, 8, 12, 16, 19];

// A value that steps up at certain levels: [[level, value], ...] ascending.
// Below the first step the answer is `before`.
export function stepped(steps, level, before = 0) {
  let value = before;
  for (const [atLevel, stepValue] of steps) {
    if (level >= atLevel) {
      value = stepValue;
    }
  }
  return value;
}

// The highest spell slot a class has at a level: full casters reach a new
// spell level every odd level, half casters start at 2 and step every four,
// the artificer is a half caster that starts at 1.
export function topSlotLevel(casterType, level) {
  if (casterType === "full") {
    return Math.min(9, Math.ceil(level / 2));
  }
  if (casterType === "half") {
    return level < 2 ? 0 : Math.min(5, Math.ceil(level / 4));
  }
  if (casterType === "artificer") {
    return Math.min(5, Math.ceil(level / 4));
  }
  return 0;
}

// Warlock Pact Magic: how many slots, and the one level they all share.
export const PACT_SLOTS = [[1, 1], [2, 2], [11, 3], [17, 4]];
export const PACT_SLOT_LEVEL = [[1, 1], [3, 2], [5, 3], [7, 4], [9, 5]];

export const UNLIMITED = Number.POSITIVE_INFINITY;

export const SRD_CLASSES = {
  barbarian: {
    hitDie: 12, caster: "none", subclassAt: 3,
    subclassLevels: [3, 6, 10, 14],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Rage", "Unarmored Defense"],
      2: ["Reckless Attack", "Danger Sense"],
      3: ["Primal Path"],
      5: ["Extra Attack", "Fast Movement"],
      7: ["Feral Instinct"],
      9: ["Brutal Critical (1 die)"],
      11: ["Relentless Rage"],
      13: ["Brutal Critical (2 dice)"],
      15: ["Persistent Rage"],
      17: ["Brutal Critical (3 dice)"],
      18: ["Indomitable Might"],
      20: ["Primal Champion"],
    },
    subclass: {
      name: "Path of the Berserker",
      features: {
        3: ["Frenzy"], 6: ["Mindless Rage"], 10: ["Intimidating Presence"], 14: ["Retaliation"],
      },
    },
    // Rages per long rest; unlimited at 20.
    resources: { rage: [[1, 2], [3, 3], [6, 4], [12, 5], [17, 6], [20, UNLIMITED]] },
    extraAttacks: [[5, 1]],
    critExtraDice: [[9, 1], [13, 2], [17, 3]],
    rageDamage: [[1, 2], [9, 3], [16, 4]],
    speedBonus: [[5, 10]],
  },
  bard: {
    hitDie: 8, caster: "full", ability: "cha", subclassAt: 3,
    subclassLevels: [3, 6, 14],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Spellcasting", "Bardic Inspiration (d6)"],
      2: ["Jack of All Trades", "Song of Rest (d6)"],
      3: ["Bard College", "Expertise"],
      5: ["Bardic Inspiration (d8)", "Font of Inspiration"],
      6: ["Countercharm"],
      9: ["Song of Rest (d8)"],
      10: ["Bardic Inspiration (d10)", "Expertise", "Magical Secrets"],
      13: ["Song of Rest (d10)"],
      14: ["Magical Secrets"],
      15: ["Bardic Inspiration (d12)"],
      17: ["Song of Rest (d12)"],
      18: ["Magical Secrets"],
      20: ["Superior Inspiration"],
    },
    subclass: {
      name: "College of Lore",
      features: {
        3: ["Bonus Proficiencies (Lore)", "Cutting Words"], 6: ["Additional Magical Secrets"],
        14: ["Peerless Skill"],
      },
    },
    inspirationDie: [[1, "d6"], [5, "d8"], [10, "d10"], [15, "d12"]],
    songOfRest: [[2, "d6"], [9, "d8"], [13, "d10"], [17, "d12"]],
    expertise: [[3, 2], [10, 4]],
  },
  cleric: {
    hitDie: 8, caster: "full", ability: "wis", subclassAt: 1,
    subclassLevels: [1, 2, 6, 8, 17],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Spellcasting", "Divine Domain"],
      2: ["Channel Divinity (1/rest)", "Channel Divinity: Turn Undead"],
      5: ["Destroy Undead (CR 1/2)"],
      6: ["Channel Divinity (2/rest)"],
      8: ["Destroy Undead (CR 1)"],
      10: ["Divine Intervention"],
      11: ["Destroy Undead (CR 2)"],
      14: ["Destroy Undead (CR 3)"],
      17: ["Destroy Undead (CR 4)"],
      18: ["Channel Divinity (3/rest)"],
      20: ["Divine Intervention Improvement"],
    },
    subclass: {
      name: "Life Domain",
      features: {
        1: ["Bonus Proficiency (heavy armor)", "Disciple of Life"],
        2: ["Channel Divinity: Preserve Life"], 6: ["Blessed Healer"], 8: ["Divine Strike"],
        17: ["Supreme Healing"],
      },
      spells: {
        1: ["Bless", "Cure Wounds"], 3: ["Lesser Restoration", "Spiritual Weapon"],
        5: ["Beacon of Hope", "Revivify"], 7: ["Death Ward", "Guardian of Faith"],
        9: ["Mass Cure Wounds", "Raise Dead"],
      },
    },
    resources: { channel_divinity: [[2, 1], [6, 2], [18, 3]] },
  },
  druid: {
    hitDie: 8, caster: "full", ability: "wis", subclassAt: 2,
    subclassLevels: [2, 6, 10, 14],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Druidic", "Spellcasting"],
      2: ["Wild Shape", "Druid Circle"],
      4: ["Wild Shape Improvement"],
      8: ["Wild Shape Improvement"],
      18: ["Timeless Body", "Beast Spells"],
      20: ["Archdruid"],
    },
    subclass: {
      name: "Circle of the Land",
      features: {
        2: ["Bonus Cantrip", "Natural Recovery"], 3: ["Circle Spells"], 6: ["Land's Stride"],
        10: ["Nature's Ward"], 14: ["Nature's Sanctuary"],
      },
    },
    // Two uses per short rest; Archdruid makes it unlimited at 20.
    resources: {
      wild_shape: [[2, 2], [20, UNLIMITED]],
      natural_recovery: [[2, 1]],
    },
    // Beast form ceilings: CR 1/4 with no flying or swimming speed at 2,
    // CR 1/2 with no flying speed at 4, CR 1 at 8.
    wildShapeCr: [[2, 0.25], [4, 0.5], [8, 1]],
    wildShapeSwim: [[4, true]],
    wildShapeFly: [[8, true]],
  },
  fighter: {
    hitDie: 10, caster: "none", subclassAt: 3,
    subclassLevels: [3, 7, 10, 15, 18],
    asi: [4, 6, 8, 12, 14, 16, 19],
    features: {
      1: ["Fighting Style", "Second Wind"],
      2: ["Action Surge (1 use)"],
      3: ["Martial Archetype"],
      5: ["Extra Attack"],
      9: ["Indomitable (1 use)"],
      11: ["Extra Attack (2)"],
      13: ["Indomitable (2 uses)"],
      17: ["Action Surge (2 uses)", "Indomitable (3 uses)"],
      20: ["Extra Attack (3)"],
    },
    subclass: {
      name: "Champion",
      features: {
        3: ["Improved Critical"], 7: ["Remarkable Athlete"], 10: ["Additional Fighting Style"],
        15: ["Superior Critical"], 18: ["Survivor"],
      },
    },
    resources: {
      second_wind: [[1, 1]],
      action_surge: [[2, 1], [17, 2]],
    },
    indomitable: [[9, 1], [13, 2], [17, 3]],
    extraAttacks: [[5, 1], [11, 2], [20, 3]],
    critRange: [[3, 19], [15, 18]],
  },
  monk: {
    hitDie: 8, caster: "none", subclassAt: 3,
    subclassLevels: [3, 6, 11, 17],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Unarmored Defense", "Martial Arts"],
      2: ["Ki", "Unarmored Movement"],
      3: ["Monastic Tradition", "Deflect Missiles"],
      4: ["Slow Fall"],
      5: ["Extra Attack", "Stunning Strike"],
      6: ["Ki-Empowered Strikes"],
      7: ["Evasion", "Stillness of Mind"],
      9: ["Unarmored Movement Improvement"],
      10: ["Purity of Body"],
      13: ["Tongue of the Sun and Moon"],
      14: ["Diamond Soul"],
      15: ["Timeless Body"],
      18: ["Empty Body"],
      20: ["Perfect Self"],
    },
    subclass: {
      name: "Way of the Open Hand",
      features: {
        3: ["Open Hand Technique"], 6: ["Wholeness of Body"], 11: ["Tranquility"],
        17: ["Quivering Palm"],
      },
    },
    // Ki points equal the monk's level, from level 2.
    resources: { ki: "level-from-2" },
    martialArts: [[1, "d4"], [5, "d6"], [11, "d8"], [17, "d10"]],
    extraAttacks: [[5, 1]],
    speedBonus: [[2, 10], [6, 15], [10, 20], [14, 25], [18, 30]],
  },
  paladin: {
    hitDie: 10, caster: "half", ability: "cha", subclassAt: 3,
    subclassLevels: [3, 7, 15, 20],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Divine Sense", "Lay on Hands"],
      2: ["Fighting Style", "Spellcasting", "Divine Smite"],
      3: ["Divine Health", "Sacred Oath", "Channel Divinity"],
      5: ["Extra Attack"],
      6: ["Aura of Protection"],
      10: ["Aura of Courage"],
      11: ["Improved Divine Smite"],
      14: ["Cleansing Touch"],
      18: ["Aura Improvements"],
    },
    subclass: {
      name: "Oath of Devotion",
      features: {
        3: ["Channel Divinity: Sacred Weapon", "Channel Divinity: Turn the Unholy"],
        7: ["Aura of Devotion"], 15: ["Purity of Spirit"], 20: ["Holy Nimbus"],
      },
      spells: {
        3: ["Protection from Evil and Good", "Sanctuary"],
        5: ["Lesser Restoration", "Zone of Truth"], 9: ["Beacon of Hope", "Dispel Magic"],
        13: ["Freedom of Movement", "Guardian of Faith"], 17: ["Commune", "Flame Strike"],
      },
    },
    // A paladin's Channel Divinity is one use per rest at every level; only
    // the cleric's grows.
    resources: { lay_on_hands: "5-per-level", channel_divinity: [[3, 1]] },
    extraAttacks: [[5, 1]],
  },
  ranger: {
    hitDie: 10, caster: "half", ability: "wis", subclassAt: 3,
    subclassLevels: [3, 7, 11, 15],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Favored Enemy", "Natural Explorer"],
      2: ["Fighting Style", "Spellcasting"],
      3: ["Ranger Archetype", "Primeval Awareness"],
      5: ["Extra Attack"],
      6: ["Favored Enemy Improvement", "Natural Explorer Improvement"],
      8: ["Land's Stride"],
      10: ["Natural Explorer Improvement", "Hide in Plain Sight"],
      14: ["Favored Enemy Improvement", "Vanish"],
      18: ["Feral Senses"],
      20: ["Foe Slayer"],
    },
    subclass: {
      name: "Hunter",
      features: {
        3: ["Hunter's Prey"], 7: ["Defensive Tactics"], 11: ["Multiattack"],
        15: ["Superior Hunter's Defense"],
      },
    },
    extraAttacks: [[5, 1]],
  },
  rogue: {
    hitDie: 8, caster: "none", subclassAt: 3,
    subclassLevels: [3, 9, 13, 17],
    asi: [4, 8, 10, 12, 16, 19],
    features: {
      1: ["Expertise", "Sneak Attack", "Thieves' Cant"],
      2: ["Cunning Action"],
      3: ["Roguish Archetype"],
      5: ["Uncanny Dodge"],
      6: ["Expertise"],
      7: ["Evasion"],
      11: ["Reliable Talent"],
      14: ["Blindsense"],
      15: ["Slippery Mind"],
      18: ["Elusive"],
      20: ["Stroke of Luck"],
    },
    subclass: {
      name: "Thief",
      features: {
        3: ["Fast Hands", "Second-Story Work"], 9: ["Supreme Sneak"], 13: ["Use Magic Device"],
        17: ["Thief's Reflexes"],
      },
    },
    sneakAttack: "half-level-up",
    expertise: [[1, 2], [6, 4]],
  },
  sorcerer: {
    hitDie: 6, caster: "full", ability: "cha", subclassAt: 1,
    subclassLevels: [1, 6, 14, 18],
    asi: STANDARD_ASI_LEVELS,
    // The SRD prints "Metamagic" again at 10 and 17 for the extra option;
    // ODM names those two entries "Metamagic Option".
    features: {
      1: ["Spellcasting", "Sorcerous Origin"],
      2: ["Font of Magic"],
      3: ["Metamagic"],
      10: ["Metamagic Option"],
      17: ["Metamagic Option"],
      20: ["Sorcerous Restoration"],
    },
    subclass: {
      name: "Draconic Bloodline",
      features: {
        1: ["Dragon Ancestor", "Draconic Resilience"], 6: ["Elemental Affinity"],
        14: ["Dragon Wings"], 18: ["Draconic Presence"],
      },
    },
    resources: { sorcery_points: "level-from-2" },
    options: { metamagic: [[3, 2], [10, 3], [17, 4]] },
  },
  warlock: {
    hitDie: 8, caster: "pact", ability: "cha", subclassAt: 1,
    subclassLevels: [1, 6, 10, 14],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Otherworldly Patron", "Pact Magic"],
      2: ["Eldritch Invocations"],
      3: ["Pact Boon"],
      11: ["Mystic Arcanum (6th level)"],
      13: ["Mystic Arcanum (7th level)"],
      15: ["Mystic Arcanum (8th level)"],
      17: ["Mystic Arcanum (9th level)"],
      20: ["Eldritch Master"],
    },
    subclass: {
      name: "The Fiend",
      features: {
        1: ["Dark One's Blessing"], 6: ["Dark One's Own Luck"], 10: ["Fiendish Resilience"],
        14: ["Hurl Through Hell"],
      },
    },
    options: {
      invocation: [[2, 2], [5, 3], [7, 4], [9, 5], [12, 6], [15, 7], [18, 8]],
      pact_boon: [[3, 1]],
    },
  },
  wizard: {
    hitDie: 6, caster: "full", ability: "int", subclassAt: 2,
    subclassLevels: [2, 6, 10, 14],
    asi: STANDARD_ASI_LEVELS,
    features: {
      1: ["Spellcasting", "Arcane Recovery"],
      2: ["Arcane Tradition"],
      18: ["Spell Mastery"],
      20: ["Signature Spells"],
    },
    subclass: {
      name: "School of Evocation",
      features: {
        2: ["Evocation Savant", "Sculpt Spells"], 6: ["Potent Cantrip"],
        10: ["Empowered Evocation"], 14: ["Overchannel"],
      },
    },
    resources: { arcane_recovery: [[1, 1]] },
  },
  // Outside SRD 5.1: the published artificer, which ODM ships.
  artificer: {
    hitDie: 8, caster: "artificer", ability: "int", subclassAt: 3,
    subclassLevels: [3, 5, 9, 15],
    asi: STANDARD_ASI_LEVELS,
    outsideSrd: true,
    features: {
      1: ["Magical Tinkering", "Spellcasting"],
      2: ["Infuse Item"],
      3: ["Artificer Specialist", "The Right Tool for the Job"],
      6: ["Tool Expertise"],
      7: ["Flash of Genius"],
      10: ["Magic Item Adept"],
      11: ["Spell-Storing Item"],
      14: ["Magic Item Savant"],
      18: ["Magic Item Master"],
      20: ["Soul of Artifice"],
    },
    subclass: null,
    options: { infusion: [[2, 4], [6, 6], [10, 8], [14, 10], [18, 12]] },
  },
};

export const CLASS_IDS = Object.keys(SRD_CLASSES);

const clean = (name) => name.trim().toLowerCase().replace(/\s+/g, " ");

// The names a sheet of this class and level should hold from its class and
// (when `withSubclass`) its SRD subclass, lowercased, each once.
export function expectedFeatureNames(classId, level, withSubclass = true) {
  const table = SRD_CLASSES[classId];
  const names = new Map();
  const take = (features) => {
    for (const [atLevel, list] of Object.entries(features)) {
      if (Number(atLevel) > level) {
        continue;
      }
      for (const name of list) {
        const key = clean(name);
        names.set(key, Math.min(names.get(key) ?? 99, Number(atLevel)));
      }
    }
  };
  take(table.features);
  if (withSubclass && table.subclass && level >= table.subclassAt) {
    take(table.subclass.features);
  }
  return names;
}

// Every (name, level) pair a class table prints, repeats included.
export function featurePairs(features) {
  return Object.entries(features).flatMap(([level, names]) =>
    names.map((name) => ({ name, level: Number(level) })),
  );
}

// A resource's SRD maximum at a level, or null when the class does not have
// it yet. UNLIMITED marks the level 20 capstones.
export function expectedResourceMax(spec, level) {
  if (spec === "level-from-2") {
    return level >= 2 ? level : null;
  }
  if (spec === "5-per-level") {
    return level * 5;
  }
  const value = stepped(spec, level, null);
  return value;
}

// Hit points by the fixed value the SRD offers in place of a roll: the whole
// die at level 1, half the die plus one after, the Constitution modifier on
// every level.
export function averageHp(hitDie, conMod, level) {
  return hitDie + conMod + (level - 1) * (hitDie / 2 + 1 + conMod);
}

// Calls the player's sheet route the way a client does.
export async function patchSheetAs(world, routeModule, user, body) {
  world.signIn(user);
  const request = new Request("http://test/", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await routeModule.PATCH(request, {
    params: Promise.resolve({ campaignId: world.campaignId }),
  });
  return { status: response.status, json: await response.json() };
}

export { clean as cleanName };
