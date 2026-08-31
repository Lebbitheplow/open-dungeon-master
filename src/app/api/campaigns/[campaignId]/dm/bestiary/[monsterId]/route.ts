import { z } from "zod";
import { isErrorResponse, requireDm } from "@/lib/campaign-api";
import { checkMonsterDraft } from "@/lib/bestiary/monster-draft";
import {
  deleteHomebrewMonster,
  getHomebrewMonster,
  updateHomebrewMonster,
} from "@/lib/bestiary/homebrew-monsters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One hand-built monster: read it, save it, throw it away.
//
// PATCH takes the WHOLE block, not a patch of it. A stat block is one thing
// a person is looking at, and half-saving it is how an armour class and a
// challenge rating end up describing different monsters.

const patchSchema = z.object({
  draft: z.unknown(),
  desc: z.string().trim().max(8_000).default(""),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; monsterId: string }> },
) {
  const { campaignId, monsterId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const monster = getHomebrewMonster(context.user.id, monsterId);
  return monster
    ? Response.json({ monster })
    : Response.json({ error: "No such monster." }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; monsterId: string }> },
) {
  const { campaignId, monsterId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That is not a stat block." }, { status: 400 });
  }
  const checked = checkMonsterDraft(parsed.data.draft);
  if ("error" in checked) {
    return Response.json({ error: checked.error }, { status: 400 });
  }
  const monster = updateHomebrewMonster(
    context.user.id,
    monsterId,
    checked.draft,
    parsed.data.desc,
  );
  return monster
    ? Response.json({ monster })
    : Response.json({ error: "No such monster." }, { status: 404 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; monsterId: string }> },
) {
  const { campaignId, monsterId } = await params;
  const context = await requireDm(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return deleteHomebrewMonster(context.user.id, monsterId)
    ? Response.json({ ok: true })
    : Response.json({ error: "No such monster." }, { status: 404 });
}
