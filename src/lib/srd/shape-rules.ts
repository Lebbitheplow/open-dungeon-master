// The spells that turn a creature into a beast of the form table
// (src/lib/srd/beast-forms.ts), and what each allows (SRD 5.1):
//
//   Polymorph: a beast of challenge rating no higher than the target's level
//     (or CR); its whole stat block, mind included.
//   Animal Shapes: each willing creature into a Large or smaller beast of
//     challenge rating 4 or lower; it keeps its Intelligence, Wisdom and
//     Charisma.
//   Shapechange: the caster into a creature of challenge rating no higher
//     than their level; they keep their Intelligence, Wisdom and Charisma.
//     The form table holds beasts; another creature's form is the DM's.
//
// Pure: cast-buff.ts asks here before the slot is spent.

import { BEAST_FORMS, type BeastForm } from "@/lib/srd/beast-forms";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

export type ShapeRule = {
  spell: string;
  // The highest challenge rating allowed, from the target's and the
  // caster's level.
  crCap: (targetLevel: number, casterLevel: number) => number;
  maxSize?: BeastForm["size"];
  // The target keeps its own Intelligence, Wisdom and Charisma.
  keepsMind: boolean;
  // The target keeps its proficiencies, class features and lineage
  // (Shapechange); otherwise the beast's statistics replace them.
  keepsTraining?: boolean;
};

const SIZES: Array<BeastForm["size"]> = ["Tiny", "Small", "Medium", "Large", "Huge"];

const RULES: Record<string, ShapeRule> = {
  polymorph: { spell: "Polymorph", crCap: (target) => target, keepsMind: false },
  "animal shapes": { spell: "Animal Shapes", crCap: () => 4, maxSize: "Large", keepsMind: true },
  shapechange: { spell: "Shapechange", crCap: (_target, caster) => caster, keepsMind: true, keepsTraining: true },
};

export function shapeRuleFor(spell: string): ShapeRule {
  return RULES[textKey(spell)] ?? RULES.polymorph;
}

// Why this form is not allowed for this target, or null.
export function shapeProblem(rule: ShapeRule, form: BeastForm, target: { name: string; level: number }, casterLevel: number): ToolError | null {
  const cap = rule.crCap(target.level, casterLevel);
  if (form.cr > cap) {
    return { error: `${form.name} is CR ${form.cr}, above the CR ${cap} ${rule.spell} allows for ${target.name}. Offer a lesser form.`, retry: true };
  }
  if (rule.maxSize && SIZES.indexOf(form.size) > SIZES.indexOf(rule.maxSize)) {
    return { error: `${form.name} is ${form.size}; ${rule.spell} allows a ${rule.maxSize} or smaller beast. Offer a smaller form.`, retry: true };
  }
  return null;
}

// The forms the spell may give this target.
export function shapeForms(rule: ShapeRule, target: { name: string; level: number }, casterLevel: number): BeastForm[] {
  return BEAST_FORMS.filter((form) => !shapeProblem(rule, form, target, casterLevel));
}

// The creature a transformed character is, for every number read from the
// sheet (SRD 5.1): Polymorph's and Animal Shapes' beast has none of the
// character's proficiencies, features, feats or lineage, and its gear has
// melded into the form; Wild Shape and Shapechange keep them. The scores and
// the AC come from the form itself (wildShape), read where they are read.
export function formSees<T extends {
  wildShape?: { kind?: "wildshape" | "polymorph"; keepsTraining?: boolean } | null;
  features?: Array<{ name: string }>;
  feats?: string[];
  race?: string;
  equipment?: unknown[];
  proficiencies?: { saves: string[]; skills: string[]; expertise?: string[] };
}>(sheet: T): T {
  if (sheet.wildShape?.kind !== "polymorph" || sheet.wildShape.keepsTraining) {
    return sheet;
  }
  return {
    ...sheet,
    ...(sheet.features ? { features: [] } : {}),
    ...(sheet.feats ? { feats: [] } : {}),
    ...(sheet.race !== undefined ? { race: "beast" } : {}),
    ...(sheet.equipment ? { equipment: [] } : {}),
    ...(sheet.proficiencies ? { proficiencies: { ...sheet.proficiencies, saves: [], skills: [], expertise: [] } } : {}),
  };
}

// The ability scores the form gives: the beast's, with the target's own
// mind where the spell keeps it.
export function shapedAbilities(rule: ShapeRule, form: BeastForm, own: BeastForm["abilities"]): BeastForm["abilities"] {
  return rule.keepsMind ? { ...form.abilities, int: own.int, wis: own.wis, cha: own.cha } : form.abilities;
}
