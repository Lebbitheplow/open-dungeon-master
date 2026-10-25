import { proficiencyBonus } from "@/lib/srd";
import { beastFormsHolding, findBeastForm, findShapeForm, formatCr, wildShapeCapsFor } from "@/lib/srd/beast-forms";
import { isNamed } from "@/lib/srd/feature-names";
import { featureChoiceOf } from "@/lib/srd/features";
import { classLevelFor } from "@/lib/srd/multiclass";
import { creatureDefenses, familiarOffer, familiarFormsHolding, findFamiliarForm } from "@/lib/srd/familiar-forms";
import { creatureAttackOf, type CreatureAttack } from "@/lib/srd/creature-attacks";
import { traitLine } from "@/lib/srd/srd-creatures";
import { sizeRank } from "@/lib/bestiary/statblock";
import type { HomebrewMonster } from "@/lib/bestiary/homebrew-monsters";
import type { CharacterSheet, SheetPet } from "@/lib/schemas/sheet";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { subclassNamed } from "@/lib/srd/subclass-name";
import { textKey } from "@/lib/language/text-logic";
import { holdingHint, type ToolError } from "@/lib/dm/tool-errors";

// The stat block a summon produces (src/lib/dm/pet-tools.ts summon_pet), and
// who may summon what: a familiar's form from the SRD creature table, a
// Beast Master's beast scaled by the ranger, a Drakewarden's drake with the
// essence it was summoned with, and a story pet. Kept apart from the tools
// so the rules read on their own (scripts/test-pet-logic.mjs drives them
// with no table).

// A Drakewarden's Draconic Essence: the damage type the drake is immune to
// and, from 7th level, the extra die its Bite deals (src/lib/srd/
// subclasses.json, Drake Companion and Bond of Fang and Scale).
export const DRAKE_ESSENCES = ["acid", "cold", "fire", "lightning", "poison"] as const;

// A story pet fights at its owner's command only when it is no stronger than
// the beast a druid of the owner's level can become (SRD 5.1 Wild Shape,
// without the Circle of the Moon: CR 1/4, 1/2 from 4th level, 1 from 8th).
// That keeps the creature a story hands a character at or below a Beast
// Master's companion, a subclass's whole feature, at every level. A
// mightier creature is kept as a pet that does not attack.
export function storyPetMaxCr(level: number): number {
  return wildShapeCapsFor(level, false).maxCr;
}

// The names of a sheet's features and feats, as written.
function featureNames(sheet: CharacterSheet): string[] {
  return [...sheet.features.map((feature) => feature.name), ...sheet.feats];
}

function knowsFindFamiliar(sheet: CharacterSheet): boolean {
  const spellList = sheet.spellcasting ? allSpellNames(sheet.spellcasting) : [];
  return [...spellList, ...featureNames(sheet)].some((name) => isNamed(name, "Find Familiar"));
}

export function hasPactOfTheChain(sheet: CharacterSheet): boolean {
  return featureNames(sheet).some((name) => isNamed(name, "Pact of the Chain"));
}

function hasBeastCompanionFeature(sheet: CharacterSheet): boolean {
  return (
    subclassNamed(sheet.subclass ?? "", "Beast Master") ||
    featureNames(sheet).some((name) => isNamed(name, "Ranger's Companion", "Animal Companion"))
  );
}

function hasDrakeFeature(sheet: CharacterSheet): boolean {
  return (
    subclassNamed(sheet.subclass ?? "", "Drakewarden") ||
    featureNames(sheet).some((name) => isNamed(name, "Drake Companion"))
  );
}

// The ranger's own level, which a companion's hit points follow; a sheet
// that lists no ranger class (an older single-class row) answers its level.
function rangerLevel(sheet: CharacterSheet): number {
  return classLevelFor(sheet, "ranger") || sheet.level;
}

// The essence a call sends, or the one the sheet's features name ("Bond of
// Fang and Scale (Fire)"); null when neither says.
export function drakeEssenceOf(sheet: Pick<CharacterSheet, "features">, sent?: string): (typeof DRAKE_ESSENCES)[number] | null {
  const named = [sent, ...["Drake Companion", "Bond of Fang and Scale", "Draconic Essence", "Drake Essence"].map((feature) => featureChoiceOf(sheet.features, feature))]
    .map((value) => textKey(value ?? ""))
    .find(Boolean);
  return DRAKE_ESSENCES.find((essence) => essence === named) ?? null;
}

