// The engine hooks of the authored subclass features, monk, paladin and
// ranger (the shape of an entry: authored-effects-data.ts).

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const AURA_REACH: Array<[number, number]> = [[7, 10], [18, 30]];

export const AUTHORED_DATA_B: Record<string, AuthoredEntry> = {
  // ---- monk ----
  "monk::Shadow Step": {
    subclass: "Way of Shadow",
    spends: [
      {
        name: "Shadow Step",
        action: "bonus",
        does: { kind: "buff", condition: "shadow step", rounds: 1, teleportFeet: 60 },
      },
    ],
  },
  "monk::Opportunist": {
    subclass: "Way of Shadow",
    reactions: [{ name: "Opportunist", does: { kind: "attack", rangeFt: 5 } }],
  },
  "monk::Tipsy Sway": {
    subclass: "Way of the Drunken Master",
    effects: [{ kind: "stand_cost", feet: 5 }],
    reactions: [{ name: "Tipsy Sway", aliases: ["Redirect Attack"], pool: { id: "ki", amount: 1 }, does: { kind: "redirect_miss", rangeFt: 5 } }],
  },
  "monk::Drunkard's Luck": {
    subclass: "Way of the Drunken Master",
    spends: [
      {
        name: "Drunkard's Luck",
        pool: { id: "ki", amount: 2 },
        does: {
          kind: "buff",
          condition: "drunkard's luck (attack)",
          variants: { attack: "drunkard's luck (attack)", check: "drunkard's luck (check)", save: "drunkard's luck (save)" },
          rounds: 10,
        },
      },
    ],
  },
  "monk::Intoxicated Frenzy": {
    subclass: "Way of the Drunken Master",
    effects: [{ kind: "flurry", strikes: 5, note: "Each extra strike is meant for a different creature; the DM keeps to that." }],
  },
  "monk::Path of the Kensei": {
    subclass: "Way of the Kensei",
    spends: [{ name: "Path of the Kensei", aliases: ["Agile Parry"], action: "bonus", does: { kind: "buff", condition: "agile parry", rounds: 1 } }],
    effects: [],
  },
  "monk::Kensei's Shot": {
    subclass: "Way of the Kensei",
    spends: [{ name: "Kensei's Shot", action: "bonus", does: { kind: "buff", condition: "kensei's shot", rounds: 1 } }],
  },
  "monk::Sharpen the Blade": {
    subclass: "Way of the Kensei",
    spends: [
      {
        name: "Sharpen the Blade",
        pool: { id: "ki", perUnit: true, max: 3 },
        action: "bonus",
        does: { kind: "buff", condition: "sharpen the blade (+{units})", rounds: 10 },
      },
    ],
  },
  "monk::Radiant Sun Bolt": {
    subclass: "Way of the Sun Soul",
    effects: [
      {
        kind: "natural_weapon",
        weapon: { name: "Radiant Sun Bolt", aliases: ["sun bolt"], dice: [[1, "1d4"], [5, "1d6"], [11, "1d8"], [17, "1d10"]], type: "radiant", ranged: true, rangeFt: 30 },
        note: "Its bonus-action pair of bolts for 1 ki after the Attack action is Flurry of Blows' place; the DM allows it.",
      },
    ],
  },
  "monk::Searing Arc Strike": {
    subclass: "Way of the Sun Soul",
    spends: [
      {
        name: "Searing Arc Strike",
        pool: { id: "ki", perUnit: true, max: 11 },
        action: "bonus",
        does: {
          kind: "aoe_report",
          dice: "3d6",
          perUnit: "1d6",
          baseUnits: 2,
          save: "dex",
          dcAbility: "wis",
          type: "fire",
          area: "a 15-foot cone (burning hands)",
        },
      },
    ],
  },
  "monk::Searing Sunburst": {
    subclass: "Way of the Sun Soul",
    spends: [
      {
        name: "Searing Sunburst",
        pool: { id: "ki", perUnit: true, max: 3, optional: true },
        action: "action",
        does: {
          kind: "aoe_report",
          dice: "2d6",
          perUnit: "2d6",
          baseUnits: 0,
          save: "con",
          dcAbility: "wis",
          type: "radiant",
          area: "a 20-foot sphere within 150 feet",
        },
      },
    ],
  },
  "monk::Touch of Death": {
    subclass: "Way of the Long Death",
    effects: [{ kind: "kill_temp_hp", formula: (level, mods) => Math.max(1, (mods.wis ?? 0) + level) }],
  },
  "monk::Touch of the Long Death": {
    subclass: "Way of the Long Death",
    spends: [
      {
        name: "Touch of the Long Death",
        pool: { id: "ki", perUnit: true, max: 10 },
        action: "action",
        does: { kind: "save_effect", save: "con", dcAbility: "wis", perUnit: "2d10", type: "necrotic", half: true, rangeFt: 5 },
      },
    ],
  },
  "monk::Arms of the Astral Self": {
    subclass: "Way of the Astral Self",
    spends: [
      {
        name: "Arms of the Astral Self",
        pool: { id: "ki", amount: 1 },
        action: "bonus",
        does: {
          kind: "buff",
          condition: "arms of the astral self",
          rounds: 100,
          burst: { save: "dex", dcAbility: "wis", rangeFt: 10, dice: (level) => `2${martialDie(level)}`, type: "force" },
        },
      },
    ],
  },
  "monk::Visage of the Astral Self": {
    subclass: "Way of the Astral Self",
    spends: [
      {
        name: "Visage of the Astral Self",
        pool: { id: "ki", amount: 1 },
        action: "bonus",
        does: { kind: "buff", condition: "visage of the astral self", rounds: 100 },
      },
    ],
  },
  "monk::Body of the Astral Self": {
    subclass: "Way of the Astral Self",
    effects: [
      {
        kind: "rider",
        dice: "1d10",
        type: "",
        when: "weapon",
        oncePerTurn: true,
        requiresCondition: "arms of the astral self",
      },
    ],
    reactions: [
      {
        name: "Body of the Astral Self",
        aliases: ["Deflect Energy"],
        gate: { condition: "arms of the astral self" },
        does: {
          kind: "reduce",
          amount: (_level, mods) => `1d10+${mods.wis ?? 0}`,
          who: "self",
          types: ["acid", "cold", "fire", "force", "lightning", "thunder"],
        },
      },
    ],
  },
  "monk::Awakened Astral Self": {
    subclass: "Way of the Astral Self",
    spends: [
      {
        name: "Awakened Astral Self",
        pool: { id: "ki", amount: 5 },
        action: "bonus",
        does: { kind: "buff", condition: "awakened astral self", rounds: 10 },
      },
    ],
  },
  "monk::Ascendant Aspect": {
    subclass: "Way of the Ascendant Dragon",
    reactions: [
      { name: "Ascendant Aspect", does: { kind: "strike_back", amount: "3d10", type: "fire", rangeFt: 30 } },
    ],
  },

  // ---- paladin ----
  "paladin::Aura of Warding": {
    subclass: "Oath of the Ancients",
    effects: [{ kind: "aura_resist", rangeFt: AURA_REACH, spells: true }],
  },
  "paladin::Elder Champion": {
    subclass: "Oath of the Ancients",
    counter: "sub_elder_champion",
    spends: [
      { name: "Elder Champion", pool: { id: "sub_elder_champion" }, action: "action", does: { kind: "buff", condition: "elder champion", rounds: 10 } },
    ],
    effects: [
      { kind: "turn_heal", when: "start", formula: "10", gate: { condition: "elder champion" } },
      { kind: "enemy_save", when: "near", rangeFt: 10, gate: { condition: "elder champion" } },
    ],
  },
  "paladin::Relentless Avenger": {
    subclass: "Oath of Vengeance",
    reactions: [{ name: "Relentless Avenger", does: { kind: "move", trigger: "oa_hit", free: true } }],
  },
  "paladin::Soul of Vengeance": {
    subclass: "Oath of Vengeance",
    reactions: [{ name: "Soul of Vengeance", does: { kind: "attack", rangeFt: 5 } }],
  },
  "paladin::Avenging Angel": {
    subclass: "Oath of Vengeance",
    counter: "sub_avenging_angel",
    spends: [
      {
        name: "Avenging Angel",
        pool: { id: "sub_avenging_angel" },
        action: "action",
        does: {
          kind: "buff",
          condition: "avenging angel",
          rounds: 600,
          burst: { save: "wis", dcAbility: "spell", rangeFt: 30, condition: "frightened", rounds: 10 },
        },
      },
    ],
    effects: [
      { kind: "move", fly: 60, gate: { condition: "avenging angel" } },
      { kind: "attack_adv", vs: "frightened_by_self", gate: { condition: "avenging angel" } },
    ],
  },
  "paladin::Aura of Conquest": {
    subclass: "Oath of Conquest",
    effects: [
      {
        kind: "enemy_turn_damage",
        formula: (level) => Math.floor(level / 2),
        type: "psychic",
        rangeFt: AURA_REACH,
        frightenedOnly: true,
        note: "Their speed of 0 is the frightened creature's to keep; the board does not stop it.",
      },
    ],
  },
  "paladin::Invincible Conqueror": {
    subclass: "Oath of Conquest",
    counter: "sub_invincible_conqueror",
    spends: [
      {
        name: "Invincible Conqueror",
        pool: { id: "sub_invincible_conqueror" },
        action: "action",
        does: { kind: "buff", condition: "invincible conqueror", rounds: 10 },
      },
    ],
  },
  "paladin::Aura of the Guardian": {
    subclass: "Oath of Redemption",
    reactions: [{ name: "Aura of the Guardian", does: { kind: "take_for_ally", rangeFt: AURA_REACH } }],
  },
  "paladin::Protective Spirit": {
    subclass: "Oath of Redemption",
    effects: [{ kind: "turn_heal", when: "end", belowHalf: true, formula: (level) => `1d6+${Math.floor(level / 2)}` }],
  },
  "paladin::Emissary of Redemption": {
    subclass: "Oath of Redemption",
    effects: [
      { kind: "resist", types: "all", gate: { notCondition: "emissary lapsed" } },
      { kind: "retaliate", formula: "half_dealt", type: "radiant", gate: { notCondition: "emissary lapsed" } },
    ],
  },
  "paladin::Aura of Alacrity": {
    subclass: "Oath of Glory",
    effects: [{ kind: "speed", amount: 10, note: "The allies' 10 feet within 5 feet of the paladin are narrated." }],
  },
  "paladin::Living Legend": {
    subclass: "Oath of Glory",
    counter: "sub_living_legend",
    spends: [
      { name: "Living Legend", pool: { id: "sub_living_legend" }, action: "bonus", does: { kind: "buff", condition: "living legend", rounds: 10 } },
    ],
  },
  "paladin::Vigilant Rebuke": {
    subclass: "Oath of the Watchers",
    reactions: [
      { name: "Vigilant Rebuke", does: { kind: "strike_back", amount: (_level, mods) => `2d8+${mods.cha ?? 0}`, type: "force", rangeFt: 30 } },
    ],
  },
  "paladin::Mortal Bulwark": {
    subclass: "Oath of the Watchers",
    counter: "sub_mortal_bulwark",
    spends: [
      { name: "Mortal Bulwark", pool: { id: "sub_mortal_bulwark" }, action: "bonus", does: { kind: "buff", condition: "mortal bulwark", rounds: 10 } },
    ],
    effects: [
      {
        kind: "attack_adv",
        vs: "types",
        types: ["aberration", "celestial", "elemental", "fey", "fiend"],
        gate: { condition: "mortal bulwark" },
      },
    ],
  },
  "paladin::Divine Allegiance": {
    subclass: "Oath of the Crown",
    reactions: [{ name: "Divine Allegiance", does: { kind: "take_for_ally", rangeFt: 5 } }],
  },
  "paladin::Unyielding Spirit": {
    subclass: "Oath of the Crown",
    effects: [{ kind: "save_adv", against: "paraly|stun" }],
  },
  "paladin::Exalted Champion": {
    subclass: "Oath of the Crown",
    counter: "sub_exalted_champion",
    spends: [
      { name: "Exalted Champion", pool: { id: "sub_exalted_champion" }, action: "action", does: { kind: "buff", condition: "exalted champion", rounds: 600 } },
    ],
  },
  "paladin::Dread Lord": {
    subclass: "Oathbreaker",
    counter: "sub_dread_lord",
    spends: [
      { name: "Dread Lord", pool: { id: "sub_dread_lord" }, action: "action", does: { kind: "buff", condition: "dread lord", rounds: 10 } },
    ],
    effects: [
      { kind: "enemy_turn_damage", formula: "4d10", type: "psychic", rangeFt: 30, gate: { condition: "dread lord" } },
    ],
  },

  // ---- ranger ----
  "ranger::Ranger's Companion": {
    subclass: "Beast Master",
    narrated:
      "The beast is a companion sheet the DM fields (pet-tools); its proficiency bonus and hit points are set when it is made.",
  },
  "ranger::Shadowy Dodge": {
    subclass: "Gloom Stalker",
    reactions: [{ name: "Shadowy Dodge", does: { kind: "disadv_vs_hit" } }],
  },
  "ranger::Planar Warrior": {
    subclass: "Horizon Walker",
    spends: [
      {
        name: "Planar Warrior",
        action: "bonus",
        does: { kind: "buff", condition: [[3, "planar warrior"], [11, "planar warrior (2d8)"]], rounds: 1 },
      },
    ],
  },
  "ranger::Spectral Defense": {
    subclass: "Horizon Walker",
    reactions: [{ name: "Spectral Defense", does: { kind: "reduce", amount: "half", who: "self" } }],
  },
  "ranger::Slayer's Prey": {
    subclass: "Monster Slayer",
    spends: [{ name: "Slayer's Prey", action: "bonus", does: { kind: "buff", condition: "slayer's prey", mark: "slayer's prey (marked)", rounds: 600 } }],
    effects: [
      { kind: "rider", dice: "1d6", type: "", when: "weapon", oncePerTurn: true, requiresCondition: "slayer's prey" },
    ],
  },
  "ranger::Supernatural Defense": {
    subclass: "Monster Slayer",
    effects: [{ kind: "save_die_vs", die: "1d6", mark: "slayer's prey (marked)", note: "Its 1d6 on a check to escape the prey's grapple is the DM's to add." }],
  },
  "ranger::Slayer's Counter": {
    subclass: "Monster Slayer",
    reactions: [{ name: "Slayer's Counter", does: { kind: "attack", rangeFt: 5 } }],
  },
  "ranger::Beguiling Twist": {
    subclass: "Fey Wanderer",
    effects: [{ kind: "save_adv", against: "charm|frighten|fear", note: "Redirecting the charm is narrated." }],
  },
  "ranger::Gathered Swarm": {
    subclass: "Swarmkeeper",
    effects: [
      { kind: "rider", dice: [[3, "1d6"], [11, "1d8"]], type: "piercing", when: "weapon", oncePerTurn: true },
    ],
    // In place of the damage, once a turn: the swarm moves the creature hit
    // (use_resource "Gathered Swarm", variant "push").
    spends: [
      { name: "Gathered Swarm", aliases: ["Swarm Push"], oncePerTurn: true, onceKey: "rider:gathered swarm", does: { kind: "swarm_push", feet: 15 } },
    ],
  },
  "ranger::Mighty Swarm": {
    subclass: "Swarmkeeper",
    effects: [{ kind: "swarm_prone", note: "Its damage step is Gathered Swarm's 1d8 from 11th level; the half cover when the swarm moves the ranger is the DM's." }],
  },
};

function martialDie(level: number): string {
  if (level >= 17) return "d10";
  if (level >= 11) return "d8";
  if (level >= 5) return "d6";
  return "d4";
}
