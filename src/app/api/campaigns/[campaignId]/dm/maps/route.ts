import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { MAP_SIZE, MAP_THEMES } from "@/lib/battlemap/generate";
import { UVTT_SIZE } from "@/lib/battlemap/uvtt";
import { isBackdropPath } from "@/lib/battlemap/backdrop";
import {
  BLANK_FILLS,
  captureBoardIntoLibrary,
  createLibraryMap,
  importUvttIntoLibrary,
  libraryState,
} from "@/lib/dm/map-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The map library. GET lists what this campaign has prepared; POST adds one,
// by rolling it, starting blank, saving what is on the table, or importing a
// Universal VTT export.
//
// DM-only prep, like the studio it sits beside: nothing here is an
// adjudication and none of it reaches the AI DM's tool list. In a workshop
// the DM seat is the only seat, which is what makes this the workshop's map
// builder rather than a second copy of one.

const createSchema = z.object({
  do: z.literal("create"),
  name: z.string().trim().min(1).max(80),
  width: z.number().int().min(MAP_SIZE.minWidth).max(MAP_SIZE.maxWidth).optional(),
  height: z.number().int().min(MAP_SIZE.minHeight).max(MAP_SIZE.maxHeight).optional(),
  theme: z.enum(MAP_THEMES as [string, ...string[]]).optional(),
  ambient: z.enum(["bright", "dim", "dark"]).optional(),
  hint: z.string().trim().max(200).optional(),
  seed: z.number().int().min(0).max(0xffffffff).optional(),
  blank: z.enum(BLANK_FILLS as unknown as [string, ...string[]]).optional(),
});

const captureSchema = z.object({
  do: z.literal("capture"),
  name: z.string().trim().min(1).max(80),
});

// The geometry only. The picture was uploaded first through /api/upload,
// which is this app's one image writer and the one place that decides what
// an image is, so this route never sees bytes and never writes a file.
const importSchema = z.object({
  do: z.literal("import-uvtt"),
  name: z.string().trim().min(1).max(80),
  backdropPath: z.string().refine(isBackdropPath, "Not an uploaded file.").optional(),
  file: z.object({
    resolution: z.object({
      map_origin: z.object({ x: z.number(), y: z.number() }).optional(),
      map_size: z.object({
        x: z.number().min(UVTT_SIZE.min).max(UVTT_SIZE.max),
        y: z.number().min(UVTT_SIZE.min).max(UVTT_SIZE.max),
      }),
      pixels_per_grid: z.number().optional(),
    }),
    // Bounded so a hand-built payload cannot ask the converter to walk a
    // million segments. A drawn dungeon is a few thousand at most.
    line_of_sight: z.array(z.array(z.object({ x: z.number(), y: z.number() }))).max(4000).optional(),
    objects_line_of_sight: z
      .array(z.array(z.object({ x: z.number(), y: z.number() })))
      .max(4000)
      .optional(),
    portals: z
      .array(z.object({ position: z.object({ x: z.number(), y: z.number() }).optional() }))
      .max(500)
      .optional(),
    lights: z
      .array(
        z.object({
          position: z.object({ x: z.number(), y: z.number() }).optional(),
          range: z.number().optional(),
        }),
      )
      .max(500)
      .optional(),
    environment: z.object({ baked_lighting: z.boolean().optional() }).optional(),
  }),
});

const bodySchema = z.discriminatedUnion("do", [createSchema, captureSchema, importSchema]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json(libraryState(context.campaign));
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
    return Response.json({ error: "Invalid map." }, { status: 400 });
  }
  const body = parsed.data;

  if (body.do === "capture") {
    const outcome = captureBoardIntoLibrary(context.campaign, body.name);
    return "error" in outcome
      ? Response.json({ error: outcome.error }, { status: 409 })
      : Response.json({ ok: true, map: outcome.map });
  }

  if (body.do === "import-uvtt") {
    const outcome = importUvttIntoLibrary(context.campaign, {
      name: body.name,
      file: body.file,
      backdropPath: body.backdropPath,
    });
    return "error" in outcome
      ? Response.json({ error: outcome.error }, { status: 422 })
      : Response.json({ ok: true, map: outcome.map, notes: outcome.notes ?? [] });
  }

  const outcome = createLibraryMap(context.campaign, {
    name: body.name,
    width: body.width,
    height: body.height,
    // zod has already narrowed these to the generator's own unions; the
    // casts are only because z.enum over a readonly array widens back to
    // string.
    theme: body.theme as Parameters<typeof createLibraryMap>[1]["theme"],
    ambient: body.ambient,
    hint: body.hint,
    seed: body.seed,
    blank: body.blank as Parameters<typeof createLibraryMap>[1]["blank"],
  });
  return "error" in outcome
    ? Response.json({ error: outcome.error }, { status: 400 })
    : Response.json({ ok: true, map: outcome.map });
}
