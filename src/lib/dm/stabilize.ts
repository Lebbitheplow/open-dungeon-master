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
import { holdsFeat } from "@/lib/srd/feat-effects";
import { survivorTended } from "@/lib/srd/feat-combat";
import { removeConditions } from "@/lib/dm/condition-logic";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet, EquipmentItem, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { spendAction } from "@/lib/dm/action-budget";
import { canAct } from "@/lib/dm/can-act";
import { rollStableTimer } from "@/lib/dm/death";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { chebyshev } from "@/lib/battlemap/types";
import { findCarriedItem } from "@/lib/dm/item-logic";
import { resolveRollExpression } from "@/lib/dm/rolls";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { STABILIZE_DC, SUFFOCATING, stabilizeMethod } from "@/lib/dm/vitals-logic";

// A healer's kit holds ten uses (SRD 5.1, Adventuring Gear). The count lives
// on the row's `charges`; a row with none recorded is a full kit, so every
// kit carried before this was kept starts with all ten.
export const HEALERS_KIT_USES = 10;

// The pack after one use of the kit on `row`: the count lowered, or, on the
// last use, one kit of the stack gone (the next starts full).
export function kitAfterUse(equipment: EquipmentItem[], row: EquipmentItem): { equipment: EquipmentItem[]; left: number } {
  const left = Math.max(0, Math.min(HEALERS_KIT_USES, row.charges ?? HEALERS_KIT_USES) - 1);
  const next = equipment.flatMap((item) => {
    if (item !== row) {
      return [item];
    }
    if (left > 0) {
      return [{ ...item, charges: left }];
    }
    const qty = item.qty ?? 1;
    return qty > 1 ? [{ ...item, qty: qty - 1, charges: undefined }] : [];
  });
  return { equipment: next, left };
}

