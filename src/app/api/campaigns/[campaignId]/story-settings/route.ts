import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { updateStorySettings } from "@/lib/db/campaigns";
import { maskStorySettings, scrubStorySettings } from "@/lib/db/settings";
import { publishPersisted } from "@/lib/events";
import { LOCAL_TEXT_MODEL_IDS } from "@/lib/text-models";
import { IMAGE_BACKENDS, PROSE_SIZE_VALUES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-campaign AI settings, gated on story authority rather than the lead:
// at a human-DM table these knobs steer the DM's own tools, and the model
// key is the DM's to hold. The two keys follow the admin settings route's
// contract: GET reduces them to has* booleans, PATCH treats an omitted field
// as keep and "" as clear. The server-wide keys have no per-campaign copy to
// expose; model-client attaches them at request time, host-gated to the
// admin-configured backend.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ settings: maskStorySettings(context.campaign.settings) });
}

// Enum values mirror the StorySettings type; strings get the same trim and
// caps normalizeSettings applies, so a maximal value round-trips unchanged.
const patchSchema = z.object({
  world: z.string().trim().max(4000).optional(),
  style: z.string().trim().max(4000).optional(),
  textProvider: z.enum(["local", "custom", "none"]).optional(),
  localTextModel: z.enum(LOCAL_TEXT_MODEL_IDS).optional(),
  customBaseUrl: z.string().trim().max(500).optional(),
  customModel: z.string().trim().max(200).optional(),
  customApiKey: z.string().trim().max(400).optional(),
  utilityProvider: z.enum(["local", "custom"]).optional(),
  utilityModel: z.string().trim().max(200).optional(),
  utilityBaseUrl: z.string().trim().max(500).optional(),
  utilityApiKey: z.string().trim().max(400).optional(),
  imageMode: z.enum(["fast", "slow"]).optional(),
  imageBackend: z.enum(IMAGE_BACKENDS).optional(),
  comfyUrl: z.string().trim().max(500).optional(),
  comfyCheckpoint: z.string().trim().max(300).optional(),
  aspect: z.enum(["square", "portrait", "landscape"]).optional(),
  imageGenerationEnabled: z.boolean().optional(),
  autoImages: z.boolean().optional(),
  proseSize: z.enum(PROSE_SIZE_VALUES).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid story settings." },
      { status: 400 },
    );
  }

  const settings = updateStorySettings(campaignId, parsed.data);
  if (!settings) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }

  // campaign_updated merges its payload into every open table's snapshot, so
  // the whole room sees the change without a refetch; scrubbed because the
  // stream reaches players who must never see a key.
  publishPersisted(campaignId, "campaign_updated", { settings: scrubStorySettings(settings) });
  return Response.json({ settings: maskStorySettings(settings) });
}
