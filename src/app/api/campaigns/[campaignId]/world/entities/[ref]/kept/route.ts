import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { settleKept } from "@/lib/db/world-forge";
import { publishEphemeral } from "@/lib/events";
import { parseRef } from "@/lib/worldforge/model";
import { recordsChanged } from "@/lib/workshop/record-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/campaigns/[campaignId]/world/entities/[ref]/kept
//
// The author's choice on a value a reimport kept as this campaign has it,
// the import's version beside it (src/lib/worldforge/import-kept.ts):
//
//   { key, choice: "use" }      write the import's version; yours is kept
//   { key, choice: "restore" }  write yours back
//   { key, choice: "dismiss" }  keep what the entry holds; the notice goes
//
// Story authority, as every World route: the import's version can be a
// hidden truth, and players never read it.
const bodySchema = z.object({
  key: z.string().min(1).max(100),
  choice: z.enum(["use", "restore", "dismiss"]),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string; ref: string }> }) {
  const { campaignId, ref: rawRef } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ref = rawRef.includes("%") ? decodeURIComponent(rawRef) : rawRef;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parseRef(ref) || !parsed.success) {
    return Response.json({ error: parsed.success ? "No such entry." : "Say which value and what to do with it." }, { status: parsed.success ? 404 : 400 });
  }
  const result = settleKept(campaignId, ref, parsed.data.key, parsed.data.choice);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status ?? 400 });
  }
  publishEphemeral(campaignId, result.entity.shelf === "faction" ? "factions_updated" : "world_updated", { at: Date.now() });
  recordsChanged(campaignId, result.entity.shelf, "world");
  return Response.json(result);
}
