// Spell and feature conditions of the registry (src/lib/srd/condition-effects.ts
// spreads them in): the strikes and marks a hit or a turn spends (the smites,
// Guiding Bolt, Shocking Grasp, Reckless Attack, Frenzy), and the spell effects
// with numbers of their own (src/lib/srd/spell-mech-rows.ts: Aid, Magic
// Weapon, Enhance Ability, Warding Bond, Irresistible Dance). Kept apart so
// the registry file does not grow past reading; the type is imported as a
// type only, so the two files do not load each other.

import type { ConditionEffectRow } from "@/lib/srd/condition-effect-types";

export const STRIKE_CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    id: "branding_smite",
    match: ["branding smite"],
    summary:
      "Branding Smite: the next weapon hit deals +2d6 radiant and makes the target visible (it cannot become invisible) until the spell ends; the charge is spent by the hit.",
    onHitDice: { dice: "2d6", type: "radiant" },
    weaponOnly: true,
    consumedBy: "hit",
  },
  {
    id: "guiding_bolt",
    match: ["guiding bolt", "lit by guiding bolt"],
    summary:
      "Guiding Bolt: the next attack roll against this creature has advantage, and that attack spends it (it fades as the caster's next turn starts).",
    attacksAgainstAdvantage: true,
    consumedAgainst: true,
  },
  {
    id: "shocked",
    match: ["shocked", "shocking grasp"],
    summary: "Shocking Grasp: the creature cannot take reactions until its next turn starts.",
    noReactions: true,
  },
  {
    id: "ray_of_frost",
    match: ["ray of frost", "chilled by ray of frost"],
    summary: "Ray of Frost: the creature's speed is 10 feet lower until the caster's next turn starts.",
    speedBonus: -10,
  },
  {
    id: "chill_touch",
    match: ["chill touch"],
    summary:
      "Chill Touch: the creature cannot regain hit points until the caster's next turn starts, and an undead one has disadvantage on attack rolls against the caster until then.",
  },
  {
    id: "reckless",
    match: ["reckless", "attacking recklessly"],
    summary:
      "Reckless Attack: advantage on melee Strength weapon attacks this turn, and attack rolls against them have advantage until their next turn.",
    attacksAgainstAdvantage: true,
  },
  {
    id: "frenzied",
    match: ["frenzied", "frenzy"],
    summary:
      "Frenzy: while the rage lasts, one melee weapon attack as a bonus action on each of their turns (pc_attack bonusAttack 'frenzy'); one level of exhaustion when the rage ends.",
  },
];

