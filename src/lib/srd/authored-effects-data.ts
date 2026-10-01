// The engine hooks of the authored subclass features, barbarian to fighter
// (the rest: authored-effects-data2.ts). One entry per feature whose rules
// text states a number or a state, keyed "class::Feature Name" as
// src/lib/srd/subclasses.json names it. Each entry says what the engine does
// with the feature: passive effects the readers apply, a use_resource spend,
// a use_reaction reaction, or, for pure roleplay and for a mechanic another
// engine must hold first, a `narrated` line saying why.
//
// Numbers follow the feature's own text; where the text names a benefit
// without a number (Mantle of Inspiration's temporary hit points, Storm
// Aura's damage) the published subclass's table is used.

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

const RAGING = { raging: true } as const;
const STORM_DAMAGE: Array<[number, string]> = [[3, "2"], [5, "3"], [10, "4"], [15, "5"], [20, "6"]];

export const AUTHORED_DATA_A: Record<string, AuthoredEntry> = {
  // ---- barbarian ----
  "barbarian::Totem Spirit": {
    subclass: "Path of the Totem Warrior",
    spends: [{ name: "Totem Spirit", fight: "out", does: { kind: "choose", options: ["Bear", "Eagle", "Wolf"] } }],
    effects: [
      { kind: "resist", types: "all", except: ["psychic"], gate: { ...RAGING, choice: "bear" } },
      { kind: "bonus_route", action: "dash", gate: { ...RAGING, choice: "eagle" } },
      { kind: "pack_adv", rangeFt: 5, gate: { ...RAGING, choice: "wolf" } },
    ],
  },
  "barbarian::Aspect of the Beast": {
    subclass: "Path of the Totem Warrior",
    spends: [{ name: "Aspect of the Beast", fight: "out", does: { kind: "choose", options: ["Bear", "Eagle", "Wolf"] } }],
    effects: [
      {
        kind: "check_adv",
        abilities: ["str"],
        reason: "push|pull|lift|break|shove|drag|carry|haul|force|bend|heave",
        gate: { choice: "bear" },
        note: "Eagle's sight and Wolf's tracking pace are narrated.",
      },
    ],
  },
  "barbarian::Totemic Attunement": {
    subclass: "Path of the Totem Warrior",
    spends: [{ name: "Totemic Attunement", fight: "out", does: { kind: "choose", options: ["Bear", "Eagle", "Wolf"] } }],
    effects: [
      { kind: "guard_aura", rangeFt: 5, gate: { ...RAGING, choice: "bear" } },
      { kind: "move", fly: "walk", gate: { ...RAGING, choice: "eagle" }, note: "Wolf's bonus-action knockdown is narrated." },
    ],
  },
  "barbarian::Ancestral Protectors": {
    subclass: "Path of the Ancestral Guardian",
    effects: [
      { kind: "mark", condition: "ancestral protectors", effect: "disadv_others", oncePerTurn: true, halve: true, gate: RAGING },
    ],
  },
  "barbarian::Spirit Shield": {
    subclass: "Path of the Ancestral Guardian",
    reactions: [
      {
        name: "Spirit Shield",
        gate: RAGING,
        does: { kind: "reduce", amount: [[6, "2d6"], [10, "3d6"], [14, "4d6"]], who: "ally", rangeFt: 30 },
      },
    ],
  },
  "barbarian::Storm Aura": {
    subclass: "Path of the Storm Herald",
    spends: [{ name: "Storm Aura", action: "bonus", gate: RAGING, does: { kind: "storm_aura" } }],
  },
  "barbarian::Shielding Storm": {
    subclass: "Path of the Storm Herald",
    effects: [
      {
        kind: "aura_resist",
        rangeFt: 10,
        typeFrom: { condition: "storm aura", map: { desert: "fire", sea: "lightning", tundra: "cold" } },
      },
    ],
  },
  "barbarian::Raging Storm": {
    subclass: "Path of the Storm Herald",
    effects: [
      { kind: "retaliate", formula: (level) => Math.floor(level / 2), type: "fire", gate: { ...RAGING, condition: "storm aura (desert)" } },
    ],
    reactions: [
      {
        name: "Raging Storm",
        gate: RAGING,
        does: {
          kind: "save_condition",
          save: "str",
          dcAbility: "con",
          condition: "prone",
          variants: { sea: "prone", tundra: "raging storm (tundra)" },
        },
      },
    ],
  },
  "barbarian::Fanatical Focus": {
    subclass: "Path of the Zealot",
    spends: [
      { name: "Fanatical Focus", gate: RAGING, oncePer: { marker: "fanatical focus spent", rounds: 10 }, does: { kind: "reroll_save" } },
    ],
  },
  "barbarian::Form of the Beast": {
    subclass: "Path of the Beast",
    // pc_attack weapon "bite", "claws" or "tail" while raging
    // (src/lib/srd/authored-effects-more.ts authoredNaturalWeapon).
    effects: [
      { kind: "natural_weapon", gate: RAGING, weapon: { name: "Bite", aliases: ["fangs", "teeth"], dice: "1d8", type: "piercing", onHit: "bite_heal" } },
      { kind: "natural_weapon", gate: RAGING, weapon: { name: "Claws", aliases: ["claw"], dice: "1d6", type: "slashing", extraAttack: true } },
      {
        kind: "natural_weapon",
        gate: RAGING,
        weapon: { name: "Tail", dice: "1d8", type: "piercing", reach: true },
        note: "The tail's reaction (1d8 to AC against one attack) and keeping to one form per rage are the DM's to hold.",
      },
    ],
  },
  "barbarian::Unstable Backlash": {
    subclass: "Path of Wild Magic",
    narrated:
      "Rerolls the Wild Surge table, whose effects are narrated; use_reaction spends the reaction from the sheet's feature.",
  },
  "barbarian::Mighty Impel": {
    subclass: "Path of the Giant",
    spends: [
      {
        name: "Mighty Impel",
        action: "bonus",
        gate: RAGING,
        does: {
          kind: "save_effect",
          save: "str",
          dcAbility: "str",
          rangeFt: 10,
          onFail: "is hurled up to 30 feet through the air: move its token with move_token (forced)",
        },
      },
    ],
  },
  "barbarian::Demiurgic Colossus": {
    subclass: "Path of the Giant",
    effects: [
      {
        kind: "reach",
        tiles: 1,
        gate: RAGING,
        note: "Growing Large, and Elemental Cleaver's doubled throw and extra 1d10, ride the Elemental Cleaver weapon the DM tracks.",
      },
    ],
  },
  "barbarian::Elemental Fury": {
    subclass: "Path of the Giant",
    spends: [
      {
        name: "Elemental Fury",
        gate: RAGING,
        oncePerTurn: true,
        does: {
          kind: "save_effect",
          save: "con",
          dcAbility: "con",
          dice: "3d8",
          type: "thunder",
          typeFromVariant: ["acid", "cold", "fire", "lightning", "thunder"],
          rangeFt: 10,
        },
      },
    ],
  },

  // ---- bard ----
  "bard::Combat Inspiration": {
    subclass: "College of Valor",
    reactions: [{ name: "Combat Inspiration", usedBy: "inspired", does: { kind: "ac_vs_hit", amount: "bardic" } }],
  },
  "bard::Battle Magic": {
    subclass: "College of Valor",
    effects: [{ kind: "bonus_attack", after: "spell" }],
  },
  "bard::Mantle of Inspiration": {
    subclass: "College of Glamour",
    spends: [
      {
        name: "Mantle of Inspiration",
        pool: { id: "bardic_inspiration" },
        action: "bonus",
        does: {
          kind: "temp_hp",
          formula: [[3, "5"], [5, "8"], [10, "11"], [15, "14"]],
          allies: { rangeFt: 60, count: (_level, mods) => Math.max(1, mods.cha ?? 0) },
        },
      },
    ],
  },
  "bard::Blade Flourish": {
    subclass: "College of Swords",
    spends: [
      { name: "Blade Flourish", pool: { id: "bardic_inspiration" }, oncePerTurn: true, does: { kind: "flourish" } },
    ],
  },
  "bard::Psychic Blades": {
    subclass: "College of Whispers",
    spends: [
      {
        name: "Psychic Blades",
        pool: { id: "bardic_inspiration" },
        oncePerTurn: true,
        does: { kind: "die_damage", dice: [[3, "2d6"], [5, "3d6"], [10, "5d6"], [15, "8d6"]], type: "psychic" },
      },
    ],
  },
  "bard::Unsettling Words": {
    subclass: "College of Eloquence",
    spends: [
      {
        name: "Unsettling Words",
        pool: { id: "bardic_inspiration" },
        action: "bonus",
        does: { kind: "buff", target: "enemy", condition: "unsettled ({bardic})", rounds: 10 },
      },
    ],
  },
  "bard::Mote of Potential": {
    subclass: "College of Creation",
    // The die this bard gives carries the mote: a check rolls the die twice
    // and keeps the higher, a save gives the roller temporary hit points,
    // an attack's burst deals the die in thunder (rolls.ts, forced-save.ts,
    // pc-attack-resolve.ts through src/lib/dm/authored-mote.ts).
    effects: [{ kind: "mote" }],
  },

  // ---- cleric ----
  "cleric::Corona of Light": {
    subclass: "Light Domain",
    spends: [
      {
        name: "Corona of Light",
        pool: { id: "channel_divinity" },
        action: "action",
        does: { kind: "buff", condition: "corona of light", rounds: 10 },
      },
    ],
    effects: [{ kind: "enemy_save", when: "near", rangeFt: 60, anyCaster: true, gate: { condition: "corona of light" } }],
  },
  "cleric::Dampen Elements": {
    subclass: "Nature Domain",
    reactions: [
      {
        name: "Dampen Elements",
        does: { kind: "resist_instance", types: ["acid", "cold", "fire", "lightning", "thunder"], who: "either", rangeFt: 30 },
      },
    ],
  },
  "cleric::Master of Nature": {
    subclass: "Nature Domain",
    narrated: "Commanding a charmed creature is the DM's narration of what it does; no number changes.",
  },
  "cleric::Stormborn": {
    subclass: "Tempest Domain",
    effects: [{ kind: "move", fly: "walk", note: "Only while not underground or indoors." }],
  },
  "cleric::Blessing of the Trickster": {
    subclass: "Trickery Domain",
    spends: [
      {
        name: "Blessing of the Trickster",
        action: "action",
        does: { kind: "buff", target: "ally", condition: "blessing of the trickster", rounds: 600 },
      },
    ],
  },
  "cleric::Inescapable Destruction": {
    subclass: "Death Domain",
    effects: [{ kind: "ignore_resist", types: ["necrotic"] }],
  },
  "cleric::Improved Reaper": {
    subclass: "Death Domain",
    // cast_at_enemy secondTargetEnemyId (src/lib/dm/authored-reaper.ts).
    effects: [{ kind: "twin_spell", school: "necromancy", maxLevel: 5, costPerLevel: "1d8" }],
  },
  "cleric::Blessing of the Forge": {
    subclass: "Forge Domain",
    spends: [
      {
        name: "Blessing of the Forge",
        fight: "out",
        does: {
          kind: "buff",
          target: "ally",
          condition: "blessing of the forge (armor)",
          variants: { armor: "blessing of the forge (armor)", weapon: "blessing of the forge (+1)" },
          rounds: 14400,
        },
      },
    ],
  },
  "cleric::Soul of the Forge": {
    subclass: "Forge Domain",
    effects: [
      { kind: "resist", types: ["fire"] },
      { kind: "ac", amount: 1, gate: { heavyArmor: true } },
    ],
  },
  "cleric::Saint of Forge and Fire": {
    subclass: "Forge Domain",
    effects: [
      { kind: "immune_damage", types: ["fire"] },
      { kind: "resist", types: ["bludgeoning", "piercing", "slashing"], nonmagical: true, gate: { heavyArmor: true } },
    ],
  },
  "cleric::Circle of Mortality": {
    subclass: "Grave Domain",
    effects: [{ kind: "heal_max", note: "Spare the Dying at 30 feet as a bonus action is narrated." }],
  },
  "cleric::Keeper of Souls": {
    subclass: "Grave Domain",
    effects: [{ kind: "death_heal", rangeFt: 60 }],
  },
  "cleric::Voice of Authority": {
    subclass: "Order Domain",
    reactions: [{ name: "Voice of Authority", usedBy: "party", does: { kind: "attack", rangeFt: 5 } }],
  },
  "cleric::Embodiment of the Law": {
    subclass: "Order Domain",
    counter: "sub_embodiment_of_the_law",
  },
  "cleric::Order's Wrath": {
    subclass: "Order Domain",
    effects: [
      { kind: "mark", condition: "order's wrath", effect: "ally_bonus_dice", oncePerTurn: true, dice: "2d8", damageType: "psychic" },
    ],
  },
  "cleric::Protective Bond": {
    subclass: "Peace Domain",
    reactions: [{ name: "Protective Bond", usedBy: "party", does: { kind: "take_for_ally", rangeFt: 60 } }],
  },
  "cleric::Vigilant Blessing": {
    subclass: "Twilight Domain",
    spends: [
      {
        name: "Vigilant Blessing",
        action: "action",
        does: { kind: "buff", target: "ally", condition: "vigilant blessing", rounds: 14400 },
      },
    ],
  },
};

// The Storm Aura's numbers by barbarian level, for the spend.
export const STORM_AURA = {
  desert: STORM_DAMAGE,
  sea: [[3, "1d6"], [10, "2d6"], [15, "3d6"], [20, "4d6"]] as Array<[number, string]>,
  tundra: STORM_DAMAGE,
};
