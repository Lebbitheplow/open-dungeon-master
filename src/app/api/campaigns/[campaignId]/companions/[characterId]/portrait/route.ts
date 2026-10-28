import { isErrorResponse, requireMember, requireStoryAuthority } from "@/lib/campaign-api";
import { imagesAvailable } from "@/lib/capabilities";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { portraitStatus, queueCompanionPortrait } from "@/lib/portrait";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Paint a portrait" for a companion (issue 569): a fresh face from what the
// sheet says, replacing the one it has. A library character has had this
// (src/app/api/characters/[characterId]/portrait/route.ts); a companion had
// only an upload, so a face painted wrong stayed wrong all campaign. Whoever
// runs the story sets a companion's portrait, so they paint it. The old
// picture goes first, so the card shows its stand-in while the queue works.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; characterId: string }> },
) {
  const { campaignId, characterId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.campaignId !== campaignId || !sheet.isCompanion) {
    return Response.json({ error: "That is not a companion at this table." }, { status: 404 });
  }
  if (!(await imagesAvailable())) {
    return Response.json(
      { error: "This server has no image model to paint with. Upload a portrait instead." },
      { status: 409 },
    );
  }
  // A second press while one is painting answers that one.
  const state = portraitStatus(sheet.id);
  if (state === "queued" || state === "generating") {
    return Response.json({ ok: true, status: state }, { status: 202 });
  }
  const cleared = patchSheet(sheet.id, { portrait: null }) ?? sheet;
  publishPersisted(campaignId, "sheet_updated", { sheet: cleared });
  queueCompanionPortrait(context.campaign, cleared, { personality: cleared.personality });
  return Response.json({ ok: true, status: "queued" }, { status: 202 });
}

// Where the painting is: "queued", "generating", "failed", or null when none
// is under way (finished, or the server restarted and dropped it).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; characterId: string }> },
) {
  const { campaignId, characterId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const sheet = getSheetById(characterId);
  if (!sheet || sheet.campaignId !== campaignId || !sheet.isCompanion) {
    return Response.json({ error: "That is not a companion at this table." }, { status: 404 });
  }
  return Response.json({ status: portraitStatus(sheet.id) });
}
