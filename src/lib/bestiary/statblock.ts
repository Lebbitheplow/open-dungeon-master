import { printedBlockOf, type PrintedBlock } from "@/lib/bestiary/printed-block";
import { xpForCr } from "@/lib/srd/encounter-math";
import { correctedMonsterData } from "@/lib/bestiary/pack-corrections";
import { readDefences } from "@/lib/bestiary/defences";
import { normalizeCreatureType } from "@/lib/bestiary/creature-type";
import type { AttackAlternative, OnHitRider, TypedDice } from "@/lib/bestiary/attack-text";
import { parseMultiattackCount, parseRoutines, type RoutineStep } from "@/lib/bestiary/multiattack-text";
import { asNumber, asString, formatSpeed, lairOptionsOf, parseBlockExtras, sizeOf, subtypeOf } from "@/lib/bestiary/block-fields";
import { parseAttack } from "@/lib/bestiary/attack-parse";
import {
  ENGINE_TRAIT_NAMES,
  mergeSpellcasting,
  parseRegeneration,
  parseSpellcasting,
  spellOfAction,
  type MonsterAbility,
  type MonsterSpellcasting,
  type Regeneration,
} from "@/lib/dm/monster-abilities";
import { abilitiesOfEntries, legendaryCountOf } from "@/lib/dm/ability-entries";
import { REGENERATION_NAME } from "@/lib/dm/regeneration-text";

// Compacts a raw Open5e monster blob into the snapshot an encounter stores
// per enemy (stat_json). Snapshotting at spawn means a live fight never
// depends on the content pack being present.

export type EnemyAttack = {
  name: string;
  toHit: number;
  // A dice expression src/lib/dice.ts rollExpression accepts, e.g. "1d8+3"
  // or "2d10+2d6+8" when the attack carries rider damage.
  damage: string;
  // Every damage type the blow deals, "/" joined ("piercing/fire"); the
  // first is the hit's own.
  type: string;
  // What the printed line says beyond the numbers. All optional: blocks
  // written by hand and snapshots from before them lack these, and every
  // reader falls back to what it did before (src/lib/dm/enemy-profile.ts).
  // "melee", "ranged", or "both" for a thrown weapon.
  mode?: "melee" | "ranged" | "both";
  spellAttack?: boolean;
  // The hit prints its damage as magical ("magical bludgeoning damage"),
  // which "from nonmagical attacks" does not cover.
  magical?: boolean;
  // Reach in feet, and range in feet (normal and long).
  reach?: number;
  range?: { normal: number; long: number };
  // The dice riding the hit under a type of their own, which each meet
  // their own resistance ("plus 7 (2d6) fire damage").
  riders?: TypedDice[];
  // What a hit does besides its damage: a save, a condition, a grapple.
  onHit?: OnHitRider;
  // What the hit deals instead at half its hit points or fewer, or at range
  // (src/lib/bestiary/attack-text.ts readAlternatives).
  alternatives?: AttackAlternative[];
  // A bonus action's attack (the block's Bonus Actions): made beside the
  // action's swings, once a round, never as one of them.
  bonusAction?: boolean;
  // Never stored: set on a planned swing that follows only a hit
  // (src/lib/dm/enemy-profile.ts plannedSwings, a routine step's ifHit).
  onlyIfHit?: boolean;
};

export type { AttackAlternative, OnHitRider, RoutineStep, TypedDice };
export { parseMultiattackCount };

export type SaveAbility = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type EnemySaveMods = Record<SaveAbility, number>;

