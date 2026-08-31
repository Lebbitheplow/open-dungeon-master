import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { getParty, updateParty } from "@/lib/db/party";
import { listSheets } from "@/lib/db/sheets";
import { payOutBankedXp } from "@/lib/dm/party-tools";
import {
  moveInMarchingOrder,
  PARTY_ACTIVITY_MAX,
  PARTY_LOCATION_MAX,
  reconcileMarchingOrder,
} from "@/lib/dm/party-logic";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The party record's DM-only half: where they are, what they are doing, the
// marching order, and handing out banked experience.
//
// Not adjudications, and deliberately not in the catalog. These are the same
// kind of thing as the board and the map studio: DM bookkeeping the AI has no
// business reaching for, since it already has award_xp and move_party for
// everything it should be doing on its own.

const partySchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("activity"), activity: z.string().trim().max(PARTY_ACTIVITY_MAX) }),
  z.object({ do: z.literal("location"), location: z.string().trim().max(PARTY_LOCATION_MAX) }),
  z.object({ do: z.literal("bank-xp"), amount: z.number().int().min(0).max(1000000) }),
  z.object({ do: z.literal("pay-xp"), characterIds: z.array(z.string()).min(1).max(12) }),
  z.object({
    do: z.literal("march"),
    characterId: z.string(),
    direction: z.enum(["up", "down"]),
  }),
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  // The order is reconciled on read rather than on every join and departure:
  // one place to get it right, and it can never name someone who left.
  const party = updateParty(campaignId, (current) => ({
    ...current,
    marchingOrder: reconcileMarchingOrder(
      current.marchingOrder,
      listSheets(campaignId).map((sheet) => sheet.id),
    ),
  }));
  return Response.json({ party });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const { campaign } = context;

  const parsed = partySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say what to change about the party." }, { status: 400 });
  }
  const body = parsed.data;

  if (body.do === "pay-xp") {
    const outcome = payOutBankedXp(campaign, body.characterIds);
    if ("error" in outcome) {
      return Response.json({ error: outcome.error }, { status: 409 });
    }
    return Response.json({ party: getParty(campaignId), each: outcome.each, paid: outcome.paid });
  }

  const party = updateParty(campaignId, (current) => {
    if (body.do === "activity") {
      return { ...current, activity: body.activity };
    }
    if (body.do === "location") {
      return { ...current, location: body.location };
    }
    if (body.do === "bank-xp") {
      return { ...current, bankedXp: body.amount };
    }
    return {
      ...current,
      marchingOrder: moveInMarchingOrder(current.marchingOrder, body.characterId, body.direction),
    };
  });
  publishPersisted(campaignId, "party_updated", { party });
  return Response.json({ party });
}
