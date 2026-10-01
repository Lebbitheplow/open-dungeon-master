// SRD 5.1 stat blocks for the creatures spells make: Conjure Animals' beasts
// (the beast-form table, src/lib/srd/beast-forms.ts, plus the few below),
// Conjure Minor Elementals' and Conjure Elemental's elementals, Conjure
// Woodland Beings' and Conjure Fey's fey, Conjure Celestial's celestials,
// Animate Dead's and Create Undead's undead, Giant Insect's insects, Find
// Steed's and Phantom Steed's mounts, Animate Objects' objects and the
// Unseen Servant. Pure data like beast-forms.ts, so a server with no content
// pack summons the same creature a server with one does
// (scripts/test-enforce-summons.mjs compares each block to the pack's when
// one is there).
//
// Data derived from the SRD 5.1, (c) Wizards of the Coast LLC, CC-BY-4.0.
// See docs/LICENSES.md.

import { BEAST_FORMS, type BeastForm } from "@/lib/srd/beast-forms";

export type SummonFormAttack = {
  name: string;
  toHit: number;
  damage: string;
  type: string;
  riders?: Array<{ dice: string; type: string }>;
  reach?: number;
  range?: number;
  longRange?: number;
};

export type SummonForm = {
  name: string;
  type: string;
  size: "Tiny" | "Small" | "Medium" | "Large" | "Huge";
  cr: number;
  ac: number;
  hp: number;
  speed: number;
  fly?: number;
  swim?: number;
  climb?: number;
  burrow?: number;
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  // Saving throws the block lists as proficient.
  saves?: Array<"str" | "dex" | "con" | "int" | "wis" | "cha">;
  attacks: SummonFormAttack[];
  attacksPerTurn?: number;
  resist?: string;
  immune?: string;
  vulnerable?: string;
  conditionImmune?: string;
  traits?: string;
};

const NONMAGICAL = "bludgeoning, piercing, and slashing from nonmagical attacks";
const ELEMENTAL_BODY = "exhaustion, grappled, paralyzed, petrified, poisoned, prone, restrained, unconscious";
const score = (str: number, dex: number, con: number, int: number, wis: number, cha: number) => ({ str, dex, con, int, wis, cha });