export type EnemyStats = {
  ac: number;
  maxHp: number;
  dexMod: number;
  // Saving-throw modifiers per ability. Optional: stat_json rows snapshotted
  // before this field existed lack it; saveModFor() covers the fallback.
  saveMods?: EnemySaveMods;
  speed: string;
  attacks: EnemyAttack[];
  // Non-attack actions and special abilities as one-line rules text, e.g.
  // "Fire Breath (Recharge 5-6): DC 12 Dex save, 6d6 fire, half on success".
  traits: string[];
  // Every special and action line as printed, uncut, for what the engine
  // does not resolve to be named to the DM (src/lib/dm/monster-traits.ts).
  // Absent on rows written before it.
  fullTraits?: string[];
  resist: string;
  immune: string;
  vulnerable: string;
  conditionImmune: string;
  // Black Flag's resistance and vulnerability to a condition: advantage, or
  // disadvantage, on a save against it (src/lib/dm/forced-save.ts). Absent
  // on blocks from every other book and on old snapshots.
  conditionResist?: string;
  conditionVulnerable?: string;
  cr: number;
  xp: number;
  // Attacks per turn from the Multiattack action (1 when absent). Optional:
  // stat_json rows snapshotted before this field existed lack it.
  attacksPerTurn?: number;
  // The Multiattack routine by attack name ("one with its bite and two with
  // its claws"), and any "Or it makes..." alternative after it. Optional:
  // a routine that names no attack leaves the count above to decide.
  routines?: RoutineStep[][];
  // Actions and specials with numbers the engine runs (a breath weapon's
  // DC and dice, its recharge), read from the full printed text so the
  // trimmed trait lines never lose them (src/lib/dm/monster-abilities.ts).
  specials?: MonsterAbility[];
  // Attacks printed only as legendary actions (A5e's ankheg queen's "Acid
  // Glob"), which a legendary action buys and enemy_attack rolls; never one
  // of the turn's own swings. Absent on rows written before it.
  legendaryAttacks?: EnemyAttack[];
  // Spell save DC, attack bonus, slots and the spell list, from a
  // Spellcasting or Innate Spellcasting trait.
  spellcasting?: MonsterSpellcasting;
  // Hit points regained at the start of its turn, and the damage types
  // that stop it the turn after (a troll's acid and fire).
  regeneration?: Regeneration;
  // Creature size (Tiny..Gargantuan). Optional: synthesized stats and old
  // snapshots lack it and are treated as Medium.
  size?: string;
  // SRD creature type in lowercase ("undead"). Optional: synthesized stats
  // and old snapshots lack it; creatureTypeOf() covers the fallback.
  type?: string;
  // The tags a type prints in brackets ("shapechanger", "demon", "elf"),
  // lowercase: Polymorph reads a shapechanger's (enemy-polymorph-logic.ts).
  // Absent on blocks with none and on old snapshots.
  subtype?: string;
  // The rest of a printed stat block (docs/workshop-parity-audit.md phase
  // 12). All optional: synthesized blocks and old snapshots lack them, and
  // every reader falls back to the field it read before. Scores are the six
  // raw ability scores; skills are bonuses by lowercase name ("perception":
  // 5); senses are in feet, with the passive Perception the block prints.
  abilities?: Partial<Record<SaveAbility, number>>;
  skills?: Record<string, number>;
  senses?: EnemySenses;
  languages?: string;
  alignment?: string;
  // Spells by name. The engine runs the attack list, not these; the DM
  // prompt prints them so whoever is running the monster knows they exist,
  // and the rating counts them through extraDamagePerRound.
  spells?: string[];
  environment?: string[];
  // Set while a Polymorph holds the creature: the block above is the
  // beast's, and this is everything its own form gives back when the spell
  // ends (src/lib/dm/enemy-polymorph.ts). Absent on every other block.
  polymorphedFrom?: EnemyOwnForm;
  // The lair actions a book prints for its lair (Tome of Beasts: in a
  // "Cave Dragon's Lair" trait, or under "Lair Actions" in the creature's
  // lore), one option each. Offered by lair_action in a fight the DM starts
  // in the lair; never a reason to call a fight a lair fight. Absent on
  // blocks without them and on old snapshots.
  lairOptions?: string[];
  // The whole printed block, word for word (src/lib/bestiary/printed-block.ts):
  // the lines above are the compact view the fights read. Blocks made by
  // hand and old snapshots lack it.
  printed?: PrintedBlock;
};

export type { PrintedAbility, PrintedBlock } from "@/lib/bestiary/printed-block";
export { normalizePrintedBlock, unrunPrintedAbilities } from "@/lib/bestiary/printed-block";

// A polymorphed creature's own form, exactly as the spell found it.
export type EnemyOwnForm = {
  // The beast it became and the spell that made it one.
  form: string;
  spell: string;
  stats: EnemyStats;
  ac: number;
  maxHp: number;
  // The hit points it returns to (SRD 5.1, Polymorph).
  currentHp: number;
};

export type EnemySenses = {
  darkvision?: number;
  blindsight?: number;
  tremorsense?: number;
  truesight?: number;
  passivePerception?: number;
};

export { CREATURE_TYPES, creatureTypeOf, normalizeCreatureType, type CreatureType } from "@/lib/bestiary/creature-type";

// Every attack a pack block prints fits (the most is five: Black Flag's pit
// fiend, whose Multiattack names its Hurl Flame), and the workshop's cap
// (src/lib/bestiary/monster-draft.ts) is the same, so a copy keeps them all.
const MAX_ATTACKS = 6;
const MAX_TRAITS = 4;
const TRAIT_CHARS = 140;

type RawAction = {
  name?: unknown;
  desc?: unknown;
  attack_bonus?: unknown;
  damage_dice?: unknown;
  damage_bonus?: unknown;
};

// The lines a block keeps whatever the cap: the traits the engine reads by
// name, and the legendary and reaction lines, which carry their section.
function keptWhateverTheCap(line: string): boolean {
  return ENGINE_TRAIT_NAMES.test(line) || /^(legendary|lair|reaction|bonus)( action)?\s*:/i.test(line);
}

