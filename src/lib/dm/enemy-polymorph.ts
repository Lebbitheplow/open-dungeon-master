// Polymorph (and True Polymorph's creature into a beast) cast at a hostile
// creature (SRD 5.1). The creature makes a WIS save against the caster's DC
// through rollEnemySave, so Magic Resistance, its conditions and lasting
// effects count, and a legendary creature may spend a Legendary Resistance.
// On a failure its game statistics become the beast's (the form table in
// src/lib/srd/beast-forms.ts, the one the character side reads), keeping its
// alignment, and it takes the beast's hit points. The own block rides on the
// row (EnemyStats.polymorphedFrom) and comes back exactly when the spell ends:
// the polymorphed condition carries the spell and the caster
// (src/lib/dm/spell-effects.ts), so concentration, the hour and Dispel Magic
// end it the way they end any spell's condition (src/lib/db/encounters.ts
// patchEnemyConditions), and a beast dropped to 0 reverts with the excess
// carried over (src/lib/dm/enemy-damage.ts).
//
// Reached from cast_buff with targetEnemyId and from cast_at_enemy; both pass
// the slot spend in, so this module never imports mutations.ts.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, type EncounterEnemy } from "@/lib/db/encounters";
import { restoreOwnForm, writeEnemyForm } from "@/lib/db/enemy-form";
import { spellFactsFor } from "@/lib/content";
import { spellSaveDcFor } from "@/lib/srd";
import { findBeastForm, formatCr } from "@/lib/srd/beast-forms";
import { conditionUntargetable } from "@/lib/srd/condition-effect-queries";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { autoLegendaryResistance } from "@/lib/dm/legendary-tools";
import { charmedBy } from "@/lib/dm/enemy-profile";
import { castingHold } from "@/lib/dm/spell-planes";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { layOnEnemy } from "@/lib/dm/spell-riders";
import { spellConditionMeta } from "@/lib/dm/spell-effects";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { beastEnemyStats, enemyShapeProblem, enemyShapeSpellFor } from "@/lib/dm/enemy-polymorph-logic";

export { enemyShapeSpellFor };

export type EnemyShapeCast = {
  caster: CharacterSheet;
  enemy: EncounterEnemy;
  spell: string;
  // The beast, by name ("brown bear").
  variant?: string;
  level?: number;
  reason?: string;
  authors: string[];
};

const POLYMORPHED = "polymorphed";

