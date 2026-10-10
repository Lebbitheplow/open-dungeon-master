// Polymorph and True Polymorph cast at a hostile creature (SRD 5.1), the pure
// half: which spells do it, what stops them before the slot is spent, and the
// beast's stat block in the shape an enemy row carries. The handler is
// src/lib/dm/enemy-polymorph.ts; the swap and the way back are
// src/lib/db/enemy-form.ts.

import { immutableForm } from "@/lib/dm/monster-traits";
import { formatCr, type BeastForm } from "@/lib/srd/beast-forms";
import { xpForCr } from "@/lib/srd/encounter-math";
import type { EnemyAttack, EnemySaveMods, EnemyStats, SaveAbility } from "@/lib/bestiary/statblock";

export type EnemyShapeSpell = {
  spell: string;
  // Polymorph has no effect on a shapechanger; True Polymorph names none.
  sparesShapechangers: boolean;
  // Rounds the form lasts, or null when it lasts until the spell ends: True
  // Polymorph held for its full hour stays until dispelled, so its form is
  // never counted down, only ended with the caster's concentration.
  rounds: number | null;
};

const HOUR = 600;

const SPELLS: Record<string, EnemyShapeSpell> = {
  polymorph: { spell: "Polymorph", sparesShapechangers: true, rounds: HOUR },
  "true polymorph": { spell: "True Polymorph", sparesShapechangers: false, rounds: null },
};

// The spells that may turn an enemy into a beast, by name; null for others.
export function enemyShapeSpellFor(spell: string): EnemyShapeSpell | null {
  return SPELLS[spell.trim().toLowerCase()] ?? null;
}

// A shapechanger says so in its type ("humanoid (shapechanger)") or in its
// Shapechanger trait; the snapshot keeps the trait even where the type lost
// its subtype.
export function isShapechanger(stats: Pick<EnemyStats, "traits" | "type">): boolean {
  return /shapechanger/i.test(stats.type ?? "") || (stats.traits ?? []).some((line) => /^shapechanger\b/i.test(line.trim()));
}

// The challenge rating the beast's is held to: the block's own, then the row's.
export function enemyCr(enemy: { cr: number; stats: Pick<EnemyStats, "cr"> }): number {
  return typeof enemy.stats.cr === "number" && Number.isFinite(enemy.stats.cr) ? enemy.stats.cr : enemy.cr;
}

// Why this creature cannot become this beast, or null. Asked before the slot
// is spent, so a refusal costs nothing.
export function enemyShapeProblem(
  rule: EnemyShapeSpell,
  form: BeastForm,
  enemy: { displayName: string; currentHp: number; cr: number; stats: EnemyStats },
): string | null {
  const name = enemy.displayName;
  if (enemy.stats.polymorphedFrom) {
    return `${name} is already a ${enemy.stats.polymorphedFrom.form} under ${enemy.stats.polymorphedFrom.spell}; it takes no second form until that one ends. Nothing was spent.`;
  }
  if (enemy.currentHp <= 0) {
    return `${rule.spell} has no effect on a creature at 0 hit points, and ${name} is at 0. Nothing was spent; pick another target.`;
  }
  // Immutable Form (the golems): no spell alters its form.
  if (immutableForm(enemy.stats)) {
    return `${name} has Immutable Form: it is immune to any spell or effect that would alter its form, and ${rule.spell} is one. Nothing was spent; pick another target or another spell.`;
  }
  if (rule.sparesShapechangers && isShapechanger(enemy.stats)) {
    return `${rule.spell} has no effect on a shapechanger, and ${name} is one. Nothing was spent; pick another target or another spell.`;
  }
  const cap = enemyCr(enemy);
  if (form.cr > cap) {
    return `${form.name} is CR ${formatCr(form.cr)}, above the CR ${formatCr(cap)} ${rule.spell} allows for ${name}: the beast's challenge rating may be no higher than the creature's own. Nothing was spent; offer a lesser form.`;
  }
  return null;
}

const ABILITIES: SaveAbility[] = ["str", "dex", "con", "int", "wis", "cha"];
const modifier = (score: number) => Math.floor((score - 10) / 2);

// "40 ft climb" in a form's trait line: the movement the table keeps only as
// words, written the way a parsed block writes its speed ("40, climb 30").
function speedOf(form: BeastForm): string {
  const modes = [...(form.traits ?? "").matchAll(/(\d+) ft (fly|swim|climb|burrow)\b/gi)].map(
    ([, feet, mode]) => `${mode.toLowerCase()} ${feet}`,
  );
  return [String(form.speed), ...new Set(modes)].join(", ");
}

// The beast's whole stat block in place of the creature's (SRD 5.1: its game
// statistics, mental scores included, are replaced), keeping only its
// alignment. `own` rides along so the spell's end can give it back exactly.
export function beastEnemyStats(form: BeastForm, own: EnemyStats, spell: string, ownHp: { ac: number; maxHp: number; currentHp: number }): EnemyStats {
  const saveMods = Object.fromEntries(ABILITIES.map((ability) => [ability, modifier(form.abilities[ability])])) as EnemySaveMods;
  const attacks: EnemyAttack[] = form.attacks.map((attack) => ({ ...attack, mode: "melee" }));
  // A Multiattack with one swing of each attack (a bear's bite and claws) is
  // that routine; the same attack twice (an ape's fists) needs none.
  const perTurn = form.attacksPerTurn ?? 1;
  const eachOnce = perTurn > 1 && attacks.length === perTurn;
  return {
    ac: form.ac,
    maxHp: form.hp,
    dexMod: modifier(form.abilities.dex),
    saveMods,
    speed: speedOf(form),
    attacks,
    // The first line tells whoever runs it what it is and how it ends.
    traits: [
      `Polymorphed (${spell}): a ${form.name} until the spell ends or the beast drops to 0 hit points; then its own form returns and the excess damage carries over. It cannot speak or cast spells.`,
      ...(form.traits ? [form.traits] : []),
    ],
    resist: "",
    immune: "",
    vulnerable: "",
    conditionImmune: "",
    cr: form.cr,
    xp: xpForCr(form.cr),
    attacksPerTurn: perTurn,
    ...(eachOnce ? { routines: [attacks.map((attack) => ({ attack: attack.name, count: 1 }))] } : {}),
    size: form.size,
    type: "beast",
    abilities: { ...form.abilities },
    ...(own.alignment ? { alignment: own.alignment } : {}),
    polymorphedFrom: { form: form.name, spell, stats: own, ...ownHp },
  };
}
