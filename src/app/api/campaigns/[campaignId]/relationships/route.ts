import { isErrorResponse, seesStorytellerSecrets, steersStory, requireMember } from "@/lib/campaign-api";
import { listRelationships } from "@/lib/db/relationships";
import { listSheets } from "@/lib/db/sheets";
import { friendshipTier, TIER_LABEL } from "@/lib/dm/relationship-logic";
import { bondTruthFor } from "@/lib/dm/scheme-logic";
import { advancesAllowed } from "@/lib/dm/advance-tick";
import { conscienceViews } from "@/lib/dm/conscience";
import { heldIntents } from "@/lib/dm/departure";
import { conductViews } from "@/lib/dm/party-conduct";
import { heldAgendas } from "@/lib/dm/companion-agenda";
import { playerPactsPossible } from "@/lib/dm/pacts";
import { textKey } from "@/lib/language/text-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where each character stands with each tracked NPC and companion, for the
// Bonds panel. Players get the TIER WORD only ("friendly", "wary"): knowing
// where you stand is the point, but handing the table the raw number turns
// roleplay into arithmetic. The party lead, who already sees DM-only facts
// and the audit log, gets the number too. Content never rides SSE; clients
// refetch on the contentless relationships_updated ephemeral.
//
// An NPC's act (issue 501, src/lib/dm/scheme-logic.ts) is a storyteller
// secret: every player, the lead included, reads the warmth it shows, until
// one of their own characters sees through it (an Insight that beat it,
// whispered to them alone) or the truth comes out to everyone. Only whoever
// runs the story reads the truth, the motive and who has seen through it.

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
  // Each lasting companion's conscience rung and any ultimatum (issue 503):
  // shown to every seat, since the companion says them aloud.
  const conscience = conscienceViews(context.campaign);
  // What each refused today and the share it wants (Phase 4): said aloud too.
  const conduct = conductViews(context.campaign);
  const storyteller = seesStorytellerSecrets(context);
  // A companion's plan to leave (issue 503) is a storyteller secret: only a
  // person running the table reads it here; at an AI table nobody does, the
  // lead included (the AI has it in its own prompt).
  const plans = storyteller ? heldIntents(context.campaign) : new Map<string, string>();
  // So is a hidden employer (Phase 8).
  const agendas = storyteller ? heldAgendas(context.campaign) : new Map<string, string>();
  const sheets = listSheets(campaignId);
  const viewer = {
    storyteller,
    ownedCharacterIds: sheets.filter((sheet) => sheet.userId === context.user.id).map((sheet) => sheet.id),
  };
  const names = new Map(sheets.map((sheet) => [sheet.id, sheet.name]));
  return Response.json({
    enabled: true,
    romanceEnabled: context.campaign.gameSettings.romance !== "off",
    // Whether NPC advances can happen here (romance on, and the safety
    // tools do not rule them out), so the Bonds tab shows its opt-in only
    // where it can matter (issue 501).
    advances: advancesAllowed(context.campaign),
    // Whether a pact could approach a player here (issue 503 Phase 7), so
    // the Bonds tab shows "Pacts may approach me" only where it can matter.
    pacts: playerPactsPossible(context.campaign, sheets),
    relationships: listRelationships(campaignId).map((relationship) => {
      const truth = bondTruthFor(viewer, relationship);
      const tier = friendshipTier(truth.approval);
      const ladder = relationship.subjectKind === "companion" && relationship.status === "active" ? conscience.get(textKey(relationship.subjectName)) : undefined;
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
        ...(lead ? { approval: truth.approval } : {}),
        ...(truth.seenThrough ? { seenThrough: true } : {}),
        ...(truth.unmasked ? { unmasked: true } : {}),
        ...(truth.act
          ? {
              act: {
                motive: truth.act.motive,
                shown: truth.act.shown,
                shownTier: truth.act.shownTier,
                seenThroughBy: truth.act.seenThroughBy.map((id) => names.get(id) ?? "").filter(Boolean),
                revealed: truth.act.revealed,
              },
            }
          : {}),
        ...(ladder
          ? {
              conscience: {
                ...ladder,
                ...conduct.get(textKey(relationship.subjectName)),
                ...(plans.has(textKey(relationship.subjectName)) ? { plan: plans.get(textKey(relationship.subjectName)) } : {}),
                ...(agendas.has(textKey(relationship.subjectName)) ? { agenda: agendas.get(textKey(relationship.subjectName)) } : {}),
              },
            }
          : {}),
      };
    }),
  });
}
