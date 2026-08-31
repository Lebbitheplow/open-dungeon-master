import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { getEntryDetail, searchMonsters } from "@/lib/content";
import { parseMonster } from "@/lib/bestiary/statblock";
import {
  checkMonsterDraft,
  draftFromCr,
  draftFromStats,
  MONSTER_NAME_MAX,
} from "@/lib/bestiary/monster-draft";
import {
  createHomebrewMonster,
  listHomebrewMonsters,
} from "@/lib/bestiary/homebrew-monsters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The bestiary forge. GET lists the monsters this DM has built and searches
// the content pack for something to start from; POST adds one.
//
// A monster is owned by the USER, not by this campaign
// (src/lib/bestiary/homebrew-monsters.ts), so the campaign id in the path is
// the DM check and nothing else: it decides whether you may use this tool,
// not which monsters you see.

const searchSchema = z.object({
  q: z.string().trim().max(80).optional(),
  maxCr: z.coerce.number().min(0).max(30).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const url = new URL(request.url);
  const parsed = searchSchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    maxCr: url.searchParams.get("maxCr") ?? undefined,
  });
  const query = parsed.success ? parsed.data : {};

  // The search runs only when asked for. A DM opening the panel wants their
  // own monsters, not 3,207 rows of Open5e.
  const found = query.q
    ? searchMonsters({ q: query.q, limit: 25, maxCr: query.maxCr }).map((entry) => ({
        slug: entry.slug,
        name: entry.name,
        source: entry.source,
        cr: typeof entry.data.cr === "number" ? entry.data.cr : 0,
      }))
    : [];

  return Response.json({
    monsters: listHomebrewMonsters(context.user.id),
    found,
  });
}

// The three ways a monster starts: at a challenge rating, from something in
// the content pack, or from a full block a DM already has on screen.
const bodySchema = z.union([
  z.object({
    from: z.literal("cr"),
    name: z.string().trim().min(1).max(MONSTER_NAME_MAX),
    cr: z.number().min(0).max(30),
  }),
  z.object({
    from: z.literal("monster"),
    name: z.string().trim().min(1).max(MONSTER_NAME_MAX).optional(),
    slug: z.string().trim().min(1).max(120),
  }),
  z.object({
    from: z.literal("draft"),
    draft: z.unknown(),
    desc: z.string().trim().max(8_000).default(""),
  }),
]);

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
    return Response.json({ error: "That is not a monster this can start from." }, { status: 400 });
  }
  const body = parsed.data;

  if (body.from === "cr") {
    return Response.json(
      { monster: createHomebrewMonster(context.user.id, draftFromCr(body.name, body.cr), "") },
      { status: 201 },
    );
  }

  if (body.from === "monster") {
    // Only the content pack, deliberately. getEntryDetail refuses a
    // "homebrew:" slug outright (src/lib/content/index.ts), which is the
    // behaviour wanted here: this path exists to get an owlbear onto the
    // screen, and copying one of the DM's own monsters is a different button.
    const entry = getEntryDetail("monsters", body.slug);
    if (!entry) {
      return Response.json(
        { error: "That monster is not in the content pack." },
        { status: 404 },
      );
    }
    const cr = typeof entry.data.cr === "number" ? entry.data.cr : 0;
    const draft = draftFromStats(body.name ?? entry.name, parseMonster(entry.data, cr));
    return Response.json(
      { monster: createHomebrewMonster(context.user.id, draft, "") },
      { status: 201 },
    );
  }

  const checked = checkMonsterDraft(body.draft);
  if ("error" in checked) {
    return Response.json({ error: checked.error }, { status: 400 });
  }
  return Response.json(
    { monster: createHomebrewMonster(context.user.id, checked.draft, body.desc) },
    { status: 201 },
  );
}
