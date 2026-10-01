// request_roll, for both callers of the engine.
//
// The AI's turn loop (turn.ts) used to carry its own copy of this, and the
// two drifted: the copy skipped the table's strictness and rolled for the
// dead. There is one now. The model's call differs in two things only, both
// passed in: a parked roll remembers the tool call it answers, so the model
// can be resumed with the result, and the refusals are worded for a model.
// Everything else is shared: the expression comes from the sheet, conditions
// can decide the roll outright, an inspiration die is spent whether the
// dice are physical or digital, an initiative roll feeds the encounter, and
// a damage roll aimed at an enemy applies itself.
import { claimedAdvantage } from "@/lib/dm/pc-attack-options";
import { rollExpression } from "@/lib/dice";
import { getActiveEncounter } from "@/lib/db/encounters";
import { insertRoll } from "@/lib/db/rolls";
import { createPendingRoll, publicPendingRoll, type DmTurn } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { allocateSeq } from "@/lib/db/campaigns";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { redactRoll } from "@/lib/dm/viewer";
import { autoApplyDamageRoll } from "@/lib/dm/enemy-damage";
import { recordInitiativeRoll } from "@/lib/dm/encounter-tools";
import { applyInitiativeRefills } from "@/lib/dm/feature-hooks";
import {
  resolveRollExpression,
  resolveSheetRef,
  rollArgsSchema,
  rollDcFor,
  type RollArgs,
} from "@/lib/dm/rolls";
import { strictnessShift } from "@/lib/dm/safety-logic";
import type { Campaign } from "@/lib/db/campaigns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { moteAfterRoll, moteOf } from "@/lib/dm/authored-mote";
import { applyRollGates } from "@/lib/dm/roll-gates";

export function handleRequestRoll(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  // Players who roll real dice at the table: their rolls park for them to
  // enter instead of being rolled by the server.
  realDiceUserIds: Set<string>,
  // Set by the AI's turn loop: the tool call a parked roll answers.
  model?: { toolCallId: string | null },
): Record<string, unknown> {
  const campaignId = campaign.id;
  let args: RollArgs;
  try {
    const raw = JSON.parse(rawArguments || "{}");
    args = rollArgsSchema.parse(raw);
    args = {
      ...args,
      dc: rollDcFor(args, raw, strictnessShift(campaign.gameSettings.gm?.strictness ?? "standard")),
    };
  } catch {
    return {
      error: model
        ? "Invalid request_roll arguments. Send JSON with kind, and skill/ability/dc or expression as documented."
        : "Pick a roll kind, and a skill, ability or DC to go with it.",
    };
  }

  // The AI's advantage stands only on a circumstance the server cannot see
  // (the same rule as pc_attack's); the DM console rules freely.
  if (turn.actor === "ai" && args.advantage && args.advantage !== "none") {
    const claim = claimedAdvantage({ requested: args.advantage, reason: args.advantageReason, byAi: true });
    args = { ...args, advantage: claim.requested };
  }
  const sheet = resolveSheetRef(args.characterId, sheets, sheetsById);
  // The dead roll nothing: not a check, not a save, not initiative.
  if (sheet) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    if (fresh.deathSaves?.dead) {
      return {
        error: `${fresh.name} is dead and makes no rolls. Only magic that raises the dead brings them back.`,
      };
    }
  }
  // No stealth on a normal or fast march, and a contest rolls the
  // creature's own check for the DC (src/lib/dm/roll-gates.ts).
  const gated = applyRollGates(campaign, turn, args);
  if ("error" in gated) {
    return { error: gated.error };
  }
  args = gated.args;
  // In combat a character's attack belongs to the attack engine, which
  // adjudicates against the enemy's AC and applies the damage itself.
  if (args.kind === "attack" && sheet && getActiveEncounter(campaignId)) {
    return {
      error: model
        ? "Character attacks in combat go through pc_attack: call it with characterId, targetEnemyId, and the weapon (or an attack-roll spell by name). The server rolls to-hit from their sheet, adjudicates against the enemy's AC, and applies damage itself."
        : "Use Player attacks for a swing in combat: it rolls to hit from their sheet, compares it to the enemy's AC and applies the damage.",
    };
  }
  // The same holds for the damage: a party character's damage on an enemy
  // with no attack roll behind it would skip the hit, the action and the
  // turn. Damage aimed at an enemy from nobody's sheet (an NPC ally the
  // story never recruited) still lands.
  if (args.kind === "damage" && args.targetEnemyId && sheet && getActiveEncounter(campaignId)) {
    return {
      error: model
        ? `${sheet.name}'s damage on an enemy comes from pc_attack (or the spell tools), which roll the hit first and apply the damage themselves; request_roll does not apply a party character's damage to an enemy.`
        : `${sheet.name}'s damage on an enemy comes from Player attacks or a cast form, which roll the hit first; a bare damage roll does not land on an enemy.`,
    };
  }

  const resolved = resolveRollExpression(
    args,
    sheet,
    sheet
      ? rollExtrasFor(campaign, sheet, args.kind)
      : { encumbrance: campaign.gameSettings.variantRules.encumbrance },
  );
  if ("error" in resolved) {
    return { error: resolved.error };
  }
  if ("autoFail" in resolved) {
    return {
      ok: true,
      success: false,
      autoFailed: true,
      note: `${sheet?.name ?? "The character"} automatically fails: ${resolved.notes.join("; ")}.${
        model ? " No dice are rolled; narrate the failure." : ""
      }`,
    };
  }

  // The inspiration die and a held Help are already baked into the
  // expression, so they are spent either way.
  // A Creation bard's mote rides the die being spent (authored-mote.ts).
  const mote = sheet ? moteOf(sheet, resolved.spendInspiration) : null;
  if (sheet) {
    spendRollCarriers(campaignId, sheet.id, resolved.spendInspiration);
  }

  if (sheet && realDiceUserIds.has(sheet.userId)) {
    const pending = createPendingRoll({
      campaignId,
      turnId: turn.id,
      toolCallId: model?.toolCallId ?? null,
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
      // A screen is a person's tool; the model's rolls are the table's.
      visibility: model ? "public" : args.visibility ?? "public",
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
    // Superior Inspiration, Perfect Self: a use back on rolling initiative.
    const refilled = args.kind === "initiative" && sheet ? applyInitiativeRefills(campaign, sheet.id) : [];
    const moteLine = sheet ? moteAfterRoll(campaign, sheet, mote, args.kind, outcome) : null;
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
      ...(gated.contest ? { contest: `${gated.contest.name} rolled ${gated.contest.skill} ${gated.contest.total}; ${gated.contest.answering ? "a tie goes to the character" : "the character must beat it"}.` } : {}),
      ...(outcome.crit ? { crit: outcome.crit } : {}),
      ...(resolved.conditionNotes ? { conditionEffects: resolved.conditionNotes } : {}),
      ...(combatNote ? { combat: combatNote } : {}),
      ...(refilled.length ? { refilled } : {}),
      ...(moteLine ? { mote: moteLine } : {}),
      ...(applied ? { applied } : {}),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid dice expression." };
  }
}