export function castShapeAtEnemy(
  campaign: Campaign,
  turn: DmTurn,
  input: EnemyShapeCast,
  spend: (cast: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const rule = enemyShapeSpellFor(input.spell);
  if (!rule) {
    return { error: `${input.spell} cannot turn a creature into a beast; only Polymorph and True Polymorph do.` };
  }
  const { caster } = input;
  const enemy = getEnemy(input.enemy.id) ?? input.enemy;
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || enemy.encounterId !== encounter.id) {
    return { error: "Unknown targetEnemyId; use one from GAME STATE. Nothing was spent." };
  }
  if (enemy.status !== "alive") {
    return { error: `${enemy.displayName} is already ${enemy.status}. Nothing was spent.` };
  }
  const form = findBeastForm(input.variant ?? "");
  if (!form) {
    return {
      error: `${rule.spell} needs the beast in variant, one the table knows (e.g. 'wolf', 'brown bear', 'giant spider'). Nothing was spent.`,
    };
  }
  const problem = enemyShapeProblem(rule, form, enemy);
  if (problem) {
    return { error: problem };
  }
  // The refusals cast_at_enemy gives any spell at a creature, for the way in
  // through cast_buff too.
  if (charmedBy(caster.conditions, caster.conditionMeta, enemy.id)) {
    return { error: `${caster.name} is charmed by ${enemy.displayName} and cannot target it with harmful magic. Nothing was spent; pick another target.` };
  }
  const away = castingHold(caster);
  if (away) {
    return { error: away };
  }
  const sealed = conditionUntargetable(enemy.conditions) ?? (enemy.conditions.includes("banished") ? "banished" : null);
  if (sealed) {
    return { error: `${enemy.displayName} is ${sealed} and nothing from outside reaches it until that ends. Nothing was spent.` };
  }
  const reach = spellReachProblem({
    encounterId: encounter.id,
    casterId: caster.id,
    casterName: caster.name,
    targetId: enemy.id,
    targetName: enemy.displayName,
    facts: spellFactsFor(rule.spell, input.authors),
  });
  if (reach) {
    return { error: reach };
  }
  const dc = spellSaveDcFor(caster, rule.spell);
  if (dc === null) {
    return { error: `${caster.name} has no spell save DC. Nothing was spent.` };
  }

  // The cast, through the one guard: slot, turn, components, concentration.
  const cast = spend({
    characterId: caster.id,
    spell: rule.spell,
    ...(input.level ? { level: input.level } : {}),
    via: "enemy",
    reason: (input.reason ?? "").slice(0, 200),
  });
  if ("error" in cast) {
    return cast;
  }
  const slotLevel = typeof cast.slotLevel === "number" ? cast.slotLevel : null;
  const base: Record<string, unknown> = {
    spell: rule.spell,
    caster: caster.name,
    target: enemy.displayName,
    ...(cast.cost ? { cost: cast.cost } : {}),
    ...(cast.slot ? { slot: cast.slot } : {}),
    ...(cast.droppedConcentration ? { droppedConcentration: cast.droppedConcentration } : {}),
  };

  // An unwilling creature makes a WIS save; every enemy is unwilling.
  const live = getEnemy(enemy.id) ?? enemy;
  const save = rollEnemySave(campaign.id, live, "wis", dc, {
    magical: true,
    record: { turn, detail: `${live.displayName}: WIS save against ${rule.spell}` },
  });
  let saved = save.success;
  Object.assign(base, {
    ...(save.autoFailed ? { autoFailed: save.notes.join("; ") } : { save: save.total }),
    dc,
    saved,
    ...(save.notes.length && !save.autoFailed ? { saveNotes: save.notes } : {}),
  });
  if (!saved) {
    const liveEncounter = getActiveEncounter(campaign.id);
    if (liveEncounter && autoLegendaryResistance(campaign, liveEncounter, live)) {
      saved = true;
      base.saved = true;
      base.legendaryResistance = "spent: the failed save becomes a success";
    }
  }
  if (saved) {
    return { ok: true, ...base, note: `${live.displayName} resists: it keeps its own form. The slot is spent.` };
  }

  // The swap, then the condition that carries the spell and its caster.
  writeEnemyForm(live.id, beastEnemyStats(form, live.stats, rule.spell, { ac: live.ac, maxHp: live.maxHp, currentHp: live.currentHp }));
  const meta = spellConditionMeta(
    { rounds: rule.rounds ?? undefined },
    { spell: rule.spell, casterId: caster.id, slotLevel },
    null,
  );
  const landed = layOnEnemy(live.id, [[POLYMORPHED, meta]]);
  if (!landed.length) {
    // Nothing holds the form without its condition: put the creature back.
    const own = getEnemy(live.id)?.stats.polymorphedFrom;
    if (own) {
      restoreOwnForm(live.id, own);
    }
    publishEncounter(campaign.id);
    return { ok: true, ...base, note: `${live.displayName} cannot be polymorphed; it keeps its own form. The slot is spent.` };
  }
  publishEncounter(campaign.id);
  return {
    ok: true,
    ...base,
    conditionApplied: POLYMORPHED,
    form: `${form.name} (CR ${formatCr(form.cr)}): ${form.hp} HP, AC ${form.ac}, speed ${form.speed} ft`,
    formAttacks: form.attacks.map((attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type})`).join(", "),
    duration: rule.rounds ? "1 hour, or until the caster's concentration ends" : "until the caster's concentration ends; held the full hour, until dispelled",
    note: `${live.displayName} becomes a ${form.name}: the beast's statistics replace its own (it keeps its alignment and personality), it cannot speak or cast spells, and it fights with the beast's attacks through enemy_attack. When the beast drops to 0 hit points or the spell ends, its own form returns with the hit points it had, the excess damage carrying over. Narrate exactly this.`,
  };
}
