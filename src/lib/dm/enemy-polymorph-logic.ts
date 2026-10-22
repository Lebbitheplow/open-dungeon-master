// Polymorph and True Polymorph cast at a hostile creature (SRD 5.1), the pure
// half: which spells do it, what stops them before the slot is spent, and the
// form's stat block in the shape an enemy row carries. Polymorph gives a
// beast; True Polymorph any creature, of a challenge rating no higher than
// the target's. The handler is
// src/lib/dm/enemy-polymorph.ts; the swap and the way back are
// src/lib/db/enemy-form.ts.

import { immutableForm } from "@/lib/dm/monster-traits";
import { BEAST_FORMS, SHAPE_FORMS, formatCr, formList, type BeastForm } from "@/lib/srd/beast-forms";
import { proficiencyBonus } from "@/lib/srd";
import { enemyAttackOf } from "@/lib/srd/creature-attacks";
import { xpForCr } from "@/lib/srd/encounter-math";
import type { EnemyAttack, EnemySaveMods, EnemyStats, SaveAbility } from "@/lib/bestiary/statblock";
import type { ToolError } from "@/lib/dm/tool-errors";
import { compareNames, textKey } from "@/lib/language/text-logic";

export type EnemyShapeSpell = {
  spell: string;
  // Polymorph has no effect on a shapechanger; True Polymorph names none.
  sparesShapechangers: boolean;
  // Rounds the form lasts, or null when it lasts until the spell ends: True
  // Polymorph held for its full hour stays until dispelled, so its form is
  // never counted down, only ended with the caster's concentration.
  rounds: number | null;
  // Any kind of creature (True Polymorph), not a beast alone.
  anyCreature?: boolean;
};

const HOUR = 600;

const SPELLS: Record<string, EnemyShapeSpell> = {
  polymorph: { spell: "Polymorph", sparesShapechangers: true, rounds: HOUR },
  "true polymorph": { spell: "True Polymorph", sparesShapechangers: false, rounds: null, anyCreature: true },
};

// The spells that may turn an enemy into a beast, by name; null for others.
export function enemyShapeSpellFor(spell: string): EnemyShapeSpell | null {
  return SPELLS[textKey(spell)] ?? null;
}

// A shapechanger says so in its type ("humanoid (shapechanger)"), its
// subtype (a succubus's, a Black Flag vampire's, which print no trait for
// it) or its Shapechanger trait.
export function isShapechanger(stats: Pick<EnemyStats, "traits" | "type" | "subtype">): boolean {
  return /shapechanger/i.test(`${stats.type ?? ""} ${stats.subtype ?? ""}`) || (stats.traits ?? []).some((line) => /^shapechanger\b/i.test(line.trim()));
}

// The forms the spell draws from: every creature, or the beasts.
export function enemyShapeForms(rule: EnemyShapeSpell): BeastForm[] {
  return rule.anyCreature ? SHAPE_FORMS : BEAST_FORMS;
}

// The forms a creature of this challenge rating may become, as a question
// or a refusal names them: every beast, or the ceiling and a few of the
// strongest when any creature will do.
export function enemyShapeOffer(rule: EnemyShapeSpell, cap: number): string {
  const forms = enemyShapeForms(rule).filter((entry) => entry.cr <= cap);
  if (!rule.anyCreature) {
    return formList(forms);
  }
  const strongest = [...forms].sort((a, b) => b.cr - a.cr || compareNames(a.name, b.name)).slice(0, 8);
  return `any creature of CR ${formatCr(cap)} or lower, among them ${formList(strongest)}`;
}

// The challenge rating the form's is held to: the block's own, then the row's.
export function enemyCr(enemy: { cr: number; stats: Pick<EnemyStats, "cr"> }): number {
  return typeof enemy.stats.cr === "number" && Number.isFinite(enemy.stats.cr) ? enemy.stats.cr : enemy.cr;
}

