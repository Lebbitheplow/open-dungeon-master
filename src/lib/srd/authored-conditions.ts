// The conditions the authored subclass spends leave (src/lib/dm/authored-spends.ts),
// as rows of the condition-effects registry, which appends them to its own:
// a condition name resolves to riders the attack, save, AC and speed engines
// already read. A row with only a summary is read by the authored hooks
// (src/lib/dm/authored-hooks.ts) or tells the table what the condition means.

import type { ConditionEffectRow } from "@/lib/srd/condition-effects";

const ALL_BUT = (...except: string[]) =>
  [
    "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
    "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
  ].filter((type) => !except.includes(type));

const summaryOnly = (id: string, name: string, summary: string): ConditionEffectRow => ({
  id,
  match: [name],
  summary,
});

export const AUTHORED_CONDITION_ROWS: ConditionEffectRow[] = [
  {
    id: "symbiotic_entity",
    match: ["symbiotic entity"],
    summary: "Symbiotic Entity: melee weapon hits deal +1d6 necrotic (the temporary hit points came with it) for 10 minutes.",
    onHitDice: { dice: "1d6", type: "necrotic" },
    weaponOnly: true,
  },
  {
    id: "kensei_shot",
    match: ["kensei's shot"],
    summary: "Kensei's Shot: ranged weapon hits with a kensei weapon deal +1d4 this turn.",
    onHitDice: { dice: "1d4", type: "" },
    weaponOnly: true,
  },
  ...[1, 2, 3].map(
    (points): ConditionEffectRow => ({
      id: `sharpen_the_blade_${points}`,
      match: [`sharpen the blade (+${points})`],
      summary: `Sharpen the Blade: +${points} to attack and damage rolls with a kensei weapon for a minute.`,
      paramAttackBonus: true,
      onHitDice: { dice: String(points), type: "" },
      weaponOnly: true,
    }),
  ),
  { id: "agile_parry", match: ["agile parry"], summary: "Agile Parry: +2 AC until the monk's next turn.", acBonus: 2 },
  // Blade Flourish's defensive flourish: the Bardic Inspiration die rolled,
  // as AC until the bard's next turn.
  ...Array.from({ length: 12 }, (_, index): ConditionEffectRow => ({
    id: `defensive_flourish_${index + 1}`,
    match: [`defensive flourish (+${index + 1})`],
    summary: `Defensive Flourish: +${index + 1} AC until the bard's next turn.`,
    acBonus: index + 1,
  })),
  {
    id: "awakened_astral_self",
    match: ["awakened astral self"],
    summary: "Awakened Astral Self: +2 AC, and a third arms strike with the Attack action (narrated).",
    acBonus: 2,
  },
  summaryOnly(
    "arms_of_the_astral_self",
    "arms of the astral self",
    "Arms of the Astral Self: spectral arms for 10 minutes; unarmed strikes reach 5 feet further and deal force damage.",
  ),
  summaryOnly(
    "visage_of_the_astral_self",
    "visage of the astral self",
    "Visage of the Astral Self: darkvision to 120 feet and advantage on Insight and Intimidation checks for 10 minutes.",
  ),
  {
    id: "shadow_step",
    match: ["shadow step"],
    summary: "Shadow Step: advantage on the next melee attack this turn.",
    attackAdvantage: true,
    consumedBy: "attack",
  },
  {
    id: "drunkards_luck_attack",
    match: ["drunkard's luck (attack)"],
    summary: "Drunkard's Luck: the next attack roll cancels its disadvantage (an advantage that the roll spends).",
    attackAdvantage: true,
    consumedBy: "attack",
  },
  summaryOnly("drunkards_luck_check", "drunkard's luck (check)", "Drunkard's Luck: the next ability check cancels its disadvantage."),
  summaryOnly("drunkards_luck_save", "drunkard's luck (save)", "Drunkard's Luck: the next saving throw cancels its disadvantage."),
  ...(["1d8", "1d10"] as const).map(
    (dice): ConditionEffectRow => ({
      id: `giants_might_${dice}`,
      match: [`giant's might (${dice})`],
      summary: `Giant's Might: Large, advantage on Strength checks and saves, and one weapon hit per turn deals +${dice} damage.`,
      advantageOn: [
        { kind: "save", ability: "str" },
        { kind: "check", ability: "str" },
      ],
      onHitDice: { dice, type: "" },
      weaponOnly: true,
    }),
  ),
  {
    id: "blessing_of_the_forge_armor",
    match: ["blessing of the forge (armor)"],
    summary: "Blessing of the Forge: the armor grants +1 AC until the cleric blesses something else.",
    acBonus: 1,
  },
  {
    id: "blessing_of_the_forge_weapon",
    match: ["blessing of the forge (+1)"],
    summary: "Blessing of the Forge: the weapon is +1 to attack and damage rolls until the cleric blesses something else.",
    paramAttackBonus: true,
    onHitDice: { dice: "1", type: "" },
    weaponOnly: true,
  },
  summaryOnly("blessing_of_the_trickster", "blessing of the trickster", "Blessing of the Trickster: advantage on Stealth checks for an hour."),
  summaryOnly("vigilant_blessing", "vigilant blessing", "Vigilant Blessing: advantage on the next initiative roll."),
  summaryOnly("elegant_maneuver", "elegant maneuver", "Elegant Maneuver: advantage on the next Acrobatics or Athletics check this turn."),
  summaryOnly(
    "corona_of_light",
    "corona of light",
    "Corona of Light: bright light 60 feet around the cleric; enemies in it save at disadvantage against spells for a minute.",
  ),
  ...(["d6", "d8", "d10", "d12"] as const).map(
    (die): ConditionEffectRow => ({
      id: `unsettled_${die}`,
      match: [`unsettled (${die})`],
      summary: `Unsettling Words: 1${die} comes off this creature's next saving throw.`,
      savePenaltyDie: `1${die}`,
      consumedBy: "save",
    }),
  ),
  summaryOnly("hound_of_ill_omen", "hound of ill omen", "Hound of Ill Omen: a shadow hound hunts this creature; it saves at disadvantage against the sorcerer's spells."),
  summaryOnly("eldritch_strike", "eldritch strike", "Eldritch Strike: disadvantage on the next save against the fighter's spell before the end of their next turn."),
  summaryOnly("distracted", "distracted", "Distracted by a mage hand: the rogue who distracted it has advantage on attacks against it this turn."),
  summaryOnly("ancestral_protectors", "ancestral protectors", "Ancestral Protectors: disadvantage on attacks against anyone but the barbarian, whose allies resist its damage, until the barbarian's next turn."),
  summaryOnly("unwavering_mark", "unwavering mark", "Unwavering Mark: disadvantage on attacks against anyone but the cavalier until their next turn."),
  summaryOnly("thunder_gauntlets", "thunder gauntlets", "Thunder Gauntlets: disadvantage on attacks against anyone but the armorer until their next turn."),
  {
    id: "ambush_master_mark",
    match: ["ambush master"],
    summary: "Ambush Master: attack rolls against this creature have advantage until the scout's next turn.",
    attacksAgainstAdvantage: true,
  },
  {
    id: "lit_by_perfected_armor",
    match: ["lit by perfected armor"],
    summary: "Perfected Armor: the next attack roll against this glowing creature has advantage.",
    attacksAgainstAdvantage: true,
    consumedAgainst: true,
  },
  summaryOnly("orders_wrath", "order's wrath", "Order's Wrath: the next ally to hit this creature deals +2d8 psychic."),
  {
    id: "planar_warrior",
    match: ["planar warrior"],
    summary: "Planar Warrior: the next weapon hit this turn deals +1d8 force.",
    onHitDice: { dice: "1d8", type: "force" },
    weaponOnly: true,
    consumedBy: "hit",
  },
  {
    id: "planar_warrior_2d8",
    match: ["planar warrior (2d8)"],
    summary: "Planar Warrior: the next weapon hit this turn deals +2d8 force.",
    onHitDice: { dice: "2d8", type: "force" },
    weaponOnly: true,
    consumedBy: "hit",
  },
  summaryOnly("slayers_prey", "slayer's prey", "Slayer's Prey: the first weapon hit each turn deals +1d6."),
  {
    id: "umbral_form",
    match: ["umbral form"],
    summary: "Umbral Form: resistance to all damage but force and radiant, and moving through creatures and objects, for a minute.",
    resistances: ALL_BUT("force", "radiant"),
  },
  summaryOnly("otherworldly_wings", "otherworldly wings", "Otherworldly Wings: a flying speed of 30 feet."),
  {
    id: "bulwark_of_force",
    match: ["bulwark of force"],
    summary: "Bulwark of Force: half cover, +2 AC and +2 on Dexterity saves, for a minute.",
    acBonus: 2,
    saveFlat: 2,
    saveFlatAbility: "dex",
  },
  {
    id: "held_in_place",
    match: ["held in place"],
    summary: "Held in place (Hold the Line): speed 0 for the rest of the turn.",
    speedMultiplier: 0,
  },
  {
    id: "raging_storm_tundra",
    match: ["raging storm (tundra)"],
    summary: "Raging Storm (Tundra): speed halved until the barbarian's next turn.",
    speedMultiplier: 0.5,
  },
  summaryOnly("storm_aura", "storm aura", "Storm Aura: the raging Storm Herald's 10-foot aura (desert, sea or tundra)."),
  summaryOnly("fanatical_focus_spent", "fanatical focus spent", "Fanatical Focus is spent until this rage ends."),
  summaryOnly("elder_champion", "elder champion", "Elder Champion: 10 hit points at the start of each turn, and enemies within 10 feet save at disadvantage against the paladin."),
  summaryOnly("avenging_angel", "avenging angel", "Avenging Angel: a 60-foot flying speed, and advantage on attacks against creatures the aura frightened."),
  {
    id: "invincible_conqueror",
    match: ["invincible conqueror"],
    summary: "Invincible Conqueror: resistance to all damage for a minute; the extra attack and the 19-20 critical are narrated.",
    resistances: ALL_BUT(),
  },
  {
    id: "living_legend",
    match: ["living legend"],
    summary: "Living Legend: advantage on Charisma checks for a minute; the reroll and the turned save are narrated.",
    advantageOn: [{ kind: "check", ability: "cha" }],
  },
  summaryOnly("mortal_bulwark", "mortal bulwark", "Mortal Bulwark: truesight 120 feet and advantage on attacks against aberrations, celestials, elementals, fey and fiends."),
  {
    id: "exalted_champion",
    match: ["exalted champion"],
    summary: "Exalted Champion: resistance to nonmagical weapon damage and advantage on Wisdom saves for an hour.",
    resistances: ["bludgeoning", "piercing", "slashing"],
    nonmagicalOnly: true,
    advantageOn: [{ kind: "save", ability: "wis" }],
  },
  {
    id: "dread_lord",
    match: ["dread lord"],
    summary:
      "Dread Lord: attack rolls against the oathbreaker are at disadvantage, enemies starting a turn within 30 feet take 4d10 psychic, and a bonus-action spectral strike (pc_attack weapon \"Dread Lord's Shadows\") deals 4d10 psychic.",
    attacksAgainstDisadvantage: true,
    grantedAttack: {
      name: "Dread Lord's Shadows",
      diceByLevel: [[1, "4d10"]],
      type: "psychic",
      abilityToDamage: false,
      ranged: false,
      bonusAction: true,
    },
  },
  summaryOnly("soul_trinket", "soul trinket", "A soul trinket: advantage on Constitution saves and resistance to poison while it is held."),
  {
    id: "adjusted_density_lighter",
    match: ["adjusted density (lighter)"],
    summary: "Adjust Density (halved): +10 feet of speed, disadvantage on Strength checks and saves.",
    speedBonus: 10,
    disadvantageOn: [
      { kind: "save", ability: "str" },
      { kind: "check", ability: "str" },
    ],
  },
  {
    id: "adjusted_density_heavier",
    match: ["adjusted density (heavier)"],
    summary: "Adjust Density (doubled): -10 feet of speed, advantage on Strength checks and saves.",
    speedBonus: -10,
    advantageOn: [
      { kind: "save", ability: "str" },
      { kind: "check", ability: "str" },
    ],
  },
  summaryOnly("emissary_lapsed", "emissary lapsed", "Emissary of Redemption is set aside until a long rest: the paladin attacked or harmed a creature."),
  summaryOnly("insightful_fighting", "insightful fighting", "Insightful Fighting: the rogue may Sneak Attack this creature without advantage for a minute."),
  // The final round's hooks (src/lib/srd/authored-effects-more.ts).
  summaryOnly("wildfire_spirit", "wildfire spirit", "The wildfire spirit is out: the druid's fire and healing spells gain 1d8 (Enhanced Bond)."),
  summaryOnly("slayers_prey_marked", "slayer's prey (marked)", "The Monster Slayer's prey: the ranger adds 1d6 to saves against its effects (Supernatural Defense)."),
  summaryOnly("struck_as_it_fled", "struck as it fled", "Relentless Avenger: the paladin's opportunity attack hit; they may move up to half their speed with use_reaction, drawing no opportunity attacks."),
];
