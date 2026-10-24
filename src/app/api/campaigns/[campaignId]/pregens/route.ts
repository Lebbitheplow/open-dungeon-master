import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listMembers } from "@/lib/db/campaigns";
import { listOfferedPregens } from "@/lib/db/pregen-offers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The pregens this table's DM offers its players (src/lib/db/pregen-offers.ts),
// for the hero chooser: only the ticked ones, of a workshop this table was
// made from, with who holds each. A DM's own pregens are left out for that
// DM, whose library lists them already. The sheet itself is not sent; the
// confirm sheet asks the server about it (POST /sheet/preview).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const names = new Map(listMembers(campaignId).map((member) => [member.userId, member.username]));
  const pregens = listOfferedPregens(campaignId)
    .filter((offer) => offer.character.userId !== context.user.id)
    .map(({ character, claim }) => ({
      id: character.id,
      name: character.name,
      race: character.race,
      class: character.class,
      subclass: character.subclass,
      background: character.background,
      level: character.level,
      workshopId: character.workshopId,
      // Free, the viewer's own seat, or someone else's.
      taken: claim ? (claim.userId === context.user.id ? "mine" : "other") : null,
      takenBy: claim && claim.userId !== context.user.id ? (names.get(claim.userId) ?? "another player") : null,
    }));
  return Response.json({ pregens });
}
