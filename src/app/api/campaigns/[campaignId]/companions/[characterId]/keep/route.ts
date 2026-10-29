import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { keepCompanion } from "@/lib/characters/keep-companion";
import { getSheetById } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Save to my characters" on a lasting companion's card: kept in the
// caller's library as an ally the GM plays, or its progress written back to
// the entry it is already kept as (src/lib/characters/keep-companion.ts).
// Whoever runs the story builds, recruits and dismisses companions, so they
// keep them too.
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
  if (!sheet || sheet.campaignId !== campaignId) {
    return Response.json({ error: "That is not a companion at this table." }, { status: 404 });
  }
  const kept = keepCompanion(sheet, context.user.id);
  if ("error" in kept) {
    return Response.json({ error: kept.error }, { status: kept.status });
  }
  // Newly tied to the library: the table's copy of the sheet says so.
  if (kept.how === "kept") {
    publishPersisted(campaignId, "sheet_updated", { sheet: kept.sheet });
  }
  return Response.json({ how: kept.how, keptLevel: kept.keptLevel, characterId: kept.character.id });
}
