import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { draftOutline, makeAsset } from "@/lib/dm/world-outline";
import { publishEphemeral } from "@/lib/events";
import { OUTLINE_ITEM_KINDS } from "@/lib/worldforge/outline";
import { recordsChanged } from "@/lib/workshop/record-events";
import { isWorkshop } from "@/lib/workshop/kind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Draft a world from this idea" (src/lib/dm/world-outline.ts), the
// workshop author's alone: a play table's World tab does not offer it, and
// this route refuses a play table too, so its lead cannot fill their own
// Bestiary and Homebrew through it. "outline" asks the model once and writes nothing: the outline goes
// back to be reviewed. "asset" makes ONE ticked creature or item through the
// Bestiary's or Homebrew's own validator, with a World entry linked to it;
// a refusal is an error the page shows on that row, with Retry. The ticked
// entries and the links between them go through WorldForge's apply
// (world/ai, tool "apply"), the forge's own door, so they are made and
// reported the same way.
const bodySchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("outline"), idea: z.string().trim().min(1).max(4_000), hint: z.string().trim().max(300).default("") }),
  z.object({
    step: z.literal("asset"),
    asset: z.object({
      kind: z.enum(["creature", "item"]),
      name: z.string().trim().min(1).max(80),
      summary: z.string().trim().max(1_000).default(""),
      cr: z.number().min(0).max(30).default(1),
      basis: z.string().trim().max(80).default(""),
      itemKind: z.enum(OUTLINE_ITEM_KINDS).default("gear"),
    }),
    premise: z.string().trim().max(600).default(""),
  }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!isWorkshop(context.campaign)) {
    return Response.json({ error: "A world is drafted from an idea in its workshop, not at the table." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That is not a step of drafting a world." }, { status: 400 });
  }
  const body = parsed.data;
  if (body.step === "outline") {
    const result = await draftOutline(context.campaign, body.idea, body.hint);
    return "error" in result ? Response.json(result, { status: 502 }) : Response.json(result);
  }
  const result = await makeAsset(context.campaign, context.user.id, body.asset, body.premise);
  if ("error" in result) {
    return Response.json(result, { status: result.stage === "model" ? 502 : 422 });
  }
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  recordsChanged(campaignId, "lore", "world");
  return Response.json(result, { status: 201 });
}
