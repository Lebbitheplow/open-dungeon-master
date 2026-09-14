import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { deleteQuest, getQuest, updateQuest } from "@/lib/db/quests";
import { normalizeObjectives, normalizeQuestStatus, QUEST_STATUSES, type QuestStatus } from "@/lib/dm/quest-logic";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireQuest(campaignId: string, questId: string) {
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const quest = getQuest(questId);
  if (!quest || quest.campaignId !== campaignId) {
    return Response.json({ error: "Quest not found." }, { status: 404 });
  }
  return quest;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; questId: string }> },
) {
  const { campaignId, questId } = await params;
  const quest = await requireQuest(campaignId, questId);
  if (quest instanceof Response) {
    return quest;
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Parameters<typeof updateQuest>[1] = {};
  if (typeof raw.title === "string" && raw.title.trim()) {
    patch.title = raw.title;
  }
  if (raw.objectives !== undefined) {
    patch.objectives = normalizeObjectives(raw.objectives, quest.objectives);
  }
  if (QUEST_STATUSES.includes(raw.status as QuestStatus)) {
    patch.status = normalizeQuestStatus(raw.status);
  }
  if (raw.visibility === "dm" || raw.visibility === "party") {
    patch.visibility = raw.visibility;
  }
  const updated = updateQuest(questId, patch);
  publishEphemeral(campaignId, "quests_updated", { at: Date.now() });
  return Response.json({ quest: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; questId: string }> },
) {
  const { campaignId, questId } = await params;
  const quest = await requireQuest(campaignId, questId);
  if (quest instanceof Response) {
    return quest;
  }
  deleteQuest(questId);
  publishEphemeral(campaignId, "quests_updated", { at: Date.now() });
  return Response.json({ ok: true });
}
