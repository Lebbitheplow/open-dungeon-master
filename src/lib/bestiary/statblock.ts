import { printedBlockOf, type PrintedBlock } from "@/lib/bestiary/printed-block";
import { xpForCr } from "@/lib/srd/encounter-math";
import { correctedMonsterData } from "@/lib/bestiary/pack-corrections";
import { parseRoutines, type OnHitRider, type RoutineStep, type TypedDice } from "@/lib/bestiary/attack-text";
import { parseAttack } from "@/lib/bestiary/attack-parse";
import {
  ENGINE_TRAIT_NAMES,
  parseAbilityText,
  parseRegeneration,
  parseSpellcasting,
  type MonsterAbility,
  type MonsterSpellcasting,
  type Regeneration,
} from "@/lib/dm/monster-abilities";

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
  // Reach in feet, and range in feet (normal and long).
  reach?: number;
  range?: { normal: number; long: number };
  // The dice riding the hit under a type of their own, which each meet
  // their own resistance ("plus 7 (2d6) fire damage").
  riders?: TypedDice[];
  // What a hit does besides its damage: a save, a condition, a grapple.
  onHit?: OnHitRider;
  // Never stored: set on a planned swing that follows only a hit
  // (src/lib/dm/enemy-profile.ts plannedSwings, a routine step's ifHit).
  onlyIfHit?: boolean;
};

export type { OnHitRider, RoutineStep, TypedDice };

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
  resist: string;
  immune: string;
  vulnerable: string;
  conditionImmune: string;
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
  // The whole printed block, word for word (src/lib/bestiary/printed-block.ts):
  // the lines above are the compact view the fights read. Blocks made by
  // hand and old snapshots lack it.
  printed?: PrintedBlock;
};

export type { PrintedAbility, PrintedBlock } from "@/lib/bestiary/printed-block";
export { normalizePrintedBlock, PRINTED_LIMITS, unrunPrintedAbilities } from "@/lib/bestiary/printed-block";

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

// The fourteen SRD creature types. They are also the bestiary thumbnail
// plates in public/assets/placeholders/monster, which is why the list is
// closed: a type with no plate would be a monster with no picture.
export const CREATURE_TYPES = [
  "aberration",
  "beast",
  "celestial",
  "construct",
  "dragon",
  "elemental",
  "fey",
  "fiend",
  "giant",
  "humanoid",
  "monstrosity",
  "ooze",
  "plant",
  "undead",
] as const;

export type CreatureType = (typeof CREATURE_TYPES)[number];

