import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listMembers } from "@/lib/db/campaigns";
import { listMessagesBefore } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;

// The transcript a page at a time, newest first: `before` is the seq to page
// back from (olderBefore of the previous page), absent for the newest page.
// The snapshot serves only the last 100 messages; this is how an agent
// (odm_get_messages, src/lib/agents/workbench.ts) reads further back. Every
// member already reads the whole transcript at the table, so a page carries
// the same messages the snapshot does.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const query = new URL(request.url).searchParams;
  const before = query.has("before") ? Number(query.get("before")) : null;
  const limit = query.has("limit") ? Number(query.get("limit")) : 30;
  if (
    (before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    return Response.json(
      { error: `before must be a message seq and limit a whole number from 1 to ${MAX_LIMIT}.` },
      { status: 400 },
    );
  }
  const { messages, hasOlder } = listMessagesBefore(campaignId, before, limit);
  // Who each line is from, so a page reads on its own without the snapshot.
  const names: Record<string, string> = {};
  for (const member of listMembers(campaignId)) {
    names[member.userId] = member.username;
  }
  for (const sheet of listSheets(campaignId)) {
    names[sheet.id] = sheet.name;
  }
  return Response.json({
    messages,
    olderBefore: hasOlder && messages.length ? messages[0].seq : null,
    names,
  });
}
