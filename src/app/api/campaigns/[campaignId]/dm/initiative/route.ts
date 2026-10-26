import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { editInitiative, newNpcEntryId, resetInitiative } from "@/lib/dm/initiative";
import { askInitiativeAgain, onPersonsTurn } from "@/lib/dm/invoke";
import { handOnEnemyTurns, playCompanionTurn } from "@/lib/dm/encounter-tools";
import { ENTRY_NAME_MAX, MAX_INITIATIVE, MIN_INITIATIVE } from "@/lib/dm/initiative-edit";
import { correctionsField } from "@/lib/correction-reasons";
import { getDatabase } from "@/lib/db/core";
import { getActiveEncounter } from "@/lib/db/encounters";
import { recordFightCorrection } from "@/lib/db/turn-ledger";

// The edits that correct the order the AI kept (issue #460). Stepping the
// turn on is a turn ending, and a delay is a combatant's own choice, so
// neither is a correction.
function correctsOrder(body: z.infer<typeof bodySchema>): boolean {
  if (body.op === "step") {
    return body.direction === "back";
  }
  return body.op !== "delay";
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Editing the turn order by hand: reorder, insert an NPC slot, delay,
// remove, hand the turn to somebody, step back a turn, or tear the whole
// order down and roll again. The edit itself is pure and tested
// (src/lib/dm/initiative-edit.ts); this route only decides who may ask.

const bodySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("move"),
    id: z.string().min(1),
    direction: z.enum(["up", "down"]),
  }),
  z.object({ op: z.literal("remove"), id: z.string().min(1) }),
  z.object({
    op: z.literal("insert"),
    name: z.string().min(1).max(ENTRY_NAME_MAX),
    initiative: z.number().int().min(MIN_INITIATIVE).max(MAX_INITIATIVE),
  }),
  z.object({ op: z.literal("delay"), id: z.string().min(1) }),
  z.object({ op: z.literal("goto"), id: z.string().min(1) }),
  z.object({ op: z.literal("step"), direction: z.enum(["back", "forward"]) }),
  z.object({
    op: z.literal("set-initiative"),
    id: z.string().min(1),
    initiative: z.number().int().min(MIN_INITIATIVE).max(MAX_INITIATIVE),
  }),
  z.object({ op: z.literal("reset") }),
  // A person's table: the enemies the pointer walked past are done (play
  // has the server play the ones still owed their action), or the AI
  // companion up now has its turn played (src/lib/dm/enemies-due.ts).
  z.object({ op: z.literal("enemies"), play: z.boolean() }),
  z.object({ op: z.literal("companion") }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That is not an edit the order takes." }, { status: 400 });
  }
  const body = parsed.data;
  // The order is what the initiative pointer walks, and the pointer waits out
  // a break where it stands: every edit here can move it, play a turn or ask
  // the table to roll again (table audit 2026-10-26, T05).
  const paused = refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }
  if (body.op === "enemies" || body.op === "companion") {
    const campaign = context.campaign;
    const error = onPersonsTurn(campaign, (turn) =>
      body.op === "enemies" ? handOnEnemyTurns(campaign, turn, body.play) : playCompanionTurn(campaign, turn),
    );
    return error ? Response.json({ error }, { status: 409 }) : Response.json({ ok: true });
  }
  const fight = getActiveEncounter(campaignId);
  // The edit and its ledger row land together, or neither does.
  const { outcome, correctionId } = getDatabase().transaction(() => {
    const result =
      body.op === "reset"
        ? resetInitiative(context.campaign)
        : editInitiative(
            context.campaign,
            // The id for a new slot is minted here rather than in the pure
            // module, so the edit stays deterministic and testable.
            body.op === "insert" ? { ...body, id: newNpcEntryId() } : body,
          );
    const recorded =
      !("error" in result) && fight && correctsOrder(body)
        ? recordFightCorrection({
            campaignId,
            fightStartedAt: fight.createdAt,
            kind: "initiative",
            userId: context.user.id,
            refId: "id" in body ? body.id : null,
          })
        : null;
    return { outcome: result, correctionId: recorded };
  })();
  if ("error" in outcome) {
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  // "Have everyone roll again" means asking them: a person has no turn loop
  // to go round the table (src/lib/dm/initiative-ask.ts, issue 63).
  const asked = body.op === "reset" ? askInitiativeAgain(context.campaign) : null;
  return Response.json({ ok: true, note: outcome.note, ...(asked ?? {}), ...correctionsField(correctionId ? [correctionId] : []) });
}
