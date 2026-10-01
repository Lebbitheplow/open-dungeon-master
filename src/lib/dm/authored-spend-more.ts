// The authored spends the final round added (src/lib/dm/authored-spend-effects.ts
// resolves the rest):
//
//   - Gathered Swarm's push: after the ranger hits a creature, the swarm moves
//     it up to 15 feet on a failed STR save against the ranger's spell save
//     DC, in place of the swarm's damage that turn (the spend claims the same
//     once-a-turn key as the damage rider, "rider:gathered swarm"). With
//     Mighty Swarm the moved creature is also knocked prone.
//   - The reroll of the last failed save (Fanatical Focus, as Indomitable
//     does): a success lifts what that failure laid on them.

import { getActiveEncounter, getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { listRecentRolls } from "@/lib/db/rolls";
import { getSheetById } from "@/lib/db/sheets";
import { computeSheetDerived } from "@/lib/srd";
import { swarmKnocksProne } from "@/lib/srd/authored-effects-more";
import type { Ability, SpendDoes } from "@/lib/srd/authored-effects-types";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollFeatureSave } from "@/lib/dm/contest-roll";
import { publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { pushTokenAway } from "@/lib/dm/map-tools";
import type { SpendContext } from "@/lib/dm/authored-spend-effects";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";

type Resolution = { error: string } | { result: Record<string, unknown> };

export function swarmPush(ctx: SpendContext, does: Extract<SpendDoes, { kind: "swarm_push" }>): Resolution {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} moves a creature in a fight; there is no fight. Nothing was spent.` };
  }
  // The creature the ranger hit: the one named, else the last they attacked
  // this round.
  const pairs = encounter.targets?.round === encounter.round ? encounter.targets.pairs[ctx.sheet.id] : undefined;
  const ref = ctx.args.targetEnemyId ?? pairs?.[pairs.length - 1];
  const enemy = ref ? resolveEnemyRef(encounter.id, ref) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name} moves the creature ${ctx.sheet.name} just hit: pass its targetEnemyId. Nothing was spent.` };
  }
  if (!pairs?.includes(enemy.id)) {
    return { error: `${ctx.spend.name} follows ${ctx.sheet.name}'s hit on ${enemy.displayName} this turn, and they have not attacked it this round. Nothing was spent.` };
  }
  const derived = computeSheetDerived(ctx.sheet);
  const dc = derived.spellSaveDc ?? 8 + derived.proficiencyBonus + derived.abilityMods.wis;
  const save = rollEnemySave(ctx.campaign.id, enemy, "str", dc, {
    magical: true,
    record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: STR save against ${ctx.spend.name}` },
  });
  if (save.success) {
    return { result: { target: enemy.displayName, save: save.total, dc, applied: `${enemy.displayName} holds its ground against the swarm.` } };
  }
  const steps = Math.max(1, Math.floor(does.feet / 5));
  let moved = 0;
  let stopped = "";
  for (let step = 0; step < steps; step += 1) {
    const pushed = pushTokenAway(ctx.campaign, encounter.id, ctx.sheet.id, enemy.id);
    if (!pushed.moved) {
      stopped = pushed.reason;
      break;
    }
    moved += 1;
  }
  const lines = [`The swarm moves ${enemy.displayName} ${moved * 5} feet${stopped && moved < steps ? ` (${stopped})` : ""}.`];
  const prone = swarmKnocksProne(ctx.sheet);
  const fresh = getEnemy(enemy.id);
  if (prone && fresh && !fresh.conditions.some((entry) => entry.toLowerCase() === "prone")) {
    patchEnemyConditions(fresh.id, [...fresh.conditions, "prone"], {
      ...(fresh.conditionMeta as ConditionMetaMap),
      prone: { source: ctx.sheet.id },
    } as typeof fresh.conditionMeta);
    lines.push(`${prone}: ${enemy.displayName} is knocked prone.`);
  }
  publishEncounter(ctx.campaign.id);
  return { result: { target: enemy.displayName, save: save.total, dc, applied: lines } };
}

// The save the character last failed, rolled again; a success lifts what
// that failure laid on them (Fanatical Focus, as Indomitable does).
export function rerollLastSave(ctx: SpendContext): { error: string } | { patch?: FullPatchSheetInput; result: Record<string, unknown> } {
  const { campaign, sheet } = ctx;
  const failed = listRecentRolls(campaign.id, 60).find(
    (roll) => roll.characterId === sheet.id && roll.kind === "saving_throw" && roll.dc !== null && roll.total < roll.dc,
  );
  const ability = failed ? ((/\b(str|dex|con|int|wis|cha)\b/i.exec(failed.detail)?.[1] ?? "").toLowerCase() as Ability | "") : "";
  if (!failed || !ability) {
    return { error: `${sheet.name} has no failed saving throw to reroll; ${ctx.spend.name} was not spent.` };
  }
  const dc = failed.dc!;
  const against = /\bvs\.? (.+)$/i.exec(failed.detail)?.[1];
  const save = rollFeatureSave(campaign, sheet, ability, dc, `${ctx.spend.name} reroll`, against);
  if (!save.success) {
    return { result: { reroll: `The reroll fails too (${ability.toUpperCase()} ${save.total ?? "failed"} vs DC ${dc}); the failure stands.` } };
  }
  const now = getSheetById(sheet.id) ?? sheet;
  const meta = now.conditionMeta as ConditionMetaMap;
  const lifted = now.conditions.filter((name) => {
    const ends = meta[name]?.saveEnds;
    return ends && ends.ability === ability && ends.dc === dc;
  });
  const cleared = removeConditions(now.conditions, now.conditionMeta, lifted);
  return {
    patch: lifted.length ? { conditions: cleared.conditions, conditionMeta: cleared.meta } : {},
    result: { reroll: `The reroll succeeds (${ability.toUpperCase()} ${save.total} vs DC ${dc})${lifted.length ? `: ${lifted.join(", ")} no longer holds them` : ""}.` },
  };
}
