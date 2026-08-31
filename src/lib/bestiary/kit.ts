import {
  ALL_CLASSES,
  SRD_RACES,
  proficiencyBonus,
  suggestedStartingHp,
} from "@/lib/srd";
import { SRD_ARMOR, isArmorProficient, type SrdArmor } from "@/lib/srd/armor";
import { SRD_WEAPONS, isWeaponProficient, type SrdWeapon } from "@/lib/srd/weapons";
import { classFeaturesFor, subclassFeatureDescription, subclassNamesFor } from "@/lib/srd/features";
import { combatRiders } from "@/lib/srd/feature-effects";
import {
  MAX_ATTACKS,
  MAX_TRAITS,
  RESIST_MAX,
  SIZES,
  TRAIT_MAX,
  type MonsterDraft,
} from "@/lib/bestiary/monster-draft";
import type { EnemyAttack, SaveAbility } from "@/lib/bestiary/statblock";

// Building a monster out of the parts the app already has.
//
// The bestiary forge asked a person to know 5e cold: type "slashing" into a
// box, type "fire, cold" into another, write "Darkvision 60 ft" from memory.
// The character builder never did that to anybody, because every choice
// there is a pick from a catalogue the app ships. This module is that same
// catalogue, aimed at a stat block: ancestries, classes, subclasses, class
// features, weapons, armour, damage types, conditions and movement modes,
// each with a function that turns a pick into ordinary MonsterDraft fields.
//
// The rule that makes the whole thing safe is that nothing here is sticky.
// Applying a class writes hit points, saves and swings; applying a weapon
// appends one attack row; adding a feature appends one trait line. All of
// them land in the same editable fields a hand-typed monster uses, so a boss
// can be a dwarf paladin with a beholder's eye rays and a renamed Rage, and
// the draft that comes out is indistinguishable from one written by hand.
//
// Pure by design: no DB and no I/O, so scripts/test-monster-kit.mjs drives
// it directly and the panel can import it in the browser.

// ---- the vocabularies ----

// The thirteen damage types the rest of the engine already reads
// (src/lib/srd/feature-effects.ts parses the same list out of rules text).
export const DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
] as const;

// The SRD conditions src/lib/dm/condition-logic.ts actually enforces. A
// condition immunity naming one of these is a rule the fight obeys; anything
// else is a note for whoever is running the monster, which is why the
// pickers still take free text.
export const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
] as const;

// Speed is stored as the one string a stat block prints ("30, fly 60").
// Walking is the bare number, so it is not in this list.
export const MOVEMENT_MODES = ["burrow", "climb", "fly", "swim"] as const;

export type MovementMode = (typeof MOVEMENT_MODES)[number];
export type SpeedSet = { walk: number } & Partial<Record<MovementMode, number>>;

export function parseSpeed(text: string): SpeedSet {
  const speeds: SpeedSet = { walk: 0 };
  for (const part of String(text ?? "").split(/[,;]/)) {
    const trimmed = part.trim().toLowerCase();
    const matched = /(\d+)/.exec(trimmed);
    if (!trimmed || !matched) {
      continue;
    }
    const feet = Number(matched[1]);
    const mode = MOVEMENT_MODES.find((entry) => trimmed.includes(entry));
    if (mode) {
      speeds[mode] = feet;
    } else {
      speeds.walk = feet;
    }
  }
  return speeds;
}

export function formatSpeed(speeds: SpeedSet): string {
  const clean = (value: number | undefined) =>
    Number.isFinite(value) ? Math.max(0, Math.min(999, Math.round(value as number))) : 0;
  const parts = [String(clean(speeds.walk))];
  for (const mode of MOVEMENT_MODES) {
    const feet = clean(speeds[mode]);
    if (feet > 0) {
      parts.push(`${mode} ${feet}`);
    }
  }
  return parts.join(", ");
}

// ---- comma-joined term fields ----

// resist / immune / vulnerable / conditionImmune are one string each, which
// is the shape the fight reads. These three turn that string into the chip
// list a picker works in and back again, without ever losing a term the
// catalogue does not know.

export function parseTerms(text: string): string[] {
  return String(text ?? "")
    .split(/[,;]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function formatTerms(terms: string[]): string {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const term of terms) {
    const key = term.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      kept.push(term.trim());
    }
  }
  return kept.join(", ").slice(0, RESIST_MAX);
}

// Add the term if it is missing, remove it if it is there. Case-insensitive,
// because "Fire" and "fire" are the same immunity.
export function toggleTerm(text: string, term: string): string {
  const wanted = term.trim().toLowerCase();
  if (!wanted) {
    return text;
  }
  const terms = parseTerms(text);
  const without = terms.filter((entry) => entry.toLowerCase() !== wanted);
  return formatTerms(without.length === terms.length ? [...terms, term.trim()] : without);
}

export function hasTerm(text: string, term: string): boolean {
  const wanted = term.trim().toLowerCase();
  return parseTerms(text).some((entry) => entry.toLowerCase() === wanted);
}

// ---- ancestry ----

export type AncestryOption = {
  id: string;
  name: string;
  size: string;
  speed: number;
  traits: string[];
};

