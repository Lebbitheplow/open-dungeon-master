import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { goneCompanions } from "@/lib/db/companion-npcs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Party panel's Gone list (issue 503): the lasting companions who left
// this party, with how they went as the table saw it. Every seat reads the
// same list: a departure happens in front of everyone. A plan a companion
// still in the party holds is a storyteller secret and is never here.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ gone: goneCompanions(campaignId) });
}
