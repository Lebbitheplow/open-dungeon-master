// The restoration spells (SRD 5.1), cast through cast_buff: what each ends
// on its target, decided before the slot is spent so a cast with nothing to
// end is refused and costs nothing.
//   Lesser Restoration: one of blinded, deafened, paralyzed, poisoned.
//   Greater Restoration: one level of exhaustion, or charmed, petrified, or
//     one curse.
//   Remove Curse: every curse (Bestow Curse's "cursed (...)" among them).
// This module imports mutations (for the slot spend) through its caller's
// cast function and must never be imported by it.

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { spellFactsFor, type ResolvedSpellMech } from "@/lib/content";
import { removeConditions } from "@/lib/dm/condition-logic";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { exhaustionPatch } from "@/lib/dm/vitals-logic";
import { afflictionConditionsFor } from "@/lib/dm/afflictions";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

type Cast = (args: Record<string, unknown>) => Record<string, unknown>;

const isCurse = (name: string) => name.trim().toLowerCase().startsWith("cursed");

// What the spell would end on this sheet: the conditions, and whether a
// level of exhaustion goes. Empty when there is nothing it can end.
export function curePlan(
  cures: { conditions: string[]; all?: boolean },
  sheet: Pick<CharacterSheet, "conditions" | "exhaustion">,
  wanted: string,
  // The conditions a disease or a madness keeps on this sheet
  // (src/lib/dm/afflictions.ts afflictionConditionsFor).
  afflicted?: (word: string) => string[],
): { conditions: string[]; exhaustion: boolean } {
  const word = wanted.trim().toLowerCase();
  const heldFor = (entry: string) =>
    entry === "disease" || entry.endsWith("madness")
      ? (afflicted?.(entry) ?? [])
      : entry === "exhaustion"
      ? (sheet.exhaustion ?? 0) > 0
        ? ["exhaustion"]
        : []
      : sheet.conditions.filter((name) => (entry === "cursed" ? isCurse(name) : name.toLowerCase() === entry));
  const offered = cures.conditions.filter((entry) => !word || entry === word || (entry === "cursed" && isCurse(word)));
  const held = offered.map(heldFor).filter((found) => found.length);
  const chosen = cures.all ? held.flat() : (held[0] ?? []).slice(0, 1);
  return {
    conditions: chosen.filter((name) => name !== "exhaustion"),
    exhaustion: chosen.includes("exhaustion"),
  };
}

export function castCure(
  campaign: Campaign,
  turn: DmTurn,
  input: { caster: CharacterSheet; target: CharacterSheet; resolved: ResolvedSpellMech; variant?: string; level?: number; reason?: string },
  cast: Cast,
): Record<string, unknown> {
  const { caster, resolved } = input;
  const target = getSheetById(input.target.id) ?? input.target;
  const cures = resolved.mech.cures;
  if (!cures) {
    return { error: `${resolved.name} ends nothing the server tracks.` };
  }
  const plan = curePlan(cures, target, input.variant ?? "", (word) => afflictionConditionsFor(campaign.id, target, word));
  if (!plan.conditions.length && !plan.exhaustion) {
    return {
      error: `${target.name} has nothing ${resolved.name} ends (${cures.conditions.join(", ")}). Nothing was cast and no slot was spent.`,
    };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && target.id !== caster.id) {
    const reach = spellReachProblem({
      encounterId: encounter.id,
      casterId: caster.id,
      casterName: caster.name,
      targetId: target.id,
      targetName: target.name,
      facts: spellFactsFor(resolved.name),
    });
    if (reach) {
      return { error: reach };
    }
  }
  const paid = cast({
    characterId: caster.id,
    spell: resolved.name,
    ...(input.level ? { level: input.level } : {}),
    via: "buff",
    reason: (input.reason ?? `${resolved.name} on ${target.name}`).slice(0, 200),
  });
  if ("error" in paid) {
    return paid;
  }
  const fresh = getSheetById(target.id) ?? target;
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, plan.conditions);
  const patch: FullPatchSheetInput = {
    conditions: cleared.conditions,
    conditionMeta: cleared.meta,
    ...(plan.exhaustion ? exhaustionPatch(fresh, (fresh.exhaustion ?? 0) - 1) : {}),
  };
  const updated = patchSheet(fresh.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: fresh.id,
    turnId: turn.id,
    kind: "clear_condition",
    delta: { spell: resolved.name, ended: plan.conditions, exhaustion: plan.exhaustion },
    reason: `${resolved.name} cast by ${caster.name}`,
    seq: allocateSeq(campaign.id),
    before: fresh,
    patch: patch as Record<string, unknown>,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: fresh.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  const ended = [...plan.conditions, ...(plan.exhaustion ? ["one level of exhaustion"] : [])];
  return {
    ok: true,
    spell: resolved.name,
    target: fresh.name,
    ended,
    ...(paid.slot ? { slot: paid.slot } : {}),
    ...(paid.cost ? { cost: paid.cost } : {}),
    ...(paid.material ? { material: paid.material } : {}),
    note: `${resolved.name} ends ${ended.join(", ")} on ${fresh.name}. The server applied it; narrate exactly this.`,
  };
}
