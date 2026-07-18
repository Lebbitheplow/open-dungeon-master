import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { createCharacter, instantiateIntoCampaign } from "@/lib/db/characters";
import { createSheet, getSheetForUser, patchSheet } from "@/lib/db/sheets";
import { createSheetSchema, patchSheetSchema } from "@/lib/schemas/sheet";
import { publishPersisted } from "@/lib/events";

const fromLibrarySchema = z.object({
  libraryCharacterId: z.string().min(1),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  return Response.json({ sheet: getSheetForUser(campaignId, context.user.id) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  if (getSheetForUser(campaignId, context.user.id)) {
    return Response.json(
      { error: "You already have a character in this campaign." },
      { status: 409 },
    );
  }

  const raw = await request.json().catch(() => ({}));

  // Path 1: pick an existing library character (adapted to campaign level).
  const fromLibrary = fromLibrarySchema.safeParse(raw);
  if (fromLibrary.success) {
    const result = instantiateIntoCampaign(
      fromLibrary.data.libraryCharacterId,
      campaignId,
      context.user.id,
      context.campaign.startingLevel,
    );
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    publishPersisted(campaignId, "sheet_updated", { sheet: result });
    return Response.json({ sheet: result }, { status: 201 });
  }

  // Path 2: create new; also saved to the user's library, then copied in.
  const parsed = createSheetSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid character sheet." },
      { status: 400 },
    );
  }

  const libraryCharacter = createCharacter(
    context.user.id,
    context.campaign.startingLevel,
    parsed.data,
  );
  const sheet = createSheet(
    campaignId,
    context.user.id,
    context.campaign.startingLevel,
    parsed.data,
    libraryCharacter.id,
  );
  publishPersisted(campaignId, "sheet_updated", { sheet });

  return Response.json({ sheet }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const sheet = getSheetForUser(campaignId, context.user.id);
  if (!sheet) {
    return Response.json({ error: "You have no character in this campaign." }, { status: 404 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSheetSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid sheet update." },
      { status: 400 },
    );
  }

  const updated = patchSheet(sheet.id, parsed.data);
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });

  return Response.json({ sheet: updated });
}
