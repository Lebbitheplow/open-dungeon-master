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

import type { BeastForm } from "@/lib/srd/beast-forms";

export type ShapeRule = {
  spell: string;
  // The highest challenge rating allowed, from the target's and the
  // caster's level.
  crCap: (targetLevel: number, casterLevel: number) => number;
  maxSize?: BeastForm["size"];
  // The target keeps its own Intelligence, Wisdom and Charisma.
  keepsMind: boolean;
};

const SIZES: Array<BeastForm["size"]> = ["Tiny", "Small", "Medium", "Large", "Huge"];

const RULES: Record<string, ShapeRule> = {
  polymorph: { spell: "Polymorph", crCap: (target) => target, keepsMind: false },
  "animal shapes": { spell: "Animal Shapes", crCap: () => 4, maxSize: "Large", keepsMind: true },
  shapechange: { spell: "Shapechange", crCap: (_target, caster) => caster, keepsMind: true },
};

export function shapeRuleFor(spell: string): ShapeRule {
  return RULES[spell.trim().toLowerCase()] ?? RULES.polymorph;
}

// Why this form is not allowed for this target, or null.
export function shapeProblem(rule: ShapeRule, form: BeastForm, target: { name: string; level: number }, casterLevel: number): string | null {
  const cap = rule.crCap(target.level, casterLevel);
  if (form.cr > cap) {
    return `${form.name} is CR ${form.cr}, above the CR ${cap} ${rule.spell} allows for ${target.name}. Offer a lesser form.`;
  }
  if (rule.maxSize && SIZES.indexOf(form.size) > SIZES.indexOf(rule.maxSize)) {
    return `${form.name} is ${form.size}; ${rule.spell} allows a ${rule.maxSize} or smaller beast. Offer a smaller form.`;
  }
  return null;
}

// The ability scores the form gives: the beast's, with the target's own
// mind where the spell keeps it.
export function shapedAbilities(rule: ShapeRule, form: BeastForm, own: BeastForm["abilities"]): BeastForm["abilities"] {
  return rule.keepsMind ? { ...form.abilities, int: own.int, wis: own.wis, cha: own.cha } : form.abilities;
}
