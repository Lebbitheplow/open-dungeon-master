// Content-pack monster rows that disagree with the SRD 5.1 stat block they
// copy, corrected when the row is read. The pack itself (data/content/
// open5e.sqlite) is left as imported: a reimport would bring the error back,
// so the correction lives here, keyed by the row's document and slug, and
// only the fields named are replaced. `actions` rewrites an action's text
// by its name, and `special_abilities` a trait's: a Multiattack that names
// an attack by a short form of its name ("its stinger" for Tail Stinger),
// since the routine reads attacks by their whole name
// (src/lib/bestiary/multiattack-text.ts), an attack line whose words are
// misprinted ("it:" for "Hit:", "escaped DC" for "escape DC", "reach 5.
// ft."), and Tome of Beasts 3's spell lists, printed with no commas between
// the spells ("At will: minor illusion silent image"), which no reader can
// split. `action_fields` replaces the numbers stored beside an action's line
// (its damage_bonus), where the line is right and the field is not.
// `legendary_desc` and `legendary_actions` replace the row's own, for
// legendary actions printed run together into one entry or filed under the
// description.
//
// The SRD rows' corrections are the creature table's too: scripts/
// generate-srd-creatures.mjs reads each wotc-srd row through
// correctedMonsterData, so a basilisk fought and a basilisk shaped into
// share one list, and test-enforce-srd-bestiary.mjs holds both to the SRD
// 5.1 text.
type ActionFields = Partial<{ attack_bonus: number; damage_dice: string; damage_bonus: number }>;

type Correction = Partial<{
  armor_class: number;
  hit_points: number;
  hit_dice: string;
  cr: number;
  challenge_rating: string;
  strength_save: number;
  dexterity_save: number;
  constitution_save: number;
  intelligence_save: number;
  wisdom_save: number;
  charisma_save: number;
  speed: Record<string, number>;
  senses: string;
  skills: Record<string, number>;
  damage_immunities: string;
  damage_resistances: string;
  damage_vulnerabilities: string;
  condition_immunities: string;
  actions: Record<string, string>;
  action_fields: Record<string, ActionFields>;
  special_abilities: Record<string, string>;
  legendary_desc: string;
  legendary_actions: Array<{ name: string; desc: string }>;
}>;

