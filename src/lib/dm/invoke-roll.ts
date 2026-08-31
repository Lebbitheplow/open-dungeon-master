// request_roll for a human DM.
//
// The AI's version of this lives in turn.ts and has one extra job: parking
// the call so the model can be resumed with the answer. A person needs none
// of that. What they DO need is the part turn.ts and this file share
// exactly: the expression comes from the sheet, conditions can decide the
// roll outright, an inspiration die is spent whether the dice are physical
// or digital, an initiative roll feeds the encounter, and a damage roll
// aimed at an enemy applies itself.
import { rollExpression } from "@/lib/dice";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { createPendingRoll, publicPendingRoll, type DmTurn } from "@/lib/db/dm-turns";
import { patchSheet } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { allocateSeq } from "@/lib/db/campaigns";
import { allySaveAura } from "@/lib/dm/aura";
import { rollEffectExtras } from "@/lib/dm/effect-tools";
import { redactRoll } from "@/lib/dm/viewer";
import { removeConditions } from "@/lib/dm/condition-logic";
import { autoApplyDamageRoll } from "@/lib/dm/enemy-damage";
import { recordInitiativeRoll } from "@/lib/dm/encounter-tools";
import { resolveRollExpression, resolveSheetRef, rollArgsSchema, type RollArgs } from "@/lib/dm/rolls";
import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export function handleRequestRoll(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // Players who roll real dice at the table: their rolls park for them to
  // enter instead of being rolled by the server.
  realDiceUserIds: Set<string>,
): Record<string, unknown> {
  const campaignId = campaign.id;
  let args: RollArgs;
  try {
    args = rollArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Pick a roll kind, and a skill, ability or DC to go with it." };
  }

  const sheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  // In combat a character's attack belongs to the attack engine, which
  // adjudicates against the enemy's AC and applies the damage itself.
  if (args.kind === "attack" && sheet && getActiveEncounter(campaignId)) {
    return {
      error:
        "Use Player attacks for a swing in combat: it rolls to hit from their sheet, compares it to the enemy's AC and applies the damage.",
    };
  }

  const aura = args.kind === "saving_throw" && sheet ? allySaveAura(campaignId, sheet) : null;
  const resolved = resolveRollExpression(args, sheet, {
    ...(aura ? { saveBonus: aura.bonus, saveNote: aura.note } : {}),
    ...(sheet ? rollEffectExtras(campaignId, sheet.id, args.kind) : {}),
    encumbrance: campaign.gameSettings.variantRules.encumbrance,
  });
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  if ("autoFail" in resolved) {
    return {
      ok: true,
      success: false,
      autoFailed: true,
      note: `${sheet?.name ?? "The character"} automatically fails: ${resolved.notes.join("; ")}.`,
    };
  }

  // The inspiration die and a held Help are already baked into the
  // expression, so they are spent either way.
  if (sheet && resolved.spendInspiration) {
    const { conditions, meta } = removeConditions(
      sheet.conditions,
      sheet.conditionMeta,
      resolved.spendInspiration.split("|"),
    );
    const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta });
    if (updated) {
      publishPersisted(campaignId, "sheet_updated", { sheet: updated });
    }
  }

  if (sheet && realDiceUserIds.has(sheet.userId)) {
    const pending = createPendingRoll({
      campaignId,
      turnId: turn.id,
      toolCallId: null,
      userId: sheet.userId,
      characterId: sheet.id,
      kind: args.kind,
      detail: resolved.detail,
      expression: resolved.expression,
      advantage: args.advantage ?? "none",
      dc: args.dc ?? null,
      reason: args.reason?.slice(0, 200) ?? "",
      targetEnemyId: args.kind === "damage" ? args.targetEnemyId ?? null : null,
    });
    publishPersisted(campaignId, "roll_pending", { pendingRoll: publicPendingRoll(pending) });
    return {
      ok: true,
      parked: true,
      note: `Waiting on ${sheet.name} to enter ${resolved.expression}.`,
    };
  }

  try {
    const outcome = rollExpression(resolved.expression);
    const roll = insertRoll({
      campaignId,
      characterId: sheet?.id ?? null,
      requestedBy: "dm",
      kind: args.kind,
      detail: resolved.detail,
      advantage: args.advantage ?? "none",
      dc: args.dc ?? null,
      result: outcome,
      visibility: args.visibility ?? "public",
    });
    turn.rollIds.push(roll.id);
    // The stream is shared, so it carries what a PLAYER may see. Whoever is
    // allowed the number re-fetches it from GET /rolls, exactly as the DM
    // re-fetches their own enemy numbers.
    publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
      roll: roll.visibility === "public" ? roll : redactRoll(roll),
      source: "digital",
    });
    const combatNote =
      args.kind === "initiative"
        ? recordInitiativeRoll(campaignId, sheet?.id ?? null, roll.total)
        : null;
    const applied =
      args.kind === "damage" && args.targetEnemyId
        ? autoApplyDamageRoll(
            campaign,
            turn,
            args.targetEnemyId,
            roll,
            sheets,
            sheetsById,
            args.damageType,
          )
        : null;
    return {
      ok: true,
      total: roll.total,
      dice: outcome.terms,
      ...(args.dc !== undefined ? { dc: args.dc, success: roll.total >= args.dc } : {}),
      ...(outcome.crit ? { crit: outcome.crit } : {}),
      ...(resolved.conditionNotes ? { conditionEffects: resolved.conditionNotes } : {}),
      ...(combatNote ? { combat: combatNote } : {}),
      ...(applied ? { applied } : {}),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid dice expression." };
  }
}
