import { isErrorResponse, requireLead, requireMember } from "@/lib/campaign-api";
import { insertLoreEntry, listLoreEntries } from "@/lib/db/lore";
import { normalizeLoreInput } from "@/lib/dm/world-lore-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The world bible is party-visible; only the lead writes it.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ entries: listLoreEntries(campaignId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireLead(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = normalizeLoreInput(raw);
  if (!input) {
    return Response.json({ error: "Invalid lore entry." }, { status: 400 });
  }
  const entry = insertLoreEntry({ campaignId, ...input });
  return Response.json({ entry });
}
