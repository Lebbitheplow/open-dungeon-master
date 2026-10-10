// The SRD spells whose mechanics prose cannot state, or states in a way the
// parser reads wrong (src/lib/srd/spell-mechanics.ts layer 2). Keys are
// lowercased spell names; alias resolution happens in the caller via the
// content pack's alias list. Every row here is SRD 5.1 (2014) as printed.

import type { SpellMech } from "@/lib/srd/spell-mech-types";
import { SRD_EFFECT_ROWS } from "@/lib/srd/spell-mech-rows";
import { SRD_TAIL_ROWS } from "@/lib/srd/spell-mech-tail-rows";
import { SRD_LAST_ROWS } from "@/lib/srd/spell-mech-last-rows";

// A minute of combat, the standard buff duration.
const MINUTE = 10;
const TEN_MINUTES = 100;
const HOUR = 600;

// Spells that move or remake rather than harm, or whose effect is the
// table's to narrate. Their text mentions damage or a save only in passing.
const UTILITY: Record<string, SpellMech> = Object.fromEntries(
  [
    "dimension door",
    "teleport",
    "wish",
    "alter self",
    "meld into stone",
    "faithful hound",
    "forbiddance",
    "contact other plane",
    "light",
  ].map((name) => [name, { resolution: "utility" } as SpellMech]),
);

