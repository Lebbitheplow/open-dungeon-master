// The second half of the SRD override rows (spell-mech-overrides.ts spreads
// them in): conditions the prose parser reads wrong, lasting effects with
// numbers, the concentration spells whose effect comes again on later turns,
// healing that is a number, and bringing back the dead. SRD 5.1 as printed.

import type { SpellMech } from "@/lib/srd/spell-mech-types";

const MINUTE = 10;
const TEN_MINUTES = 100;
const HOUR = 600;
const EIGHT_HOURS = 4800;
const DAY = 14400;

export const SRD_EFFECT_ROWS: Record<string, SpellMech> = {
  // ---- conditions the prose reads wrong ----
  "hypnotic pattern": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: MINUTE, also: ["incapacitated"], endsOnDamage: true },
    area: true,
    areaFeet: 30,
    noDamage: true,
    note: "Charmed and incapacitated with a speed of 0 for the duration, no repeat save; it ends for a creature that takes damage (the server ends it) or is shaken out of it with an action.",
  },
  "blindness/deafness": {
    resolution: "save",
    save: "con",
    condition: { name: "blinded", variants: ["blinded", "deafened"], saveEnds: true },
    targets: { count: 1, perSlotLevel: 1 },
    noDamage: true,
    note: "The caster chooses blinded or deafened (pass condition); the target saves again at the end of each of its turns.",
  },
  web: {
    resolution: "save",
    save: "dex",
    condition: { name: "restrained", rounds: HOUR, escape: ["str"] },
    area: true,
    areaFeet: 20,
    noDamage: true,
    note: "Restrained until it breaks free: an action and a Strength check against the caster's DC (clear_enemy_condition on a success). Fire burns the web: 2d4 fire to a creature starting its turn in the burning strands.",
  },
  entangle: {
    resolution: "save",
    save: "str",
    condition: { name: "restrained", rounds: MINUTE, escape: ["str"] },
    area: true,
    areaFeet: 20,
    noDamage: true,
    note: "Restrained until the spell ends, or until it frees itself with an action and a Strength check against the caster's DC.",
  },
  grease: {
    resolution: "save",
    save: "dex",
    condition: { name: "prone" },
    area: true,
    areaFeet: 10,
    noDamage: true,
  },
  fear: {
    resolution: "save",
    save: "wis",
    condition: { name: "frightened", rounds: MINUTE },
    area: true,
    areaFeet: 30,
    noDamage: true,
    note: "A frightened creature drops what it holds and must Dash away each turn; it saves again only when it ends a turn out of the caster's sight.",
  },
  confusion: {
    resolution: "save",
    save: "wis",
    condition: { name: "confused", saveEnds: true },
    area: true,
    areaFeet: 10,
    noDamage: true,
    note: "A confused creature rolls a d10 at the start of each turn for what it does (narrate the result) and cannot take reactions.",
  },
  "hideous laughter": {
    resolution: "save",
    save: "wis",
    condition: { name: "incapacitated", also: ["prone"], saveEnds: true, saveOnDamage: "advantage" },
    noDamage: true,
    note: "Prone and incapacitated, unable to stand; it saves again at the end of each of its turns and each time it takes damage, with advantage then. A creature with Intelligence 4 or less is unaffected.",
  },
  "calm emotions": {
    resolution: "utility",
    note: "Humanoids that fail a CHA save have charm and fright suppressed or turn indifferent; narrate it and clear the suppressed conditions by hand.",
  },
  banishment: {
    resolution: "save",
    save: "cha",
    condition: { name: "banished", rounds: MINUTE, also: ["incapacitated"] },
    targets: { count: 1, perSlotLevel: 1 },
    noDamage: true,
    note: "Gone from the fight for the duration, with no repeat save; it returns to its space when concentration ends before a minute passes.",
  },
  "power word stun": {
    resolution: "save",
    save: "con",
    condition: { name: "stunned", saveEnds: true, hpAtMost: 150 },
    noDamage: true,
    note: "No save: a creature with 150 hit points or fewer is stunned; it makes a CON save at the end of each of its turns.",
  },
  "irresistible dance": {
    resolution: "save",
    save: "wis",
    condition: { name: "dancing", saveEnds: true, noInitialSave: true },
    immuneIfImmuneTo: "charmed",
    noDamage: true,
    note: "No save when cast; the dancer uses its action for a WIS save to stop. Creatures immune to being charmed are immune.",
  },
  "animal friendship": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: DAY },
    targets: { count: 1, perSlotLevel: 1 },
    targetTypes: ["beast"],
    noDamage: true,
  },
  geas: {
    resolution: "save",
    save: "wis",
    // 30 days; a year from a 7th-level slot; until dispelled from 9th.
    condition: { name: "charmed", rounds: 30 * DAY, roundsBySlot: [[7, 365 * DAY], [9, null]] },
    noDamage: true,
    note: "Charmed for 30 days; acting against the command deals 5d10 psychic, once a day.",
  },

  // ---- effects that last and have numbers ----
  "spirit guardians": {
    resolution: "buff",
    buff: { condition: "spirit guardians", target: "self", rounds: TEN_MINUTES },
    aura: { radiusFeet: 15, save: "wis", dice: "3d8", perSlotLevel: "1d8", baseLevel: 3, type: "radiant", halfOnSave: true },
    note: "An enemy that starts its turn within 15 feet makes a WIS save or takes 3d8 radiant (half on a success); the server rolls it at the start of that enemy's turn on the battle map. Speed is halved inside.",
  },
  aid: {
    resolution: "buff",
    buff: { condition: "aided", target: "allies", rounds: EIGHT_HOURS, maxHp: { base: 5, perSlotLevel: 5 } },
    targets: { count: 3 },
    note: "Up to three creatures; each one's hit point maximum and current hit points rise by 5 (+5 a slot level above 2nd) for 8 hours.",
  },
  "protection from evil and good": {
    resolution: "buff",
    buff: { condition: "protected from evil and good", target: "ally", rounds: TEN_MINUTES },
  },
  "magic weapon": {
    resolution: "buff",
    buff: {
      condition: "magic weapon +1",
      target: "ally",
      rounds: HOUR,
      bySlot: [
        [2, "magic weapon +1"],
        [4, "magic weapon +2"],
        [6, "magic weapon +3"],
      ],
    },
  },
  "death ward": {
    resolution: "buff",
    buff: { condition: "death ward", target: "ally", rounds: EIGHT_HOURS },
  },
  "beacon of hope": {
    resolution: "buff",
    buff: { condition: "beacon of hope", target: "allies", rounds: MINUTE },
  },
  "protection from energy": {
    resolution: "buff",
    buff: {
      condition: "protection from energy (fire)",
      target: "ally",
      rounds: HOUR,
      variants: [
        "protection from energy (fire)",
        "protection from energy (cold)",
        "protection from energy (acid)",
        "protection from energy (lightning)",
        "protection from energy (thunder)",
      ],
    },
    note: "Pass variant with the damage type: acid, cold, fire, lightning or thunder.",
  },
  "pass without trace": {
    resolution: "buff",
    buff: { condition: "pass without trace", target: "allies", rounds: HOUR },
  },
  "warding bond": {
    resolution: "buff",
    buff: { condition: "warding bond", target: "ally", rounds: HOUR },
    note: "Each time the warded creature takes damage the caster takes the same amount (apply_damage); it ends if the two are more than 60 feet apart.",
  },
  "enhance ability": {
    resolution: "buff",
    buff: {
      condition: "enhance ability (bear's endurance)",
      target: "ally",
      rounds: HOUR,
      variants: [
        "enhance ability (bear's endurance)",
        "enhance ability (bull's strength)",
        "enhance ability (cat's grace)",
        "enhance ability (eagle's splendor)",
        "enhance ability (fox's cunning)",
        "enhance ability (owl's wisdom)",
      ],
    },
    targets: { count: 1, perSlotLevel: 1 },
    note: "Pass variant with the chosen effect; Bear's Endurance also grants 2d6 temporary hit points.",
  },
  "holy aura": {
    resolution: "buff",
    buff: { condition: "holy aura", target: "allies", rounds: MINUTE },
  },
  "fire shield": {
    resolution: "buff",
    buff: {
      condition: "fire shield (cold)",
      target: "self",
      rounds: TEN_MINUTES,
      variants: ["fire shield (cold)", "fire shield (fire)"],
    },
    note: "The warm shield resists cold, the chill shield fire (pass variant). A creature within 5 feet that hits with a melee attack takes 2d8 of the other type (damage_enemy).",
  },
  "branding smite": {
    resolution: "buff",
    buff: { condition: "branding smite", target: "self", rounds: MINUTE },
  },
  shillelagh: {
    resolution: "buff",
    buff: { condition: "shillelagh", target: "self", rounds: MINUTE },
    note: "The club or quarterstaff uses the caster's spellcasting ability for attack and damage, its damage die a d8, and it is magical (a bonus action).",
  },
  "feather fall": {
    resolution: "buff",
    buff: { condition: "feather fall", target: "allies", rounds: MINUTE },
    targets: { count: 5 },
    note: "Up to five falling creatures descend 60 feet a round and take no falling damage when they land.",
  },
  "spike growth": {
    resolution: "utility",
    note: "Difficult terrain; a creature takes 2d4 piercing for every 5 feet it moves through the area (damage_enemy).",
  },

  // ---- repeats while concentrating ----
  "call lightning": {
    resolution: "save",
    save: "dex",
    halfOnSave: true,
    damageType: "lightning",
    area: true,
    areaFeet: 5,
    repeat: "action",
    note: "Each later turn the caster's action calls another bolt with no slot: aoe_damage with the spell again.",
  },
  moonbeam: {
    resolution: "save",
    save: "con",
    halfOnSave: true,
    damageType: "radiant",
    area: true,
    areaFeet: 5,
    repeat: "free",
    note: "A creature entering the beam or starting its turn there saves again (aoe_damage with the spell again spends no slot); moving the beam takes the caster's action.",
  },
  "flaming sphere": {
    resolution: "save",
    save: "dex",
    halfOnSave: true,
    damageType: "fire",
    repeat: "bonus",
    note: "A bonus action rams the sphere into a creature on later turns with no slot: cast_at_enemy with the spell again.",
  },
  cloudkill: {
    resolution: "save",
    save: "con",
    halfOnSave: true,
    damageType: "poison",
    area: true,
    areaFeet: 20,
    repeat: "free",
  },
  "insect plague": {
    resolution: "save",
    save: "con",
    halfOnSave: true,
    damageType: "piercing",
    area: true,
    areaFeet: 20,
    repeat: "free",
  },
  "vampiric touch": {
    resolution: "attack",
    attack: "melee",
    damageType: "necrotic",
    repeat: "action",
  },
  "flame blade": {
    resolution: "buff",
    buff: { condition: "flame blade", target: "self", rounds: TEN_MINUTES },
    note: "Attack with it via pc_attack, weapon 'Flame Blade' (an action each time, no slot).",
  },

  // ---- healing and bringing back ----
  heal: {
    resolution: "heal",
    healing: { flat: 70, perSlotLevel: 10 },
  },
  "mass heal": {
    resolution: "heal",
    healPool: 700,
    note: "700 hit points divided among any number of creatures: one heal call per creature with its amount, the same turn, one slot.",
  },
  "mass healing word": { resolution: "heal", targets: { count: 6 } },
  "mass cure wounds": { resolution: "heal", targets: { count: 6 } },
  "prayer of healing": { resolution: "heal", targets: { count: 6 } },
  revivify: {
    resolution: "heal",
    revive: { hp: "one", withinMinutes: 1 },
  },
  "raise dead": {
    resolution: "heal",
    revive: { hp: "one", withinMinutes: 10 * 24 * 60, ordeal: true },
  },
  resurrection: {
    resolution: "heal",
    revive: { hp: "all", withinMinutes: 100 * 365 * 24 * 60, ordeal: true },
  },
  "true resurrection": {
    resolution: "heal",
    revive: { hp: "all", withinMinutes: 200 * 365 * 24 * 60 },
  },
  "dispel magic": {
    resolution: "utility",
    dispel: true,
    note: "Ends every spell of the slot's level or lower on the target; a higher one needs a spellcasting check against DC 10 + its level (the server rolls it).",
  },
};
