import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import {
  addAdhocToken,
  moveTokenFreely,
  readTemplate,
  removeAdhocToken,
  setTokenVisibility,
} from "@/lib/dm/board";
import { ADHOC_NAME_MAX } from "@/lib/dm/board-logic";
import { ADHOC_TOKEN_KINDS } from "@/lib/battlemap/types";
import {
  MAX_TEMPLATE_FEET,
  MIN_TEMPLATE_FEET,
  TEMPLATE_SHAPES,
} from "@/lib/battlemap/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Board handling: the DM moves any token, adds their own people and props,
// hides a combatant, and measures an area. DM-only, and deliberately not an
// adjudication, so it never appears in the catalog the AI is offered
// (src/lib/dm/board.ts).

const coord = z.number().int().min(0).max(255);
const tile = z.object({ x: coord, y: coord });

const bodySchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("place"), tokenId: z.string().min(1), x: coord, y: coord }),
  z.object({
    do: z.literal("add"),
    kind: z.enum(ADHOC_TOKEN_KINDS as unknown as [string, ...string[]]),
    name: z.string().min(1).max(ADHOC_NAME_MAX),
    hidden: z.boolean().optional(),
    x: coord,
    y: coord,
  }),
  z.object({ do: z.literal("remove"), tokenId: z.string().min(1) }),
  z.object({
    do: z.literal("visibility"),
    tokenId: z.string().min(1),
    hidden: z.boolean(),
  }),
  z.object({
    do: z.literal("template"),
    shape: z.enum(TEMPLATE_SHAPES as unknown as [string, ...string[]]),
    origin: tile,
    target: tile,
    sizeFeet: z.number().int().min(MIN_TEMPLATE_FEET).max(MAX_TEMPLATE_FEET),
  }),
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
    return Response.json({ error: "That is not something the board can do." }, { status: 400 });
  }
  const body = parsed.data;
  const { campaign } = context;

  // Measuring changes nothing, so it answers before the write paths below.
  if (body.do === "template") {
    const readout = readTemplate(campaign, {
      shape: body.shape as Parameters<typeof readTemplate>[1]["shape"],
      origin: body.origin,
      target: body.target,
      sizeFeet: body.sizeFeet,
    });
    return readout
      ? Response.json(readout)
      : Response.json({ error: "There is no board on the table." }, { status: 404 });
  }

  const outcome =
    body.do === "place"
      ? moveTokenFreely(campaign, body.tokenId, body.x, body.y)
      : body.do === "add"
        ? addAdhocToken(campaign, {
            kind: body.kind as Parameters<typeof addAdhocToken>[1]["kind"],
            name: body.name,
            x: body.x,
            y: body.y,
            hidden: body.hidden,
          })
        : body.do === "remove"
          ? removeAdhocToken(campaign, body.tokenId)
          : setTokenVisibility(campaign, body.tokenId, body.hidden);

  return "error" in outcome
    ? Response.json({ error: outcome.error }, { status: 409 })
    : Response.json({ ok: true, note: outcome.note });
}
