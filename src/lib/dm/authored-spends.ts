// use_resource on an authored subclass feature whose effect the server
// resolves (src/lib/srd/authored-effects-data*.ts, `spends`): the checks,
// the turn's cost, the pool it spends and the effect, in that order, so a
// refusal costs nothing. Before this a feature like Kensei's Shot, Symbiotic
// Entity or Touch of the Long Death had no counter and no effect: use_resource
// said the character had no such resource and the model narrated the text.
//
// Called from the use_resource arm of src/lib/dm/mutations.ts before the
// generic path. Must not import mutations.ts (which imports it).

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getDmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, saveEncounter } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { authoredSpendFor, gateHolds, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import type { SpendAction, SpendDoes } from "@/lib/srd/authored-effects-types";
import { canAct } from "@/lib/dm/can-act";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { spendAction } from "@/lib/dm/action-budget";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { resolveSpendEffect, type SpendContext } from "@/lib/dm/authored-spend-effects";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

export type AuthoredSpendArgs = {
  amount?: number;
  variant?: string;
  targetCharacterId?: string;
  targetEnemyId?: string;
};

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

function audit(campaign: Campaign, turnId: string, sheet: CharacterSheet, delta: Record<string, unknown>, reason: string, patch: Record<string, unknown>) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId: turnId || null,
    kind: "use_resource",
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

function gateSentence(spend: AuthoredSpend): string {
  const gate = spend.gate ?? {};
  if (gate.raging) return `${spend.name} works only while raging (and not in heavy armor).`;
  if (gate.condition) return `${spend.name} works only while ${gate.condition} holds.`;
  if (gate.choice) return `${spend.name} belongs to the ${gate.choice} option, which this character has not chosen.`;
  if (gate.choiceOf) return `${spend.name} belongs to the ${gate.choiceOf.value} ${gate.choiceOf.feature}, which this character has not chosen.`;
  return `${spend.name} cannot be used right now.`;
}

// The turn's cost, checked first and written last (the resource-turn.ts
// pattern for features that are not counters).
function prepareCost(
  campaign: Campaign,
  sheet: CharacterSheet,
  cost: SpendAction | undefined,
  label: string,
  onceKey: string | null,
): { error: string } | { commit: () => Record<string, unknown> } {
  const encounter = getActiveEncounter(campaign.id);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  if (!inFight || !encounter) {
    return { commit: () => ({}) };
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions));
  if (onceKey && budget?.oncePerTurn.includes(onceKey)) {
    return { error: `${label} is used once a turn, and ${sheet.name} has used it this turn.` };
  }
  if (cost === "reaction") {
    if (encounter.reactionsUsed.includes(sheet.id)) {
      return { error: `${sheet.name} has already used their reaction; it comes back at the start of their next turn. ${label} does not happen.` };
    }
    return {
      commit: () => {
        const live = getActiveEncounter(campaign.id);
        if (live && !live.reactionsUsed.includes(sheet.id)) {
          live.reactionsUsed = [...live.reactionsUsed, sheet.id];
          saveEncounter(live);
        }
        return { cost: "their reaction" };
      },
    };
  }
  if (!cost || cost === "none") {
    return {
      commit: () => {
        const live = getActiveEncounter(campaign.id);
        if (onceKey && live && budget) {
          storeBudget(live, { ...budget, oncePerTurn: [...budget.oncePerTurn, onceKey] });
        }
        return {};
      },
    };
  }
  const able = canAct({ sheet, encounter, kind: cost });
  if (!able.ok) {
    return { error: able.error };
  }
  if (!budget) {
    return { commit: () => ({}) };
  }
  const spent = spendAction(budget, cost, label, sheet.name);
  if (!spent.ok) {
    return { error: spent.error };
  }
  return {
    commit: () => {
      const live = getActiveEncounter(campaign.id);
      if (live) {
        storeBudget(live, { ...spent.budget, oncePerTurn: onceKey ? [...spent.budget.oncePerTurn, onceKey] : spent.budget.oncePerTurn });
      }
      return { cost: cost === "bonus" ? "their bonus action" : "their action" };
    },
  };
}

function pickVariant(does: SpendDoes, variant: string | undefined, spend: AuthoredSpend): { does: SpendDoes; action?: SpendAction } | { error: string } {
  if (does.kind !== "variants") {
    return { does, action: spend.action };
  }
  const wanted = lower(variant);
  const key = Object.keys(does.options).find((option) => wanted.includes(option));
  if (!key) {
    return { error: `${spend.name} needs a variant: ${Object.keys(does.options).join(" or ")}. Nothing was spent.` };
  }
  return does.options[key];
}

