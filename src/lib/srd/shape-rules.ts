// The spells that turn a creature into another of the form table
// (src/lib/srd/beast-forms.ts), and what each allows (SRD 5.1):
//
//   Polymorph: a beast of challenge rating no higher than the target's level
//     (or CR); its whole stat block, mind included.
//   Animal Shapes: each willing creature into a Large or smaller beast of
//     challenge rating 4 or lower; it keeps its Intelligence, Wisdom and
//     Charisma.
//   True Polymorph: a creature into any kind of creature of challenge rating
//     no higher than the target's (or its level); its whole stat block, mind
//     included.
//   Shapechange: the caster into any creature but a construct or an undead,
//     of challenge rating no higher than their level, and one they have
//     seen; an average example, without the Spellcasting trait, and without
//     its legendary actions. They keep their Intelligence, Wisdom and
//     Charisma, and their proficiencies.
//
// Pure: cast-buff.ts asks here before the slot is spent.

import { BEAST_FORMS, SHAPE_FORMS, findBeastForm, findShapeForm, formatCr, formList, type BeastForm } from "@/lib/srd/beast-forms";
import type { ToolError } from "@/lib/dm/tool-errors";
import { compareNames, textKey } from "@/lib/language/text-logic";
import { traitLine } from "@/lib/srd/srd-creatures";

export type ShapeRule = {
  spell: string;
  // The highest challenge rating allowed, from the target's and the
  // caster's level.
  crCap: (targetLevel: number, casterLevel: number) => number;
  maxSize?: BeastForm["size"];
  // The target keeps its own Intelligence, Wisdom and Charisma.
  keepsMind: boolean;
  // The target keeps its proficiencies, class features and lineage
  // (Shapechange); otherwise the form's statistics replace them.
  keepsTraining?: boolean;
  // Any kind of creature, not a beast alone, but for the types named.
  anyCreature?: boolean;
  barredTypes?: string[];
  // The block's lines the form goes without (Shapechange: the Spellcasting
  // trait and the legendary actions).
  dropsTraits?: RegExp;
  // What the server cannot check and the table must (Shapechange: a
  // creature the caster has seen).
  seenOnly?: string;
};

const SIZES: Array<BeastForm["size"]> = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];

const RULES: Record<string, ShapeRule> = {
  polymorph: { spell: "Polymorph", crCap: (target) => target, keepsMind: false },
  "animal shapes": { spell: "Animal Shapes", crCap: () => 4, maxSize: "Large", keepsMind: true },
  "true polymorph": { spell: "True Polymorph", crCap: (target) => target, keepsMind: false, anyCreature: true },
  shapechange: {
    spell: "Shapechange",
    crCap: (_target, caster) => caster,
    keepsMind: true,
    keepsTraining: true,
    anyCreature: true,
    barredTypes: ["construct", "undead"],
    dropsTraits: /^(?:Spellcasting|Legendary action)\b/i,
    seenOnly: "Shapechange takes the form of a creature the caster has seen at least once; the table holds them to that.",
  },
};

export function shapeRuleFor(spell: string): ShapeRule {
  return RULES[textKey(spell)] ?? RULES.polymorph;
}

// The form a spell names: any creature for True Polymorph and Shapechange,
// a beast for the others.
export function findFormFor(rule: ShapeRule, term: string): BeastForm | null {
  return rule.anyCreature ? findShapeForm(term) : findBeastForm(term);
}

// The forms a spell draws from, before its caps.
export function formsOf(rule: ShapeRule): BeastForm[] {
  return rule.anyCreature ? SHAPE_FORMS : BEAST_FORMS;
}

// Why this form is not allowed for this target, or null.
export function shapeProblem(rule: ShapeRule, form: BeastForm, target: { name: string; level: number }, casterLevel: number): ToolError | null {
  if (!rule.anyCreature && form.type !== "beast") {
    return { error: `${form.name} is a ${form.type}, not a beast; ${rule.spell} gives a beast's form. Offer a beast.`, retry: true };
  }
  if (rule.barredTypes?.includes(form.type)) {
    return { error: `${form.name} is a ${form.type}; ${rule.spell}'s form cannot be a ${rule.barredTypes.join(" or ")}. Offer another creature.`, retry: true };
  }
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
  return formsOf(rule).filter((form) => !shapeProblem(rule, form, target, casterLevel));
}

// The forms the spell may give this target, as a question or a refusal
// names them: every one for a beast spell, the ceiling and a few of the
// strongest for a spell that gives any creature (a list of hundreds helps
// nobody choose).
export function shapeOffer(rule: ShapeRule, target: { name: string; level: number }, casterLevel: number): string {
  const forms = shapeForms(rule, target, casterLevel);
  if (!rule.anyCreature) {
    return formList(forms);
  }
  const cap = rule.crCap(target.level, casterLevel);
  const strongest = [...forms].sort((a, b) => b.cr - a.cr || compareNames(a.name, b.name)).slice(0, 8);
  return `any creature of CR ${formatCr(cap)} or lower${rule.barredTypes ? ` but a ${rule.barredTypes.join(" or ")}` : ""}, among them ${formList(strongest)}`;
}

// The form as the spell gives it: a Shapechange's average example has no
// Spellcasting trait and no legendary actions.
export function shapedForm(rule: ShapeRule, form: BeastForm): BeastForm {
  if (!rule.dropsTraits) {
    return form;
  }
  const traitLines = form.traitLines.filter((line) => !rule.dropsTraits!.test(line));
  if (traitLines.length === form.traitLines.length) {
    return form;
  }
  const out: BeastForm = { ...form, traitLines };
  delete out.traits;
  return traitLines.length ? { ...out, traits: traitLine(traitLines, 600) } : out;
}

// The sheet a transformed character's numbers are read from is
// src/lib/srd/form-sees.ts, which the browser loads without the form table.

// The damage and conditions the form shrugs off, in words, or "".
export function formDefenses(form: BeastForm): string {
  return [
    form.resist ? `resists ${form.resist}` : "",
    form.immune ? `immune to ${form.immune}` : "",
    form.vulnerable ? `vulnerable to ${form.vulnerable}` : "",
    form.conditionImmune ? `cannot be ${form.conditionImmune}` : "",
  ].filter(Boolean).join("; ");
}

// The ability scores the form gives: the creature's, with the target's own
// mind where the spell keeps it.
export function shapedAbilities(rule: ShapeRule, form: BeastForm, own: BeastForm["abilities"]): BeastForm["abilities"] {
  return rule.keepsMind ? { ...form.abilities, int: own.int, wis: own.wis, cha: own.cha } : form.abilities;
}