export const SUMMON_FORMS: SummonForm[] = [
  // ---- undead (Animate Dead, Create Undead) ----
  {
    name: "Skeleton", type: "undead", size: "Medium", cr: 0.25, ac: 13, hp: 13, speed: 30,
    abilities: score(10, 14, 15, 6, 8, 5),
    attacks: [
      { name: "Shortsword", toHit: 4, damage: "1d6+2", type: "piercing" },
      { name: "Shortbow", toHit: 4, damage: "1d6+2", type: "piercing", range: 80, longRange: 320 },
    ],
    vulnerable: "bludgeoning", immune: "poison", conditionImmune: "exhaustion, poisoned",
    traits: "Darkvision 60 ft.",
  },
  {
    name: "Zombie", type: "undead", size: "Medium", cr: 0.25, ac: 8, hp: 22, speed: 20,
    abilities: score(13, 6, 16, 3, 6, 5), saves: ["wis"],
    attacks: [{ name: "Slam", toHit: 3, damage: "1d6+1", type: "bludgeoning" }],
    immune: "poison", conditionImmune: "poisoned",
    traits: "Undead Fortitude: damage that drops it to 0 forces a CON save (DC 5 + the damage) to stay at 1, unless radiant or a critical hit. Darkvision 60 ft.",
  },
  {
    name: "Ghoul", type: "undead", size: "Medium", cr: 1, ac: 12, hp: 22, speed: 30,
    abilities: score(13, 15, 10, 7, 10, 6),
    attacks: [
      { name: "Claws", toHit: 4, damage: "2d4+2", type: "slashing" },
      { name: "Bite", toHit: 2, damage: "2d6+2", type: "piercing" },
    ],
    immune: "poison", conditionImmune: "charmed, exhaustion, poisoned",
    traits: "Claws paralyze a creature other than an elf or undead for 1 minute on a failed DC 10 CON save (repeat at the end of each of its turns). Darkvision 60 ft.",
  },
  {
    name: "Ghast", type: "undead", size: "Medium", cr: 2, ac: 13, hp: 36, speed: 30,
    abilities: score(16, 17, 10, 11, 10, 8),
    attacks: [
      { name: "Claws", toHit: 5, damage: "2d6+3", type: "slashing" },
      { name: "Bite", toHit: 3, damage: "2d8+3", type: "piercing" },
    ],
    resist: "necrotic", immune: "poison", conditionImmune: "charmed, exhaustion, poisoned",
    traits: "Stench: a creature starting its turn within 5 ft. saves CON DC 10 or is poisoned until its next turn. Claws paralyze (DC 10 CON) a creature other than undead. Turning Defiance.",
  },
  {
    name: "Wight", type: "undead", size: "Medium", cr: 3, ac: 14, hp: 45, speed: 30,
    abilities: score(15, 14, 16, 10, 13, 15),
    attacks: [
      { name: "Longsword", toHit: 4, damage: "1d8+2", type: "slashing" },
      { name: "Life Drain", toHit: 4, damage: "1d6+2", type: "necrotic" },
      { name: "Longbow", toHit: 4, damage: "1d8+2", type: "piercing", range: 150, longRange: 600 },
    ],
    attacksPerTurn: 2,
    resist: `necrotic; ${NONMAGICAL} that aren't silvered`, immune: "poison", conditionImmune: "exhaustion, poisoned",
    traits: "Multiattack: two longsword or two longbow attacks; Life Drain may replace one longsword attack (the target's hit point maximum drops by the damage, CON DC 13). Sunlight Sensitivity. Darkvision 60 ft.",
  },
  {
    name: "Mummy", type: "undead", size: "Medium", cr: 3, ac: 11, hp: 58, speed: 20,
    abilities: score(16, 8, 15, 6, 10, 12), saves: ["wis"],
    attacks: [{ name: "Rotting Fist", toHit: 5, damage: "2d6+3", type: "bludgeoning", riders: [{ dice: "3d6", type: "necrotic" }] }],
    vulnerable: "fire", resist: NONMAGICAL, immune: "necrotic, poison",
    conditionImmune: "charmed, exhaustion, frightened, paralyzed, poisoned",
    traits: "Multiattack: Dreadful Glare (WIS DC 11 or frightened) and one rotting fist; the fist curses with mummy rot (CON DC 12). Darkvision 60 ft.",
  },

  // ---- elementals (Conjure Minor Elementals, Conjure Elemental) ----
  {
    name: "Air Elemental", type: "elemental", size: "Large", cr: 5, ac: 15, hp: 90, speed: 0, fly: 90,
    abilities: score(14, 20, 14, 6, 10, 6),
    attacks: [{ name: "Slam", toHit: 8, damage: "2d8+5", type: "bludgeoning" }],
    attacksPerTurn: 2,
    resist: `lightning, thunder; ${NONMAGICAL}`, immune: "poison", conditionImmune: ELEMENTAL_BODY,
    traits: "Multiattack: two slams. Whirlwind (Recharge 4-6): STR DC 13, 3d8+2 bludgeoning and flung 20 ft. prone. Air Form. Darkvision 60 ft.",
  },
  {
    name: "Earth Elemental", type: "elemental", size: "Large", cr: 5, ac: 17, hp: 126, speed: 30, burrow: 30,
    abilities: score(20, 8, 20, 5, 10, 5),
    attacks: [{ name: "Slam", toHit: 8, damage: "2d8+5", type: "bludgeoning", reach: 10 }],
    attacksPerTurn: 2,
    vulnerable: "thunder", resist: NONMAGICAL, immune: "poison",
    conditionImmune: "exhaustion, paralyzed, petrified, poisoned, unconscious",
    traits: "Multiattack: two slams. Earth Glide. Siege Monster. Darkvision 60 ft., tremorsense 60 ft.",
  },
  {
    name: "Fire Elemental", type: "elemental", size: "Large", cr: 5, ac: 13, hp: 102, speed: 50,
    abilities: score(10, 17, 16, 6, 10, 7),
    attacks: [{ name: "Touch", toHit: 6, damage: "2d6+3", type: "fire" }],
    attacksPerTurn: 2,
    resist: NONMAGICAL, immune: "fire, poison", conditionImmune: ELEMENTAL_BODY,
    traits: "Multiattack: two touches; a touched creature or object ignites (1d10 fire at the start of each of its turns until doused). Fire Form, Illumination, Water Susceptibility. Darkvision 60 ft.",
  },
  {
    name: "Water Elemental", type: "elemental", size: "Large", cr: 5, ac: 14, hp: 114, speed: 30, swim: 90,
    abilities: score(18, 14, 18, 5, 10, 8),
    attacks: [{ name: "Slam", toHit: 7, damage: "2d8+4", type: "bludgeoning" }],
    attacksPerTurn: 2,
    resist: `acid; ${NONMAGICAL}`, immune: "poison", conditionImmune: ELEMENTAL_BODY,
    traits: "Multiattack: two slams. Whelm (Recharge 4-6): STR DC 15, 2d8+4 bludgeoning and grappled. Water Form, Freeze. Darkvision 60 ft.",
  },
  {
    name: "Dust Mephit", type: "elemental", size: "Small", cr: 0.5, ac: 12, hp: 17, speed: 30, fly: 30,
    abilities: score(5, 14, 10, 9, 11, 10),
    attacks: [{ name: "Claws", toHit: 4, damage: "1d4+2", type: "slashing" }],
    vulnerable: "fire", immune: "poison", conditionImmune: "poisoned",
    traits: "Blinding Breath (Recharge 6): 15-ft cone, DEX DC 10 or blinded for 1 minute. Death Burst. Sleep once a day. Darkvision 60 ft.",
  },
  {
    name: "Ice Mephit", type: "elemental", size: "Small", cr: 0.5, ac: 11, hp: 21, speed: 30, fly: 30,
    abilities: score(7, 13, 10, 9, 11, 12),
    attacks: [{ name: "Claws", toHit: 3, damage: "1d4+1", type: "slashing", riders: [{ dice: "1d4", type: "cold" }] }],
    vulnerable: "bludgeoning, fire", immune: "cold, poison", conditionImmune: "poisoned",
    traits: "Frost Breath (Recharge 6): 15-ft cone, DEX DC 10, 2d4 cold, half on a success. Death Burst. Fog Cloud once a day. Darkvision 60 ft.",
  },
  {
    name: "Magma Mephit", type: "elemental", size: "Small", cr: 0.5, ac: 11, hp: 22, speed: 30, fly: 30,
    abilities: score(8, 12, 12, 7, 10, 10),
    attacks: [{ name: "Claws", toHit: 3, damage: "1d4+1", type: "slashing", riders: [{ dice: "1d4", type: "fire" }] }],
    vulnerable: "cold", immune: "fire, poison", conditionImmune: "poisoned",
    traits: "Fire Breath (Recharge 6): 15-ft cone, DEX DC 11, 2d6 fire, half on a success. Death Burst. Heat Metal once a day. Darkvision 60 ft.",
  },
  {
    name: "Mud Mephit", type: "elemental", size: "Small", cr: 0.25, ac: 11, hp: 27, speed: 20, fly: 20, swim: 20,
    abilities: score(8, 12, 12, 9, 11, 7),
    attacks: [{ name: "Fists", toHit: 3, damage: "1d6+1", type: "bludgeoning" }],
    immune: "poison", conditionImmune: "poisoned",
    traits: "Mud Breath (Recharge 6): DEX DC 11 or restrained for 1 minute. Death Burst. Darkvision 60 ft.",
  },
  {
    name: "Smoke Mephit", type: "elemental", size: "Small", cr: 0.25, ac: 12, hp: 22, speed: 30, fly: 30,
    abilities: score(6, 14, 12, 10, 10, 11),
    attacks: [{ name: "Claws", toHit: 4, damage: "1d4+2", type: "slashing" }],
    immune: "fire, poison", conditionImmune: "poisoned",
    traits: "Cinder Breath (Recharge 6): 15-ft cone, DEX DC 10 or blinded until the end of the mephit's next turn. Death Burst. Darkvision 60 ft.",
  },
  {
    name: "Steam Mephit", type: "elemental", size: "Small", cr: 0.25, ac: 10, hp: 21, speed: 30, fly: 30,
    abilities: score(5, 11, 10, 11, 10, 12),
    attacks: [{ name: "Claws", toHit: 2, damage: "1d4", type: "slashing", riders: [{ dice: "1d4", type: "fire" }] }],
    immune: "fire, poison", conditionImmune: "poisoned",
    traits: "Steam Breath (Recharge 6): 15-ft cone, DEX DC 10, 1d8 fire, half on a success. Death Burst. Blur once a day. Darkvision 60 ft.",
  },
  {
    name: "Magmin", type: "elemental", size: "Small", cr: 0.5, ac: 14, hp: 9, speed: 30,
    abilities: score(7, 15, 12, 8, 11, 10),
    attacks: [{ name: "Touch", toHit: 4, damage: "2d6", type: "fire" }],
    resist: NONMAGICAL, immune: "fire",
    traits: "Death Burst: DEX DC 11, 2d6 fire, half on a success. Ignited Illumination. Darkvision 60 ft.",
  },
  {
    name: "Gargoyle", type: "elemental", size: "Medium", cr: 2, ac: 15, hp: 52, speed: 30, fly: 60,
    abilities: score(15, 11, 16, 6, 11, 7),
    attacks: [
      { name: "Bite", toHit: 4, damage: "1d6+2", type: "piercing" },
      { name: "Claws", toHit: 4, damage: "1d6+2", type: "slashing" },
    ],
    attacksPerTurn: 2,
    resist: `${NONMAGICAL} that aren't adamantine`, immune: "poison", conditionImmune: "exhaustion, petrified, poisoned",
    traits: "Multiattack: one bite and one claws. False Appearance. Darkvision 60 ft.",
  },
  {
    name: "Azer", type: "elemental", size: "Medium", cr: 2, ac: 17, hp: 39, speed: 30,
    abilities: score(17, 12, 15, 12, 13, 10), saves: ["con"],
    attacks: [{ name: "Warhammer", toHit: 5, damage: "1d8+3", type: "bludgeoning", riders: [{ dice: "1d6", type: "fire" }] }],
    immune: "fire, poison", conditionImmune: "poisoned",
    traits: "Heated Body: a creature touching it or hitting it in melee within 5 ft. takes 1d10 fire. Illumination.",
  },
  {
    name: "Xorn", type: "elemental", size: "Medium", cr: 5, ac: 19, hp: 73, speed: 20, burrow: 20,
    abilities: score(17, 10, 22, 11, 10, 11),
    attacks: [
      { name: "Claw", toHit: 6, damage: "1d6+3", type: "slashing" },
      { name: "Bite", toHit: 6, damage: "3d6+3", type: "piercing" },
    ],
    attacksPerTurn: 4,
    resist: "piercing and slashing from nonmagical attacks that aren't adamantine",
    traits: "Multiattack: three claws and one bite. Earth Glide. Stone Camouflage. Darkvision 60 ft., tremorsense 60 ft.",
  },
  {
    name: "Salamander", type: "elemental", size: "Large", cr: 5, ac: 15, hp: 90, speed: 30,
    abilities: score(18, 14, 15, 11, 10, 12),
    attacks: [
      { name: "Spear", toHit: 7, damage: "2d6+4", type: "piercing", riders: [{ dice: "1d6", type: "fire" }] },
      { name: "Tail", toHit: 7, damage: "2d6+4", type: "bludgeoning", riders: [{ dice: "2d6", type: "fire" }], reach: 10 },
    ],
    attacksPerTurn: 2,
    vulnerable: "cold", resist: NONMAGICAL, immune: "fire",
    traits: "Multiattack: one spear and one tail; the tail grapples (escape DC 14) and burns 2d6 fire at the start of each of the target's turns. Heated Body. Darkvision 60 ft.",
  },
  {
    name: "Invisible Stalker", type: "elemental", size: "Medium", cr: 6, ac: 14, hp: 104, speed: 50, fly: 50,
    abilities: score(16, 19, 14, 10, 15, 11),
    attacks: [{ name: "Slam", toHit: 6, damage: "2d6+3", type: "bludgeoning" }],
    attacksPerTurn: 2,
    resist: NONMAGICAL, immune: "poison", conditionImmune: ELEMENTAL_BODY,
    traits: "Multiattack: two slams. Invisibility: it is invisible. Faultless Tracker. Darkvision 60 ft.",
  },

  // ---- fey (Conjure Woodland Beings, Conjure Fey) ----
  {
    name: "Sprite", type: "fey", size: "Tiny", cr: 0.25, ac: 15, hp: 2, speed: 10, fly: 40,
    abilities: score(3, 18, 10, 14, 13, 11),
    attacks: [
      { name: "Shortbow", toHit: 6, damage: "1", type: "piercing", range: 40, longRange: 160 },
      { name: "Longsword", toHit: 2, damage: "1", type: "slashing" },
    ],
    traits: "Shortbow poison: CON DC 10 or poisoned for 1 minute (unconscious while poisoned if the save fails by 5 or more). Heart Sight. Invisibility.",
  },
  {
    name: "Blink Dog", type: "fey", size: "Medium", cr: 0.25, ac: 13, hp: 22, speed: 40,
    abilities: score(12, 17, 12, 10, 13, 11),
    attacks: [{ name: "Bite", toHit: 3, damage: "1d6+1", type: "piercing" }],
    traits: "Teleport (Recharge 4-6): up to 40 ft. Keen Hearing and Smell.",
  },
  {
    name: "Satyr", type: "fey", size: "Medium", cr: 0.5, ac: 14, hp: 31, speed: 40,
    abilities: score(12, 16, 11, 12, 10, 14),
    attacks: [
      { name: "Shortsword", toHit: 5, damage: "1d6+3", type: "piercing" },
      { name: "Ram", toHit: 3, damage: "2d4+1", type: "bludgeoning" },
      { name: "Shortbow", toHit: 5, damage: "1d6+3", type: "piercing", range: 80, longRange: 320 },
    ],
    traits: "Magic Resistance: advantage on saves against spells and magical effects.",
  },
  {
    name: "Dryad", type: "fey", size: "Medium", cr: 1, ac: 11, hp: 22, speed: 30,
    abilities: score(10, 12, 11, 14, 15, 18),
    attacks: [{ name: "Club", toHit: 2, damage: "1d4", type: "bludgeoning" }],
    traits: "Magic Resistance. Fey Charm (WIS DC 14). Tree Stride. Innate Spellcasting: druidcraft, entangle, goodberry, barkskin, pass without trace, shillelagh. Darkvision 60 ft.",
  },

  // ---- celestials (Conjure Celestial) ----
  {
    name: "Pegasus", type: "celestial", size: "Large", cr: 2, ac: 12, hp: 59, speed: 60, fly: 90,
    abilities: score(18, 15, 16, 10, 15, 13), saves: ["dex", "wis", "cha"],
    attacks: [{ name: "Hooves", toHit: 6, damage: "2d6+4", type: "bludgeoning" }],
  },
  {
    name: "Couatl", type: "celestial", size: "Medium", cr: 4, ac: 19, hp: 97, speed: 30, fly: 90,
    abilities: score(16, 20, 17, 18, 20, 18), saves: ["con", "wis", "cha"],
    attacks: [
      { name: "Bite", toHit: 8, damage: "1d6+5", type: "piercing" },
      { name: "Constrict", toHit: 6, damage: "2d6+3", type: "bludgeoning", reach: 10 },
    ],
    resist: "radiant", immune: `psychic; ${NONMAGICAL}`,
    traits: "Bite poison: CON DC 13 or poisoned 24 hours (unconscious while poisoned). Constrict grapples (escape DC 15) and restrains. Magic Weapons. Shielded Mind. Truesight 120 ft.",
  },
  {
    name: "Unicorn", type: "celestial", size: "Large", cr: 5, ac: 12, hp: 67, speed: 50,
    abilities: score(18, 14, 15, 11, 17, 16),
    attacks: [
      { name: "Horn", toHit: 7, damage: "1d8+4", type: "piercing" },
      { name: "Hooves", toHit: 7, damage: "2d6+4", type: "bludgeoning" },
    ],
    attacksPerTurn: 2,
    immune: "poison", conditionImmune: "charmed, paralyzed, poisoned",
    traits: "Multiattack: one hooves and one horn. Charge. Magic Resistance. Magic Weapons. Healing Touch (3/day, 2d8+2). Teleport (1/day).",
  },

  // ---- Giant Insect ----
  {
    name: "Giant Centipede", type: "beast", size: "Small", cr: 0.25, ac: 13, hp: 4, speed: 30, climb: 30,
    abilities: score(5, 14, 12, 1, 7, 3),
    attacks: [{ name: "Bite", toHit: 4, damage: "1d4+2", type: "piercing" }],
    traits: "Bite poison: CON DC 11 or 3d6 poison; a creature dropped to 0 by it is stable but poisoned and paralyzed for 1 hour. Blindsight 30 ft.",
  },
  {
    name: "Giant Wasp", type: "beast", size: "Medium", cr: 0.5, ac: 12, hp: 13, speed: 10, fly: 50,
    abilities: score(10, 14, 10, 1, 10, 3),
    attacks: [{ name: "Sting", toHit: 4, damage: "1d6+2", type: "piercing" }],
    traits: "Sting poison: CON DC 11, 3d6 poison, half on a success.",
  },
  {
    name: "Giant Scorpion", type: "beast", size: "Large", cr: 3, ac: 15, hp: 52, speed: 40,
    abilities: score(15, 13, 15, 1, 9, 3),
    attacks: [
      { name: "Claw", toHit: 4, damage: "1d8+2", type: "bludgeoning" },
      { name: "Sting", toHit: 4, damage: "1d10+2", type: "piercing" },
    ],
    attacksPerTurn: 3,
    traits: "Multiattack: two claws and one sting. A claw grapples (escape DC 12). Sting poison: CON DC 12, 4d10 poison, half on a success. Blindsight 60 ft.",
  },

  // ---- steeds (Find Steed, Phantom Steed) ----
  {
    name: "Warhorse", type: "beast", size: "Large", cr: 0.5, ac: 11, hp: 19, speed: 60,
    abilities: score(18, 12, 13, 2, 12, 7),
    attacks: [{ name: "Hooves", toHit: 6, damage: "2d6+4", type: "bludgeoning" }],
    traits: "Trampling Charge: 20 ft. straight then a hooves hit: STR DC 14 or prone, and a bonus-action hooves attack against it.",
  },
  {
    name: "Riding Horse", type: "beast", size: "Large", cr: 0.25, ac: 10, hp: 13, speed: 60,
    abilities: score(16, 10, 12, 2, 11, 7),
    attacks: [{ name: "Hooves", toHit: 5, damage: "2d4+3", type: "bludgeoning" }],
  },
  {
    name: "Pony", type: "beast", size: "Medium", cr: 0.125, ac: 10, hp: 11, speed: 40,
    abilities: score(15, 10, 13, 2, 11, 7),
    attacks: [{ name: "Hooves", toHit: 4, damage: "2d4+2", type: "bludgeoning" }],
  },
  {
    name: "Camel", type: "beast", size: "Large", cr: 0.125, ac: 9, hp: 15, speed: 50,
    abilities: score(16, 8, 14, 2, 8, 5),
    attacks: [{ name: "Bite", toHit: 5, damage: "1d4", type: "bludgeoning" }],
  },
  {
    name: "Mastiff", type: "beast", size: "Medium", cr: 0.125, ac: 12, hp: 5, speed: 40,
    abilities: score(13, 14, 12, 3, 12, 7),
    attacks: [{ name: "Bite", toHit: 3, damage: "1d6+1", type: "piercing" }],
    traits: "A bitten creature saves STR DC 11 or falls prone. Keen Hearing and Smell.",
  },

  // ---- Animate Objects (the spell's own table) ----
  ...(
    [
      ["Tiny", 20, 18, 4, 18, 8, "1d4+4"],
      ["Small", 25, 16, 6, 14, 6, "1d8+2"],
      ["Medium", 40, 13, 10, 12, 5, "2d6+1"],
      ["Large", 50, 10, 14, 10, 6, "2d10+2"],
      ["Huge", 80, 10, 18, 6, 8, "2d12+4"],
    ] as const
  ).map(([size, hp, ac, str, dex, toHit, damage]): SummonForm => ({
    name: `Animated Object (${size})`, type: "construct", size, cr: 0, ac, hp, speed: 30,
    abilities: score(str, dex, 10, 3, 3, 1),
    attacks: [{ name: "Slam", toHit, damage, type: "bludgeoning" }],
    traits: "Blindsight 30 ft. (blind beyond). An object with no legs flies 30 ft. and may hover; one with legs climbs 30 ft. At 0 hit points it is an object again.",
  })),

  // ---- Arcane Hand (its hit points and fist are the caster's, set at the casting) ----
  {
    name: "Arcane Hand", type: "construct", size: "Large", cr: 0, ac: 20, hp: 1, speed: 60,
    abilities: score(26, 10, 10, 10, 10, 10),
    attacks: [{ name: "Clenched Fist", toHit: 0, damage: "4d8", type: "force" }],
    traits: "A hand of shimmering force that moves 60 ft. on each command. Grasping Hand grapples with its Strength 26 and crushes a creature it holds for 2d6 + the caster's spellcasting modifier bludgeoning; Forceful Hand shoves (a contest with its Strength); Interposing Hand gives half cover.",
  },

  // ---- Faithful Hound (its bite is the caster's, set at the casting) ----
  {
    name: "Faithful Hound", type: "construct", size: "Medium", cr: 0, ac: 10, hp: 1, speed: 0,
    abilities: score(10, 10, 10, 10, 10, 10),
    attacks: [{ name: "Bite", toHit: 0, damage: "4d8", type: "piercing" }],
    immune: "acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder",
    conditionImmune: "blinded, charmed, deafened, exhaustion, frightened, grappled, incapacitated, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious",
    traits: "A phantom watchdog, invisible to all but its caster, that cannot be harmed and stays where it was conjured. It barks when a creature it does not know comes within 30 ft. and bites one hostile creature within 5 ft. at the start of its caster's turns.",
  },

  // ---- Unseen Servant ----
  {
    name: "Unseen Servant", type: "construct", size: "Medium", cr: 0, ac: 10, hp: 1, speed: 15,
    abilities: score(2, 10, 10, 1, 1, 1),
    attacks: [],
    traits: "An invisible, mindless force: it cannot attack and does simple tasks at the caster's command (a bonus action).",
  },
];