export const NUMBERED_CONDITION_EFFECTS: ConditionEffectRow[] = [
  {
    id: "flame_blade",
    match: ["flame blade"],
    summary:
      "Flame Blade: a fiery blade in the free hand; a melee spell attack for 3d6 fire (+1d6 per two slot levels above 2nd). Resolve it with pc_attack, weapon 'Flame Blade' (an action).",
    grantedAttack: {
      name: "Flame Blade",
      diceByLevel: [[1, "3d6"]],
      type: "fire",
      abilityToDamage: false,
      ranged: false,
      bonusAction: false,
      upcast: { baseLevel: 2, every: 2, dice: "1d6" },
    },
  },
  // ---- spell effects with numbers (src/lib/srd/spell-mech-rows.ts) ----
  {
    id: "aided",
    match: ["aided"],
    summary: "Aid: the hit point maximum and current hit points are higher by the amount in the name for 8 hours; they fall back when it ends.",
  },
  {
    id: "protected_from_evil_and_good",
    match: ["protected from evil and good", "protection from evil and good"],
    summary:
      "Protection from Evil and Good: aberrations, celestials, elementals, fey, fiends and undead have disadvantage on attack rolls against them, and cannot charm, frighten or possess them.",
    attacksAgainstDisadvantageFrom: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"],
    conditionImmunitiesFrom: {
      types: ["aberration", "celestial", "elemental", "fey", "fiend", "undead"],
      conditions: ["charmed", "frightened"],
    },
  },
  {
    id: "magic_weapon_1",
    match: ["magic weapon +1", "magic weapon"],
    summary: "Magic Weapon: the weapon is magical, +1 to attack and damage rolls.",
    attackDie: "1",
    onHitDice: { dice: "1", type: "" },
    weaponOnly: true,
    magicalStrikes: true,
  },
  {
    id: "magic_weapon_2",
    match: ["magic weapon +2"],
    summary: "Magic Weapon: the weapon is magical, +2 to attack and damage rolls.",
    attackDie: "2",
    onHitDice: { dice: "2", type: "" },
    weaponOnly: true,
    magicalStrikes: true,
  },
  {
    id: "magic_weapon_3",
    match: ["magic weapon +3"],
    summary: "Magic Weapon: the weapon is magical, +3 to attack and damage rolls.",
    attackDie: "3",
    onHitDice: { dice: "3", type: "" },
    weaponOnly: true,
    magicalStrikes: true,
  },
  {
    id: "death_ward",
    match: ["death ward"],
    summary:
      "Death Ward: the first time damage would drop them to 0 hit points they drop to 1 instead, and the spell ends; an effect that would kill outright without damage is negated.",
  },
  {
    id: "beacon_of_hope",
    match: ["beacon of hope"],
    summary: "Beacon of Hope: advantage on Wisdom saves and death saves, and healing restores its maximum.",
    advantageOn: [{ kind: "save", ability: "wis" }],
    deathSaveAdvantage: true,
  },
  {
    id: "protection_from_energy",
    match: ["protection from energy"],
    summary: "Protection from Energy: resistance to the damage type in the name.",
    paramResistance: true,
  },
  {
    id: "pass_without_trace",
    match: ["pass without trace"],
    summary: "Pass without Trace: +10 to Dexterity (Stealth) checks, and they leave no tracks.",
    skillBonus: { skill: "stealth", bonus: 10 },
  },
  {
    id: "warding_bond",
    match: ["warding bond"],
    summary:
      "Warding Bond: +1 AC and saving throws and resistance to all damage while within 60 feet of the caster, who takes the same damage whenever they do.",
    acBonus: 1,
    saveFlat: 1,
    resistances: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"],
  },
  {
    id: "enhance_con",
    match: ["enhance ability (bear's endurance)"],
    summary: "Enhance Ability (Bear's Endurance): advantage on Constitution checks (the temporary hit points were granted at casting).",
    advantageOn: [{ kind: "check", ability: "con" }],
  },
  {
    id: "enhance_str",
    match: ["enhance ability (bull's strength)"],
    summary: "Enhance Ability (Bull's Strength): advantage on Strength checks, carrying capacity doubled.",
    advantageOn: [{ kind: "check", ability: "str" }],
  },
  {
    id: "enhance_dex",
    match: ["enhance ability (cat's grace)"],
    summary: "Enhance Ability (Cat's Grace): advantage on Dexterity checks, no damage from a fall of 20 feet or less.",
    advantageOn: [{ kind: "check", ability: "dex" }],
  },
  {
    id: "enhance_cha",
    match: ["enhance ability (eagle's splendor)"],
    summary: "Enhance Ability (Eagle's Splendor): advantage on Charisma checks.",
    advantageOn: [{ kind: "check", ability: "cha" }],
  },
  {
    id: "enhance_int",
    match: ["enhance ability (fox's cunning)"],
    summary: "Enhance Ability (Fox's Cunning): advantage on Intelligence checks.",
    advantageOn: [{ kind: "check", ability: "int" }],
  },
  {
    id: "enhance_wis",
    match: ["enhance ability (owl's wisdom)"],
    summary: "Enhance Ability (Owl's Wisdom): advantage on Wisdom checks.",
    advantageOn: [{ kind: "check", ability: "wis" }],
  },
  {
    id: "holy_aura",
    match: ["holy aura"],
    summary: "Holy Aura: advantage on every saving throw, and attack rolls against them have disadvantage.",
    advantageOn: [{ kind: "save" }],
    attacksAgainstDisadvantage: true,
  },
  {
    id: "fire_shield",
    match: ["fire shield"],
    summary:
      "Fire Shield: resistance to the damage type in the name (the warm shield cold, the chill shield fire); a creature within 5 feet that hits them in melee takes 2d8 of the other type.",
    paramResistance: true,
  },
  {
    id: "spirit_guardians",
    match: ["spirit guardians"],
    summary:
      "Spirit Guardians: a 15-foot aura; an enemy starting its turn inside saves (WIS) or takes 3d8 radiant, half on a success (the server rolls it), and its speed is halved there.",
  },
  {
    id: "confused",
    match: ["confused"],
    summary:
      "Confusion: no reactions; at the start of each turn a d10 decides what it does (1: wanders, 2 to 6: nothing, 7 to 8: attacks a random creature in reach, 9 to 10: acts normally).",
    noReactions: true,
  },
  {
    id: "commanded",
    match: ["commanded"],
    summary: "Command: it follows the one-word command on its next turn.",
  },
  {
    id: "banished",
    match: ["banished"],
    summary: "Banishment: gone to a harmless demiplane, incapacitated; it cannot be targeted and returns when the spell ends early.",
  },
  {
    id: "dancing",
    match: ["dancing"],
    summary:
      "Irresistible Dance: dancing in place with all its movement, disadvantage on Dexterity saves and attack rolls, and attack rolls against it have advantage; its action buys a WIS save to stop.",
    // All its movement goes to the dance; its action may buy the save
    // (take_action escape, src/lib/dm/spell-escape.ts).
    speedSet: 0,
    disadvantageOn: [{ kind: "save", ability: "dex" }],
    attacksAgainstAdvantage: true,
    attackDisadvantage: true,
  },
  {
    id: "shillelagh",
    match: ["shillelagh"],
    summary:
      "Shillelagh: their club or quarterstaff attacks with the spellcasting ability, deals a d8, and is magical.",
    magicalStrikes: true,
  },
  {
    id: "feather_fall",
    match: ["feather fall"],
    summary: "Feather Fall: they descend 60 feet a round and take no falling damage.",
  },
  {
    id: "returned_4",
    match: ["returned from death (-4)"],
    summary: "Back from the dead: -4 to attack rolls and saving throws, one less after each long rest.",
    attackPenaltyDie: "4",
    savePenaltyDie: "4",
  },
  {
    id: "returned_3",
    match: ["returned from death (-3)"],
    summary: "Back from the dead: -3 to attack rolls and saving throws, one less after each long rest.",
    attackPenaltyDie: "3",
    savePenaltyDie: "3",
  },
  {
    id: "returned_2",
    match: ["returned from death (-2)"],
    summary: "Back from the dead: -2 to attack rolls and saving throws, one less after each long rest.",
    attackPenaltyDie: "2",
    savePenaltyDie: "2",
  },
  {
    id: "returned_1",
    match: ["returned from death (-1)"],
    summary: "Back from the dead: -1 to attack rolls and saving throws; gone after the next long rest.",
    attackPenaltyDie: "1",
    savePenaltyDie: "1",
  },
];
