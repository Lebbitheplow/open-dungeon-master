import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { editInitiative, newNpcEntryId, resetInitiative } from "@/lib/dm/initiative";
import { ENTRY_NAME_MAX, MAX_INITIATIVE, MIN_INITIATIVE } from "@/lib/dm/initiative-edit";

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
  const outcome =
    body.op === "reset"
      ? resetInitiative(context.campaign)
      : editInitiative(
          context.campaign,
          // The id for a new slot is minted here rather than in the pure
          // module, so the edit stays deterministic and testable.
          body.op === "insert" ? { ...body, id: newNpcEntryId() } : body,
        );
  return "error" in outcome
    ? Response.json({ error: outcome.error }, { status: 409 })
    : Response.json({ ok: true, note: outcome.note });
}
