import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { entriesBoundTo } from "@/lib/db/world-bindings";
import { createEntryForRecord, getWorldDoc } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";
import { recordsChanged } from "@/lib/workshop/record-events";
import { BINDING_KINDS, isPlaceBinding, type BindingKind } from "@/lib/worldforge/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The World entries that link to one playable record (audit finding WF-17),
// for the record's own tool: the way back to each entry, and the names to
// give before the record is deleted. ?kind=monster|item&ref=homebrew:<id>,
// or ?kind=map|encounter&ref=<the prepared map's or encounter's id>
export async function GET(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as BindingKind;
  const ref = (url.searchParams.get("ref") ?? "").slice(0, 120);
  if (!BINDING_KINDS.includes(kind) || !ref) {
    return Response.json({ error: "Name a kind and a record." }, { status: 400 });
  }
  return Response.json({ entries: entriesBoundTo(campaignId, getWorldDoc(campaignId), kind, ref) });
}

// "Give it a World entry" (audit finding WF-08): a lore entry named for the
// record and linked to it, or the entry that already links to it.
// { kind: "monster" | "item", ref: "homebrew:<id>" | a rulebook slug }
export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const raw = (await request.json().catch(() => ({}))) as { kind?: unknown; ref?: unknown };
  const kind = raw.kind as BindingKind;
  const ref = typeof raw.ref === "string" ? raw.ref.trim().slice(0, 120) : "";
  // A battle map or an encounter is a place's, given from the place.
  if (!BINDING_KINDS.includes(kind) || isPlaceBinding(kind) || !ref) {
    return Response.json({ error: "Name a kind and a record." }, { status: 400 });
  }
  const result = createEntryForRecord(campaignId, { kind, ref });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status ?? 400 });
  }
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  recordsChanged(campaignId, "lore", "world");
  return Response.json(result);
}