// Why this creature cannot become this form, or null. Asked before the slot
// is spent, so a refusal costs nothing.
export function enemyShapeProblem(
  rule: EnemyShapeSpell,
  form: BeastForm,
  enemy: { displayName: string; currentHp: number; cr: number; stats: EnemyStats },
): ToolError | null {
  const name = enemy.displayName;
  if (enemy.stats.polymorphedFrom) {
    return { error: `${name} is already a ${enemy.stats.polymorphedFrom.form} under ${enemy.stats.polymorphedFrom.spell}; it takes no second form until that one ends. Nothing was spent.`, refused: "rules" };
  }
  const cap = enemyCr(enemy);
  if (!rule.anyCreature && form.type !== "beast") {
    return { error: `${form.name} is a ${form.type}, not a beast; ${rule.spell} gives a beast's form. Nothing was spent; offer a beast: ${enemyShapeOffer(rule, cap)}.`, retry: true };
  }
  if (form.cr > cap) {
    return { error: `${form.name} is CR ${formatCr(form.cr)}, above the CR ${formatCr(cap)} ${rule.spell} allows for ${name}: the form's challenge rating may be no higher than the creature's own. Nothing was spent; offer a lesser form: ${enemyShapeOffer(rule, cap)}.`, retry: true };
  }
  return null;
}

// Why the spell, cast at this creature, has no effect on it, or null: it is
// cast, and spent, all the same (SRD 5.1).
export function enemyShapeNoEffect(rule: EnemyShapeSpell, enemy: { displayName: string; currentHp: number; stats: EnemyStats }): string | null {
  if (enemy.currentHp <= 0) {
    return `${enemy.displayName} is at 0 hit points: ${rule.spell} has no effect on it.`;
  }
  // Immutable Form (the golems): no spell alters its form.
  if (immutableForm(enemy.stats)) {
    return `${enemy.displayName} has Immutable Form, immune to any spell that would alter its form: ${rule.spell} has no effect on it.`;
  }
  if (rule.sparesShapechangers && isShapechanger(enemy.stats)) {
    return `${enemy.displayName} is a shapechanger: ${rule.spell} has no effect on it.`;
  }
  return null;
}

const ABILITIES: SaveAbility[] = ["str", "dex", "con", "int", "wis", "cha"];
const modifier = (score: number) => Math.floor((score - 10) / 2);

// The form's movement the way a parsed block writes its speed: "40, climb 30".
function speedOf(form: BeastForm): string {
  const modes = (["fly", "swim", "climb", "burrow"] as const)
    .filter((mode) => form.speeds[mode])
    .map((mode) => `${mode} ${form.speeds[mode]}`);
  return [String(form.speed), ...modes].join(", ");
}

// The form's whole stat block in place of the creature's (SRD 5.1: its game
// statistics, mental scores included, are replaced), keeping only its
// alignment: its saving throws (the proficient ones with the proficiency
// bonus its challenge rating carries), defenses, type and size. `own` rides
// along so the spell's end can give it back exactly.
export function beastEnemyStats(form: BeastForm, own: EnemyStats, spell: string, ownHp: { ac: number; maxHp: number; currentHp: number }): EnemyStats {
  const pb = proficiencyBonus(Math.max(1, form.cr));
  const saveMods = Object.fromEntries(
    ABILITIES.map((ability) => [ability, modifier(form.abilities[ability]) + (form.saves?.includes(ability) ? pb : 0)]),
  ) as EnemySaveMods;
  // Each attack with its reach or range, its rider dice and what its hit
  // carries (a constrictor's grapple, a spider's poison), which the enemy's
  // own engine lands.
  const attacks: EnemyAttack[] = form.attacks.map(enemyAttackOf);
  // The Multiattack as the block writes it: a bear's bite and claws, an
  // ape's two fists.
  const perTurn = form.attacksPerTurn ?? 1;
  return {
    ac: form.ac,
    maxHp: form.hp,
    dexMod: modifier(form.abilities.dex),
    saveMods,
    speed: speedOf(form),
    attacks,
    // The first line tells whoever runs it what it is and how it ends.
    traits: [
      `Polymorphed (${spell}): a ${form.name} until the spell ends or the form drops to 0 hit points; then its own form returns and the excess damage carries over. It cannot speak or cast spells unless the form can.`,
      ...form.traitLines,
    ],
    resist: form.resist ?? "",
    immune: form.immune ?? "",
    vulnerable: form.vulnerable ?? "",
    conditionImmune: form.conditionImmune ?? "",
    cr: form.cr,
    xp: xpForCr(form.cr),
    attacksPerTurn: perTurn,
    ...(form.routines ? { routines: form.routines } : {}),
    size: form.size,
    type: form.type,
    abilities: { ...form.abilities },
    ...(own.alignment ? { alignment: own.alignment } : {}),
    polymorphedFrom: { form: form.name, spell, stats: own, ...ownHp },
  };
}