// A beast-form row read as a summon form (Conjure Animals, Conjure Fey).
function fromBeast(beast: BeastForm): SummonForm {
  return {
    name: beast.name,
    type: "beast",
    size: beast.size,
    cr: beast.cr,
    ac: beast.ac,
    hp: beast.hp,
    speed: beast.speed,
    abilities: beast.abilities,
    attacks: beast.attacks.map((attack) => ({ ...attack })),
    attacksPerTurn: beast.attacksPerTurn,
    traits: beast.traits,
  };
}

const normalize = (term: string) => term.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const ALL: SummonForm[] = [
  ...SUMMON_FORMS,
  ...BEAST_FORMS.filter((beast) => !SUMMON_FORMS.some((form) => form.name === beast.name)).map(fromBeast),
];

// The stat block a caller names: exact first, then the longest name inside
// the request ("a big fire elemental" -> Fire Elemental, "spider" -> Giant
// Spider). Null when the table does not know it.
export function findSummonForm(term: string): SummonForm | null {
  const wanted = normalize(term);
  if (!wanted) {
    return null;
  }
  const exact = ALL.find((form) => normalize(form.name) === wanted);
  if (exact) {
    return exact;
  }
  const candidates = ALL.filter((form) => {
    const name = normalize(form.name);
    return wanted.includes(name) || name.includes(wanted) || name.split(" ").pop() === wanted;
  });
  candidates.sort((a, b) => b.name.length - a.name.length);
  return candidates[0] ?? null;
}

export function summonFormNames(): string[] {
  return ALL.map((form) => form.name);
}
