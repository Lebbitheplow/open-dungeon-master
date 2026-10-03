// What a running spell does at the END of the target's turn (SRD 5.1):
//
//   Acid Arrow: 2d4 acid (1d4 more a slot level above 2nd) at the end of
//     the target's next turn after the hit.
//   Phantasmal Killer, Weird: the frightened creature saves at the end of
//     each of its turns; a failure deals the spell's dice, a success ends the
//     spell for it.
//   Flesh to Stone: the restrained creature saves at the end of each of its
//     turns; three failures petrify it, three successes free it.
//
// Each leaves a mark named for the spell with `untilTurnEndOf` the target
// (src/lib/dm/spell-riders.ts turnEndMark, src/lib/dm/spell-attack-riders.ts);
// the pointer ends the mark as that turn ends (src/lib/dm/turn-end.ts) and
// asks here what the ending does. A mark that must come back for the next
// turn is laid again.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { spellSaveDcFor } from "@/lib/srd";
import { spellMechanicsFor } from "@/lib/content";
import { addDice } from "@/lib/srd/spell-scaling";
import { removeConditions, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { lastCastSlot, spellKey } from "@/lib/dm/spell-effects";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";

type TurnEndHook = (campaign: Campaign, enemy: EncounterEnemy, meta: ConditionMeta) => string | null;

// Acid Arrow's second burn.
function acidArrowBurn(campaign: Campaign, enemy: EncounterEnemy, meta: ConditionMeta): string | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || enemy.status !== "alive") {
    return null;
  }
  const slot = meta.slotLevel ?? (meta.source ? lastCastSlot(meta.source, "Acid Arrow") : null) ?? 2;
  const dice = addDice("2d4", "1d4", Math.max(0, slot - 2));
  const caster = meta.source ? getSheetById(meta.source) : null;
  const burn = rollCard(campaign, null, caster?.id ?? null, "damage", rollAgainst("Acid Arrow (second burn)", enemy.displayName), dice, caster ? sheetAttacker(caster) : null).total;
  return hurtEnemy(campaign, encounter, enemy, burn, "acid", "Acid Arrow's acid");
}

// The mark goes back on for the next turn's end.
function rearm(enemyId: string, mark: string, meta: ConditionMeta) {
  const live = getEnemy(enemyId);
  if (!live || live.status !== "alive") {
    return;
  }
  // Waiting on the next turn: not yet begun.
  const next: ConditionMeta = { ...meta, untilTurnEndOf: live.id };
  delete next.turnBegun;
  const conditions = live.conditions.includes(mark) ? live.conditions : [...live.conditions, mark];
  patchEnemyConditions(live.id, conditions, { ...(live.conditionMeta as ConditionMetaMap), [mark]: next });
}

// Phantasmal Killer, Weird and Flesh to Stone: the save at the end of the
// creature's turn, while the spell still holds it.
function saveAtTurnEnd(campaign: Campaign, enemy: EncounterEnemy, meta: ConditionMeta): string | null {
  const encounter = getActiveEncounter(campaign.id);
  const resolved = meta.spell ? spellMechanicsFor({ spell: meta.spell }) : null;
  const edge = resolved?.mech.condition?.turnEnd;
  const caster = meta.source ? getSheetById(meta.source) : null;
  if (!encounter || !resolved?.mech.save || !edge || !caster || enemy.status !== "alive") {
    return null;
  }
  const tag = spellKey(resolved.name);
  const held = enemy.conditions.filter((name) => {
    const entry = (enemy.conditionMeta as ConditionMetaMap)[name];
    return Boolean(entry?.spell && spellKey(entry.spell) === tag && entry.source === caster.id);
  });
  if (!held.length) {
    return null;
  }
  const ability = resolved.mech.save;
  const dc = spellSaveDcFor(caster, resolved.name) ?? 13;
  const save = rollEnemySave(campaign.id, enemy, ability, dc, {
    magical: true,
    record: { detail: `${enemy.displayName}: ${ability.toUpperCase()} save against ${resolved.name}` },
  });
  const release = () => {
    const cleared = removeConditions(enemy.conditions, enemy.conditionMeta, held);
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    return cleared;
  };
  if (edge.tally) {
    const tally = { passed: meta.tally?.passed ?? 0, failed: meta.tally?.failed ?? 0 };
    tally[save.success ? "passed" : "failed"] += 1;
    if (tally.failed >= edge.tally.fails) {
      const cleared = release();
      patchEnemyConditions(enemy.id, [...cleared.conditions, edge.tally.becomes], {
        ...cleared.meta,
        [edge.tally.becomes]: { spell: resolved.name, source: caster.id },
      });
      return `${enemy.displayName} fails its ${ability.toUpperCase()} save against ${resolved.name} a third time and is ${edge.tally.becomes}.`;
    }
    if (tally.passed >= edge.tally.fails) {
      release();
      return `${enemy.displayName} succeeds on its third ${ability.toUpperCase()} save and ${resolved.name} ends.`;
    }
    rearm(enemy.id, tag, { ...meta, tally });
    return `${enemy.displayName} ${save.success ? "resists" : "stiffens"}: ${ability.toUpperCase()} save against ${resolved.name} (${tally.failed} failed, ${tally.passed} passed).`;
  }
  if (save.success) {
    release();
    return `${enemy.displayName} masters its terror: ${resolved.name} ends for it (${ability.toUpperCase()} save against DC ${dc}).`;
  }
  rearm(enemy.id, tag, meta);
  const slot = meta.slotLevel ?? edge.baseLevel;
  const dice = edge.dice && edge.perSlotLevel ? addDice(edge.dice, edge.perSlotLevel, Math.max(0, slot - edge.baseLevel)) : edge.dice;
  if (!dice) {
    return null;
  }
  const hurt = rollCard(campaign, null, caster?.id ?? null, "damage", rollAgainst(resolved.name, enemy.displayName), dice, caster ? sheetAttacker(caster) : null).total;
  return hurtEnemy(campaign, encounter, enemy, hurt, edge.type ?? "psychic", resolved.name);
}

const HOOKS: Record<string, TurnEndHook> = {
  "acid arrow": acidArrowBurn,
  "phantasmal killer": saveAtTurnEnd,
  weird: saveAtTurnEnd,
  "flesh to stone": saveAtTurnEnd,
  // Prismatic Spray's indigo ray (src/lib/dm/prismatic.ts).
  "indigo ray": saveAtTurnEnd,
};

// What the end of a spell's mark does, or null for a mark that only ends.
export function spellTurnEndHook(condition: string): TurnEndHook | null {
  return HOOKS[condition.trim().toLowerCase()] ?? null;
}
