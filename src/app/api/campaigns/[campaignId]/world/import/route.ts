import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { importWorldForge } from "@/lib/db/world-forge-io";
import { publishEphemeral } from "@/lib/events";
import { uploadRefusalResponse } from "@/lib/upload-budget";
import { MAX_BUNDLE_BYTES } from "@/lib/workshop/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A WorldForge export into THIS workshop's WorldForge, added to what is
// there: a person or place it already has is updated, not doubled.
//
// SECURITY: the file is a stranger's. The text is capped by length before
// it is parsed, every value is read through the model's floors
// (src/lib/worldforge/format.ts), pictures are weighed against the upload
// budget, and the export's settings (which can hold an API key) are never
// read.
const bodySchema = z.object({ text: z.string().min(1).max(MAX_BUNDLE_BYTES) });

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That file is empty or too large." }, { status: 400 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(parsed.data.text);
  } catch {
    return Response.json({ error: "That file is not JSON." }, { status: 400 });
  }
  const result = importWorldForge(campaignId, { id: context.user.id, isAdmin: context.user.isAdmin }, raw);
  if ("error" in result) {
    return result.refusal ? uploadRefusalResponse(result.refusal) : Response.json({ error: result.error }, { status: 400 });
  }
  publishEphemeral(campaignId, "world_updated", { at: Date.now() });
  publishEphemeral(campaignId, "factions_updated", { at: Date.now() });
  return Response.json(result);
}
