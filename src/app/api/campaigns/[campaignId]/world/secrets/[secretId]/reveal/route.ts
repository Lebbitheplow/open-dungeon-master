import { isDm, isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { revealSecret, worldAnswerFor } from "@/lib/db/world-forge";
import { loreBodyOverflow, normalizeLoreInput } from "@/lib/dm/world-lore-logic";
import { publishHandout } from "@/lib/dm/scene-state";
import { publishEphemeral } from "@/lib/events";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Reveal to the party" (audit WF-10): a secret of this campaign's world,
// told to the table on purpose. The words are the story authority's own,
// written in the form before they press Reveal, and become a lore entry
// every player reads; the secret is marked learned with the record of the
// telling (src/lib/db/world-forge.ts revealSecret). The secret's notes, its
// keepers and the rest of the world stay behind requireStoryAuthority.
//
// A workshop has no party to tell, and its secrets reach a campaign as a
// copy, so a reveal is a campaign's alone: the workshop it came from keeps
// its secret as it was.
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string; secretId: string }> }) {
  const { campaignId, secretId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (context.campaign.kind === "workshop") {
    return Response.json({ error: "A workshop has no party to tell. Reveal it from a campaign's World tab." }, { status: 400 });
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // Over the cap is refused with what would be lost, never cut (issue #302).
  const overflow = loreBodyOverflow(raw.body);
  if (overflow) {
    return Response.json({ error: overflow }, { status: 400 });
  }
  const told = normalizeLoreInput({ category: raw.category ?? "other", title: raw.title, body: raw.body });
  if (!told) {
    return Response.json({ error: "Write what the party learns: a title and the words they will read." }, { status: 400 });
  }
  // A handout is the DM seat's to put up, as "Show this now" is (dm/invoke).
  const show = raw.show === true;
  if (show && !isDm(context)) {
    return Response.json({ error: "Only the Dungeon Master can put a handout on every screen." }, { status: 403 });
  }
  const outcome = revealSecret(campaignId, secretId, told);
  if ("error" in outcome) {
    return Response.json({ error: outcome.error }, { status: outcome.status ?? 400 });
  }
  const { entry } = outcome;
  if (show) {
    publishHandout(campaignId, { loreId: entry.id, title: entry.title, style: "parchment", audience: null });
  }
  // Players' lore lists read themselves again (a contentless ping to the
  // whole table: each seat's GET /lore answers for that seat); the world's
  // editors read the world again.
  publishEphemeral(campaignId, "lore_updated", { at: Date.now() });
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  recordsChanged(campaignId, "lore", "world");
  return Response.json({ secret: outcome.secret, entry, ...worldAnswerFor(request, campaignId) });
}