// "Humanoid (goblinoid)" -> "humanoid". Open5e files swarms under their own
// type, which has no plate; a swarm of rats is drawn as the beast it is.
export function normalizeCreatureType(raw: unknown): CreatureType | null {
  const word = String(raw ?? "").trim().toLowerCase().split(/[\s(]/)[0];
  if (word === "swarm") {
    return "beast";
  }
  return (CREATURE_TYPES as readonly string[]).includes(word) ? (word as CreatureType) : null;
}

// The type to draw or print for a stat block: its own when it carries one,
// and monstrosity for a synthesized block or a pre-type snapshot, the plate
// that promises the least about what is under it.
export function creatureTypeOf(stats: Pick<EnemyStats, "type">): CreatureType {
  return normalizeCreatureType(stats.type) ?? "monstrosity";
}

const MULTIATTACK_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
// The same ceiling enemy-attack.ts holds a turn to: a guard against a
// corrupt block, well above any SRD creature (the tarrasque makes five).
const MAX_MULTIATTACK = 10;

// "The wolf makes two bite attacks." -> 2. As many as the stat block says
// (SRD 5.1, Multiattack): "makes five attacks" is five swings. The hydra's
// "as many bite attacks as it has heads" reads as the five heads it starts
// with.
export function parseMultiattackCount(description: string): number | null {
  if (/as many [^.]*attacks? as it has heads/i.test(description)) {
    return 5;
  }
  const match = /makes?\s+(?:either\s+)?(two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\b[^.]*attack/i.exec(
    description,
  );
  if (!match) {
    return null;
  }
  const word = match[1].toLowerCase();
  const count = MULTIATTACK_WORDS[word] ?? Number(word);
  return count >= 2 ? Math.min(MAX_MULTIATTACK, count) : null;
}

const MAX_ATTACKS = 4;
const MAX_TRAITS = 4;
const TRAIT_CHARS = 140;

type RawAction = {
  name?: unknown;
  desc?: unknown;
  attack_bonus?: unknown;
  damage_dice?: unknown;
  damage_bonus?: unknown;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

function formatSpeed(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => typeof value === "number")
      .map(([mode, value]) => (mode === "walk" ? String(value) : `${mode} ${value}`))
      .join(", ");
  }
  return "30";
}

export function parseMonster(raw: Record<string, unknown>, crFromRow: number): EnemyStats {
  // A pack row that misprints its SRD block is read corrected.
  const data = correctedMonsterData(raw);
  const actions = Array.isArray(data.actions) ? (data.actions as RawAction[]) : [];
  const specials = Array.isArray(data.special_abilities)
    ? (data.special_abilities as RawAction[])
    : [];

  const attacks: EnemyAttack[] = [];
  const nonAttackActions: RawAction[] = [];
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
  const routines = multiattack ? parseRoutines(multiattack, attacks.map((attack) => attack.name)) : null;

  // The lines the engine reads come first, so the cap on the rest never
  // drops a Legendary Resistance or a Magic Resistance.
  const lines = [...nonAttackActions, ...specials]
    .map(traitLine)
    .filter((line): line is string => line !== null);
  const traits = [
    ...lines.filter(keptWhateverTheCap),
    ...lines.filter((line) => !keptWhateverTheCap(line)).slice(0, MAX_TRAITS),
    ...sectionLines(data.reactions, "Reaction"),
    ...sectionLines(data.legendary_actions, "Legendary action"),
  ];
  // The number of legendary actions, when the block gives other than the
  // usual three (legendary-logic.ts reads it back).
  const perRound = /can take (\d) legendary actions/i.exec(asString(data.legendary_desc));
  if (perRound && Number(perRound[1]) !== 3) {
    traits.push(`Legendary actions: The creature can take ${perRound[1]} legendary actions a round.`);
  }

  // The numbers of every action and special that has some, from the full
  // text; and the spellcasting a block prints.
  const specialsWithNumbers = [
    ...nonAttackActions,
    ...specials,
    ...(Array.isArray(data.legendary_actions) ? (data.legendary_actions as RawAction[]) : []),
  ]
    .map((entry) => parseAbilityText(asString(entry.name), asString(entry.desc)))
    // Legendary Resistance is the pool legendary-logic.ts keeps, not an act.
    .filter((entry): entry is MonsterAbility => entry !== null && !/^legendary resistance/i.test(entry.name));
  const castingEntry = specials.find((entry) => /spellcasting/i.test(asString(entry.name)));
  const spellcasting = castingEntry ? parseSpellcasting(asString(castingEntry.desc)) : null;
  const regenerating = specials.find((entry) => /^regeneration\b/i.test(asString(entry.name)));
  const regeneration = regenerating ? parseRegeneration(asString(regenerating.desc)) : null;

  const printed = printedBlockOf(data, actions, specials);

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
    resist: asString(data.damage_resistances),
    immune: asString(data.damage_immunities),
    vulnerable: asString(data.damage_vulnerabilities),
    conditionImmune: asString(data.condition_immunities),
    cr,
    xp: xpForCr(cr),
    attacksPerTurn,
    ...(routines ? { routines } : {}),
    ...(specialsWithNumbers.length ? { specials: specialsWithNumbers } : {}),
    ...(spellcasting ? { spellcasting } : {}),
    ...(regeneration ? { regeneration } : {}),
    ...(asString(data.size) ? { size: asString(data.size) } : {}),
    ...(type ? { type } : {}),
    ...parseBlockExtras(data, abilityFields),
    ...(spellcasting?.spells.length ? { spells: [...new Set(spellcasting.spells.map((spell) => spell.name))] } : {}),
    ...(printed ? { printed } : {}),
  };
}

