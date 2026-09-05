import { isValidExpression } from "@/lib/dice";
import { xpForCr } from "@/lib/srd/encounter-math";

// Compacts a raw Open5e monster blob into the snapshot an encounter stores
// per enemy (stat_json). Snapshotting at spawn means a live fight never
// depends on the content pack being present.

export type EnemyAttack = {
  name: string;
  toHit: number;
  // A dice expression src/lib/dice.ts rollExpression accepts, e.g. "1d8+3"
  // or "2d10+8+2d6" when the attack carries rider damage.
  damage: string;
  type: string;
};

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

// "The wolf makes two bite attacks." -> 2, clamped to 3 so a bad parse can
// never flood a turn with swings.
export function parseMultiattackCount(description: string): number | null {
  const match = /makes?\s+(two|three|four|2|3|4)\b[^.]*attack/i.exec(description);
  if (!match) {
    return null;
  }
  const word = match[1].toLowerCase();
  const count = word === "two" || word === "2" ? 2 : word === "three" || word === "3" ? 3 : 4;
  return Math.min(3, count);
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

// "piercing damage plus 7 (2d6) fire damage" -> ["piercing", "fire"].
function damageTypes(desc: string): string {
  const types = [
    ...new Set([...desc.matchAll(/\(?[\d) ]*([a-z]+) damage/gi)].map((m) => m[1].toLowerCase())),
  ].filter((word) => word !== "extra" && word !== "of");
  return types.join("/");
}

// Rider damage appears only in the desc: "Hit: 7 (1d8 + 3) piercing damage
// plus 7 (2d6) fire damage." The first parenthesized dice group is already
// covered by damage_dice; every later one is appended to the expression.
function riderDice(desc: string): string[] {
  const groups = [...desc.matchAll(/plus \d+ \((\d{1,3}d\d{1,3}(?:\s*[+-]\s*\d+)?)\)/gi)];
  return groups.map((match) => match[1].replace(/\s+/g, ""));
}

function parseAttack(action: RawAction): EnemyAttack | null {
  const toHit = asNumber(action.attack_bonus);
  const dice = asString(action.damage_dice).replace(/\s+/g, "");
  if (toHit === null || toHit <= 0 || !dice) {
    return null;
  }
  const bonus = asNumber(action.damage_bonus) ?? 0;
  const desc = asString(action.desc);
  let damage = bonus > 0 ? `${dice}+${bonus}` : bonus < 0 ? `${dice}-${Math.abs(bonus)}` : dice;
  for (const rider of riderDice(desc)) {
    damage = `${damage}+${rider}`;
  }
  if (!isValidExpression(damage)) {
    return null;
  }
  return {
    name: asString(action.name) || "Attack",
    toHit,
    damage,
    type: damageTypes(desc) || "untyped",
  };
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

export function parseMonster(data: Record<string, unknown>, crFromRow: number): EnemyStats {
  const actions = Array.isArray(data.actions) ? (data.actions as RawAction[]) : [];
  const specials = Array.isArray(data.special_abilities)
    ? (data.special_abilities as RawAction[])
    : [];

  const attacks: EnemyAttack[] = [];
  const nonAttackActions: RawAction[] = [];
  let attacksPerTurn = 1;
  for (const action of actions) {
    const attack = parseAttack(action);
    if (attack && attacks.length < MAX_ATTACKS) {
      attacks.push(attack);
    } else if (!attack) {
      if (/multiattack/i.test(String(action.name ?? ""))) {
        attacksPerTurn = parseMultiattackCount(String(action.desc ?? "")) ?? 2;
      }
      nonAttackActions.push(action);
    }
  }

  const traits: string[] = [];
  for (const entry of [...nonAttackActions, ...specials]) {
    if (traits.length >= MAX_TRAITS) {
      break;
    }
    const line = traitLine(entry);
    if (line) {
      traits.push(line);
    }
  }

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
    ...(asString(data.size) ? { size: asString(data.size) } : {}),
    ...(type ? { type } : {}),
    ...parseBlockExtras(data, abilityFields),
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