export const ANCESTRY_OPTIONS: AncestryOption[] = SRD_RACES.map((race) => ({
  id: race.id,
  name: race.name,
  size: race.size,
  speed: race.speed,
  traits: race.traits,
}));

export function findAncestry(id: string): AncestryOption | null {
  return ANCESTRY_OPTIONS.find((entry) => entry.id === id) ?? null;
}

// ---- class ----

export type ClassKitOption = {
  id: string;
  name: string;
  hitDie: 6 | 8 | 10 | 12;
  saves: SaveAbility[];
  armor: string[];
  weapons: string[];
  casterType: string;
};

// SRD classes and the genre catalogue both, exactly as the character builder
// sees them: a cyberpunk workshop should be able to build a boss out of the
// classes that workshop's players can take.
export const CLASS_KIT_OPTIONS: ClassKitOption[] = ALL_CLASSES.map((klass) => ({
  id: klass.id,
  name: klass.name,
  hitDie: klass.hitDie,
  saves: klass.saves as SaveAbility[],
  armor: klass.armor,
  weapons: klass.weapons,
  casterType: klass.casterType,
}));

export function findClassKit(id: string): ClassKitOption | null {
  return CLASS_KIT_OPTIONS.find((entry) => entry.id === id) ?? null;
}

export function subclassOptionsFor(classId: string): string[] {
  return classId ? subclassNamesFor(classId) : [];
}

// ---- class and subclass features, as trait lines ----

export type ClassFeatureLine = {
  name: string;
  level: number;
  // The one line of rules text the app holds for it, when it holds one.
  // Base-class feature names are bare in the SRD tables; the authored
  // subclasses ship their own wording (src/lib/srd/subclasses.json).
  text: string;
  // What goes in the trait box: the name, with its rules text after a colon
  // when there is any. Editable and renameable once it is there.
  line: string;
};

export function classFeatureLines(
  classId: string,
  subclass: string,
  level: number,
): ClassFeatureLine[] {
  if (!classId) {
    return [];
  }
  const seen = new Set<string>();
  const lines: ClassFeatureLine[] = [];
  for (const feature of classFeaturesFor(classId, subclass, level)) {
    const text = subclassFeatureDescription(classId, subclass, feature.name) ?? "";
    const line = (text ? `${feature.name}: ${text}` : feature.name).slice(0, TRAIT_MAX);
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push({ name: feature.name, level: feature.level ?? 1, text, line });
  }
  return lines;
}

// ---- armour ----

// Every armour the class is trained in, then the rest. A boss is allowed to
// wear plate it has no business in, so nothing is hidden; the ones that fit
// the chassis just come first.
export function armorOptionsFor(classId: string): SrdArmor[] {
  const klass = findClassKit(classId);
  if (!klass) {
    return SRD_ARMOR;
  }
  const proficient = SRD_ARMOR.filter((armor) => isArmorProficient(klass.armor, armor));
  const rest = SRD_ARMOR.filter((armor) => !proficient.includes(armor));
  return [...proficient, ...rest];
}

export function findArmor(name: string): SrdArmor | null {
  return SRD_ARMOR.find((armor) => armor.name === name) ?? null;
}

// Base 10, or the armour's own base, plus as much DEX as it allows, plus a
// shield. The same arithmetic src/lib/srd/armor.ts does for a character
// sheet, against a stat block's single dexMod.
export function acFromArmor(armor: SrdArmor | null, dexMod: number, withShield: boolean): number {
  const shield = withShield ? (findArmor("Shield")?.baseAc ?? 2) : 0;
  if (!armor || armor.category === "shield") {
    const bare = 10 + dexMod + (armor?.category === "shield" ? armor.baseAc : shield);
    return Math.max(1, Math.min(30, bare));
  }
  const dex = armor.dexCap === undefined ? dexMod : Math.min(dexMod, armor.dexCap);
  return Math.max(1, Math.min(30, armor.baseAc + dex + shield));
}

export function applyArmor(
  draft: MonsterDraft,
  armorName: string,
  withShield: boolean,
): MonsterDraft {
  const ac = acFromArmor(findArmor(armorName), draft.stats.dexMod, withShield);
  return { ...draft, stats: { ...draft.stats, ac } };
}

// ---- weapons ----

export function weaponOptionsFor(classId: string): SrdWeapon[] {
  const klass = findClassKit(classId);
  if (!klass) {
    return SRD_WEAPONS;
  }
  const proficient = SRD_WEAPONS.filter((weapon) => isWeaponProficient(klass.weapons, weapon));
  const rest = SRD_WEAPONS.filter((weapon) => !proficient.includes(weapon));
  return [...proficient, ...rest];
}

export function findWeapon(name: string): SrdWeapon | null {
  return SRD_WEAPONS.find((weapon) => weapon.name === name) ?? null;
}