type StoryPetBlock = Pick<SheetPet, "hp" | "ac" | "speed" | "resist" | "immune" | "vulnerable"> & {
  name: string;
  cr: number;
  attacks: CreatureAttack[];
  traits: string[];
};

// The stat block a story pet's form names: a monster the table made in the
// workshop first (its author meant theirs), then the SRD creature table.
// Whole names only, never the nearest.
function storyPetBlock(form: string, tableMonster?: (name: string) => HomebrewMonster | null): StoryPetBlock | null {
  const own = tableMonster?.(form);
  if (own) {
    const stats = own.draft.stats;
    return {
      name: own.draft.name,
      cr: stats.cr,
      hp: Math.min(300, stats.maxHp),
      ac: Math.min(30, stats.ac),
      speed: Math.min(120, Number(/\d+/.exec(stats.speed)?.[0] ?? 30)),
      attacks: stats.attacks.map(creatureAttackOf),
      traits: stats.traits,
      ...creatureDefenses(stats),
    };
  }
  const creature = findShapeForm(form);
  return creature
    ? {
        name: creature.name,
        cr: creature.cr,
        hp: Math.min(300, creature.hp),
        ac: creature.ac,
        speed: creature.speed,
        attacks: creature.attacks,
        traits: creature.traitLines,
        ...creatureDefenses(creature),
      }
    : null;
}

export type PetBuildOptions = {
  // The table's own monsters by name (src/lib/bestiary/homebrew-monsters.ts
  // findTableMonster), for a story pet the workshop made.
  tableMonster?: (name: string) => HomebrewMonster | null;
};