function sectionLines(entries: unknown, label: string): string[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return (entries as RawAction[])
    .map((entry) => {
      const name = asString(entry.name);
      const desc = asString(entry.desc).replace(/\s+/g, " ").trim();
      if (!name || !desc) {
        return null;
      }
      const text = `${label}: ${name}. ${desc}`;
      return text.length > TRAIT_CHARS + label.length + 2 ? `${text.slice(0, TRAIT_CHARS + label.length - 1)}...` : text;
    })
    .filter((line): line is string => line !== null);
}

function traitLine(entry: RawAction): string | null {
  const name = asString(entry.name);
  const desc = asString(entry.desc).replace(/\s+/g, " ").trim();
  if (!name || !desc) {
    return null;
  }
  return `${name}: ${desc.length > TRAIT_CHARS ? `${desc.slice(0, TRAIT_CHARS - 3)}...` : desc}`;
}

export function parseMonster(raw: Record<string, unknown>, crFromRow: number): EnemyStats {
  // A pack row that misprints its SRD block is read corrected.
  const data = correctedMonsterData(raw);
  const actions = Array.isArray(data.actions) ? (data.actions as RawAction[]) : [];
  const specials = Array.isArray(data.special_abilities)
    ? (data.special_abilities as RawAction[])
    : [];
  // Black Flag, A5e and the 2023 and third Tomes of Beasts print a Bonus
  // Actions section: its attacks join the block's, marked, and the rest are
  // lines the DM reads beside the actions.
  const bonusActions = Array.isArray(data.bonus_actions) ? (data.bonus_actions as RawAction[]) : [];

  const attacks: EnemyAttack[] = [];
  const nonAttackActions: RawAction[] = [];
  const nonAttackBonus: RawAction[] = [];
  let attacksPerTurn = 1;
  let multiattack = "";
  for (const action of actions) {
    const attack = parseAttack(action);
    if (attack && attacks.length < MAX_ATTACKS) {
      attacks.push(attack);
    } else if (!attack) {
      if (/multiattack/i.test(String(action.name ?? ""))) {
        attacksPerTurn = parseMultiattackCount(String(action.desc ?? "")) ?? 2;
        multiattack = asString(action.desc);
      }
      nonAttackActions.push(action);
    }
  }
  for (const action of bonusActions) {
    const attack = parseAttack(action);
    if (attack && attacks.length < MAX_ATTACKS) {
      attacks.push({ ...attack, bonusAction: true });
    } else if (!attack) {
      nonAttackBonus.push(action);
    }
  }
  // A Multiattack routine is the action's: a bonus action's attack is never
  // one of its steps.
  const routines = multiattack ? parseRoutines(multiattack, attacks.filter((attack) => !attack.bonusAction).map((attack) => attack.name)) : null;

  // The lines the engine reads come first, so the cap on the rest never
  // drops a Legendary Resistance or a Magic Resistance.
  const lines = [...nonAttackActions, ...specials]
    .map(traitLine)
    .filter((line): line is string => line !== null);
  // Every line, uncut: the engine's cap is for the prompt, not the record.
  const fullLine = (entry: RawAction, label = "") => {
    const name = asString(entry.name);
    const desc = asString(entry.desc).replace(/\s+/g, " ").trim();
    return name && desc ? `${label}${name}: ${desc}` : null;
  };
  const fullTraits = [
    ...[...nonAttackActions, ...specials].map((entry) => fullLine(entry)),
    ...nonAttackBonus.map((entry) => fullLine(entry, "Bonus action: ")),
  ].filter((entry): entry is string => entry !== null);
  const traits = [
    ...lines.filter(keptWhateverTheCap),
    ...lines.filter((line) => !keptWhateverTheCap(line)).slice(0, MAX_TRAITS),
    ...sectionLines(nonAttackBonus, "Bonus action"),
    ...sectionLines(data.reactions, "Reaction"),
    ...sectionLines(data.legendary_actions, "Legendary action"),
  ];
  // The number of legendary actions, when the block gives other than the
  // usual three (legendary-logic.ts reads it back): from its description,
  // A5e's first option, or a zmey's heads (src/lib/dm/ability-entries.ts).
  const legendaryEntries = Array.isArray(data.legendary_actions) ? (data.legendary_actions as RawAction[]) : [];
  const perRound = legendaryCountOf(asString(data.legendary_desc), legendaryEntries, specials);
  if (perRound !== null && perRound !== 3) {
    traits.push(`Legendary actions: The creature can take ${perRound} legendary actions a round.`);
  }

  // The numbers of every action and special that has some, from the full
  // text; and the spellcasting a block prints.
  // An entry of several options is one ability per option, sharing its
  // limit, and a second save is one of its own (src/lib/dm/ability-entries.ts).
  const specialsWithNumbers = [
    ...abilitiesOfEntries(nonAttackActions),
    // A bonus action's ability is the creature's bonus action, not its action.
    ...abilitiesOfEntries(nonAttackBonus).map((ability) => ({ ...ability, bonusAction: true })),
    ...abilitiesOfEntries(specials),
    ...abilitiesOfEntries(legendaryEntries, { legendary: true }),
  ]
    // Legendary Resistance is the pool legendary-logic.ts keeps, not an act.
    .filter((entry): entry is MonsterAbility => !/^legendary resistance/i.test(entry.name));
  const legendaryAttacks = legendaryEntries.map((entry) => parseAttack(entry)).filter((attack): attack is EnemyAttack => attack !== null);
  // Every Spellcasting entry, wherever the book filed it (Black Flag and
  // Tome of Beasts 2023 print it as an action), as one; and A5e's spells
  // printed as actions ("Hold Monster (5th-Level; V, S, Concentration)").
  const castingParts = [...specials, ...actions]
    .filter((entry) => /spellcasting/i.test(asString(entry.name)))
    .map((entry) => parseSpellcasting(asString(entry.desc), asString(entry.name)))
    .filter((part): part is MonsterSpellcasting => part !== null);
  const spellActions = [...actions, ...(Array.isArray(data.reactions) ? (data.reactions as RawAction[]) : [])]
    .map((entry) => spellOfAction(asString(entry.name)))
    .filter((spell): spell is NonNullable<typeof spell> => spell !== null);
  const spellcasting = mergeSpellcasting(spellActions.length ? [...castingParts, { slots: {}, spells: spellActions }] : castingParts);
  const regeneration =
    specials
      .filter((entry) => REGENERATION_NAME.test(asString(entry.name)))
      .map((entry) => parseRegeneration(asString(entry.desc)))
      .find((entry): entry is Regeneration => entry !== null) ?? null;

  const printed = printedBlockOf(data, actions, specials, bonusActions);
  const lair = lairOptionsOf(data, specials);
  const defences = readDefences(data, specials);

  const dexterity = asNumber(data.dexterity) ?? 10;
  const cr = asNumber(data.cr) ?? crFromRow;
  const type = normalizeCreatureType(data.type);

  // Save modifiers: an explicit *_save field wins; otherwise the ability
  // modifier from the raw score.
  const abilityFields: Record<SaveAbility, [score: string, save: string]> = {
    str: ["strength", "strength_save"],
    dex: ["dexterity", "dexterity_save"],
    con: ["constitution", "constitution_save"],
    int: ["intelligence", "intelligence_save"],
    wis: ["wisdom", "wisdom_save"],
    cha: ["charisma", "charisma_save"],
  };
  const saveMods = Object.fromEntries(
    (Object.entries(abilityFields) as Array<[SaveAbility, [string, string]]>).map(
      ([ability, [scoreField, saveField]]) => {
        const explicit = asNumber(data[saveField]);
        if (explicit !== null) {
          return [ability, explicit];
        }
        const score = asNumber(data[scoreField]) ?? 10;
        return [ability, Math.floor((score - 10) / 2)];
      },
    ),
  ) as EnemySaveMods;

  return {
    ac: asNumber(data.armor_class) ?? 12,
    maxHp: Math.max(1, asNumber(data.hit_points) ?? 10),
    dexMod: Math.floor((dexterity - 10) / 2),
    saveMods,
    speed: formatSpeed(data.speed),
    attacks,
    traits,
    ...(fullTraits.length ? { fullTraits } : {}),
    ...defences,
    cr,
    xp: xpForCr(cr),
    attacksPerTurn,
    ...(routines ? { routines } : {}),
    ...(specialsWithNumbers.length ? { specials: specialsWithNumbers } : {}),
    ...(legendaryAttacks.length ? { legendaryAttacks } : {}),
    ...(spellcasting ? { spellcasting } : {}),
    ...(regeneration ? { regeneration } : {}),
    ...(sizeOf(data.size) ? { size: sizeOf(data.size) } : {}),
    ...(type ? { type } : {}),
    ...(subtypeOf(data) ? { subtype: subtypeOf(data) } : {}),
    ...parseBlockExtras(data, abilityFields),
    ...(spellcasting?.spells.length ? { spells: [...new Set(spellcasting.spells.map((spell) => spell.name))] } : {}),
    ...(lair.length ? { lairOptions: lair } : {}),
    ...(printed ? { printed } : {}),
  };
}

export { keenSensesOf, passivePerceptionFor, saveModFor, sizeRank, watchfulPassivePerception } from "@/lib/bestiary/enemy-numbers";
