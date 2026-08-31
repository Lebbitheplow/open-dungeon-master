import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import {
  OVERWORLD_HEIGHT,
  OVERWORLD_WIDTH,
  generateOverworldTerrain,
  normalizeOverworldParams,
} from "@/lib/overworld/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Terrain for a seed and a set of dials, written nowhere. This is what makes
// "reroll until you like it" possible without the table watching the world
// flicker: the preview is a string in a response, and only a PATCH with the
// same seed puts it on the map.
const previewSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  params: z.unknown().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = previewSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid preview request." }, { status: 400 });
  }
  const seed = parsed.data.seed ?? (Math.random() * 0xffffffff) >>> 0;
  const dials = normalizeOverworldParams(parsed.data.params);
  return Response.json({
    seed,
    params: dials,
    width: OVERWORLD_WIDTH,
    height: OVERWORLD_HEIGHT,
    terrain: generateOverworldTerrain(seed, OVERWORLD_WIDTH, OVERWORLD_HEIGHT, dials),
  });
}