// "1d8 slashing" is how the weapon table writes damage; a stat block wants
// the dice and the type in separate fields, with the wielder's ability
// modifier already added to the dice.
export function weaponAttack(
  weapon: SrdWeapon,
  options: { profBonus: number; abilityMod: number },
): EnemyAttack {
  const [dice = "1d4", ...typeWords] = weapon.damage.split(/\s+/);
  const mod = Math.max(0, Math.min(10, Math.round(options.abilityMod)));
  return {
    name: weapon.name,
    toHit: Math.max(-5, Math.min(20, Math.round(options.profBonus) + mod)),
    damage: mod ? `${dice}+${mod}` : dice,
    type: typeWords.join(" ") || "untyped",
  };
}

export function addAttack(draft: MonsterDraft, attack: EnemyAttack): MonsterDraft {
  if (draft.stats.attacks.length >= MAX_ATTACKS) {
    return draft;
  }
  return { ...draft, stats: { ...draft.stats, attacks: [...draft.stats.attacks, attack] } };
}

// ---- traits ----

// One trait line, deduped and capped. Every path that puts catalogue text on
// a monster goes through here, so "add the dwarf's traits" and "add Rage"
// cannot between them overflow the box or write the same line twice.
export function addTrait(draft: MonsterDraft, line: string): MonsterDraft {
  const trimmed = line.trim().slice(0, TRAIT_MAX);
  if (!trimmed || draft.stats.traits.length >= MAX_TRAITS) {
    return draft;
  }
  const key = trimmed.toLowerCase();
  if (draft.stats.traits.some((trait) => trait.trim().toLowerCase() === key)) {
    return draft;
  }
  return { ...draft, stats: { ...draft.stats, traits: [...draft.stats.traits, trimmed] } };
}

export function addTraits(draft: MonsterDraft, lines: string[]): MonsterDraft {
  return lines.reduce(addTrait, draft);
}

// ---- applying a pick ----

// Size, walking speed and the ancestry's own traits. Everything else about
// the block is left alone: an ancestry says what somebody IS, and the class
// below says what they can do.
export function applyAncestry(draft: MonsterDraft, ancestryId: string): MonsterDraft {
  const ancestry = findAncestry(ancestryId);
  if (!ancestry) {
    return draft;
  }
  const size = SIZES.find((option) => option === ancestry.size) ?? draft.stats.size ?? "Medium";
  const speeds = parseSpeed(draft.stats.speed);
  return addTraits(
    {
      ...draft,
      stats: {
        ...draft.stats,
        size,
        speed: formatSpeed({ ...speeds, walk: ancestry.speed }),
      },
    },
    ancestry.traits,
  );
}

export type ChassisPick = {
  classId: string;
  subclass: string;
  level: number;
  // A CON score, not a modifier, because that is the number a person picking
  // a class in the character builder is already choosing.
  con: number;
  // Only to let a hill dwarf's extra hit point per level count, which is the
  // one place suggestedStartingHp looks at ancestry.
  ancestryId: string;
};

// What a class is worth on a stat block, as numbers rather than as prose:
// hit points for the level off its hit die, its two saving throws raised to
// at least its proficiency bonus, and a swing per Extra Attack it has
// earned. Idempotent, and it never lowers anything, so applying it twice or
// after a hand edit cannot quietly undo work.
//
// Features are deliberately NOT dumped in here. A level 12 paladin has more
// features than a stat block has room for, and picking the three that matter
// is the interesting part of building a boss, so classFeatureLines offers
// them and the panel adds the ones somebody chooses.
export function applyClassChassis(draft: MonsterDraft, pick: ChassisPick): MonsterDraft {
  const klass = findClassKit(pick.classId);
  if (!klass) {
    return draft;
  }
  const level = Math.max(1, Math.min(20, Math.round(pick.level)));
  const prof = proficiencyBonus(level);
  const saves = { ...(draft.stats.saveMods ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }) };
  for (const ability of klass.saves) {
    saves[ability] = Math.max(saves[ability] ?? 0, prof);
  }
  // How many more times the class swings, read off the same table the PC
  // side of combat reads ("Extra Attack", "Extra Attack (2)", "Extra Attack
  // (3)" are three different rows). The engine caps a turn at three.
  const { extraAttacks } = combatRiders({
    class: pick.classId,
    level,
    features: classFeaturesFor(pick.classId, pick.subclass, level),
  });
  return {
    ...draft,
    stats: {
      ...draft.stats,
      maxHp: Math.max(
        draft.stats.maxHp,
        suggestedStartingHp(pick.classId, pick.ancestryId, pick.con, level),
      ),
      saveMods: saves,
      attacksPerTurn: Math.max(
        draft.stats.attacksPerTurn ?? 1,
        Math.min(3, 1 + extraAttacks),
      ),
    },
  };
}

// What applying a chassis would say, for the line under the button. A DM
// deserves to know a pick raises hit points to 94 before it does.
export function describeChassis(pick: ChassisPick): string {
  const klass = findClassKit(pick.classId);
  if (!klass) {
    return "";
  }
  const level = Math.max(1, Math.min(20, Math.round(pick.level)));
  const hp = suggestedStartingHp(pick.classId, pick.ancestryId, pick.con, level);
  const saves = klass.saves.map((ability) => ability.toUpperCase()).join(" and ");
  return `d${klass.hitDie} hit die: at least ${hp} hit points, ${saves} saves at +${proficiencyBonus(
    level,
  )} or better.`;
}
