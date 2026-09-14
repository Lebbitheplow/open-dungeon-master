import {
  isErrorResponse,
  requireStoryAuthority,
  requireMember,
  steersStory,
} from "@/lib/campaign-api";
import { insertLoreEntry, listLoreEntries } from "@/lib/db/lore";
import { ingestLoreAttachment } from "@/lib/dm/lore-attachments";
import {
  loreVisibleTo,
  normalizeLoreAudience,
  normalizeLoreInput,
  normalizeLoreStyle,
  stripSecretBlocks,
} from "@/lib/dm/world-lore-logic";
import { isUploadedImagePath, isUploadedPdfPath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The world bible is party-visible; only the lead writes it. An entry the
// lead marked as theirs alone (docs/workshop-parity-audit.md phase 14) is
// left out of a player's list here, so it never crosses the wire to a
// browser that should not hold it.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const dm = steersStory(context);
  const entries = loreVisibleTo(listLoreEntries(campaignId), dm, context.user.id);
  // A secret passage never crosses the wire to a player's browser.
  return Response.json({
    entries: dm ? entries : entries.map((entry) => ({ ...entry, body: stripSecretBlocks(entry.body) })),
  });
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
  const input = normalizeLoreInput(raw);
  if (!input) {
    return Response.json({ error: "Invalid lore entry." }, { status: 400 });
  }
  // The picture went through /api/upload first; only a path this app wrote
  // is accepted, and anything else is refused rather than sanitized.
  if (raw.imagePath !== undefined && raw.imagePath !== "" && !isUploadedImagePath(raw.imagePath)) {
    return Response.json({ error: "Not an uploaded file." }, { status: 400 });
  }
  if (raw.attachmentPath !== undefined && raw.attachmentPath !== "" && !isUploadedPdfPath(raw.attachmentPath)) {
    return Response.json({ error: "Not an uploaded PDF." }, { status: 400 });
  }
  const entry = insertLoreEntry({
    campaignId,
    ...input,
    imagePath: typeof raw.imagePath === "string" ? raw.imagePath : "",
    audience: normalizeLoreAudience(raw.audience),
    attachmentPath: typeof raw.attachmentPath === "string" ? raw.attachmentPath : "",
    style: normalizeLoreStyle(raw.style),
  });
  if (entry.attachmentPath) {
    void ingestLoreAttachment(entry).catch((error) => console.error("[lore] pdf ingest failed", error));
  }
  return Response.json({ entry });
}
