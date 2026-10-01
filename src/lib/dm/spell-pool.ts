// Sleep and Color Spray (SRD 5.1): no saving throw. The caster rolls one pool
// of hit points for the casting, spent on the caught creatures from the
// fewest current hit points up; a creature the rest of the pool does not
// cover is untouched. The pool rides the caster's turn budget, so a second
// creature the same turn draws on the same roll (cast_at_enemy), and
// aoe_damage spends it on everyone caught in one call.
//
// Imports nothing that imports the cast tools.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollExpression } from "@/lib/dice";
import type { SpellMech } from "@/lib/srd/spell-mechanics";
import { addDice } from "@/lib/srd/spell-scaling";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { spellKeyOf } from "@/lib/dm/cast-rules";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { laySpellConditionsOnEnemy, spellConditionMeta } from "@/lib/dm/spell-effects";
import type { AoeSpellPlan } from "@/lib/dm/aoe-spell";

// Sleep and Color Spray roll one pool of hit points for the casting; what a
// creature's hit points took out of it is gone for the next one. Kept on
// the turn budget beside the open casting, so a second call the same turn
// spends the same roll.
const POOL = "cast-pool";

export function poolLeftOf(budget: TurnBudget | null, spell: string): number | null {
  const wanted = spellKeyOf(spell);
  for (const entry of budget?.oncePerTurn ?? []) {
    const [tag, name, left] = entry.split("|");
    if (tag === POOL && name === wanted) {
      return Number(left);
    }
  }
  return null;
}

export function withPoolLeft(budget: TurnBudget, spell: string, left: number): TurnBudget {
  const wanted = spellKeyOf(spell);
  return {
    ...budget,
    oncePerTurn: [
      ...budget.oncePerTurn.filter((entry) => {
        const [tag, name] = entry.split("|");
        return !(tag === POOL && name === wanted);
      }),
      [POOL, wanted, Math.max(0, Math.floor(left))].join("|"),
    ],
  };
}


// One creature against the pool: the caster rolls one pool of hit
// points for the casting, and a creature whose hit points what is left of it
// covers is affected, its hit points taken out of the pool; one with more is
// untouched. A second creature the same turn draws on what is left (the pool
// rides the turn budget, cast-rules.ts). The caller picks the order: the
// lowest first, as the spell has it.
export function sleepPool(
  campaign: Campaign,
  encounterId: string,
  caster: Pick<CharacterSheet, "id" | "name">,
  enemy: EncounterEnemy,
  spell: string,
  pool: NonNullable<SpellMech["hitPointPool"]>,
  input: {
    spellLevel: number;
    slotLevel: number;
    continuing: boolean;
    source: { spell: string; casterId: string; slotLevel: number | null };
    note?: string;
  },
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  const budget = encounter?.turnBudget && encounter.turnBudget.ownerId === caster.id ? encounter.turnBudget : null;
  const carried = input.continuing ? poolLeftOf(budget, spell) : null;
  const dice = addDice(pool.dice, pool.perSlotLevel, Math.max(0, input.slotLevel - input.spellLevel));
  const rolled = carried ?? rollExpression(dice).total;
  const out: Record<string, unknown> = {
    noSave: true,
    pool: carried === null ? `${dice}: ${rolled} hit points` : `${rolled} hit points left of the casting's roll`,
    ...(input.note ? { spellNote: input.note } : {}),
  };
  const keep = (left: number) => {
    const live = getActiveEncounter(campaign.id);
    if (live && live.turnBudget && live.turnBudget.ownerId === caster.id) {
      saveEncounter({ ...live, turnBudget: withPoolLeft(live.turnBudget, spell, left) });
    }
  };
  const type = (enemy.stats.type ?? "").toLowerCase();
  const immune =
    pool.immuneTypes?.some((entry) => type.includes(entry)) ||
    (pool.immuneCondition && enemy.stats.conditionImmune.toLowerCase().includes(pool.immuneCondition)) ||
    enemy.stats.conditionImmune.toLowerCase().includes(pool.condition);
  if (immune) {
    keep(rolled);
    return { ...out, note: `${enemy.displayName} is not affected by ${spell}; nothing happens to it.` };
  }
  if (pool.skipConditions?.some((entry) => enemy.conditions.includes(entry))) {
    keep(rolled);
    return { ...out, note: `${enemy.displayName} is already ${pool.skipConditions.find((entry) => enemy.conditions.includes(entry))}; the spell passes over it.` };
  }
  if (enemy.currentHp > rolled) {
    keep(rolled);
    return {
      ...out,
      note: `${enemy.displayName} has ${enemy.currentHp} hit points, more than the ${rolled} left in the spell: it is unaffected.`,
    };
  }
  const landed = laySpellConditionsOnEnemy(
    enemy.id,
    [pool.condition],
    spellConditionMeta({ rounds: pool.rounds, endsOnDamage: pool.endsOnDamage }, input.source, null),
  );
  keep(rolled - enemy.currentHp);
  if (landed.length) {
    publishEncounter(campaign.id);
  }
  void encounterId;
  return {
    ...out,
    conditionApplied: pool.condition,
    poolLeft: rolled - enemy.currentHp,
    duration: `${pool.rounds} round${pool.rounds === 1 ? "" : "s"}${pool.endsOnDamage ? ", or until it takes damage or is shaken awake" : ""}`,
  };
}

// aoe_damage: the pool spent on everyone caught, the fewest hit points first.
export function aoePool(
  campaign: Campaign,
  encounterId: string,
  plan: AoeSpellPlan,
  enemies: EncounterEnemy[],
  corrections: string[],
): Record<string, unknown> {
  const pool = plan.mech?.hitPointPool;
  if (!pool) {
    return { error: `${plan.spell} rolls no pool of hit points.` };
  }
  const ordered = [...enemies].sort((a, b) => a.currentHp - b.currentHp);
  const results: Array<Record<string, unknown>> = [];
  ordered.forEach((enemy, index) => {
    const outcome = sleepPool(campaign, encounterId, plan.caster, enemy, plan.spell, pool, {
      spellLevel: plan.spellLevel,
      slotLevel: plan.slotLevel ?? plan.spellLevel,
      continuing: index > 0,
      source: { spell: plan.spell, casterId: plan.caster.id, slotLevel: plan.slotLevel },
    });
    results.push({
      target: enemy.displayName,
      ...(outcome.conditionApplied ? { conditionApplied: outcome.conditionApplied } : {}),
      ...(outcome.note ? { note: outcome.note } : {}),
      ...(index === 0 && outcome.pool ? { pool: outcome.pool } : {}),
    });
  });
  return {
    ok: true,
    spell: plan.spell,
    caster: plan.caster.name,
    noSave: true,
    results,
    ...(corrections.length ? { corrected: corrections } : {}),
    ...(plan.mech?.note ? { spellNote: plan.mech.note } : {}),
  };
}
