// The engine hooks of the authored subclass features, rogue to artificer
// (the shape of an entry: authored-effects-data.ts).

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

const ELEMENTS = ["acid", "cold", "fire", "lightning", "thunder"];
const LUNAR_PHASES = ["Full Moon", "New Moon", "Crescent Moon"];
// A genie patron's kind and its damage type (Tasha's, The Genie).
const GENIE_KINDS: Array<[string, string]> = [["dao", "bludgeoning"], ["djinni", "thunder"], ["efreeti", "fire"], ["marid", "cold"]];
// A Hex Warrior's weapon: one the warlock is proficient with that lacks the
// two-handed property, chosen at the end of a long rest.
const HEX_WEAPONS = SRD_WEAPONS.filter(
  (weapon) => (weapon.category === "simple" || weapon.category === "martial") && !(weapon.properties ?? []).some((property) => /two-handed/i.test(property)),
).map((weapon) => weapon.name);

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
  // A soul trinket held: advantage on Constitution saves and on death saves
  // (the "soul trinket" condition row), no resistance.
  "rogue::Tokens of the Departed": {
    subclass: "Phantom",
    reactions: [{ name: "Tokens of the Departed", does: { kind: "gain_condition", condition: "soul trinket", rounds: 14400 } }],
    effects: [{ kind: "save_adv", ability: "con", gate: { condition: "soul trinket" } }],
  },
  "rogue::Psionic Power (Soulknife)": {
    subclass: "Soulknife",
    counter: "sub_psionic_energy",
    spends: [
      {
        name: "Psionic Recovery",
        aliases: ["Regain Psionic Energy"],
        pool: { id: "sub_psionic_recovery" },
        action: "bonus",
        does: { kind: "restore", pool: "sub_psionic_energy", amount: 1 },
      },
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
  // The Divine Soul's affinity teaches one more spell, free (subclasses.json
  // choiceSpells); the cleric list is theirs to learn from (spellLists).
  "sorcerer::Divine Magic": {
    subclass: "Divine Soul",
    spends: [{ name: "Divine Affinity", aliases: ["Divine Magic"], fight: "out", does: { kind: "choose", options: ["Good", "Evil", "Law", "Chaos", "Neutrality"] } }],
  },
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
  // Lunar Sorcery (Dragonlance): the phase is chosen after each long rest
  // ("Lunar Embodiment (Crescent Moon)"), and Lunar Empowerment reads it.
  "sorcerer::Lunar Embodiment": {
    subclass: "Lunar Sorcery",
    counter: "sub_lunar_free_cast",
    spends: [{ name: "Lunar Phase", aliases: ["Moon Phase"], fight: "out", does: { kind: "choose", options: LUNAR_PHASES } }],
  },
  // Sacred flame at one creature or two within 5 feet of each other
  // (cast_at_enemy secondTargetEnemyId, src/lib/dm/authored-reaper.ts).
  "sorcerer::Moon Fire": {
    subclass: "Lunar Sorcery",
    effects: [{ kind: "twin_spell", school: "evocation", minLevel: 0, maxLevel: 0, spells: ["sacred flame"] }],
  },
  "sorcerer::Lunar Empowerment": {
    subclass: "Lunar Sorcery",
    effects: [
      {
        kind: "check_adv",
        skills: ["investigation", "perception"],
        gate: { choiceOf: { feature: "Lunar Embodiment", value: "full moon" } },
        note: "Only within the bright light the sorcerer sheds; the DM keeps to that.",
      },
      { kind: "check_adv", skills: ["stealth"], gate: { choiceOf: { feature: "Lunar Embodiment", value: "new moon" } }, note: "Attack rolls against them in total darkness are at disadvantage; the DM keeps to that." },
      { kind: "resist", types: ["necrotic", "radiant"], gate: { choiceOf: { feature: "Lunar Embodiment", value: "crescent moon" } } },
    ],
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
    effects: [{ kind: "resist", types: ["cold"], note: "Understanding fully submerged creatures, and they you, is narrated." }],
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
  // The patron's kind ("Genie's Vessel (Efreeti)") sets Genie's Wrath, the
  // Elemental Gift resistance and the kind's expanded spells
  // (subclasses.json choiceSpells).
  "warlock::Genie's Vessel": {
    subclass: "The Genie",
    spends: [{ name: "Genie Kind", aliases: ["Patron Kind", "Genie's Kind"], fight: "out", does: { kind: "choose", options: ["Dao", "Djinni", "Efreeti", "Marid"] } }],
    effects: GENIE_KINDS.map(([kind, type]) => ({
      kind: "rider" as const,
      dice: "prof",
      type,
      when: "weapon" as const,
      oncePerTurn: true,
      gate: { choice: kind },
      note: "Genie's Wrath rides any attack roll that hits, a spell attack too; the DM adds it to a spell's.",
    })),
  },
  "warlock::Elemental Gift": {
    subclass: "The Genie",
    counter: "sub_elemental_gift",
    spends: [
      {
        name: "Elemental Flight",
        aliases: ["Elemental Gift flight"],
        pool: { id: "sub_elemental_gift" },
        action: "bonus",
        does: { kind: "buff", condition: "flying", rounds: 100 },
      },
    ],
    effects: [
      ...GENIE_KINDS.map(([kind, type]) => ({ kind: "resist" as const, types: [type], gate: { choiceOf: { feature: "Genie's Vessel", value: kind } } })),
      // Sheets that chose the type on Elemental Gift itself, before the kind
      // was a choice of Genie's Vessel.
      ...GENIE_KINDS.map(([, type]) => ({ kind: "resist" as const, types: [type], gate: { choice: type } })),
      { kind: "move", fly: 30, gate: { condition: "flying" } },
    ],
  },
  // An undead that attacks the warlock first saves on Wisdom against their
  // spell save DC or loses the attack (src/lib/dm/authored-hooks.ts).
  "warlock::Among the Dead": {
    subclass: "The Undying",
    effects: [
      { kind: "ward_vs", types: ["undead"], save: "wis", note: "Area effects get through, and an undead that saved or that the warlock attacked is immune for 24 hours; the DM keeps to that." },
      { kind: "save_adv", against: ["disease"] },
    ],
  },
  "warlock::Radiant Soul": {
    subclass: "The Celestial",
    effects: [{ kind: "spell_rider", dice: "cha", damageTypes: ["radiant", "fire"], note: "One radiant or fire damage roll of the spell, against one of its targets." }],
  },
  // Hexblade's Curse: the warlock's condition marks the cursed creature
  // (its meta's quarry): +proficiency damage and a critical hit on 19-20
  // against it, and hit points back when it dies (src/lib/dm/authored-hooks.ts).
  "warlock::Hexblade's Curse": {
    subclass: "The Hexblade",
    counter: "sub_hexblades_curse",
    spends: [
      {
        name: "Hexblade's Curse",
        pool: { id: "sub_hexblades_curse" },
        action: "bonus",
        does: {
          kind: "buff",
          quarry: true,
          condition: [[1, "hexblade's curse (+2)"], [5, "hexblade's curse (+3)"], [9, "hexblade's curse (+4)"], [13, "hexblade's curse (+5)"], [17, "hexblade's curse (+6)"]],
          rounds: 10,
        },
      },
    ],
  },
  "warlock::Hex Warrior": {
    subclass: "The Hexblade",
    spends: [{ name: "Hex Warrior Weapon", aliases: ["Hex Warrior"], fight: "out", does: { kind: "choose", options: HEX_WEAPONS } }],
    effects: [{ kind: "weapon_ability", ability: "cha", note: "With Pact of the Blade, every pact weapon too; the DM names it as the hex weapon." }],
  },
  "warlock::Armor of Hexes": {
    subclass: "The Hexblade",
    reactions: [{ name: "Armor of Hexes", does: { kind: "chance_miss", die: "1d6", min: 4, vsMark: "hexblade's curse" } }],
  },
  "warlock::Master of Hexes": {
    subclass: "The Hexblade",
    spends: [
      {
        name: "Master of Hexes",
        action: "none",
        does: {
          kind: "buff",
          quarry: true,
          condition: [[1, "hexblade's curse (+2)"], [5, "hexblade's curse (+3)"], [9, "hexblade's curse (+4)"], [13, "hexblade's curse (+5)"], [17, "hexblade's curse (+6)"]],
          rounds: 10,
        },
      },
    ],
  },
  "warlock::Necrotic Husk": {
    subclass: "The Undead",
    effects: [{ kind: "immune_damage", types: ["necrotic"], gate: { condition: "form of dread" } }],
  },
  "warlock::Spirit Projection": {
    subclass: "The Undead",
    effects: [
      { kind: "resist", types: ["bludgeoning", "piercing", "slashing"], gate: { condition: "spirit projection" } },
      { kind: "move", fly: "walk", gate: { condition: "spirit projection" }, note: "Passing through creatures and objects, the healing in Form of Dread and the spells without components are the DM's to apply." },
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
      { kind: "save_adv", magical: true },
      { kind: "resist", types: "all", spells: true },
    ],
  },
  "wizard::Durable Summons": {
    subclass: "School of Conjuration",
    effects: [{ kind: "summon_temp_hp", amount: 30, school: "conjuration" }],
  },
  // No use limit: each creature only once until the wizard's long rest, which
  // the DM keeps to.
  "wizard::Hypnotic Gaze": {
    subclass: "School of Enchantment",
    spends: [
      {
        name: "Hypnotic Gaze",
        action: "action",
        does: {
          kind: "save_effect",
          save: "wis",
          dcAbility: "spell",
          condition: "charmed",
          rounds: 1,
          rangeFt: 5,
          onFail: "is also incapacitated with speed 0 until the end of the wizard's next turn; the wizard's action extends it",
        },
      },
    ],
  },
  "wizard::Instinctive Charm": {
    subclass: "School of Enchantment",
    reactions: [{ name: "Instinctive Charm", does: { kind: "redirect", save: { ability: "wis", dcAbility: "spell" }, rangeFt: 30 } }],
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
        does: { kind: "save_condition", save: "str", dcAbility: "spell", condition: "pulled by perfected armor" },
      },
    ],
    effects: [
      { kind: "mark", condition: "lit by perfected armor", effect: "attacked_adv", gate: { choiceOf: { feature: "Armor Model", value: "infiltrator" } } },
    ],
  },
  "artificer::Arcane Firearm": {
    subclass: "Artillerist",
    effects: [{ kind: "spell_rider", dice: "1d8", classes: ["artificer"], items: ["wand", "staff", "rod"] }],
  },
  // Eldritch Cannon (TCoE): "As an action, you can magically create a Small
  // or Tiny eldritch cannon" (once a long rest, or for a spell slot), and
  // "As a bonus action, you can activate it" (issue 233): Flamethrower,
  // Force Ballista (pc_attack weapon "Force Ballista", which is the bonus
  // action), or Protector.
  "artificer::Eldritch Cannon": {
    subclass: "Artillerist",
    counter: "sub_eldritch_cannon",
    spends: [
      {
        name: "Eldritch Cannon",
        aliases: ["Create Eldritch Cannon", "Create Cannon"],
        pool: { id: "sub_eldritch_cannon" },
        action: "action",
        does: { kind: "buff", condition: "eldritch cannon", rounds: 600 },
      },
      {
        name: "Activate Cannon",
        aliases: ["Flamethrower", "Protector", "Activate Eldritch Cannon"],
        action: "bonus",
        gate: { condition: "eldritch cannon" },
        does: {
          kind: "variants",
          options: {
            flamethrower: {
              action: "bonus",
              does: { kind: "aoe_report", dice: [[1, "2d8"], [9, "3d8"]], save: "dex", dcAbility: "spell", type: "fire", area: "a 15-foot cone from the cannon" },
            },
            protector: {
              action: "bonus",
              does: { kind: "temp_hp", formula: "1d8+int", allies: { rangeFt: 10, count: "12" } },
            },
            ballista: {
              action: "none",
              does: { kind: "note", text: "Force Ballista is its own bonus-action attack: pc_attack with weapon \"Force Ballista\" at a creature within 120 feet of the cannon (2d8 force, pushed 5 feet on a hit)." },
            },
          },
        },
      },
    ],
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
  // Spirit Totem (XGtE): "As a bonus action, you can move the spirit up to 60
  // feet to a point you can see" (issue 233).
  "druid::Spirit Totem": {
    subclass: "Circle of the Shepherd",
    spends: [
      {
        name: "Move Spirit Totem",
        aliases: ["Move the Spirit", "Move Spirit"],
        action: "bonus",
        gate: { condition: "spirit totem" },
        does: { kind: "note", text: "The spirit moves up to 60 feet to a point the druid can see, and its 30-foot aura moves with it." },
      },
    ],
  },
};
