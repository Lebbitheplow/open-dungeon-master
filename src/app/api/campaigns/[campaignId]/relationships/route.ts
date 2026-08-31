import { isErrorResponse, steersStory, requireMember } from "@/lib/campaign-api";
import { listRelationships } from "@/lib/db/relationships";
import { friendshipTier, TIER_LABEL } from "@/lib/dm/relationship-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where each character stands with each tracked NPC and companion, for the
// Bonds panel. Players get the TIER WORD only ("friendly", "wary"): knowing
// where you stand is the point, but handing the table the raw number turns
// roleplay into arithmetic. The party lead, who already sees DM-only facts
// and the audit log, gets the number too. Content never rides SSE; clients
// refetch on the contentless relationships_updated ephemeral.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const lead = steersStory(context);
  if (context.campaign.gameSettings.relationships === "off") {
    return Response.json({ enabled: false, relationships: [] });
  }
  return Response.json({
    enabled: true,
    romanceEnabled: context.campaign.gameSettings.romance !== "off",
    relationships: listRelationships(campaignId).map((relationship) => {
      const tier = friendshipTier(relationship.approval);
      return {
        id: relationship.id,
        characterId: relationship.characterId,
        characterName: relationship.characterName,
        subjectName: relationship.subjectName,
        subjectKind: relationship.subjectKind,
        tier,
        tierLabel: TIER_LABEL[tier],
        romance: relationship.romance,
        status: relationship.status,
        apartChapters: relationship.apartChapters,
        // The three most recent remembered beats read as a short history.
        history: relationship.memories.slice(-3).map((memory) => memory.text),
        ...(lead ? { approval: relationship.approval } : {}),
      };
    }),
  });
}
