import { isErrorResponse, requireMember, requireStoryAuthority, steersStory } from "@/lib/campaign-api";
import { insertQuest, listQuests } from "@/lib/db/quests";
import { normalizeObjectives, normalizeQuestStatus, questsVisibleTo } from "@/lib/dm/quest-logic";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The quest log (docs/vtt-parity-implementation-plan.md section 5.7).
// Everyone reads the party's; whoever steers the story writes.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ quests: questsVisibleTo(listQuests(campaignId), steersStory(context)) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) {
    return Response.json({ error: "A quest needs a title." }, { status: 400 });
  }
  const quest = insertQuest({
    campaignId,
    title,
    objectives: normalizeObjectives(raw.objectives),
    status: normalizeQuestStatus(raw.status),
    visibility: raw.visibility === "dm" ? "dm" : "party",
    source: "dm",
  });
  publishEphemeral(campaignId, "quests_updated", { at: Date.now() });
  return Response.json({ quest });
}
