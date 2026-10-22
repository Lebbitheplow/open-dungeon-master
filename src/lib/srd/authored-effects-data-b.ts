// The engine hooks of the authored subclass features, druid and fighter
// (the shape of an entry: authored-effects-data.ts).

import type { AuthoredEntry } from "@/lib/srd/authored-effects-types";

export const AUTHORED_DATA_A2: Record<string, AuthoredEntry> = {
  // ---- druid ----
  // Combat Wild Shape spends Wild Shape's own uses: the change as a bonus
  // action (src/lib/dm/resource-turn.ts) and a slot burned for 1d8 per
  // level while transformed (src/lib/dm/mutations.ts).
  "druid::Combat Wild Shape": {
    subclass: "Circle of the Moon",
    counter: "wild_shape",
  },
  // The Circle of the Land's terrain, chosen when the druid joins it: its
  // circle spells are the chosen land's (class-features.json choiceSpells).
  "druid::Circle Spells": {
    subclass: "Circle of the Land",
    spends: [
      {
        name: "Circle Land",
        aliases: ["Circle Spells", "Land"],
        fight: "out",
        does: { kind: "choose", options: ["Arctic", "Coast", "Desert", "Forest", "Grassland", "Mountain", "Swamp", "Underdark"] },
      },
    ],
  },
  "druid::Halo of Spores": {
    subclass: "Circle of Spores",
    reactions: [
      {
        name: "Halo of Spores",
        does: {
          kind: "strike_back",
          amount: [[2, "1d4"], [6, "1d6"], [10, "1d8"], [14, "1d10"]],
          type: "necrotic",
          rangeFt: 10,
          save: { ability: "con", dcAbility: "spell" },
        },
      },
    ],
  },
  "druid::Symbiotic Entity": {
    subclass: "Circle of Spores",
    spends: [
      {
        name: "Symbiotic Entity",
        pool: { id: "wild_shape" },
        action: "action",
        does: { kind: "buff", condition: "symbiotic entity", rounds: 100, tempHp: (level) => 4 * level },
      },
    ],
  },
  "druid::Fungal Body": {
    subclass: "Circle of Spores",
    effects: [
      { kind: "immune_condition", conditions: ["blinded", "deafened", "frightened", "poisoned"] },
      { kind: "crit_immune" },
    ],
  },
  "druid::Twinkling Constellations": {
    subclass: "Circle of Stars",
    effects: [
      {
        kind: "move",
        fly: 20,
        gate: { condition: "starry form: dragon" },
        note: "The Archer's 2d8 is the Starry Form row's own; changing constellation each turn is narrated.",
      },
    ],
  },
  "druid::Summon Wildfire Spirit": {
    subclass: "Circle of Wildfire",
    spends: [
      {
        name: "Summon Wildfire Spirit",
        aliases: ["Wildfire Spirit"],
        pool: { id: "wild_shape" },
        action: "action",
        does: { kind: "buff", condition: "wildfire spirit", rounds: 600 },
      },
    ],
  },
  "druid::Enhanced Bond": {
    subclass: "Circle of Wildfire",
    effects: [
      {
        kind: "spell_rider",
        dice: "1d8",
        damageTypes: ["fire"],
        healing: true,
        gate: { condition: "wildfire spirit" },
        note: "Casting from the spirit's space is the DM's to place.",
      },
    ],
  },
  "druid::Cauterizing Flames": {
    subclass: "Circle of Wildfire",
    counter: "sub_cauterizing_flames",
    spends: [
      {
        name: "Cauterizing Flames",
        pool: { id: "sub_cauterizing_flames" },
        action: "reaction",
        does: { kind: "flames", formula: (_level, mods) => `2d10+${mods.wis ?? 0}`, type: "fire" },
      },
    ],
  },
  // XGtE: a bonus action to teleport the druid, an action to teleport a
  // willing creature they touch.
  "druid::Hidden Paths": {
    subclass: "Circle of Dreams",
    counter: "sub_hidden_paths",
    spends: [
      {
        name: "Hidden Paths",
        pool: { id: "sub_hidden_paths" },
        does: {
          kind: "variants",
          options: {
            self: { does: { kind: "teleport", feet: 60 }, action: "bonus" },
            touch: { does: { kind: "teleport", feet: 30, touched: true }, action: "action" },
          },
        },
      },
    ],
  },

  // ---- fighter ----
  "fighter::Know Your Enemy": {
    subclass: "Battle Master",
    narrated: "Information the DM gives after a minute of watching: nothing on a sheet changes.",
  },
  "fighter::Relentless": {
    subclass: "Battle Master",
    effects: [{ kind: "init_refill", resource: "sub_superiority_dice" }],
  },
  "fighter::Weapon Bond": {
    subclass: "Eldritch Knight",
    narrated: "Not being disarmed and calling the bonded weapon to hand are inventory narration.",
  },
  "fighter::War Magic": {
    subclass: "Eldritch Knight",
    effects: [{ kind: "bonus_attack", after: "cantrip" }],
  },
  "fighter::Eldritch Strike": {
    subclass: "Eldritch Knight",
    effects: [{ kind: "mark", condition: "eldritch strike", effect: "save_disadv" }],
  },
  // Curving Shot (XGtE): "When you make an attack roll with a magic arrow and
  // miss, you can use a bonus action to reroll the attack roll against a
  // different target within 60 feet of the original target" (issue 233).
  "fighter::Curving Shot": {
    subclass: "Arcane Archer",
    effects: [{ kind: "bonus_attack", after: "missed_arrow" }],
  },
  "fighter::Ever-Ready Shot": {
    subclass: "Arcane Archer",
    effects: [{ kind: "init_refill", resource: "sub_arcane_shot" }],
  },
  "fighter::Born to the Saddle": {
    subclass: "Cavalier",
    effects: [{ kind: "save_adv", against: ["dismount"] }],
  },
  "fighter::Unwavering Mark": {
    subclass: "Cavalier",
    counter: "sub_unwavering_mark",
    effects: [{ kind: "mark", condition: "unwavering mark", effect: "disadv_others", melee: true }],
  },
  "fighter::Hold the Line": {
    subclass: "Cavalier",
    reactions: [
      { name: "Hold the Line", does: { kind: "attack", rangeFt: 5, onHitCondition: { name: "held in place", rounds: 1 } } },
    ],
  },
  "fighter::Vigilant Defender": {
    subclass: "Cavalier",
    effects: [{ kind: "oa_each_turn" }],
  },
  "fighter::Elegant Courtier": {
    subclass: "Samurai",
    effects: [{ kind: "save_swap", save: "wis", use: "cha", note: "The Persuasion proficiency is applied to the sheet at the pick." }],
  },
  "fighter::Tireless Spirit": {
    subclass: "Samurai",
    effects: [{ kind: "init_refill", resource: "sub_fighting_spirit" }],
  },
  "fighter::Rapid Strike": {
    subclass: "Samurai",
    effects: [{ kind: "rapid_strike", note: "The extra attack's target is the same creature; the DM keeps to that." }],
  },
  "fighter::Manifest Echo": {
    subclass: "Echo Knight",
    narrated:
      "The echo is a position on the board, not a creature the engine tracks; attacks from its space are ordinary pc_attack calls.",
  },
  "fighter::Legion of One": {
    subclass: "Echo Knight",
    effects: [{ kind: "init_refill", resource: "sub_unleash_incarnation" }],
  },
  // Every Psionic Energy die returns on a long rest; once per short or long
  // rest a bonus action regains one (Tasha's).
  "fighter::Psionic Power (Psi Warrior)": {
    subclass: "Psi Warrior",
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
  "fighter::Protective Field": {
    subclass: "Psi Warrior",
    reactions: [
      {
        name: "Protective Field",
        pool: { id: "sub_psionic_energy" },
        does: { kind: "reduce", amount: "psionic_int", who: "either", rangeFt: 30 },
      },
    ],
  },
  "fighter::Telekinetic Adept": {
    subclass: "Psi Warrior",
    spends: [
      {
        name: "Telekinetic Adept",
        aliases: ["Telekinetic Thrust", "Psi-Powered Leap"],
        does: {
          kind: "variants",
          options: {
            thrust: {
              does: { kind: "save_effect", save: "str", dcAbility: "int", condition: "prone", rangeFt: 5, onFail: "may instead be pushed 10 feet (move_token forced)" },
              action: "none",
            },
            leap: { does: { kind: "buff", condition: "flying", rounds: 1 }, action: "bonus" },
          },
        },
      },
    ],
  },
  "fighter::Bulwark of Force": {
    subclass: "Psi Warrior",
    counter: "sub_bulwark_of_force",
    spends: [
      {
        name: "Bulwark of Force",
        pool: { id: "sub_bulwark_of_force", fallback: "sub_psionic_energy" },
        action: "bonus",
        does: {
          kind: "buff",
          target: "allies",
          condition: "bulwark of force",
          rounds: 10,
          rangeFt: 30,
          count: (_level, mods) => Math.max(1, mods.int ?? 0),
        },
      },
    ],
  },
  "fighter::Telekinetic Master": {
    subclass: "Psi Warrior",
    counter: "sub_telekinetic_master",
    effects: [{ kind: "bonus_attack", after: "telekinesis" }],
  },
  "fighter::Great Stature": {
    subclass: "Rune Knight",
    spends: [
      {
        name: "Giant's Might",
        pool: { id: "sub_giants_might" },
        action: "bonus",
        does: { kind: "buff", condition: "giant's might (1d8)", rounds: 10 },
      },
    ],
  },
  "fighter::Runic Juggernaut": {
    subclass: "Rune Knight",
    spends: [
      {
        name: "Giant's Might",
        pool: { id: "sub_giants_might" },
        action: "bonus",
        does: { kind: "buff", condition: "giant's might (1d10)", rounds: 10 },
      },
    ],
  },
  "fighter::Inspiring Surge": {
    subclass: "Banneret",
    reactions: [{ name: "Inspiring Surge", usedBy: "party", does: { kind: "attack", rangeFt: 5 } }],
  },
};
