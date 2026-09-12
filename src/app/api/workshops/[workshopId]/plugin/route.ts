import { isErrorResponse, requireWorkshop } from "@/lib/workshop-api";
import { deletePackDraft, getPackDraft, savePackDraft } from "@/lib/db/world-pack-drafts";
import { worldPackDraftSchema } from "@/lib/worlds/draft";
import { MAX_MANIFEST_BYTES } from "@/lib/worlds/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The workshop's world pack draft: read it, replace it, throw it away.
//
// PUT takes the whole draft every time rather than a patch. The editor
// autosaves a few hundred milliseconds after a keystroke, the draft is one
// JSON value, and a whole-value write cannot leave a row half-updated. The
// body is capped at the manifest size BEFORE it is parsed, the same way the
// bundle import caps its file: a draft that could not be installed cannot be
// saved either, so a person finds the limit while typing, not at export.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const context = await requireWorkshop(workshopId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(getPackDraft(workshopId, context.workshop.gameSettings.genre));
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const context = await requireWorkshop(workshopId);
  if (isErrorResponse(context)) {
    return context;
  }
  // next.config caps request bodies at the same 16 MB and TRUNCATES rather
  // than refuses, so the declared length is checked first (a browser fetch
  // always sends one for a string body) and the bytes that arrived second,
  // "at or over" both times: a body cut at the cap is over it.
  const declared = Number(request.headers.get("content-length") ?? 0);
  const text = declared >= MAX_MANIFEST_BYTES ? "" : await request.text().catch(() => "");
  if (declared >= MAX_MANIFEST_BYTES || new TextEncoder().encode(text).length >= MAX_MANIFEST_BYTES) {
    return Response.json(
      { error: `A world pack caps at ${MAX_MANIFEST_BYTES / 1024 / 1024} MB. Remove some pictures.` },
      { status: 413 },
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: "That is not a draft." }, { status: 400 });
  }
  const parsed = worldPackDraftSchema.safeParse((raw as { draft?: unknown })?.draft);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return Response.json(
      { error: `That draft was refused: ${first ? `${first.path.join(".") || "root"} ${first.message}` : "unknown problem"}.` },
      { status: 400 },
    );
  }
  return Response.json(savePackDraft(workshopId, parsed.data));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const context = await requireWorkshop(workshopId);
  if (isErrorResponse(context)) {
    return context;
  }
  deletePackDraft(workshopId);
  return Response.json(getPackDraft(workshopId, context.workshop.gameSettings.genre));
}