// A use_resource call this module resolves, or null for the other paths.
export function authoredFeatureSpend(
  campaign: Campaign,
  turnId: string,
  stale: CharacterSheet,
  resourceName: string,
  args: AuthoredSpendArgs,
  reason: string,
): Record<string, unknown> | null {
  const sheet = getSheetById(stale.id) ?? stale;
  const found = authoredSpendFor(sheet, resourceName);
  if (!found) {
    return null;
  }
  const { spend, held } = found;
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is down and cannot use ${spend.name}.` };
  }
  if (!gateHolds(spend.gate, sheet, held)) {
    return { error: `${gateSentence(spend)} Nothing was spent.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  const inFight = encounter !== null && (encounter.kind ?? "fight") === "fight";
  if (spend.fight === "out" && inFight) {
    return { error: `${spend.name} is chosen outside a fight, when a rest ends, not in the middle of one.` };
  }
  if (spend.oncePer && sheet.conditions.some((entry) => lower(entry) === spend.oncePer!.marker)) {
    return { error: `${spend.name} has been used already (${spend.oncePer.marker}). Nothing was spent.` };
  }
  const picked = pickVariant(spend.does, args.variant, spend);
  if ("error" in picked) {
    return picked;
  }
  // The pool: how much, from which counter.
  let poolId: string | null = null;
  let units = 0;
  if (spend.pool) {
    units = spend.pool.perUnit ? Math.floor(args.amount ?? (spend.pool.optional ? 0 : 1)) : (spend.pool.amount ?? 1);
    if (spend.pool.max && units > spend.pool.max) {
      return { error: `${spend.name} takes at most ${spend.pool.max}; ${units} is more than it can hold. Nothing was spent.` };
    }
    const candidates = [spend.pool.id, ...(spend.pool.fallback ? [spend.pool.fallback] : [])];
    poolId = candidates.find((id) => {
      const state = sheet.resources?.[id];
      return state && state.max - state.used >= units;
    }) ?? null;
    if (units > 0 && !poolId) {
      const state = sheet.resources?.[spend.pool.id];
      return {
        error: state
          ? `${sheet.name} has ${state.max - state.used}/${state.max} left of what ${spend.name} spends, and it takes ${units}. Nothing was spent.`
          : `${sheet.name} has no ${spend.pool.id.replace(/^sub_/, "").replace(/_/g, " ")} to spend on ${spend.name}.`,
      };
    }
  }
  const onceKey = spend.oncePerTurn ? (spend.onceKey ?? `authored:${lower(spend.name)}`) : null;
  const charge = prepareCost(campaign, sheet, picked.action, spend.name, onceKey);
  if ("error" in charge) {
    return charge;
  }
  const ctx: SpendContext = {
    campaign,
    turnId,
    turn: getDmTurn(turnId),
    encounter,
    sheet,
    held: held as HeldAuthored,
    spend,
    args,
    units,
    mods: computeSheetDerived(sheet).abilityMods,
    reason,
  };
  const outcome = resolveSpendEffect(ctx, picked.does);
  if ("error" in outcome) {
    return outcome;
  }
  // Only now is anything written: the effect's own patch, the pool, the
  // once-per marker, the turn.
  const now = getSheetById(sheet.id) ?? sheet;
  const patch: FullPatchSheetInput = { ...(outcome.patch ?? {}) };
  if (poolId && units > 0) {
    const state = now.resources[poolId];
    patch.resources = { ...now.resources, [poolId]: { max: state.max, used: state.used + units } };
  }
  if (spend.oncePer) {
    const conditions = patch.conditions ?? now.conditions;
    const meta = patch.conditionMeta ?? now.conditionMeta;
    patch.conditions = [...conditions, spend.oncePer.marker];
    patch.conditionMeta = { ...meta, [spend.oncePer.marker]: { rounds: spend.oncePer.rounds } };
  }
  if (Object.keys(patch).length) {
    patchSheet(sheet.id, patch);
    audit(campaign, turnId, now, { resource: spend.name, spent: units || undefined, variant: args.variant }, reason, patch);
    const updated = patchSheet(sheet.id, {});
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  const left = poolId ? getSheetById(sheet.id)?.resources?.[poolId] : null;
  return {
    ok: true,
    resource: spend.name,
    ...(poolId && units > 0 ? { spent: units, left: left ? `${left.max - left.used}/${left.max}` : undefined } : {}),
    ...outcome.result,
    ...charge.commit(),
  };
}
