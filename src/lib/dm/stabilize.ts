// Stabilizing a dying creature (SRD 5.1, Stabilizing a Creature): somebody
// uses their action on it and makes a DC 10 Wisdom (Medicine) check, or
// spends a use of a healer's kit, or casts Spare the Dying. The server rolls
// the check from the healer's own sheet, so whoever calls the tool names the
// healer and the dice decide.
//
// A stable creature stays at 0 hit points and unconscious, and regains 1 hit
// point after 1d4 hours (src/lib/dm/death.ts rollStableTimer).
//
// This module must not import mutations.ts (which imports it).
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { rollStableTimer } from "@/lib/dm/death";
import { findCarriedItem } from "@/lib/dm/item-logic";
import { removeItemMath } from "@/lib/dm/mutation-math";
import { resolveRollExpression } from "@/lib/dm/rolls";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { STABILIZE_DC, SUFFOCATING, stabilizeMethod } from "@/lib/dm/vitals-logic";

function write(
  campaign: Campaign,
  turnId: string,
  before: CharacterSheet,
  kind: string,
  delta: Record<string, unknown>,
  reason: string,
  patch: FullPatchSheetInput,
) {
  const updated = patchSheet(before.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: before.id,
    turnId,
    kind,
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before,
    patch: patch as Record<string, unknown>,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: before.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

export function handleStabilize(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  healer: CharacterSheet | null,
  input: { method?: string; reason?: string },
): Record<string, unknown> {
  const reason = (input.reason ?? "").slice(0, 200);
  const track = sheet.deathSaves;
  if (!track || track.dead || sheet.currentHp > 0) {
    return { error: `${sheet.name} is not dying; nothing to stabilize.` };
  }
  if (track.stable) {
    return { ok: true, note: `${sheet.name} is already stable.` };
  }
  if (sheet.conditions.some((entry) => entry.toLowerCase() === SUFFOCATING)) {
    return {
      error: `${sheet.name} is still without air and cannot be stabilized until they can breathe. Get them to air, clear the suffocating condition, then stabilize or heal them.`,
    };
  }
  if (!healer) {
    return {
      error: `Stabilizing takes somebody's action: pass healerId, the character tending to ${sheet.name}. The server rolls their DC ${STABILIZE_DC} Wisdom (Medicine) check, or pass method "kit" for a healer's kit or "spell" for Spare the Dying.`,
    };
  }
  if (healer.id === sheet.id) {
    return { error: `${sheet.name} is unconscious and cannot tend to themselves; name another character as healerId.` };
  }
  // The healer spends their action on it, so they must have one to spend.
  const encounter = getActiveEncounter(campaign.id);
  const able = canAct({ sheet: healer, encounter, kind: "action" });
  if (!able.ok) {
    return { error: able.error };
  }
  const method = stabilizeMethod(input.method);
  let kitPatch: FullPatchSheetInput | null = null;
  let how = "";
  if (method === "kit") {
    const kit = findCarriedItem(healer.equipment, "healer's kit");
    const removal = kit ? removeItemMath(healer.equipment, kit.name, 1) : null;
    if (!kit || !removal) {
      return {
        error: `${healer.name} carries no healer's kit. Without one, stabilizing takes a DC ${STABILIZE_DC} Wisdom (Medicine) check: call stabilize again without a method.`,
      };
    }
    kitPatch = { equipment: removal.equipment };
    how = `${healer.name} spends a use of their ${kit.name}`;
  } else if (method === "spell") {
    const knows = healer.spellcasting
      ? allSpellNames(healer.spellcasting).some(
          (entry) => entry.trim().toLowerCase() === "spare the dying",
        )
      : false;
    if (!knows) {
      return {
        error: `${healer.name} does not know Spare the Dying. Without it, stabilizing takes a DC ${STABILIZE_DC} Wisdom (Medicine) check: call stabilize again without a method.`,
      };
    }
    how = `${healer.name} casts Spare the Dying`;
  }
  const budget = encounter
    ? budgetFor(encounter, healer.id, attacksAllowedFor(healer))
    : null;
  const spent = budget ? spendAction(budget, "action", "Stabilizing a creature", healer.name) : null;
  if (spent && !spent.ok) {
    return { error: spent.error };
  }

  let check: Record<string, unknown> = {};
  if (method === "check") {
    const resolved = resolveRollExpression(
      { kind: "skill_check", skill: "medicine", dc: STABILIZE_DC, characterId: healer.id },
      healer,
      { encumbrance: campaign.gameSettings.variantRules.encumbrance },
    );
    if ("error" in resolved) {
      return { error: resolved.error };
    }
    if ("autoFail" in resolved) {
      return { error: `${healer.name} cannot make the check: ${resolved.notes.join("; ")}.` };
    }
    // The check is made, pass or fail, so the action is spent from here on.
    if (encounter && spent?.ok) {
      storeBudget(encounter, spent.budget);
    }
    const outcome = rollExpression(resolved.expression);
    const roll = insertRoll({
      campaignId: campaign.id,
      characterId: healer.id,
      requestedBy: "dm",
      kind: "skill_check",
      detail: `medicine, to stabilize ${sheet.name}`,
      dc: STABILIZE_DC,
      result: outcome,
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll,
      source: "digital",
    });
    check = { rolled: outcome.total, dc: STABILIZE_DC };
    if (outcome.total < STABILIZE_DC) {
      return {
        ok: true,
        stabilized: false,
        ...check,
        note: `${healer.name}'s Medicine check (${outcome.total}) misses DC ${STABILIZE_DC}. ${sheet.name} is still dying; their action is spent.`,
      };
    }
    how = `${healer.name}'s Medicine check (${outcome.total}) meets DC ${STABILIZE_DC}`;
  } else if (encounter && spent?.ok) {
    storeBudget(encounter, spent.budget);
  }

  if (kitPatch) {
    write(campaign, turnId, healer, "use_item", { item: "healer's kit" }, reason, kitPatch);
  }
  const wait = rollStableTimer(campaign, sheet);
  const nextTrack = { ...track, stable: true };
  write(campaign, turnId, sheet, "stabilize", { deathSaves: nextTrack, healer: healer.name }, reason, {
    deathSaves: nextTrack,
    conditions: wait.conditions,
    conditionMeta: wait.conditionMeta,
  });
  return {
    ok: true,
    stabilized: true,
    ...check,
    note: `${how}. ${sheet.name} is stable: no more death saves, but still unconscious at 0 HP. They regain 1 hit point in ${wait.hours} hour${wait.hours === 1 ? "" : "s"}, or sooner if healed.`,
  };
}
