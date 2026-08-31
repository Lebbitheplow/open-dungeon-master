import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import {
  getPendingRoll,
  listPendingForTurn,
  resolvePendingRoll,
  setPendingCombatNote,
} from "@/lib/db/dm-turns";
import { insertRoll } from "@/lib/db/rolls";
import { defaultRng, expressionDice, rollExpression, rollExpressionWithDice } from "@/lib/dice";
import { recordInitiativeRoll } from "@/lib/dm/encounter-tools";
import { applyPendingDamageRoll } from "@/lib/dm/enemy-damage";
import { resolvePendingPcAttack } from "@/lib/dm/pc-attack";
import { resumeDmTurn } from "@/lib/dm/turn";
import { resumeHumanTurn } from "@/lib/dm/invoke";
import { enqueueDmJob } from "@/lib/dm/queue";
import { publishWithSeq } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const submitSchema = z.union([
  // Each entry is a die face, or the literal "digital" for a face whose
  // source preference asked the server to roll that one die.
  z.object({
    dice: z
      .array(z.union([z.number().int().min(1).max(100), z.literal("digital")]))
      .min(1)
      .max(120),
  }),
  z.object({ fallback: z.literal("digital") }),
]);

// A player (or, for the digital fallback, the owner) resolves a parked
// physical roll. When the turn has no pending rolls left, the DM resumes.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; pendingRollId: string }> },
) {
  const { campaignId, pendingRollId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  // Body parsing happens before the pending-roll lookup on purpose: with no
  // await between the status check and resolvePendingRoll below, concurrent
  // double-submits cannot both insert a roll row (better-sqlite3 is sync).
  const raw = await request.json().catch(() => ({}));
  const parsed = submitSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid roll submission." }, { status: 400 });
  }

  const pending = getPendingRoll(pendingRollId);
  if (!pending || pending.campaignId !== campaignId) {
    return Response.json({ error: "Roll not found." }, { status: 404 });
  }
  if (pending.status !== "pending") {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }

  const isFallback = "fallback" in parsed.data;
  const isRoller = pending.userId === context.user.id;
  // Whoever runs the story can force the digital fallback when a player is
  // away from their physical dice: the lead in an AI campaign, the DM in a
  // human-run one.
  const canForceFallback = steersStory(context);
  if (isFallback ? !isRoller && !canForceFallback : !isRoller) {
    return Response.json({ error: "This is not your roll." }, { status: 403 });
  }

  // The faces the player typed or their Pixels dice reported. A "digital"
  // entry stands in for a face rolled by the server: drawn crypto-random
  // here, never fabricated in the browser where it would be predictable
  // and forgeable.
  const submitted = isFallback
    ? []
    : (parsed.data as { dice: Array<number | "digital"> }).dice;
  const anyDigital = submitted.includes("digital");
  const allDigital = submitted.length > 0 && submitted.every((entry) => entry === "digital");

  let outcome;
  try {
    if (isFallback) {
      outcome = rollExpression(pending.expression);
    } else {
      // Per-index sides come from the expression itself, so each server-drawn
      // face matches the die it stands in for ("2d20kh1+1d4" -> [20, 20, 4]).
      const faces = expressionDice(pending.expression);
      const dice = submitted.map((entry, index) => {
        if (entry !== "digital") {
          return entry;
        }
        if (index >= faces.length) {
          // Same wording rollExpressionWithDice uses for an oversized payload.
          throw new Error("Too many die values for this roll.");
        }
        return defaultRng(faces[index]);
      });
      outcome = rollExpressionWithDice(pending.expression, dice);
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid dice values." },
      { status: 400 },
    );
  }

  const roll = insertRoll({
    campaignId,
    characterId: pending.characterId,
    requestedBy: "player",
    kind: pending.kind,
    // "(physical)" marks a roll made entirely with real dice; once any face
    // was drawn by the server the label would overclaim, so a mixed or fully
    // digital submission keeps the plain detail.
    detail:
      isFallback || anyDigital
        ? pending.detail
        : `${pending.detail || pending.kind} (physical)`.trim(),
    advantage: pending.advantage,
    dc: pending.dc,
    result: outcome,
  });

  const resolved = resolvePendingRoll(
    pendingRollId,
    isFallback ? "fallback" : "submitted",
    roll.id,
  );
  if (!resolved) {
    return Response.json({ error: "That roll was already resolved." }, { status: 409 });
  }

  publishWithSeq(campaignId, allocateSeq(campaignId), "roll_result", {
    roll,
    pendingRollId,
    // Real dice already rolled on a real table; the overlay animates only
    // rolls where every face was drawn digitally (a mixed submission still
    // happened at the table).
    source: isFallback || allDigital ? "digital" : "physical",
  });

  // Combat initiative submitted from a physical table: record it; the last
  // one locks the order. The note rides pending_rolls.combat_note so the
  // resumed DM turn narrates what actually happened.
  if (pending.kind === "initiative") {
    const note = recordInitiativeRoll(campaignId, pending.characterId, roll.total);
    if (note) {
      setPendingCombatNote(pendingRollId, note);
    }
  } else if (pending.kind === "attack" && pending.attack) {
    // A parked pc_attack to-hit roll: the server adjudicates it against the
    // stored enemy AC and, on a hit, parks the damage roll so the turn stays
    // paused until the player rolls their damage dice.
    const note = resolvePendingPcAttack(pending, roll);
    if (note) {
      setPendingCombatNote(pendingRollId, note);
    }
  } else if (pending.kind === "damage" && pending.targetEnemyId) {
    // Targeted damage applies server-side the moment the dice land; the
    // enemy card updates now, not when the model gets around to it.
    const note = applyPendingDamageRoll(pending, roll);
    if (note) {
      setPendingCombatNote(pendingRollId, note);
    }
  }

  const remaining = listPendingForTurn(pending.turnId).filter(
    (entry) => entry.status === "pending",
  );
  if (!remaining.length) {
    // A turn a person opened has no model waiting on the answer: the roll
    // already published itself and applied what it applies, so closing the
    // turn is the whole of "resuming" it.
    if (!resumeHumanTurn(pending.turnId)) {
      enqueueDmJob(campaignId, () => resumeDmTurn(campaignId, pending.turnId));
    }
  }

  return Response.json({ roll });
}
