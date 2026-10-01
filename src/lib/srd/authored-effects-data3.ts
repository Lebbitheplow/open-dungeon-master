// The engine hooks of the authored subclass features, rogue to artificer
// (the shape of an entry: authored-effects-data.ts).

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const ELEMENTS = ["acid", "cold", "fire", "lightning", "thunder"];

export const AUTHORED_DATA_B2: Record<string, AuthoredEntry> = {
  // ---- rogue ----
  "rogue::Assassinate": {
    subclass: "Assassin",
    effects: [
      { kind: "attack_adv", vs: "not_acted" },
      { kind: "auto_crit", vs: "surprised" },
    ],
  },
  "rogue::Magical Ambush": {
    subclass: "Arcane Trickster",
    effects: [{ kind: "enemy_save", when: "hidden" }],
  },
  "rogue::Versatile Trickster": {
    subclass: "Arcane Trickster",
    spends: [
      { name: "Versatile Trickster", action: "bonus", does: { kind: "buff", target: "enemy", condition: "distracted", rounds: 1 } },
    ],
    effects: [{ kind: "attack_adv", vs: "distracted" }],
  },
  "rogue::Master of Tactics": {
    subclass: "Mastermind",
    effects: [{ kind: "bonus_route", action: "help", note: "Helping at up to 30 feet is the DM's to allow." }],
  },
  "rogue::Misdirection": {
    subclass: "Mastermind",
    reactions: [{ name: "Misdirection", does: { kind: "redirect" } }],
  },
  "rogue::Rakish Audacity": {
    subclass: "Swashbuckler",
    effects: [
      { kind: "init_ability", ability: "cha" },
      { kind: "sneak_duel" },
    ],
  },
  "rogue::Elegant Maneuver": {
    subclass: "Swashbuckler",
    spends: [{ name: "Elegant Maneuver", action: "bonus", does: { kind: "buff", condition: "elegant maneuver", rounds: 10 } }],
  },
  "rogue::Eye for Detail": {
    subclass: "Inquisitive",
    effects: [{ kind: "bonus_route", action: "search" }],
  },
  "rogue::Insightful Fighting": {
    subclass: "Inquisitive",
    // The read creature's Sneak Attack edge is read by authoredSneakEdge.
    spends: [
      { name: "Insightful Fighting", action: "bonus", does: { kind: "insight_contest", condition: "insightful fighting", rounds: 10 } },
    ],
  },
  "rogue::Steady Eye": {
    subclass: "Inquisitive",
    effects: [
      { kind: "check_adv", skills: ["perception", "investigation"], note: "The engine does not measure the half-speed move; the DM withholds it after a longer one." },
    ],
  },
  "rogue::Eye for Weakness": {
    subclass: "Inquisitive",
    effects: [{ kind: "sneak_bonus", dice: 3, mark: "insightful fighting" }],
  },
  "rogue::Skirmisher": {
    subclass: "Scout",
    reactions: [{ name: "Skirmisher", does: { kind: "move", trigger: "enemy_adjacent" } }],
  },
  "rogue::Superior Mobility": {
    subclass: "Scout",
    effects: [{ kind: "speed", amount: 10, note: "A climb or swim speed rises too; the board has none for characters." }],
  },
  "rogue::Ambush Master": {
    subclass: "Scout",
    effects: [
      { kind: "init_adv" },
      { kind: "mark", condition: "ambush master", effect: "attacked_adv", firstRoundOnly: true, oncePerTurn: true },
    ],
  },
  "rogue::Sudden Strike": {
    subclass: "Scout",
    effects: [{ kind: "bonus_attack", after: "attack", note: "A second Sneak Attack on another creature is the DM's to allow." }],
  },
  "rogue::Tokens of the Departed": {
    subclass: "Phantom",
    reactions: [{ name: "Tokens of the Departed", does: { kind: "gain_condition", condition: "soul trinket", rounds: 14400 } }],
    effects: [
      { kind: "save_adv", ability: "con", gate: { condition: "soul trinket" } },
      { kind: "resist", types: ["poison"], gate: { condition: "soul trinket" } },
    ],
  },
  "rogue::Psychic Blades": {
    subclass: "Soulknife",
    effects: [
      {
        kind: "natural_weapon",
        weapon: {
          name: "Psychic Blade",
          aliases: ["psychic blades", "soul blade"],
          dice: "1d6",
          type: "psychic",
          finesse: true,
          thrown: true,
          light: true,
          rangeFt: 60,
          longRangeFt: 120,
          second: "1d4",
        },
        note: "The published blade keeps its d6 at every level; the second blade is pc_attack offHand with the psychic blade, a d4.",
      },
    ],
  },

  // ---- sorcerer ----
  "sorcerer::Bend Luck": {
    subclass: "Wild Magic",
    reactions: [{ name: "Bend Luck", usedBy: "holder", pool: { id: "sorcery_points", amount: 2 }, does: { kind: "attack_penalty", die: "1d4" } }],
  },
  "sorcerer::Otherworldly Wings": {
    subclass: "Divine Soul",
    spends: [{ name: "Otherworldly Wings", action: "bonus", does: { kind: "buff", condition: "otherworldly wings", rounds: 14400 } }],
    effects: [{ kind: "move", fly: 30, gate: { condition: "otherworldly wings" } }],
  },
  "sorcerer::Hound of Ill Omen": {
    subclass: "Shadow Magic",
    spends: [
      {
        name: "Hound of Ill Omen",
        pool: { id: "sorcery_points", amount: 3 },
        action: "bonus",
        does: { kind: "buff", target: "enemy", condition: "hound of ill omen", rounds: 50 },
      },
    ],
    effects: [{ kind: "enemy_save", when: "marked", mark: "hound of ill omen" }],
  },
  "sorcerer::Shadow Walk": {
    subclass: "Shadow Magic",
    spends: [{ name: "Shadow Walk", action: "bonus", does: { kind: "teleport", feet: 120, note: "from one patch of dim light or darkness to another" } }],
  },
  "sorcerer::Umbral Form": {
    subclass: "Shadow Magic",
    spends: [
      { name: "Umbral Form", pool: { id: "sorcery_points", amount: 6 }, action: "bonus", does: { kind: "buff", condition: "umbral form", rounds: 10 } },
    ],
  },
  "sorcerer::Tempestuous Magic": {
    subclass: "Storm Sorcery",
    spends: [
      { name: "Tempestuous Magic", action: "bonus", does: { kind: "teleport", feet: 10, note: "flying, without provoking opportunity attacks" } },
    ],
  },
  "sorcerer::Storm Guide": {
    subclass: "Storm Sorcery",
    narrated: "Stopping the rain or turning the wind around the sorcerer is weather narration.",
  },
  "sorcerer::Storm's Fury": {
    subclass: "Storm Sorcery",
    reactions: [
      {
        name: "Storm's Fury",
        does: {
          kind: "strike_back",
          amount: (level) => level,
          type: "lightning",
          melee: true,
          save: { ability: "str", dcAbility: "spell", damageRegardless: true, onFail: "is pushed up to 20 feet (move_token forced)" },
        },
      },
    ],
  },
  "sorcerer::Wind Soul": {
    subclass: "Storm Sorcery",
    counter: "sub_wind_soul",
    effects: [
      { kind: "immune_damage", types: ["lightning", "thunder"] },
      { kind: "move", fly: 60 },
    ],
    spends: [
      {
        name: "Wind Soul",
        pool: { id: "sub_wind_soul" },
        action: "action",
        does: {
          kind: "buff",
          target: "allies",
          condition: "flying",
          rounds: 600,
          rangeFt: 30,
          count: (_level, mods) => 3 + Math.max(0, mods.cha ?? 0),
        },
      },
    ],
  },
  "sorcerer::Telepathic Speech": {
    subclass: "Aberrant Mind",
    narrated: "A telepathic link is conversation: nothing on a sheet changes.",
  },
  "sorcerer::Moon Fire": {
    subclass: "Lunar Sorcery",
    narrated:
      "The phases name light, concealment and reach without numbers; the DM narrates the phase until the text states them.",
  },

  // ---- warlock ----
  "warlock::Beguiling Defenses": {
    subclass: "The Archfey",
    effects: [{ kind: "immune_condition", conditions: ["charmed"] }],
    reactions: [
      { name: "Beguiling Defenses", does: { kind: "save_condition", save: "wis", dcAbility: "spell", condition: "charmed", rounds: 10 } },
    ],
  },
  "warlock::Celestial Resilience": {
    subclass: "The Celestial",
    effects: [
      {
        kind: "rest_temp_hp",
        formula: (level, mods) => level + (mods.cha ?? 0),
        allies: { count: 5, formula: (level, mods) => Math.floor(level / 2) + (mods.cha ?? 0) },
      },
    ],
  },
  "warlock::Gift of the Sea": {
    subclass: "The Fathomless",
    effects: [{ kind: "move", swim: 40, note: "Breathing underwater is narrated." }],
  },
  "warlock::Oceanic Soul": {
    subclass: "The Fathomless",
    effects: [{ kind: "immune_damage", types: ["cold"] }],
  },
  "warlock::Guardian Coil": {
    subclass: "The Fathomless",
    reactions: [
      {
        name: "Guardian Coil",
        gate: { condition: "tentacle of the deep" },
        does: { kind: "reduce", amount: [[6, "1d8"], [10, "2d8"]], who: "either", rangeFt: 30 },
      },
    ],
  },
  "warlock::Grasping Tentacles": {
    subclass: "The Fathomless",
    effects: [{ kind: "concentration_guard", spell: "black tentacles", tempHp: "level" }],
  },
  "warlock::Elemental Gift": {
    subclass: "The Genie",
    counter: "sub_elemental_gift",
    spends: [
      { name: "Elemental Gift", fight: "out", does: { kind: "choose", options: ["Bludgeoning", "Thunder", "Fire", "Cold"] } },
      {
        name: "Elemental Flight",
        aliases: ["Elemental Gift flight"],
        pool: { id: "sub_elemental_gift" },
        action: "bonus",
        does: { kind: "buff", condition: "flying", rounds: 100 },
      },
    ],
    effects: [
      { kind: "resist", types: ["bludgeoning"], gate: { choice: "bludgeoning" } },
      { kind: "resist", types: ["thunder"], gate: { choice: "thunder" } },
      { kind: "resist", types: ["fire"], gate: { choice: "fire" } },
      { kind: "resist", types: ["cold"], gate: { choice: "cold" } },
      { kind: "move", fly: 30, gate: { condition: "flying" } },
    ],
  },
  "warlock::Among the Dead": {
    subclass: "The Undying",
    effects: [
      { kind: "attacked_disadv", from: ["undead"], note: "Lost against an undead the warlock attacks; the DM keeps to that." },
      { kind: "save_adv", against: "disease" },
    ],
  },

  // ---- wizard ----
  // The ward's hit points are counters (authored-resources.json); the engine
  // raises, spends and restores them (src/lib/dm/arcane-ward.ts).
  "wizard::Arcane Ward": {
    subclass: "School of Abjuration",
    effects: [{ kind: "arcane_ward" }],
  },
  "wizard::Projected Ward": {
    subclass: "School of Abjuration",
    reactions: [{ name: "Projected Ward", does: { kind: "reduce", amount: "ward", who: "ally", rangeFt: 30 } }],
  },
  "wizard::Spell Resistance": {
    subclass: "School of Abjuration",
    effects: [
      { kind: "save_adv", against: "spell|magic" },
      { kind: "resist", types: "all", spells: true },
    ],
  },
  "wizard::Durable Summons": {
    subclass: "School of Conjuration",
    effects: [{ kind: "summon_temp_hp", amount: 30, school: "conjuration" }],
  },
  "wizard::Illusory Reality": {
    subclass: "School of Illusion",
    narrated: "Making an illusory object real is the DM's narration of the illusion.",
  },
  "wizard::Transmuter's Stone": {
    subclass: "School of Transmutation",
    spends: [
      {
        name: "Transmuter's Stone",
        fight: "out",
        does: { kind: "choose", options: ["Darkvision", "Speed", "Constitution", ...ELEMENTS.map((type) => type[0].toUpperCase() + type.slice(1))] },
      },
    ],
    effects: [
      { kind: "speed", amount: 10, gate: { choice: "speed" } },
      { kind: "save_prof", abilities: ["con"], gate: { choice: "constitution" } },
      ...ELEMENTS.map((type) => ({ kind: "resist" as const, types: [type], gate: { choice: type } })),
    ],
  },
  "wizard::Arcane Deflection": {
    subclass: "War Magic",
    reactions: [{ name: "Arcane Deflection", does: { kind: "ac_vs_hit", amount: 2 } }],
  },
  "wizard::Durable Magic": {
    subclass: "War Magic",
    effects: [
      { kind: "ac", amount: 2, gate: { concentrating: true } },
      { kind: "save_bonus", amount: 2, gate: { concentrating: true } },
    ],
  },
  "wizard::Song of Defense": {
    subclass: "Bladesinging",
    reactions: [
      { name: "Song of Defense", gate: { condition: "bladesong" }, pool: { slot: true }, does: { kind: "reduce", amount: "slot5", who: "self" } },
    ],
  },
  "wizard::Convergent Future": {
    subclass: "Chronurgy Magic",
    reactions: [{ name: "Convergent Future", does: { kind: "force_miss", exhaustion: 1 } }],
  },
  "wizard::Adjust Density": {
    subclass: "Graviturgy Magic",
    spends: [
      {
        name: "Adjust Density",
        action: "action",
        does: {
          kind: "buff",
          target: "ally",
          condition: "adjusted density (lighter)",
          variants: { lighter: "adjusted density (lighter)", halve: "adjusted density (lighter)", heavier: "adjusted density (heavier)", double: "adjusted density (heavier)" },
          rounds: 10,
        },
      },
    ],
  },
  "wizard::Wizardly Quill": {
    subclass: "Order of Scribes",
    narrated: "A quill that writes and erases is roleplay: nothing on a sheet changes.",
  },

  // ---- artificer ----
  "artificer::Armor Model": {
    subclass: "Armorer",
    counter: "sub_defensive_field",
    spends: [
      { name: "Armor Model", fight: "out", does: { kind: "choose", options: ["Guardian", "Infiltrator"] } },
      {
        name: "Defensive Field",
        pool: { id: "sub_defensive_field" },
        action: "bonus",
        gate: { choice: "guardian" },
        does: { kind: "temp_hp", formula: (level) => level },
      },
    ],
    effects: [
      { kind: "mark", condition: "thunder gauntlets", effect: "disadv_others", melee: true, gate: { choice: "guardian" } },
      { kind: "speed", amount: 5, gate: { choice: "infiltrator" } },
      { kind: "check_adv", skills: ["stealth"], gate: { choice: "infiltrator" } },
    ],
  },
  "artificer::Perfected Armor": {
    subclass: "Armorer",
    counter: "sub_perfected_armor",
    reactions: [
      {
        name: "Perfected Armor",
        gate: { choiceOf: { feature: "Armor Model", value: "guardian" } },
        pool: { id: "sub_perfected_armor" },
        does: { kind: "save_condition", save: "str", dcAbility: "spell", condition: "prone" },
      },
    ],
    effects: [
      { kind: "mark", condition: "lit by perfected armor", effect: "attacked_adv", gate: { choiceOf: { feature: "Armor Model", value: "infiltrator" } } },
    ],
  },
  "artificer::Arcane Firearm": {
    subclass: "Artillerist",
    effects: [{ kind: "spell_rider", dice: "1d8", classes: ["artificer"], item: "\\b(wand|staff|rod)\\b" }],
  },
  "artificer::Explosive Cannon": {
    subclass: "Artillerist",
    spends: [
      {
        name: "Explosive Cannon",
        action: "action",
        does: { kind: "aoe_report", dice: "3d8", save: "dex", dcAbility: "spell", type: "force", area: "a 20-foot radius around the cannon" },
      },
    ],
  },
  "artificer::Arcane Jolt": {
    subclass: "Battle Smith",
    // After a magic weapon hit, once a turn: 2d6 force to the creature
    // (variant "burn", targetEnemyId) or 2d6 healing (variant "heal",
    // targetCharacterId); 4d6 from 15th level (Improved Defender).
    spends: [
      {
        name: "Arcane Jolt",
        pool: { id: "art_arcane_jolt" },
        oncePerTurn: true,
        does: { kind: "flames", formula: [[9, "2d6"], [15, "4d6"]], type: "force" },
      },
    ],
  },
  // The defender is a summoned ally with its stat block, made outside a fight
  // (src/lib/dm/summon-defender.ts); Improved Defender raises its AC.
  "artificer::Steel Defender": {
    subclass: "Battle Smith",
    spends: [{ name: "Steel Defender", aliases: ["Summon Steel Defender"], action: "none", does: { kind: "summon", form: "Steel Defender" } }],
  },
  "artificer::Improved Defender": {
    subclass: "Battle Smith",
    effects: [{ kind: "defender_upgrade", ac: 2 }],
  },
};
