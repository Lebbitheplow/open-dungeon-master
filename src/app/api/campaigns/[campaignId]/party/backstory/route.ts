import { z } from "zod";
import { isErrorResponse, isLead, requireVoice, type MemberContext } from "@/lib/campaign-api";
import { updateParty } from "@/lib/db/party";
import { listSheets } from "@/lib/db/sheets";
import { draftPartyBackstory } from "@/lib/dm/party-draft";
import { mayWritePartyBackstory, PARTY_BACKSTORY_MAX, PARTY_BACKSTORY_REFUSAL } from "@/lib/dm/party-story";
import { publishPersisted } from "@/lib/events";
import { isWorkshop } from "@/lib/workshop/kind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The party's shared backstory (src/lib/dm/party-story.ts): optional, written
// in the lobby once characters have joined, and editable mid-campaign. The
// DM's per-turn prompt reads it fresh every turn; the saga planner reads it
// when the arc is planned at the start and when the lead regenerates it, and
// nothing else is re-run when it changes.
//
// "save" stores it (blank clears it) with the latest save winning; "draft"
// asks the story model for one from the seated characters' backstories and
// stores nothing, so the table edits it before anyone saves.
const bodySchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("save"), text: z.string().max(PARTY_BACKSTORY_MAX * 2) }),
  z.object({ do: z.literal("draft"), current: z.string().max(PARTY_BACKSTORY_MAX * 2).optional() }),
]);

function partyCharacters(campaignId: string) {
  // Guests are passing through; a lasting companion travels with the party
  // and belongs in its story.
  return listSheets(campaignId).filter((sheet) => !(sheet.isCompanion && sheet.companionKind === "guest"));
}

function mayWrite(context: MemberContext): boolean {
  const { campaign, user } = context;
  return mayWritePartyBackstory({
    isLead: isLead(context),
    holdsDmSeat: campaign.dmUserId === user.id || campaign.assistantDmUserId === user.id,
    hasCharacter: listSheets(campaign.id).some((sheet) => sheet.userId === user.id && !sheet.isCompanion),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (isWorkshop(context.campaign)) {
    return Response.json({ error: "A workshop has no party to write a backstory for." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Say whether to save or draft the party backstory." }, { status: 400 });
  }
  if (!mayWrite(context)) {
    return Response.json({ error: PARTY_BACKSTORY_REFUSAL }, { status: 403 });
  }
  const body = parsed.data;

  if (body.do === "save") {
    const text = body.text.trim();
    if (text.length > PARTY_BACKSTORY_MAX) {
      return Response.json(
        { error: `Keep the party backstory under ${PARTY_BACKSTORY_MAX} characters.` },
        { status: 400 },
      );
    }
    const party = updateParty(campaignId, (current) => ({
      ...current,
      backstory: text,
      backstoryBy: text ? context.user.username : "",
      backstoryAt: text ? new Date().toISOString() : "",
    }));
    publishPersisted(campaignId, "party_updated", { party });
    return Response.json({ party });
  }

  const characters = partyCharacters(campaignId);
  if (!characters.length) {
    return Response.json({ error: "Nobody has a character yet; there is no party to draft from." }, { status: 409 });
  }
  const { text, error } = await draftPartyBackstory(
    context.campaign,
    characters.map((sheet) => ({
      name: sheet.name,
      race: sheet.race,
      className: sheet.class,
      background: sheet.background,
      backstory: sheet.backstory || (sheet.isCompanion ? sheet.personality : ""),
    })),
    body.current ?? "",
  );
  return error ? Response.json({ error }, { status: 502 }) : Response.json({ text });
}