export const MECH_OVERRIDES: Record<string, SpellMech> = {
  ...UTILITY,
  // Attacks that deal no damage: what a hit does is a disease or a journey.
  contagion: {
    resolution: "attack",
    attack: "melee",
    noDamage: true,
    note: "On a hit the creature is afflicted with the disease the caster picks (afflict); it deals no damage of its own.",
  },
  "plane shift": {
    resolution: "attack",
    attack: "melee",
    noDamage: true,
    note: "On a hit the creature makes a Charisma save or is sent to the plane the caster names; it deals no damage.",
  },
  bless: {
    resolution: "buff",
    buff: { condition: "blessed", target: "allies", rounds: MINUTE },
    targets: { count: 3, perSlotLevel: 1 },
    note: "Up to three creatures, one more per slot level above 1st; concentration.",
  },
  bane: {
    resolution: "save",
    save: "cha",
    condition: { name: "baned", rounds: MINUTE },
    targets: { count: 3, perSlotLevel: 1 },
    noDamage: true,
    note: "Up to three targets, one more per slot level above 1st; concentration.",
  },
  "shield of faith": {
    resolution: "buff",
    buff: { condition: "shield of faith", target: "ally", rounds: TEN_MINUTES },
  },
  "mage armor": {
    resolution: "buff",
    buff: { condition: "mage armor", target: "ally", rounds: HOUR * 8 },
    note: "Ends early if the target dons armor.",
  },
  haste: {
    resolution: "buff",
    buff: { condition: "hasted", target: "ally", rounds: MINUTE },
    note: "When the spell ends the target cannot move or act until after its next turn; the server applies the lethargy.",
  },
  polymorph: {
    resolution: "buff",
    buff: { condition: "polymorphed", target: "ally", rounds: HOUR },
    note: "Pass variant with the beast form (e.g. 'giant ape', 'tyrannosaurus rex'); the server applies the form's full stat block. The beast's CR must not exceed the target's level. Concentration; ends early at 0 beast HP.",
  },
  slow: {
    resolution: "save",
    save: "wis",
    condition: { name: "slowed", saveEnds: true },
    targets: { count: 6 },
    area: true,
    areaFeet: 40,
    noDamage: true,
    note: "Up to six creatures in a 40-foot cube; each saves again at the end of its turns. Concentration.",
  },
  "hold person": {
    resolution: "save",
    save: "wis",
    condition: { name: "paralyzed", saveEnds: true },
    targets: { count: 1, perSlotLevel: 1 },
    targetTypes: ["humanoid"],
    noDamage: true,
  },
  "hold monster": {
    resolution: "save",
    save: "wis",
    condition: { name: "paralyzed", saveEnds: true },
    targets: { count: 1, perSlotLevel: 1 },
    immuneTypes: ["undead"],
    noDamage: true,
  },
  "dominate person": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: MINUTE, saveOnDamage: "normal" },
    targetTypes: ["humanoid"],
    noDamage: true,
    note: "The caster commands the charmed creature; it saves again each time it takes damage (the server rolls it). Concentration.",
  },
  "dominate beast": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: MINUTE, saveOnDamage: "normal" },
    targetTypes: ["beast"],
    noDamage: true,
    note: "The caster commands the charmed beast; it saves again each time it takes damage (the server rolls it). Concentration.",
  },
  "dominate monster": {
    resolution: "save",
    save: "wis",
    condition: { name: "charmed", rounds: HOUR, saveOnDamage: "normal" },
    noDamage: true,
    note: "The caster commands the charmed creature; it saves again each time it takes damage (the server rolls it). Concentration.",
  },
  sleep: {
    resolution: "auto",
    area: true,
    areaFeet: 20,
    hitPointPool: {
      dice: "5d8",
      perSlotLevel: "2d8",
      condition: "unconscious",
      rounds: MINUTE,
      immuneTypes: ["undead"],
      immuneCondition: "charmed",
      skipConditions: ["unconscious"],
      endsOnDamage: true,
    },
    note: "No saving throw: one roll of the pool for the casting, spent from the lowest hit points up. Undead and creatures immune to being charmed are not affected. A sleeper wakes when it takes damage (the server ends it) or is shaken awake.",
  },
  "color spray": {
    resolution: "auto",
    area: true,
    areaFeet: 15,
    hitPointPool: {
      dice: "6d10",
      perSlotLevel: "2d10",
      condition: "blinded",
      rounds: 1,
      skipConditions: ["unconscious", "blinded"],
    },
    note: "No saving throw: one roll of the pool for the casting, spent from the lowest hit points up; blinded until the end of the caster's next turn.",
  },
  "eldritch blast": {
    resolution: "attack",
    attack: "ranged",
    damageType: "force",
    dice: { base: "1d10", baseLevel: 0 },
    attacks: { count: 1, byCasterLevel: true },
    note: "One pc_attack call for each beam: two beams at 5th level, three at 11th, four at 17th, all from the one action. Each beam is 1d10 force.",
  },
  "scorching ray": {
    resolution: "attack",
    attack: "ranged",
    damageType: "fire",
    attacks: { count: 3, perSlotLevel: 1 },
    note: "One pc_attack call for each ray: three rays, one more per slot level above 2nd, all from the one slot.",
  },
  "wall of fire": {
    resolution: "save",
    save: "dex",
    halfOnSave: true,
    damageType: "fire",
    dice: { base: "5d8", perSlotLevel: "1d8", baseLevel: 4 },
    area: true,
    repeat: "free",
    note: "Concentration. A creature that ends its turn within 10 feet of the hot side, or enters the wall, takes the same damage again: aoe_damage with the spell again spends no slot.",
  },
  barkskin: {
    resolution: "buff",
    buff: { condition: "barkskin", target: "ally", rounds: HOUR },
  },
  blur: {
    resolution: "buff",
    buff: { condition: "blurred", target: "self", rounds: MINUTE },
  },
  stoneskin: {
    resolution: "buff",
    buff: { condition: "stoneskin", target: "ally", rounds: HOUR },
  },
  longstrider: {
    resolution: "buff",
    buff: { condition: "longstrider", target: "ally", rounds: HOUR },
  },
  guidance: {
    resolution: "buff",
    buff: { condition: "guidance", target: "ally", rounds: MINUTE },
  },
  resistance: {
    resolution: "buff",
    buff: { condition: "resistance (spell)", target: "ally", rounds: MINUTE },
  },
  "true strike": {
    resolution: "buff",
    buff: { condition: "true strike", target: "self", rounds: 1 },
  },
  "divine favor": {
    resolution: "buff",
    buff: { condition: "divine favor", target: "self", rounds: MINUTE },
  },
  "hunter's mark": {
    resolution: "buff",
    buff: { condition: "hunter's mark", target: "self", rounds: HOUR },
    note: "Name the quarry in the condition, e.g. \"hunter's mark (the ogre)\".",
  },
  hex: {
    resolution: "buff",
    buff: { condition: "hexing", target: "self", rounds: HOUR },
    note: "Name the target in the condition; it also has disadvantage on checks with one chosen ability.",
  },
  heroism: {
    resolution: "buff",
    buff: { condition: "heroism", target: "ally", rounds: MINUTE, tempHpEachTurn: true },
    note: "The server grants the temporary hit points at the start of each of the target's turns.",
  },
  "enlarge/reduce": {
    resolution: "buff",
    buff: {
      condition: "enlarged",
      target: "ally",
      rounds: MINUTE,
      variants: ["enlarged", "reduced"],
    },
  },
  invisibility: {
    resolution: "buff",
    buff: { condition: "invisible", target: "ally", rounds: HOUR },
    note: "Ends when the target attacks or casts a spell.",
  },
  "greater invisibility": {
    resolution: "buff",
    buff: { condition: "invisible", target: "ally", rounds: MINUTE },
  },
  "mirror image": {
    resolution: "buff",
    buff: { condition: "mirror image", target: "self", rounds: MINUTE },
  },
  "spiritual weapon": {
    resolution: "buff",
    buff: { condition: "spiritual weapon", target: "self", rounds: MINUTE },
    note: "Attack with it via pc_attack, weapon 'Spiritual Weapon' (a bonus action).",
  },
  "faerie fire": {
    resolution: "save",
    save: "dex",
    condition: { name: "faerie fire", rounds: MINUTE },
    area: true,
    areaFeet: 20,
    noDamage: true,
    note: "Each creature in a 20-foot cube saves; concentration.",
  },
  "magic missile": {
    resolution: "auto",
    damageType: "force",
    darts: { count: 3, perSlotLevel: 1, each: "1d4+1" },
    note: "Three darts, 1d4+1 each, +1 dart per slot level above 1st; they always hit. Name darts on cast_at_enemy to split them: the next target the same turn takes the darts left, with no second slot.",
  },
  sanctuary: {
    resolution: "buff",
    buff: { condition: "sanctuary", target: "ally", rounds: MINUTE },
    note: "Attackers must first pass a WIS save or pick a new target; ends if the warded creature attacks.",
  },
  "expeditious retreat": {
    resolution: "buff",
    buff: { condition: "expeditious retreat", target: "self", rounds: TEN_MINUTES },
  },
  fly: {
    resolution: "buff",
    buff: { condition: "flying", target: "ally", rounds: TEN_MINUTES },
    targets: { count: 1, perSlotLevel: 1 },
  },
  "protection from poison": {
    resolution: "buff",
    buff: { condition: "protected from poison", target: "ally", rounds: HOUR },
  },
  "false life": {
    resolution: "buff",
    buff: {
      condition: "false life",
      target: "self",
      rounds: HOUR,
      tempHp: { base: 4, perSlotLevel: 5, dice: "1d4" },
    },
  },
  ...SRD_EFFECT_ROWS,
  ...SRD_TAIL_ROWS,
  ...SRD_LAST_ROWS,
};