// On a mapped fight the healer must be beside the dying creature: tending
// them, a kit and Spare the Dying are all touch. Null when that holds or
// there is no board to read.
function outOfTouch(encounterId: string | undefined, healer: CharacterSheet, sheet: CharacterSheet): string | null {
  const map = encounterId ? getBattleMapForEncounter(encounterId) : null;
  const from = map ? getTokenByRef(map.id, healer.id) : null;
  const to = map ? getTokenByRef(map.id, sheet.id) : null;
  if (!from || !to) {
    return null;
  }
  const feet = chebyshev(from.x, from.y, to.x, to.y) * 5;
  return feet > 5
    ? `${healer.name} is ${feet} ft from ${sheet.name}; stabilizing needs them within 5 feet. Move ${healer.name} beside them first.`
    : null;
}

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
  const far = outOfTouch(encounter?.id, healer, sheet);
  if (far) {
    return { error: far };
  }
  const method = stabilizeMethod(input.method);
  let kitPatch: FullPatchSheetInput | null = null;
  let how = "";
  if (method === "kit") {
    const kit = findCarriedItem(healer.equipment, "healer's kit");
    if (!kit || (kit.charges ?? HEALERS_KIT_USES) <= 0) {
      return {
        error: `${healer.name} carries no healer's kit with a use left. Without one, stabilizing takes a DC ${STABILIZE_DC} Wisdom (Medicine) check: call stabilize again without a method.`,
      };
    }
    const used = kitAfterUse(healer.equipment, kit);
    kitPatch = { equipment: used.equipment };
    how = `${healer.name} spends a use of their ${kit.name} (${used.left} left)`;
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
      {
        kind: "skill_check",
        skill: "medicine",
        dc: STABILIZE_DC,
        characterId: healer.id,
        // Survivor: Medicine checks to stabilize them have advantage.
        ...(survivorTended(sheet) ? { advantage: "advantage" as const, advantageReason: "Survivor: Medicine checks to stabilize them have advantage" } : {}),
      },
      healer,
      rollExtrasFor(campaign, healer, "skill_check"),
    );
    if ("error" in resolved) {
      return { error: resolved.error };
    }
    if ("autoFail" in resolved) {
      return { error: `${healer.name} cannot make the check: ${resolved.notes.join("; ")}.` };
    }
    spendRollCarriers(campaign.id, healer.id, resolved.spendInspiration);
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
  // Healer: a creature stabilized with the kit also regains 1 hit point,
  // which wakes them (src/lib/srd/feat-combat.ts).
  if (method === "kit" && holdsFeat(healer, "Healer")) {
    const nextTrack = { successes: 0, failures: 0, stable: false, dead: false };
    const woken = removeConditions(sheet.conditions, sheet.conditionMeta, ["unconscious", "dying"]);
    write(campaign, turnId, sheet, "stabilize", { deathSaves: nextTrack, healer: healer.name, currentHp: 1 }, reason, {
      deathSaves: nextTrack,
      currentHp: 1,
      conditions: woken.conditions,
      conditionMeta: woken.meta,
    });
    return {
      ok: true,
      stabilized: true,
      ...check,
      note: `${how}. Healer: ${sheet.name} is stable and regains 1 hit point, awake again.`,
    };
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

// A creature a Healer has already tended since its last rest.
export const TENDED = "tended by a healer";

// Healer's kit, in a Healer's hands (src/lib/srd/feat-combat.ts): as an
// action, one use restores 1d6 + 4 hit points plus the creature's Hit Dice
// count, once per creature per rest. Null when this is not that (the kit
// is not carried, the user lacks the feat, the item is something else);
// the amount comes back for the heal mutation to apply.
export function healerKitUse(
  campaign: Campaign,
  turnId: string,
  healer: CharacterSheet,
  target: CharacterSheet,
  itemName: string,
): { error: string } | { ok: true; amount: number; note: string } | null {
  if (!/healer'?s kit/i.test(itemName) || !holdsFeat(healer, "Healer")) {
    return null;
  }
  const kit = findCarriedItem(healer.equipment, "healer's kit");
  if (!kit || (kit.charges ?? HEALERS_KIT_USES) <= 0) {
    return { error: `${healer.name} carries no healer's kit with a use left. Nothing was spent.` };
  }
  if (target.deathSaves?.dead) {
    return { error: `${target.name} is dead; a healer's kit cannot help them. Nothing was spent.` };
  }
  if (target.conditions.some((entry) => entry.toLowerCase() === TENDED)) {
    return { error: `${target.name} has already been tended with a healer's kit since their last rest; the Healer feat works once per creature per rest. Nothing was spent.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    const able = canAct({ sheet: healer, encounter, kind: "action" });
    if (!able.ok) {
      return { error: able.error };
    }
    const far = outOfTouch(encounter.id, healer, target);
    if (far && healer.id !== target.id) {
      return { error: far };
    }
    const budget = budgetFor(encounter, healer.id, attacksAllowedFor(healer));
    if (budget) {
      const spent = spendAction(budget, "action", "the healer's kit", healer.name);
      if (!spent.ok) {
        return { error: spent.error };
      }
      storeBudget(encounter, spent.budget);
    }
  }
  const used = kitAfterUse(healer.equipment, kit);
  write(campaign, turnId, healer, "use_item", { item: "healer's kit", healer: true }, "Healer", { equipment: used.equipment });
  const dice = Math.max(0, target.hitDice?.total ?? target.level);
  const outcome = rollExpression(`1d6+4+${dice}`);
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: healer.id,
    requestedBy: "dm",
    kind: "custom",
    detail: `Healer: a healer's kit use on ${target.name} (1d6 + 4 + ${dice} Hit Dice)`,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  const tended = patchSheet(target.id, { conditions: [...target.conditions, TENDED] });
  if (tended) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: tended });
  }
  return {
    ok: true,
    amount: Math.max(0, outcome.total),
    note: `Healer: ${healer.name} spends a use of their healer's kit (${used.left} left) on ${target.name}, who regains ${outcome.total} hit points (1d6 + 4 + ${dice} Hit Dice); not again for ${target.name} until they rest.`,
  };
}