// The rest of an Open5e block: scores, skills, senses, languages and
// alignment, so a monster started from the pack arrives with the whole
// printed block rather than the half the engine runs.
function parseBlockExtras(
  data: Record<string, unknown>,
  abilityFields: Record<SaveAbility, [score: string, save: string]>,
): Pick<EnemyStats, "abilities" | "skills" | "senses" | "languages" | "alignment"> {
  const abilities: Partial<Record<SaveAbility, number>> = {};
  for (const [ability, [scoreField]] of Object.entries(abilityFields) as Array<[SaveAbility, [string, string]]>) {
    const score = asNumber(data[scoreField]);
    if (score !== null) {
      abilities[ability] = score;
    }
  }
  const skills: Record<string, number> = {};
  const rawSkills = data.skills;
  if (rawSkills && typeof rawSkills === "object" && !Array.isArray(rawSkills)) {
    for (const [name, bonus] of Object.entries(rawSkills as Record<string, unknown>)) {
      const value = asNumber(bonus);
      if (value !== null) {
        skills[name.trim().toLowerCase().replace(/_/g, " ")] = value;
      }
    }
  }
  const sensesText = asString(data.senses);
  const senses: EnemySenses = {};
  for (const sense of ["darkvision", "blindsight", "tremorsense", "truesight"] as const) {
    const match = new RegExp(`${sense}\\s*(\\d+)`, "i").exec(sensesText);
    if (match) {
      senses[sense] = Number(match[1]);
    }
  }
  const passive = /passive perception\s*(\d+)/i.exec(sensesText);
  if (passive) {
    senses.passivePerception = Number(passive[1]);
  }
  return {
    ...(Object.keys(abilities).length ? { abilities } : {}),
    ...(Object.keys(skills).length ? { skills } : {}),
    ...(Object.keys(senses).length ? { senses } : {}),
    ...(asString(data.languages) ? { languages: asString(data.languages).slice(0, 200) } : {}),
    ...(asString(data.alignment) ? { alignment: asString(data.alignment).slice(0, 40) } : {}),
  };
}

// Size comparison for the grapple/shove cap: a creature can only grab or
// push a target at most one size larger than itself. Unknown sizes read as
// Medium so old stat snapshots stay grabbable.
const SIZE_ORDER = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

export function sizeRank(size: string | undefined): number {
  const index = SIZE_ORDER.indexOf((size ?? "").trim().toLowerCase());
  return index === -1 ? SIZE_ORDER.indexOf("medium") : index;
}

// Save modifier for an enemy, with a fallback for stat snapshots taken
// before saveMods existed: dex maps to the stored dexMod, everything else
// scales with CR.
export function saveModFor(stats: EnemyStats, ability: SaveAbility): number {
  const explicit = stats.saveMods?.[ability];
  if (typeof explicit === "number" && Number.isFinite(explicit)) {
    return explicit;
  }
  if (ability === "dex") {
    return stats.dexMod;
  }
  return Math.min(5, Math.round(stats.cr * 0.3));
}

// An enemy's passive Perception: the 5e formula against its Wisdom. Used by
// the Hide action so a stealth roll is compared to something real rather
// than left to the model's judgement.
// The number a hiding character has to beat. The block's own printed
// passive Perception wins; then its Perception skill; then, for a block
// that says nothing, the Wisdom modifier as before.
export function passivePerceptionFor(stats: EnemyStats): number {
  const printed = stats.senses?.passivePerception;
  if (typeof printed === "number" && Number.isFinite(printed)) {
    return printed;
  }
  const perception = stats.skills?.perception;
  if (typeof perception === "number" && Number.isFinite(perception)) {
    return 10 + perception;
  }
  return 10 + saveModFor(stats, "wis");
}

// The senses a block's Keen trait sharpens ("Keen Hearing and Smell", "Keen
// Sight", "Keen Senses": all three). SRD 5.1: advantage on Wisdom
// (Perception) checks that rely on them.
export function keenSensesOf(stats: Pick<EnemyStats, "traits">): Array<"sight" | "hearing" | "smell"> {
  const senses = new Set<"sight" | "hearing" | "smell">();
  for (const line of stats.traits ?? []) {
    const name = /^keen ([a-z ,]+?)\s*[:.]/i.exec(line.trim())?.[1]?.toLowerCase() ?? "";
    for (const sense of ["sight", "hearing", "smell"] as const) {
      if (name.includes(sense) || name.startsWith("senses")) {
        senses.add(sense);
      }
    }
  }
  return [...senses];
}

// The passive Perception a creature watches with when something tries to
// slip past it (a hider, an ambush): advantage is +5 on a passive score
// (SRD 5.1, Passive Checks), and a Keen sense gives it, since sight, sound
// and scent all give a hidden creature away.
export function watchfulPassivePerception(stats: EnemyStats): number {
  return passivePerceptionFor(stats) + (keenSensesOf(stats).length ? 5 : 0);
}