const CORRECTIONS: Record<string, Correction> = {
  // SRD 5.1 Skeleton: vulnerable to bludgeoning, immune to poison (the row
  // files poison under resistances).
  "wotc-srd/skeleton": { damage_immunities: "poison", damage_resistances: "" },
  // SRD 5.1 Zombie: immune to poison (the row leaves immunities empty).
  "wotc-srd/zombie": { damage_immunities: "poison" },
  "wotc-srd/purple-worm": { actions: { Multiattack: "The worm makes two attacks: one with its bite and one with its tail stinger." } },
  // SRD 5.1 Basilisk: Armor Class 15 (natural armor); the row has 12.
  "wotc-srd/basilisk": { armor_class: 15 },
  // SRD 5.1 Giant Elk: Armor Class 14 (natural armor); the row has 15.
  "wotc-srd/giant-elk": { armor_class: 14 },
  // SRD 5.1 Cult Fanatic: Hit Points 33 (6d8 + 6); the row has 22.
  "wotc-srd/cult-fanatic": { hit_points: 33 },
  // SRD 5.1 Horned Devil: Hit Points 148 (17d10+55); the row has the Monster
  // Manual's 178.
  "wotc-srd/horned-devil": { hit_points: 148, hit_dice: "17d10+55" },
  // SRD 5.1 Chain Devil: Challenge 8 (3,900 XP), Saving Throws Con +7, Wis
  // +4, Cha +5, passive Perception 11; the row has the Monster Manual's 11,
  // no saves and 8.
  "wotc-srd/chain-devil": {
    cr: 8,
    challenge_rating: "8",
    constitution_save: 7,
    wisdom_save: 4,
    charisma_save: 5,
    senses: "darkvision 120 ft., passive Perception 11",
  },
  // SRD 5.1 Kraken: Bite and Tentacle "+17 to hit" (Strength 30 and a
  // proficiency bonus of 7); the row prints +7.
  "wotc-srd/kraken": {
    actions: {
      Bite:
        "Melee Weapon Attack: +17 to hit, reach 5 ft., one target. Hit: 23 (3d8 + 10) piercing damage. If the target is a Large or smaller creature grappled by the kraken, that creature is swallowed, and the grapple ends. While swallowed, the creature is blinded and restrained, it has total cover against attacks and other effects outside the kraken, and it takes 42 (12d6) acid damage at the start of each of the kraken's turns. If the kraken takes 50 damage or more on a single turn from a creature inside it, the kraken must succeed on a DC 25 Constitution saving throw at the end of that turn or regurgitate all swallowed creatures, which fall prone in a space within 10 feet of the kraken. If the kraken dies, a swallowed creature is no longer restrained by it and can escape from the corpse using 15 feet of movement, exiting prone.",
      Tentacle:
        "Melee Weapon Attack: +17 to hit, reach 30 ft., one target. Hit: 20 (3d6 + 10) bludgeoning damage, and the target is grappled (escape DC 18). Until this grapple ends, the target is restrained. The kraken has ten tentacles, each of which can grapple one target.",
    },
    action_fields: { Bite: { attack_bonus: 17 }, Tentacle: { attack_bonus: 17 } },
  },
  // SRD 5.1 Solar: Slaying Longbow slays "a creature that has 100 hit points
  // or fewer"; the row has 190.
  "wotc-srd/solar": {
    actions: {
      "Slaying Longbow":
        "Ranged Weapon Attack: +13 to hit, range 150/600 ft., one target. Hit: 15 (2d8 + 6) piercing damage plus 27 (6d8) radiant damage. If the target is a creature that has 100 hit points or fewer, it must succeed on a DC 15 Constitution saving throw or die.",
    },
  },
  // SRD 5.1 Ancient Green Dragon: Bite "19 (2d10 + 8) piercing damage plus
  // 10 (3d6) poison damage"; the row's damage_bonus is 9, within a point of
  // the printed average, so the reader keeps it.
  "wotc-srd/ancient-green-dragon": { action_fields: { Bite: { damage_bonus: 8 } } },
  // SRD 5.1 Wight: resistant to necrotic and to nonmagical weapons, immune to
  // poison, and to exhaustion as well as poison; the row moves the
  // resistances into immunities and drops exhaustion.
  "wotc-srd/wight": {
    damage_resistances: "necrotic; bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered",
    damage_immunities: "poison",
    condition_immunities: "exhaustion, poisoned",
  },
  // SRD 5.1 Imp: the same rule as the row's shorthand, in the SRD's words.
  "wotc-srd/imp": { damage_resistances: "cold; bludgeoning, piercing, and slashing from nonmagical attacks that aren't silvered" },
  // SRD 5.1 Archmage: damage from spells and, from its stoneskin, nonmagical
  // weapons; the row's "non magical" splits the word the damage rules read.
  "wotc-srd/archmage": { damage_resistances: "damage from spells; nonmagical bludgeoning, piercing, and slashing (from stoneskin)" },
  // SRD 5.1 Ice Devil: Damage Immunities cold, fire, poison; the row drops cold.
  "wotc-srd/ice-devil": { damage_immunities: "cold, fire, poison" },
  // SRD 5.1 Mummy Lord: Damage Vulnerabilities fire; the row has bludgeoning.
  "wotc-srd/mummy-lord": { damage_vulnerabilities: "fire" },
  // SRD 5.1 Crocodile: Speed 20 ft., swim 30 ft.; the row has swim 20.
  "wotc-srd/crocodile": { speed: { walk: 20, swim: 30 } },
  // SRD 5.1 Adult Brass Dragon: Speed 40 ft., burrow 30 ft., fly 80 ft.; the
  // row has burrow 40.
  "wotc-srd/adult-brass-dragon": { speed: { walk: 40, burrow: 30, fly: 80 } },
  // SRD 5.1 Young Blue Dragon: Speed 40 ft., burrow 20 ft., fly 80 ft.; the
  // row has burrow 40.
  "wotc-srd/young-blue-dragon": { speed: { walk: 40, burrow: 20, fly: 80 } },
  // SRD 5.1 Priest: Speed 30 ft.; the row has 25.
  "wotc-srd/priest": { speed: { walk: 30 } },
  // SRD 5.1 Hunter Shark: Senses blindsight 30 ft.; the row has darkvision 30.
  "wotc-srd/hunter-shark": { senses: "blindsight 30 ft., passive Perception 12" },
  // The passive Perception each SRD 5.1 block prints, which Hide and an
  // ambush are held to (src/lib/bestiary/enemy-numbers.ts); the rows have
  // 10, 9 and 12.
  "wotc-srd/blink-dog": { senses: "passive Perception 13" },
  "wotc-srd/bone-devil": { senses: "darkvision 120 ft., passive Perception 12" },
  "wotc-srd/spider": { senses: "darkvision 30 ft., passive Perception 10" },
  // The skills each SRD 5.1 block prints and the row drops, which an opposed
  // check rolls in place of the bare ability modifier.
  "wotc-srd/black-bear": { skills: { perception: 3 } },
  "wotc-srd/spy": { skills: { deception: 5, insight: 4, investigation: 5, perception: 6, persuasion: 5, "sleight of hand": 4, stealth: 4 } },
  "wotc-srd/swarm-of-ravens": { skills: { perception: 5 } },
  "wotc-srd/werewolf": { skills: { perception: 4, stealth: 3 } },
  "wotc-srd/half-red-dragon-veteran": { skills: { athletics: 5, perception: 2 } },
  "blackflag/archdruid_bf": {
    actions: {
      "Thorned Staff":
        "_Melee Weapon Attack:_ +7 to hit, reach 5 ft., one target. _Hit:_ 10 (2d6+3) piercing damage plus 18 (4d8) cold, fire, lightning, poison, or thunder damage (the archdruid's choice).",
    },
  },
  "blackflag/bard_bf": {
    actions: {
      Rapier:
        "_Melee Weapon Attack:_ +6 to hit, reach 5 ft., one target. _Hit:_ 7 (1d8+3) piercing damage plus 13 (3d8) damage of the type determined by Artistic Expression.",
    },
  },
  "tob/mamura": { actions: { Multiattack: "The mamura makes three claw attacks and one whiptail stinger attack." } },
  // The slam prints no type; the 2023 printing of the same creature's is
  // bludgeoning.
  "tob/abominable-beauty": { actions: { Slam: "Melee Weapon Attack: +8 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) bludgeoning damage plus 28 (8d6) fire damage." } },
  "tob/star-spawn-of-cthulhu": {
    actions: {
      Multiattack: "The star spawn can use disintegrating gaze if it's available, and also make one crushing claws attack and one dimensional stomp attack.",
    },
  },
  "tob2/forest-emperor": {
    actions: {
      Multiattack:
        "The forest emperor makes two acidic claw attacks and one tail attack. If both claws hit the same target, the target must succeed on a DC 18 Constitution saving throw or its hp maximum is reduced by 7 (2d6) and the forest emperor regains hp equal to this amount. This reduction lasts until the target finishes a long rest. The target dies if this effect reduces its hp maximum to 0.",
    },
  },
  "tob2/animated-bearskin-rug": {
    actions: {
      Envelop:
        "Melee Weapon Attack: +6 to hit, reach 5 ft., one Medium or smaller creature. Hit: The creature is grappled (escape DC 14). Until this grapple ends, the target is restrained, and the rug can't envelop another target.",
    },
  },
  "tob2/ophidiotaur": { actions: { Multiattack: "The ophidiotaur makes two attacks: one with its bite and one with its poisoned glaive." } },
  "tob-2023/crystallinedevil-tob1-2023": { actions: { Multiattack: "The devil makes three Shard Claw attacks." } },
  "tob-2023/ancientwinddragon-tob1-2023": { actions: { Claw: "Melee Weapon Attack: +16 to hit, reach 10 ft., one target. Hit: 16 (2d6 + 9) slashing damage." } },
  "tob-2023/dogmolejuggernaut-tob1-2023": { actions: { Claw: "Melee Weapon Attack: +8 to hit, reach 5 ft., one target. Hit: 12 (3d4 + 5) slashing damage." } },
  // Tome of Beasts: the vampire warlock's Misty Step is printed as its
  // legendary description, so the count and the first option were lost.
  "tob/vampire-warlock-variant": {
    legendary_desc:
      "The vampire warlock can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. The vampire warlock regains spent legendary actions at the start of its turn.",
    legendary_actions: [
      { name: "Misty Step", desc: "The vampire warlock uses misty step." },
      { name: "Unarmed Strike", desc: "The vampire warlock makes one unarmed strike." },
      { name: "Call the Blood (Costs 2 Actions)", desc: "The vampire warlock uses call the blood." },
    ],
  },
  // Creature Codex: options printed run together into the first entry.
  "cc/azi-dahaka": {
    legendary_actions: [
      {
        name: "Control Weather",
        desc: "Azi Dahaka can alter the weather in a 5-mile radius centered on itself. The effect is identical to the control weather spell, except the casting time and effects are immediate.",
      },
      {
        name: "Call Lightning (Costs 2 Actions)",
        desc: "A bolt of lightning flashes down from the clouds to a point Azi Dahaka can see within 100 feet of it. Each creature within 5 feet of that point must make a DC 20 Dexterity saving throw, taking 16 (3d10) lightning damage on a failed save, or half as much damage on a successful one.",
      },
      {
        name: "Wing Attack (Costs 2 Actions)",
        desc: "Azi Dahaka beats its wings. Each creature within 10 feet of the dragon must succeed on a DC 20 Dexterity saving throw or take 12 (2d6 + 5) bludgeoning damage and be knocked prone. Azi Dahaka can then fly up to half its flying speed.",
      },
    ],
  },
  "cc/lord-zombie": {
    legendary_actions: [
      {
        name: "Shambling Hordes",
        desc: "The lord telepathically commands all zombies it controls within 1 mile to immediately move up to half their speed. A zombie that moves out of an enemy's reach because of this movement doesn't provoke an opportunity attack.",
      },
      { name: "Life Drain (Costs 2 Actions)", desc: "The lord makes a life drain attack." },
      { name: "Arise (Costs 3 Actions)", desc: "The lord targets a humanoid corpse within 30 feet, which rises as a zombie under the lord's control." },
    ],
  },
  // Tome of Beasts 3's spell lists, with the commas the printing lost.
  "tob3/akanka": { actions: { Spellcasting: "Cha (DC 13) no material components: At will: minor illusion, silent image\n3/day: major image\n1/day: hallucinatory terrain" } },
  "tob3/alabroza-bloodfiend": { actions: { Spellcasting: "Cha (DC 12) no material components: At will: minor illusion\n3/day ea: detect thoughts, suggestion" } },
  "tob3/angel-kalkydra": { actions: { Spellcasting: "Cha (DC 19) no material components: At will: detect evil and good, light\n3/day ea: daylight, dispel evil and good\n1/day ea: commune, greater restoration" } },
  "tob3/angel-zirnitran": { special_abilities: { Spellcasting: "Wis (DC 21) no material components: At will: detect evil and good, invisibility (self only), legend lore, thaumaturgy\n3/day ea: dispel evil and good, geas (as an action)\n1/day ea: antimagic field, plane shift" } },
  "tob3/angel-shrouded": { actions: { Spellcasting: "Wis (DC 19) no material components: At will: bane, bless, locate creature\n3/day ea: invisibility (self only), healing word (level 5), nondetection" } },
  "tob3/arcane-scavenger": { actions: { Spellcasting: "Int (DC 15) no material components: At will: detect magic, locate object\n3/day ea: counterspell, dispel magic" } },
  "tob3/archon-word": { actions: { Spellcasting: "Cha (DC 13) no material or somatic components: At will: dancing lights, message, true strike\n1/day ea: faerie fire, heroism" } },
  "tob3/aziza": { actions: { Spellcasting: "Wis (DC 12) no material components: At will: druidcraft, guidance\n1/day ea: animal messenger, bless" } },
  "tob3/bannik": { actions: { Spellcasting: "Wis (DC 13) only wand of bound fir required: At will: augury, create or destroy water, fog cloud\n3/day: lesser restoration" } },
  "tob3/bearfolk-thunderstomper": { actions: { Spellcasting: "Cha (DC 15): At will: dancing lights, prestidigitation, vicious mockery\n2/day ea: charm person, disguise self, mirror image\n1/day ea: compulsion, enthrall, freedom of movement, hypnotic pattern" } },
  "tob3/belu": { actions: { Spellcasting: "Cha (DC 14) no material components: At will: entangle, speak with plants, stone shape\n2/day: plant growth" } },
  "tob3/brownie-mystic": { actions: { Spellcasting: "Wis (DC 13) no material components: At will: mending, minor illusion, prestidigitation\n3/day ea: entangle, mirror image\n1/day ea: confusion, conjure animals, dimension door" } },
  "tob3/catonoctrix": { actions: { "Spellcasting (Psionics)": "Int (DC 15) no spell components: At will: detect thoughts, divination\n1/day ea: confusion, scrying, suggestion" } },
  "tob3/cave-sovereign": { actions: { "Spellcasting (Psionics)": "Cha (DC 18) no spell components: At will: detect thoughts, mage hand (the hand is invisible)\n3/day ea: dimension door, telekinesis\n1/day: hallucinatory terrain (as an action)" } },
  "tob3/chimera-royal": { actions: { Spellcasting: "Goat head casts one of the following spells. Cha (DC 18) only verbal components: At will: charm person, dispel magic, mage hand\n3/day ea: bestow curse, enthrall, haste\n1/day: dominate person" } },
  "tob3/devil-infernal-tutor": { actions: { Spellcasting: "Cha (DC 18) no material components: At will: bane, calm emotions, command, detect thoughts, suggestion\n3/day ea: bestow curse, compulsion, enthrall\n1/day ea: geas, modify memory" } },
  "tob3/devil-infernal-tutor-lesser": { actions: { Spellcasting: "Cha (DC 15) no material components: At will: bane, calm emotions, detect thoughts\n3/day ea: command, enthrall, suggestion\n1/day: compulsion" } },
  "tob3/div": { actions: { Spellcasting: "Cha (DC 14) no material components: At will: disguise self, minor illusion\n3/day ea: charm person, suggestion\n1/day ea: dream, fear" } },
  "tob3/dragon-prismatic-adult": { actions: { Spellcasting: "Int (DC 17) no material components: At will: charm person, color spray, dancing lights\n3/day: prismatic spray\n1/day: prismatic wall" } },
  "tob3/dragon-prismatic-ancient": { actions: { Spellcasting: "Int (DC 20) no material components: At will: charm person, dancing lights, prismatic spray\n1/day: prismatic wall" } },
  "tob3/dragon-prismatic-wyrmling": { actions: { Spellcasting: "Int (DC 12) no material components: At will: dancing lights\n1/day ea: charm person, color spray" } },
  "tob3/dragon-prismatic-young": { actions: { Spellcasting: "Int (DC 14) no material components: At will: dancing lights\n3/day ea: charm person, color spray\n1/day: prismatic spray" } },
  "tob3/dread-examiner": { actions: { "Spellcasting (Psionics)": "Cha (DC 22) no spell components: At will: dispel magic, fabricate (as an action), telekinesis\n3/day ea: animate objects, wall of force\n1/day: true polymorph" } },
  "tob3/giant-lantern": { actions: { Spellcasting: "Cha (DC 15) no material components: At will: detect magic, identify (as an action)\n3/day ea: control water, freedom of movement, water breathing" } },
  "tob3/giant-thursir-hearth-priestess": { actions: { Spellcasting: "Wis (DC 13): At will: mending, spare the dying, thaumaturgy\n3/day ea: cure wounds, heat metal\n1/day: haste" } },
  "tob3/gremlin-rum-story-keeper": { actions: { Spellcasting: "Cha (DC 13) no material components: At will: prestidigitation\n3/day ea: charm person, mirror image" } },
  "tob3/hag-brine": { actions: { Spellcasting: "Cha (DC 16) no material components: At will: minor illusion\n3/day ea: charm person, major image\n1/day: control water" } },
  "tob3/hag-floe": { actions: { Spellcasting: "Cha (DC 13) no material components: At will: minor illusion, prestidigitation\n3/day ea: fog cloud, sleep\n1/day: sleet storm" } },
  "tob3/hag-wood": { actions: { Spellcasting: "Wis (DC 17) no material components: At will: charm person, entangle\n3/day: plant growth\n1/day: contagion" } },
  "tob3/npc:-apostle": { actions: { Spellcasting: "Wis (DC 15): At will: guidance, spare the dying, thaumaturgy\n3/day ea: bless, cure wounds (3rd-level), hold person, lesser restoration\n1/day ea: bestow curse, daylight, freedom of movement, mass cure wounds, revivify" } },
  "tob3/npc:-cultist-psychophant": { actions: { "Spellcasting (Psionics)": "Cha (DC 16) no spell components: At will: detect thoughts, mage hand (hand invisible), thaumaturgy\n3/day ea: charm person, suggestion\n1/day ea: levitate, telekinesis" } },
  "tob3/npc:-field-commander": { actions: { Spellcasting: "Cha (DC 16): At will: command, protection from evil and good\n3/day ea: cure wounds (level 3), find steed (as an action)\n1/day: revivify" } },
  "tob3/npc:-first-servant": { actions: { Spellcasting: "Wis (DC 17): At will: bane, protection from evil and good, spare the dying, thaumaturgy\n3/day ea: cure wounds (level 5), dispel evil and good, divination, speak with dead\n1/day ea: commune (as an action), holy aura, resurrection" } },
  "tob3/npc:-infiltrator": { actions: { Spellcasting: "Int (DC 13): At will: mage hand, message, minor illusion\n3/day ea: charm person, sleep\n1/day: invisibility" } },
  "tob3/npc:-merchant-captain": { actions: { Spellcasting: "Cha (DC 15): At will: comprehend languages, mage hand, mending\n3/day ea: calm emotions, enthrall, heroism\n1/day ea: confusion, freedom of movement" } },
  "tob3/npc:-warlock-of-the-genie-lord": { actions: { Spellcasting: "Cha (DC 15). At will: levitate, water breathing\n3/day ea: fire shield, fly, gust of wind\n1/day ea: conjure minor elementals (as an action), wall of stone" } },
  "tob3/phoenixborn-sorcerer": { actions: { Spellcasting: "Cha (DC 13): At will: mage hand, minor illusion, light, prestidigitation\n2/day ea: charm person, continual flame, mage armor\n1/day: dispel magic" } },
  "tob3/rakshasa-myrmidon": { actions: { Spellcasting: "Cha (DC 12) no material components: At will: detect thoughts, disguise self\n2/day: expeditious retreat" } },
  "tob3/rakshasa-pustakam": { actions: { Spellcasting: "Cha (DC 15) no material or somatic components: At will: detect thoughts, mage hand, minor illusion\n3/day ea: command, suggestion" } },
  "tob3/rakshasa-servitor": { actions: { Spellcasting: "Cha (DC 11) no material components: At will: detect thoughts, disguise self\n1/day: cause fear" } },
  "tob3/rakshasa-slayer": { actions: { Spellcasting: "Cha (DC 16) no material components: At will: detect thoughts, disguise self\n3/day: invisibility\n1/day: mislead" } },
  "tob3/savior-lumen": { actions: { Spellcasting: "Cha (DC 14) no material components: At will: floating disk, mending, spare the dying\n3/day ea: gentle repose, knock, sending\n1/day ea: locate creature, passwall" } },
  "tob3/shetani": { actions: { Spellcasting: "Cha (DC 18): At will: charm person, silent image\n3/day ea: major image, suggestion\n1/day ea: mirage arcane (as an action), programmed illusion" } },
  "tob3/trollkin-ragecaster": { actions: { "Spellcasting (Ragecasting Only)": "Cha (DC 15) no material components: At will: thunderwave\n3/day ea: call lightning, fireball\n1/day: fire shield" } },
  "tob3/wilderness-crone": { actions: { Spellcasting: "Wis (DC 15). Prepared: At will: minor illusion, tree stride\n3/day ea: goodberry, hold person, locate animals or plants\n1/day ea: commune with nature, remove curse" } },
};

