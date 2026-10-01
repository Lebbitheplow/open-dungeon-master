// The third set of SRD override rows (spell-mech-overrides.ts spreads them
// in): the spells whose save does more than damage and a condition (a push,
// a lost action, a shrunken maximum), the effects that come back at a turn's
// end or start, and the spells the prose parser reads as a save although
// they are buffs, creatures or table magic. SRD 5.1 as printed.
//
// A row here replaces the parsed answer whole, so each one restates the
// save, the half and the damage type; the dice still come from the spell's
// own text (or the baked manifest with no content pack) unless a row says.

import type { SpellMech } from "@/lib/srd/spell-mech-types";

const MINUTE = 10;
const TEN_MINUTES = 100;
const HOUR = 600;
const DAY = 14400;

// Spells whose save the table resolves as story: a mind read, a lie
// compelled, a place warded, a scene watched from afar. The engine has no
// state for what they do, so they cast with use_spell_slot and are narrated.
const TABLE_MAGIC = [
  "detect thoughts",
  "zone of truth",
  "magic circle",
  "hallow",
  "planar binding",
  "scrying",
  "seeming",
  "dream",
  "magic jar",
  "forcecage",
  "glyph of warding",
  "wall of stone",
];

export const SRD_TAIL_ROWS: Record<string, SpellMech> = {
  ...Object.fromEntries(
    TABLE_MAGIC.map((name) => [
      name,
      { resolution: "utility", note: "Its effect is the table's to narrate; cast it with use_spell_slot." } as SpellMech,
    ]),
  ),

  // ---- a push on a failed save ----
  thunderwave: {
    resolution: "save",
    save: "con",
    halfOnSave: true,
    damageType: "thunder",
    area: true,
    areaFeet: 15,
    riders: { pushFeet: 10 },
    note: "A creature that fails is pushed 10 feet away from the caster; the server moves its token on a battle map.",
  },
  "gust of wind": {
    resolution: "save",
    save: "str",
    area: true,
    areaFeet: 60,
    noDamage: true,
    repeat: "bonus",
    riders: { pushFeet: 15 },
    note: "A creature in the line that fails its Strength save is pushed 15 feet away (the server moves its token); a bonus action each later turn blows again with no slot.",
  },

  // ---- riders of a failed save ----
  "vicious mockery": {
    resolution: "save",
    save: "wis",
    damageType: "psychic",
    condition: { name: "mocked", endsWith: "target turn end" },
    note: "On a failed save it has disadvantage on the next attack roll it makes before the end of its next turn; the server spends it on that roll.",
  },
  harm: {
    resolution: "save",
    save: "con",
    halfOnSave: true,
    damageType: "necrotic",
    riders: { hpFloor: 1, shrinksMaxHp: true },
    note: "Harm cannot take the target below 1 hit point; a failed save shrinks its hit point maximum by the necrotic damage taken, for an hour.",
  },
  "heat metal": {
    resolution: "auto",
    damageType: "fire",
    dice: { base: "2d8", perSlotLevel: "1d8", baseLevel: 2 },
    repeat: "bonus",
    riders: { gripSave: "con" },
    note: "The damage is automatic. The holder makes a CON save or drops a held object; one that keeps it (armor it wears: pass condition \"armor\") has disadvantage on attacks and checks until the caster's next turn. The server rolls it. Each later turn a bonus action repeats the damage with no slot.",
  },
  "charm person": {
    resolution: "save",
    save: "wis",
    // Harm from the party ends it; damage is what the engine sees of harm.
    condition: { name: "charmed", rounds: HOUR, endsOnDamage: true },
    targets: { count: 1, perSlotLevel: 1 },
    targetTypes: ["humanoid"],
    noDamage: true,
    riders: { advantageInFight: true },
    note: "A creature the party is fighting saves with advantage (the server rolls it so). Charmed for an hour, or until the party harms it.",
  },
  command: {
    resolution: "save",
    save: "wis",
    condition: { name: "commanded", rounds: 1, choices: { grovel: ["prone"], halt: ["halted"] } },
    targets: { count: 1, perSlotLevel: 1 },
    immuneTypes: ["undead"],
    noDamage: true,
    note: "Name the word in condition: grovel lays it prone, halt stops it for its next turn (the server applies both); approach, drop and flee are narrated on its turn. No effect on undead.",
  },
  suggestion: {
    resolution: "save",
    save: "wis",
    condition: { name: "suggested", rounds: 8 * HOUR, endsOnDamage: true },
    immuneIfImmuneTo: "charmed",
    noDamage: true,
    note: "It pursues the suggested course for up to 8 hours; damage from the caster or the party ends it (the server ends it on damage). A creature that cannot be charmed is immune.",
  },
  "mass suggestion": {
    resolution: "save",
    save: "wis",
    condition: { name: "suggested", rounds: DAY, endsOnDamage: true },
    immuneIfImmuneTo: "charmed",
    targets: { count: 12 },
    noDamage: true,
    note: "Up to twelve creatures pursue the course for 24 hours; damage from the caster or the party ends it for the one hurt.",
  },
  levitate: {
    resolution: "save",
    save: "con",
    condition: { name: "levitating", rounds: TEN_MINUTES },
    noDamage: true,
    note: "It rises up to 20 feet and can move only by pushing or pulling on something fixed: its speed is 0 while the spell lasts.",
  },
  "modify memory": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: MINUTE, also: ["incapacitated"] },
    noDamage: true,
    note: "Charmed and incapacitated while the caster reshapes its memory; what it remembers is narrated.",
  },
  "stinking cloud": {
    resolution: "save",
    save: "con",
    area: true,
    areaFeet: 20,
    noDamage: true,
    repeat: "free",
    riders: { losesAction: true },
    note: "A creature that fails spends its action retching on its turn (the server holds it to that); creatures that need no breath or are immune to poison succeed. A creature starting its turn in the cloud saves again: aoe_damage with the spell again, no slot.",
  },
  "sleet storm": {
    resolution: "save",
    save: "dex",
    condition: { name: "prone" },
    area: true,
    areaFeet: 40,
    noDamage: true,
    repeat: "free",
    riders: { concentrationSave: "con" },
    note: "A creature that fails falls prone, and a concentrating creature caught makes a CON save or loses its concentration (the server rolls both). Entering or starting a turn in the storm saves again: aoe_damage with the spell again, no slot.",
  },
  earthquake: {
    resolution: "save",
    save: "dex",
    condition: { name: "prone" },
    area: true,
    areaFeet: 100,
    noDamage: true,
    repeat: "free",
    riders: { concentrationSave: "con" },
    note: "Each creature on the ground saves or falls prone, and a concentrating one makes a CON save or loses it. Fissures and collapsing buildings are narrated (their 5d6 through damage_enemy with source environment).",
  },
  blight: {
    resolution: "save",
    save: "con",
    halfOnSave: true,
    damageType: "necrotic",
    immuneTypes: ["undead", "construct"],
    riders: { saveDisadvantageFor: ["plant"], maxDamageFor: ["plant"] },
    note: "No effect on undead or constructs; a plant creature saves with disadvantage and takes the maximum damage (the server applies both).",
  },
  "chain lightning": {
    resolution: "save",
    save: "dex",
    halfOnSave: true,
    damageType: "lightning",
    targets: { count: 4, perSlotLevel: 1 },
    note: "The target and up to three more creatures within 30 feet of it, one more per slot level above 6th: one aoe_damage call naming them all, one slot.",
  },
  "acid splash": {
    resolution: "save",
    save: "dex",
    damageType: "acid",
    targets: { count: 2 },
    riders: { clusterFeet: 5 },
    note: "One creature, or two standing within 5 feet of each other.",
  },

  "bestow curse": {
    resolution: "save",
    save: "wis",
    condition: {
      name: "cursed (str)",
      rounds: MINUTE,
      variants: [
        "cursed (str)", "cursed (dex)", "cursed (con)", "cursed (int)", "cursed (wis)", "cursed (cha)",
        "cursed (attacks)", "cursed (will)", "cursed (necrotic)",
      ],
    },
    noDamage: true,
    note: "Name the curse in condition: an ability (str to cha: disadvantage on its checks and saves), attacks (disadvantage on attack rolls against the caster), will (a WIS save at the start of each of its turns or it wastes its action), or necrotic (the caster's attacks and spells deal 1d8 necrotic more to it). The server holds each.",
  },

  // ---- conditions that hold on, and hurt at a turn's edge ----
  "black tentacles": {
    resolution: "save",
    save: "dex",
    damageType: "bludgeoning",
    condition: {
      name: "restrained",
      rounds: MINUTE,
      turnStart: { dice: "3d6", baseLevel: 4, type: "bludgeoning", noSave: true },
      escape: ["str", "dex"],
    },
    area: true,
    areaFeet: 20,
    repeat: "free",
    note: "A creature that fails takes 3d6 bludgeoning and is restrained; one it holds takes 3d6 at the start of each of its turns (the server rolls it). It escapes with its action and a Strength or Dexterity check against the caster's DC (take_action escape).",
  },
  weird: {
    resolution: "save",
    save: "wis",
    condition: { name: "frightened", rounds: MINUTE, turnEnd: { dice: "4d10", baseLevel: 9, type: "psychic" } },
    area: true,
    areaFeet: 30,
    noDamage: true,
    note: "Frightened; at the end of each of its turns it saves again or takes 4d10 psychic, a success ending the spell for it. The server rolls it.",
  },
  "phantasmal killer": {
    resolution: "save",
    save: "wis",
    condition: {
      name: "frightened",
      rounds: MINUTE,
      turnEnd: { dice: "4d10", perSlotLevel: "1d10", baseLevel: 4, type: "psychic" },
    },
    noDamage: true,
    note: "At the end of each of its turns the target saves again or takes 4d10 psychic (+1d10 a slot level above 4th); a success ends the spell. The server rolls it.",
  },
  "flesh to stone": {
    resolution: "save",
    save: "con",
    condition: { name: "restrained", rounds: MINUTE, turnEnd: { baseLevel: 6, tally: { fails: 3, becomes: "petrified" } } },
    noDamage: true,
    note: "Restrained; it saves at the end of each of its turns: three successes end the spell, three failures turn it to stone (the server keeps the count).",
  },
  eyebite: {
    resolution: "save",
    save: "wis",
    condition: {
      name: "unconscious",
      variants: ["unconscious", "frightened", "sickened"],
      variantRules: {
        unconscious: { endsOnDamage: true, rounds: MINUTE },
        frightened: { rounds: MINUTE },
        sickened: { saveEnds: true },
      },
    },
    noDamage: true,
    repeat: "action",
    note: "Pass condition: unconscious (Asleep: ends on damage), frightened (Panicked: it Dashes away) or sickened (disadvantage on attacks and checks, a WIS save at the end of each turn). Each later turn the caster's action targets another creature with no slot.",
  },
  sunbeam: {
    resolution: "save",
    save: "con",
    halfOnSave: true,
    damageType: "radiant",
    condition: { name: "blinded", endsWith: "caster turn start" },
    area: true,
    areaFeet: 60,
    repeat: "action",
    riders: { saveDisadvantageFor: ["undead", "ooze"] },
    note: "Blinded until the caster's next turn on a failed save; undead and oozes save with disadvantage. Each later turn the caster's action sends another beam with no slot.",
  },
  sunburst: {
    resolution: "save",
    save: "con",
    halfOnSave: true,
    damageType: "radiant",
    condition: { name: "blinded", rounds: MINUTE, saveEnds: true },
    area: true,
    areaFeet: 60,
    riders: { saveDisadvantageFor: ["undead", "ooze"] },
  },
  disintegrate: {
    resolution: "save",
    save: "dex",
    damageType: "force",
    riders: { disintegrates: true },
    note: "A creature this drops to 0 hit points is disintegrated: dead, with nothing left to raise but by True Resurrection or Wish.",
  },
  "divine word": {
    resolution: "save",
    save: "cha",
    area: true,
    areaFeet: 30,
    noDamage: true,
    riders: {
      hpTiers: [
        { atMost: 20, conditions: [], dies: true },
        { atMost: 30, conditions: ["blinded", "deafened", "stunned"], rounds: HOUR },
        { atMost: 40, conditions: ["deafened", "blinded"], rounds: TEN_MINUTES },
        { atMost: 50, conditions: ["deafened"], rounds: MINUTE },
      ],
    },
    note: "By its hit points on a failed save: 20 or fewer killed, 30 or fewer blinded, deafened and stunned for an hour, 40 or fewer deafened and blinded for 10 minutes, 50 or fewer deafened for a minute. The server applies it.",
  },
  "resilient sphere": {
    resolution: "save",
    save: "dex",
    condition: { name: "enclosed", rounds: MINUTE },
    noDamage: true,
    note: "Enclosed in the sphere: nothing passes in or out, so it cannot be attacked or harmed from outside, and harms nothing outside.",
  },

  // ---- concentration spells that come again on later turns ----
  "incendiary cloud": {
    resolution: "save",
    save: "dex",
    halfOnSave: true,
    damageType: "fire",
    area: true,
    areaFeet: 20,
    repeat: "free",
    note: "A creature entering the cloud or ending its turn there saves again: aoe_damage with the spell again, no slot. The cloud drifts 10 feet each turn.",
  },
  "blade barrier": {
    resolution: "save",
    save: "dex",
    halfOnSave: true,
    damageType: "slashing",
    area: true,
    areaFeet: 100,
    repeat: "free",
    note: "A creature entering the wall or starting its turn there saves again: aoe_damage with the spell again, no slot. The wall gives three-quarters cover and is difficult terrain.",
  },

  // ---- attack spells with no damage ----
  "ray of enfeeblement": {
    resolution: "attack",
    attack: "ranged",
    noDamage: true,
    note: "On a hit its Strength weapon attacks deal half damage; it makes a CON save at the end of each round to end it (the server holds both). pc_attack with the spell and no damage.",
  },

  // ---- buffs the prose reads as a save ----
  "gaseous form": {
    resolution: "buff",
    buff: { condition: "gaseous form", target: "ally", rounds: HOUR },
    note: "A misty cloud: resistance to nonmagical damage, advantage on STR, DEX and CON saves, a 10-foot fly speed; it cannot attack or cast spells (the server refuses both).",
  },
  "heroes' feast": {
    resolution: "buff",
    buff: { condition: "heroes' feast", target: "allies", rounds: DAY },
    targets: { count: 12 },
    maxHpDice: "2d10",
    note: "Up to twelve diners: immune to poison and to being frightened, advantage on WIS saves, and their hit point maximum and hit points rise by 2d10 for 24 hours (the server rolls it once for each).",
  },
  "dispel evil and good": {
    resolution: "buff",
    buff: { condition: "dispel evil and good", target: "self", rounds: MINUTE },
    note: "Celestials, elementals, fey, fiends and undead have disadvantage on attacks against the caster (the server applies it). Break Enchantment and Dismissal are narrated.",
  },

  // ---- restoration: what a cast ends ----
  "lesser restoration": {
    resolution: "buff",
    cures: { conditions: ["blinded", "deafened", "paralyzed", "poisoned", "disease", "madness"] },
    note: "Ends one of blinded, deafened, paralyzed or poisoned on the target, one disease, or a short- or long-term madness (name it in variant: disease, madness); with none held, nothing is cast.",
  },
  "greater restoration": {
    resolution: "buff",
    cures: { conditions: ["exhaustion", "charmed", "petrified", "cursed", "indefinite madness"] },
    note: "Ends one: a level of exhaustion, charmed, petrified, a curse, or an indefinite madness (name it in variant). Reduced ability scores and hit point maximums are narrated back.",
  },
  "remove curse": {
    resolution: "buff",
    cures: { conditions: ["cursed"], all: true },
    note: "Ends every curse on the target; a cursed magic item's attunement is broken (narrated).",
  },

  // ---- words of power and wards of the mind ----
  "power word kill": {
    resolution: "auto",
    noDamage: true,
    riders: { hpTiers: [{ atMost: 100, conditions: [], dies: true }] },
    note: "No save: a creature with 100 hit points or fewer dies; one with more is untouched.",
  },
  "mind blank": {
    resolution: "buff",
    buff: { condition: "mind blank", target: "ally", rounds: DAY },
    note: "Immune to psychic damage and to being charmed for 24 hours (the server refuses both); divination and mind reading are narrated.",
  },
  foresight: {
    resolution: "buff",
    buff: { condition: "foresight", target: "ally", rounds: 8 * HOUR },
    note: "Advantage on attack rolls, checks and saves, and attacks against it have disadvantage, for 8 hours (the server applies all of it).",
  },

  // ---- creatures, not damage ----
  "animate objects": {
    resolution: "summon",
    note: "Up to ten objects become creatures under the caster's command: bring them in with add_companion; their slams are their own attacks.",
  },

  // ---- healing that goes on ----
  regenerate: {
    resolution: "heal",
    dice: { base: "4d8+15", baseLevel: 7 },
    healNoModifier: true,
    regainEachTurn: 1,
    note: "The target regains 1 hit point at the start of each of its turns for an hour (the server adds it); a severed limb regrows in two minutes.",
  },
};
