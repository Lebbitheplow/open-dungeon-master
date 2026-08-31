import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { MAP_SIZE, MAP_THEMES } from "@/lib/battlemap/generate";
import { BACKDROP_LIMITS, isBackdropPath } from "@/lib/battlemap/backdrop";
import {
  applyStudioMap,
  closeScene,
  openScene,
  previewStudioMap,
  setStudioBackdrop,
  studioState,
} from "@/lib/dm/map-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The map studio. GET says what board is on the table; POST does one of four
// things to it, named by `do`. All of it is DM-only prep, so nothing here is
// an adjudication and nothing reaches the AI DM's tool list.

const settingsSchema = z.object({
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  width: z.number().int().min(MAP_SIZE.minWidth).max(MAP_SIZE.maxWidth).optional(),
  height: z.number().int().min(MAP_SIZE.minHeight).max(MAP_SIZE.maxHeight).optional(),
  theme: z.enum(MAP_THEMES as [string, ...string[]]).optional(),
  ambient: z.enum(["bright", "dim", "dark"]).optional(),
  hint: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(300).optional(),
});

const bodySchema = settingsSchema.extend({
  do: z.enum(["preview", "apply", "open-scene", "close-scene", "backdrop"]),
  // The picture under the grid. "" takes it away; anything else has to be a
  // file this app wrote through /api/upload, which is the one place that
  // turns uploaded bytes into a file on disk.
  backdropPath: z
    .string()
    .refine((value) => value === "" || isBackdropPath(value), "Not an uploaded file.")
    .optional(),
  backdropTransform: z
    .object({
      offsetX: z.number().min(-BACKDROP_LIMITS.maxOffset).max(BACKDROP_LIMITS.maxOffset),
      offsetY: z.number().min(-BACKDROP_LIMITS.maxOffset).max(BACKDROP_LIMITS.maxOffset),
      scale: z.number().min(BACKDROP_LIMITS.minScale).max(BACKDROP_LIMITS.maxScale),
      opacity: z.number().min(0).max(1),
    })
    .optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(studioState(context.campaign));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid map settings." }, { status: 400 });
  }
  const { do: action, backdropPath, backdropTransform, ...raw } = parsed.data;
  // zod has already narrowed these to the generator's own unions; the cast
  // is only because z.enum over a readonly array widens back to string.
  const settings = raw as Parameters<typeof previewStudioMap>[1] & { summary?: string };

  if (action === "preview") {
    // Writes nothing. This is the private part: the DM spins seeds until the
    // map looks right and the table sees none of it.
    const { seed, map } = previewStudioMap(context.campaign, settings);
    return Response.json({ seed, map });
  }
  if (action === "backdrop") {
    const outcome = setStudioBackdrop(
      context.campaign,
      backdropPath ?? "",
      backdropTransform ?? null,
    );
    return "error" in outcome
      ? Response.json({ error: outcome.error }, { status: 409 })
      : Response.json({ ok: true, ...studioState(context.campaign) });
  }
  if (action === "close-scene") {
    const outcome = closeScene(context.campaign);
    return "error" in outcome
      ? Response.json({ error: outcome.error }, { status: 409 })
      : Response.json({ ok: true, ...studioState(context.campaign) });
  }
  const outcome =
    action === "apply" ? applyStudioMap(context.campaign, settings) : openScene(context.campaign, settings);
  if ("error" in outcome) {
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  return Response.json({ ok: true, seed: outcome.seed, ...studioState(context.campaign) });
}