// Some documents shorten what the SRD spells out (Tome of Beasts 3's "DC 13
// Con save" and "for 1 min", Black Flag's "DC 16 CON save"): their
// lines are read spelled out, so the readers (attack-text.ts,
// monster-abilities.ts) know one wording.
const ABILITY_NAMES: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const DAMAGE_WORDS = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";

// What a bracket's success says, in the words the readers know: "half" is
// half as much damage, "negates" is nothing, "not prone" or "half damage
// and isn't poisoned" names what the success spares.
function successOf(raw: string): string {
  const text = raw.trim().replace(/\.$/, "");
  const half = /^half(?:\s+damage)?\b\s*(?:,?\s*(?:and\s+)?(?:isn't|is not|not|doesn't|does not)\s+(.+))?$/i.exec(text);
  if (half) {
    return `it takes half as much damage on a successful save${half[1] ? ` and is not ${half[1].trim()}` : ""}.`;
  }
  if (/^negates(?: both)?$/i.test(text)) {
    return "it suffers none of it.";
  }
  const spared = /^(?:negates|not|isn't)\s+(.+)$/i.exec(text);
  if (spared) {
    return `it is not ${spared[1].trim()}.`;
  }
  return text ? `${text}.` : "it suffers none of it.";
}

// Tome of Beasts 3 writes a save as a bracket after its effect: "Each
// creature in that area: 36 (8d8) thunder (DC 16 Con half)", "knocked prone
// (DC 16 Str negates)", "Target incapacitated until the end of its next
// turn (DC 16 Con not incapacitated)". Spelled out the SRD's way, the effect
// before the bracket is what a failure does: "... must make a DC 16
// Constitution saving throw. On a failure, 36 (8d8) thunder damage. On a
// success, it takes half as much damage on a successful save."
function bracketSaves(desc: string): string {
  if (!/\(DC\s*\d/i.test(desc)) {
    return desc;
  }
  // "15 ft. away" is no end of a sentence; the effect runs back to one.
  const FT = "․";
  const spelled = desc
    .replace(/\bft\./g, `ft${FT}`)
    .replace(/([^.:]*?)\s*\(DC\s*(\d{1,2})\s+(str|dex|con|int|wis|cha)[a-z]*\.?\s+([^()]*?)\)(\.?)/gi, (whole, effect: string, dc: string, ability: string, outcome: string) => {
      if (/saving throw|\bsave\b/i.test(outcome) || !effect.trim()) {
        return whole;
      }
      // "Target incapacitated until...": the subject makes the save.
      const subject = /^\s*((?:the\s+)?target|it)\s+(?=\S)/i.exec(effect);
      const failure = effect
        .slice(subject ? subject[0].length : 0)
        .trim()
        // "45 (10d8) psychic and is stunned": the dice are damage.
        .replace(new RegExp(`(\\d+\\s*\\(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?\\)\\s+(?:${DAMAGE_WORDS}))\\b(?!\\s+damage)`, "gi"), "$1 damage");
      const lead = subject ? ` ${subject[1]} ` : /^\s/.test(effect) ? " " : "";
      return `${lead}must make a DC ${dc} ${ABILITY_NAMES[ability.toLowerCase()]} saving throw. On a failure, ${failure}. On a success, ${successOf(outcome)}`;
    });
  return spelled.replaceAll(`ft${FT}`, "ft.");
}

function spelledOut(desc: string, document: string): string {
  return (document === "tob3" ? bracketSaves(desc) : desc)
    .replace(/\bDC\s*(\d{1,2})\s+(str|dex|con|int|wis|cha)(?:[a-z]+|\.)?\s+save\b/gi, (_, dc: string, ability: string) => `DC ${dc} ${ABILITY_NAMES[ability.toLowerCase()]} saving throw`)
    .replace(/\bfor (\d{1,3}) (min|hr)s?\b/g, (_, count: string, unit: string) => `for ${count} ${unit === "min" ? "minute" : "hour"}${count === "1" ? "" : "s"}`);
}

const SECTIONS = ["actions", "bonus_actions", "reactions", "legendary_actions", "special_abilities"];

// Whether a row has a correction here: someone read it against its book
// (src/lib/content/monster-reading-logic.ts counts it as checked).
export function hasPackCorrection(document: string, slug: string): boolean {
  return Object.hasOwn(CORRECTIONS, `${document}/${slug}`);
}

export function correctedMonsterData(data: Record<string, unknown>): Record<string, unknown> {
  const document = String(data.document__slug ?? data.document_slug ?? "wotc-srd");
  const { actions: texts = {}, action_fields: actionFields = {}, special_abilities: traitTexts = {}, ...fields } = CORRECTIONS[`${document}/${String(data.slug ?? "")}`] ?? {};
  const base: Record<string, unknown> = { ...data, ...fields };
  const sections = SECTIONS.filter((section) => Array.isArray(base[section])).map((section) => [
    section,
    (base[section] as Array<Record<string, unknown>>).map((raw) => {
      const rewrites = section === "actions" ? texts : section === "special_abilities" ? traitTexts : {};
      const numbers = section === "actions" && Object.hasOwn(actionFields, String(raw.name)) ? actionFields[String(raw.name)] : null;
      const entry = numbers ? { ...raw, ...numbers } : raw;
      const desc = Object.hasOwn(rewrites, String(entry.name)) ? rewrites[String(entry.name)] : entry.desc;
      return typeof desc === "string" ? { ...entry, desc: spelledOut(desc, document) } : entry;
    }),
  ]);
  return { ...base, ...Object.fromEntries(sections) };
}