// Builds the pet a summon produces, or an error string.
export function buildPet(
  sheet: CharacterSheet,
  args: {
    kind: SheetPet["kind"];
    form: string;
    name?: string;
    essence?: string;
    hp?: number;
    ac?: number;
  },
  options: PetBuildOptions = {},
): SheetPet | ToolError {
  const level = sheet.level;
  const pb = proficiencyBonus(level);
  if (args.kind === "familiar") {
    if (!knowsFindFamiliar(sheet) && !hasPactOfTheChain(sheet)) {
      return {
        error: `${sheet.name} does not know Find Familiar and has no Pact of the Chain; they cannot summon a familiar.`,
        refused: "rules",
      };
    }
    const form = findFamiliarForm(args.form);
    if (!form) {
      const offer = familiarOffer(hasPactOfTheChain(sheet));
      return {
        error: args.form.trim()
          ? `Unknown familiar form "${args.form.trim()}". The forms there are: ${offer}.${holdingHint(args.form, familiarFormsHolding(args.form))} Ask the player which, unless they named one.`
          : `A familiar needs its form: ${offer}. Ask the player which, unless they named one.`,
        retry: true,
      };
    }
    if (form.chainOnly && !hasPactOfTheChain(sheet)) {
      return {
        error: `A ${form.form} familiar needs Pact of the Chain; ${sheet.name} can take an ordinary form instead (${familiarOffer(false)}). Ask the player which.`,
        retry: true,
      };
    }
    return {
      name: args.name?.trim() || form.form,
      kind: "familiar",
      form: form.form,
      hp: form.hp,
      maxHp: form.maxHp,
      ac: form.ac,
      speed: form.speed,
      attacks: form.attacks,
      notes: `${form.notes} A familiar acts on its own but cannot attack${form.chainOnly ? "" : " (Pact of the Chain forms can)"}; the owner can see through its senses as an action.`,
      ...creatureDefenses(form),
    };
  }
  if (args.kind === "beast_companion") {
    if (!hasBeastCompanionFeature(sheet)) {
      return {
        error: `${sheet.name} has no Ranger's Companion feature; only a Beast Master gets a bonded beast.`,
        refused: "rules",
      };
    }
    // PHB Beast Master: a beast no larger than Medium, of challenge rating
    // 1/4 or lower.
    const beast = findBeastForm(args.form);
    const fits = (entry: { cr: number; size: string }) => entry.cr <= 0.25 && sizeRank(entry.size) <= sizeRank("Medium");
    if (!beast || !fits(beast)) {
      return {
        error: `A ranger's companion must be a Medium or smaller beast of CR 1/4 or lower (wolf, panther, boar, mastiff...)${beast ? `; a ${beast.name} is ${beast.size}, CR ${beast.cr}` : ""}.${beast ? "" : holdingHint(args.form, beastFormsHolding(args.form).filter(fits).map((entry) => entry.name))}`,
        retry: true,
      };
    }
    // PHB Beast Master: add the ranger's proficiency bonus to the beast's
    // AC, attack and damage rolls; HP floor of four times ranger level.
    const hp = Math.max(beast.hp, rangerLevel(sheet) * 4);
    return {
      name: args.name?.trim() || beast.name,
      kind: "beast_companion",
      form: beast.name,
      hp,
      maxHp: hp,
      ac: beast.ac + pb,
      speed: beast.speed,
      attacks: beast.attacks.slice(0, 3).map((attack) => ({
        ...attack,
        toHit: attack.toHit + pb,
        damage: `${attack.damage}+${pb}`,
      })),
      // The pet record keeps 300 characters of notes: the beast's traits as
      // fit, then the command rule.
      notes: `${traitLine(beast.traitLines, 200)} Commanding an attack costs the ranger's action; it otherwise defends itself.`.trim(),
      ...creatureDefenses(beast),
    };
  }
  if (args.kind === "drake") {
    if (!hasDrakeFeature(sheet)) {
      return { error: `${sheet.name} has no Drake Companion feature; only a Drakewarden bonds a drake.`, refused: "rules" };
    }
    // Drake Companion: the essence is chosen at each summon, and the drake
    // is immune to it. Bond of Fang and Scale (7th level): its Bite deals an
    // extra 1d6 of that type, and it grows wings.
    const essence = drakeEssenceOf(sheet, args.essence);
    if (!essence) {
      return {
        error: `A drake needs its Draconic Essence, the damage type it is immune to: ${DRAKE_ESSENCES.join(", ")}. Ask the player which, unless they named one.`,
        retry: true,
      };
    }
    const ranger = rangerLevel(sheet);
    const grown = ranger >= 7;
    return {
      name: args.name?.trim() || "Drake",
      kind: "drake",
      form: "Drake",
      hp: 5 + ranger * 5,
      maxHp: 5 + ranger * 5,
      ac: 14,
      speed: 40,
      attacks: [{ name: "Bite", toHit: 2 + pb, damage: `1d6+${pb}`, type: "piercing", ...(grown ? { riders: [{ dice: "1d6", type: essence }] } : {}) }],
      notes: `Draconic Essence: ${essence}, which it is immune to; commanded as a bonus action. ${grown ? `Medium, with a flying speed of 40 ft.; it can carry ${sheet.name} as a mount.` : "It grows wings at 7th level."}`,
      immune: essence,
    };
  }
  // Story pet: the creature its stat block says, by name. One with no block
  // takes the model's numbers, clamped by the schema, and cannot attack.
  const block = storyPetBlock(args.form, options.tableMonster);
  if (block) {
    const maxCr = storyPetMaxCr(level);
    const fights = block.cr <= maxCr;
    const held = fights ? "" : ` CR ${formatCr(block.cr)}: too strong to fight at ${sheet.name}'s command (a story pet fights at CR ${formatCr(maxCr)} or lower at their level), so it does not attack.`;
    return {
      name: args.name?.trim() || block.name,
      kind: "other",
      form: block.name,
      hp: block.hp,
      maxHp: block.hp,
      ac: block.ac,
      speed: block.speed,
      attacks: fights ? block.attacks.slice(0, 3).map((attack) => ({ ...attack })) : [],
      notes: `${traitLine(block.traits, 290 - held.length)}${held}`.trim(),
      ...(block.resist ? { resist: block.resist } : {}),
      ...(block.immune ? { immune: block.immune } : {}),
      ...(block.vulnerable ? { vulnerable: block.vulnerable } : {}),
    };
  }
  if (!args.hp || !args.ac) {
    return {
      error: `"${args.form.trim()}" names no stat block the table knows. Name an SRD creature (mastiff, wolf, riding horse) or a monster the table made in the workshop, or send its hp and ac for a pet that cannot attack.`,
      retry: true,
    };
  }
  return {
    name: args.name?.trim() || args.form,
    kind: "other",
    form: args.form,
    hp: args.hp,
    maxHp: args.hp,
    ac: args.ac,
    speed: 30,
    attacks: [],
    notes: "",
  };
}

// The words a pet's defenses read in a summon's result and in GAME STATE.
export function defenseWords(pet: Pick<SheetPet, "resist" | "immune" | "vulnerable">): string {
  return [
    pet.immune ? `immune to ${pet.immune}` : "",
    pet.resist ? `resists ${pet.resist}` : "",
    pet.vulnerable ? `vulnerable to ${pet.vulnerable}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

