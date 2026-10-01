// What the monster suites share on top of enforce-combat.mjs: SRD 5.1 stat
// blocks written out as the content pack stores them (Open5e rows), so a
// suite stages a real monster with or without the pack, and a DM turn the
// model owns, for the rules that only bind the AI.
//
//   const kit = await combatKit(world);
//   const mk = await monsterKit(world, kit);
//   mk.stage(enemy.id, ROWS.wolf);          // the goblin becomes a wolf
//   const turn = mk.aiTurn();
//   await mk.ai(turn, "end_turn", { characterId });
import { clearDice, dice, diceLog } from "./enforce-world.mjs";

// SRD 5.1 blocks, the fields the engine reads, in the pack's own shape. The
// text is the SRD's.
export const ROWS = {
  adultRedDragon: {
    name: "Adult Red Dragon", size: "Huge", type: "Dragon", armor_class: 19, hit_points: 256, cr: 17,
    speed: { walk: 40, climb: 40, fly: 80 },
    strength: 27, dexterity: 10, constitution: 25, intelligence: 16, wisdom: 13, charisma: 21,
    dexterity_save: 6, constitution_save: 13, wisdom_save: 7, charisma_save: 11,
    damage_immunities: "fire", senses: "blindsight 60 ft., darkvision 120 ft., passive Perception 23",
    actions: [
      { name: "Multiattack", desc: "The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws." },
      { name: "Bite", desc: "Melee Weapon Attack: +14 to hit, reach 10 ft., one target. Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.", attack_bonus: 14, damage_dice: "2d10+2d6", damage_bonus: 8 },
      { name: "Claw", desc: "Melee Weapon Attack: +14 to hit, reach 5 ft., one target. Hit: 15 (2d6 + 8) slashing damage.", attack_bonus: 14, damage_dice: "2d6", damage_bonus: 8 },
      { name: "Tail", desc: "Melee Weapon Attack: +14 to hit, reach 15 ft., one target. Hit: 17 (2d8 + 8) bludgeoning damage.", attack_bonus: 14, damage_dice: "2d8", damage_bonus: 8 },
      { name: "Frightful Presence", desc: "Each creature of the dragon's choice that is within 120 ft. of the dragon and aware of it must succeed on a DC 19 Wisdom saving throw or become frightened for 1 minute. A creature can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success. If a creature's saving throw is successful or the effect ends for it, the creature is immune to the dragon's Frightful Presence for the next 24 hours." },
      { name: "Fire Breath (Recharge 5-6)", desc: "The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save, or half as much damage on a successful one.", attack_bonus: 0, damage_dice: "18d6" },
    ],
    legendary_desc: "The dragon can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. The dragon regains spent legendary actions at the start of its turn.",
    legendary_actions: [
      { name: "Detect", desc: "The dragon makes a Wisdom (Perception) check." },
      { name: "Tail Attack", desc: "The dragon makes a tail attack." },
      { name: "Wing Attack (Costs 2 Actions)", desc: "The dragon beats its wings. Each creature within 10 ft. of the dragon must succeed on a DC 22 Dexterity saving throw or take 15 (2d6 + 8) bludgeoning damage and be knocked prone. The dragon can then fly up to half its flying speed." },
    ],
    special_abilities: [
      { name: "Legendary Resistance (3/Day)", desc: "If the dragon fails a saving throw, it can choose to succeed instead." },
    ],
  },
  wolf: {
    name: "Wolf", size: "Medium", type: "Beast", armor_class: 13, hit_points: 11, cr: 0.25,
    speed: { walk: 40 }, strength: 12, dexterity: 15, constitution: 12, intelligence: 3, wisdom: 12, charisma: 6,
    senses: "passive Perception 13",
    actions: [
      { name: "Bite", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage. If the target is a creature, it must succeed on a DC 11 Strength saving throw or be knocked prone.", attack_bonus: 4, damage_dice: "2d4", damage_bonus: 2 },
    ],
    special_abilities: [
      { name: "Keen Hearing and Smell", desc: "The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell." },
      { name: "Pack Tactics", desc: "The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 ft. of the creature and the ally isn't incapacitated." },
    ],
  },
  giantSpider: {
    name: "Giant Spider", size: "Large", type: "Beast", armor_class: 14, hit_points: 26, cr: 1,
    speed: { walk: 30, climb: 30 }, strength: 14, dexterity: 16, constitution: 12, intelligence: 2, wisdom: 11, charisma: 4,
    actions: [
      { name: "Bite", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one creature. Hit: 7 (1d8 + 3) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 9 (2d8) poison damage on a failed save, or half as much damage on a successful one. If the poison damage reduces the target to 0 hit points, the target is stable but poisoned for 1 hour, even after regaining hit points, and is paralyzed while poisoned in this way.", attack_bonus: 5, damage_dice: "1d8", damage_bonus: 3 },
      { name: "Web (Recharge 5-6)", desc: "Ranged Weapon Attack: +5 to hit, range 30/60 ft., one creature. Hit: The target is restrained by webbing. As an action, the restrained target can make a DC 12 Strength check, bursting the webbing on a success.", attack_bonus: 5 },
    ],
  },
  vampireBite: {
    name: "Vampire", size: "Medium", type: "Undead", armor_class: 16, hit_points: 144, cr: 13,
    actions: [
      { name: "Multiattack (Vampire Form Only)", desc: "The vampire makes two attacks, only one of which can be a bite attack." },
      { name: "Unarmed Strike (Vampire Form Only)", desc: "Melee Weapon Attack: +9 to hit, reach 5 ft., one creature. Hit: 8 (1d8 + 4) bludgeoning damage. Instead of dealing damage, the vampire can grapple the target (escape DC 18).", attack_bonus: 9, damage_dice: "1d8", damage_bonus: 4 },
      { name: "Bite (Bat or Vampire Form Only)", desc: "Melee Weapon Attack: +9 to hit, reach 5 ft., one willing creature, or a creature that is grappled by the vampire, incapacitated, or restrained. Hit: 7 (1d6 + 4) piercing damage plus 10 (3d6) necrotic damage.", attack_bonus: 9, damage_dice: "1d6+3d6", damage_bonus: 4 },
      { name: "Charm", desc: "The vampire targets one humanoid it can see within 30 ft. of it. If the target can see the vampire, the target must succeed on a DC 17 Wisdom saving throw against this magic or be charmed by the vampire." },
      { name: "Children of the Night (1/Day)", desc: "The vampire magically calls 2d4 swarms of bats or rats, provided that the sun isn't up." },
    ],
    special_abilities: [
      { name: "Shapechanger", desc: "If the vampire isn't in sun light or running water, it can use its action to polymorph into a Tiny bat or a Medium cloud of mist, or back into its true form." },
      { name: "Legendary Resistance (3/Day)", desc: "If the vampire fails a saving throw, it can choose to succeed instead." },
      { name: "Misty Escape", desc: "When it drops to 0 hit points outside its resting place, the vampire transforms into a cloud of mist instead of falling unconscious." },
      { name: "Regeneration", desc: "The vampire regains 20 hit points at the start of its turn if it has at least 1 hit point and isn't in sunlight or running water. If the vampire takes radiant damage or damage from holy water, this trait doesn't function at the start of the vampire's next turn." },
      { name: "Spider Climb", desc: "The vampire can climb difficult surfaces, including upside down on ceilings, without needing to make an ability check." },
    ],
    legendary_desc: "The vampire can take 3 legendary actions, choosing from the options below.",
    legendary_actions: [
      { name: "Move", desc: "The vampire moves up to its speed without provoking opportunity attacks." },
      { name: "Unarmed Strike", desc: "The vampire makes one unarmed strike." },
      { name: "Bite (Costs 2 Actions)", desc: "The vampire makes one bite attack." },
    ],
  },
  lich: {
    name: "Lich", size: "Medium", type: "Undead", armor_class: 17, hit_points: 135, cr: 21,
    intelligence: 20, constitution_save: 10, intelligence_save: 12, wisdom_save: 9,
    actions: [
      { name: "Paralyzing Touch", desc: "Melee Spell Attack: +12 to hit, reach 5 ft., one creature. Hit: 10 (3d6) cold damage. The target must succeed on a DC 18 Constitution saving throw or be paralyzed for 1 minute. The target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success.", attack_bonus: 12, damage_dice: "3d6" },
    ],
    special_abilities: [
      { name: "Legendary Resistance (3/Day)", desc: "If the lich fails a saving throw, it can choose to succeed instead." },
      { name: "Spellcasting", desc: "The lich is an 18th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 20, +12 to hit with spell attacks). The lich has the following wizard spells prepared:\n\n* Cantrips (at will): mage hand, prestidigitation, ray of frost\n* 1st level (4 slots): detect magic, magic missile, shield, thunderwave\n* 2nd level (3 slots): detect thoughts, invisibility, acid arrow, mirror image\n* 3rd level (3 slots): animate dead, counterspell, dispel magic, fireball\n* 4th level (3 slots): blight, dimension door\n* 5th level (3 slots): cloudkill, scrying\n* 6th level (1 slot): disintegrate, globe of invulnerability\n* 7th level (1 slot): finger of death, plane shift\n* 8th level (1 slot): dominate monster, power word stun\n* 9th level (1 slot): power word kill" },
    ],
  },
  ogre: {
    name: "Ogre", size: "Large", type: "Giant", armor_class: 11, hit_points: 59, cr: 2,
    actions: [
      { name: "Greatclub", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 13 (2d8 + 4) bludgeoning damage.", attack_bonus: 6, damage_dice: "2d8", damage_bonus: 4 },
      { name: "Javelin", desc: "Melee or Ranged Weapon Attack: +6 to hit, reach 5 ft. or range 30/120 ft., one target. Hit: 11 (2d6 + 4) piercing damage.", attack_bonus: 6, damage_dice: "2d6", damage_bonus: 4 },
    ],
  },
  banditCaptain: {
    name: "Bandit Captain", size: "Medium", type: "Humanoid", armor_class: 15, hit_points: 65, cr: 2,
    actions: [
      { name: "Multiattack", desc: "The captain makes three melee attacks: two with its scimitar and one with its dagger. Or the captain makes two ranged attacks with its daggers." },
      { name: "Scimitar", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 6 (1d6 + 3) slashing damage.", attack_bonus: 5, damage_dice: "1d6", damage_bonus: 3 },
      { name: "Dagger", desc: "Melee or Ranged Weapon Attack: +5 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 5 (1d4 + 3) piercing damage.", attack_bonus: 5, damage_dice: "1d4", damage_bonus: 3 },
    ],
    reactions: [
      { name: "Parry", desc: "The captain adds 2 to its AC against one melee attack that would hit it. To do so, the captain must see the attacker and be wielding a melee weapon." },
    ],
  },
  hillGiant: {
    name: "Hill Giant", size: "Huge", type: "Giant", armor_class: 13, hit_points: 105, cr: 5,
    speed: { walk: 40 },
    actions: [
      { name: "Multiattack", desc: "The giant makes two greatclub attacks." },
      { name: "Greatclub", desc: "Melee Weapon Attack: +8 to hit, reach 10 ft., one target. Hit: 18 (3d8 + 5) bludgeoning damage.", attack_bonus: 8, damage_dice: "3d8", damage_bonus: 5 },
      { name: "Rock", desc: "Ranged Weapon Attack: +8 to hit, range 60/240 ft., one target. Hit: 21 (3d10 + 5) bludgeoning damage.", attack_bonus: 8, damage_dice: "3d10", damage_bonus: 5 },
    ],
  },
  goblin: {
    name: "Goblin", size: "Small", type: "Humanoid", armor_class: 15, hit_points: 7, cr: 0.25,
    dexterity: 14, skills: { stealth: 6 }, senses: "darkvision 60 ft., passive Perception 9",
    actions: [
      { name: "Scimitar", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing damage.", attack_bonus: 4, damage_dice: "1d6", damage_bonus: 2 },
      { name: "Shortbow", desc: "Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.", attack_bonus: 4, damage_dice: "1d6", damage_bonus: 2 },
    ],
    special_abilities: [
      { name: "Nimble Escape", desc: "The goblin can take the Disengage or Hide action as a bonus action on each of its turns." },
    ],
  },
  constrictor: {
    name: "Constrictor Snake", size: "Large", type: "Beast", armor_class: 12, hit_points: 13, cr: 0.25,
    actions: [
      { name: "Bite", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one creature. Hit: 5 (1d6 + 2) piercing damage.", attack_bonus: 4, damage_dice: "1d6", damage_bonus: 2 },
      { name: "Constrict", desc: "Melee Weapon Attack: +4 to hit, reach 5 ft., one creature. Hit: 6 (1d8 + 2) bludgeoning damage, and the target is grappled (escape DC 14). Until this grapple ends, the creature is restrained, and the snake can't constrict another target.", attack_bonus: 4, damage_dice: "1d8", damage_bonus: 2 },
    ],
  },
  mage: {
    name: "Mage", size: "Medium", type: "Humanoid", armor_class: 12, hit_points: 40, cr: 6,
    intelligence: 17, wisdom_save: 4, intelligence_save: 6,
    actions: [
      { name: "Dagger", desc: "Melee or Ranged Weapon Attack: +5 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 4 (1d4 + 2) piercing damage.", attack_bonus: 5, damage_dice: "1d4", damage_bonus: 2 },
    ],
    special_abilities: [
      { name: "Spellcasting", desc: "The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit with spell attacks). The mage has the following wizard spells prepared:\n\n* Cantrips (at will): fire bolt, light, mage hand, prestidigitation\n* 1st level (4 slots): detect magic, mage armor, magic missile, shield\n* 2nd level (3 slots): misty step, suggestion\n* 3rd level (3 slots): counterspell, fireball, fly\n* 4th level (3 slots): greater invisibility, ice storm\n* 5th level (1 slot): cone of cold" },
    ],
  },
};

export async function monsterKit(world, kit) {
  const { parseMonster } = await import("../../src/lib/bestiary/statblock.ts");
  const { legendaryProfile, freshPool } = await import("../../src/lib/dm/legendary-logic.ts");
  const { createDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");

  const parse = (row) => parseMonster(row, row.cr ?? 1);

  // Rewrites a spawned enemy into the block a row prints, legendary pools
  // included, the way start_encounter would have written it.
  function stage(enemyId, row, patch = {}) {
    // setEnemy merges; a block that lacks a field the dummy had must not
    // keep the dummy's, and an undefined field is dropped when stored.
    const stats = {
      senses: undefined, skills: undefined, abilities: undefined, spells: undefined,
      ...parse(row), ...(patch.stats ?? {}),
    };
    const enemy = kit.setEnemy(enemyId, { ac: stats.ac, maxHp: stats.maxHp, ...patch, stats });
    const encounter = world.encounter();
    const profile = legendaryProfile(stats);
    if (profile) {
      encounter.legendary.pools[enemyId] = freshPool(profile);
    } else {
      delete encounter.legendary.pools[enemyId];
    }
    kit.saveEncounter(encounter);
    return enemy;
  }

  const aiTurn = () => createDmTurn(world.campaignId, [], "ai");
  const ai = (turn, name, args = {}) =>
    invokeEngine(world.campaign(), { kind: "ai", turnId: turn.id }, { name, args });

  // One call with its dice forced; the dice it rolled come back with it.
  async function forced(faces, run) {
    clearDice();
    diceLog();
    dice(...faces);
    const out = await run();
    const unused = clearDice();
    return { out, ok: out.ok, error: out.error, result: out.result ?? {}, unused, rolled: diceLog() };
  }

  return { parse, stage, aiTurn, ai, forced };
}

// How many d20s one roll threw: 2 with advantage or disadvantage.
export const d20Count = (rolled) => rolled.filter((die) => die.sides === 20).length;
