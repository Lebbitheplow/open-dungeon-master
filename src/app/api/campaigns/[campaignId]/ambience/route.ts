import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { handlePlaySting, handleSetAmbience } from "@/lib/dm/ambience-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The sound panel's hand on the table's sound (SoundPanel.tsx): the same two
// engine actions the AI DM and the console reach, set_ambience and
// play_sting, for whoever steers the story. That is the DM at a table a
// person runs and the party lead at an AI table, who otherwise had no way to
// change the track short of asking the model to.
const bodySchema = z.object({
  bed: z.string().max(40).optional(),
  music: z.string().max(40).optional(),
  hold: z.boolean().optional(),
  sting: z.string().max(40).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Name a bed, a music cue or a sound." }, { status: 400 });
  }
  const { bed, music, hold, sting } = parsed.data;
  const results: Record<string, unknown> = {};
  if (bed !== undefined || music !== undefined) {
    const result = handleSetAmbience(context.campaign, JSON.stringify({ bed, music, hold }));
    if (result.error) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    Object.assign(results, result);
  }
  if (sting !== undefined) {
    const result = handlePlaySting(context.campaign, JSON.stringify({ cue: sting }));
    if (result.error) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    results.played = result.played;
  }
  if (!Object.keys(results).length) {
    return Response.json({ error: "Name a bed, a music cue or a sound." }, { status: 400 });
  }
  return Response.json(results);
}
