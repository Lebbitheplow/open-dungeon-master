import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { publicCampaign, type Campaign } from "@/lib/db/campaigns";
import { createWorkshop, listWorkshopsForUser } from "@/lib/db/workshops";
import { readImportSource } from "@/lib/db/content-import";
import { IMPORT_KINDS, type ImportKind } from "@/lib/workshop/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The workshop list and its create. Everything a workshop CONTAINS is served
// by the ordinary /api/campaigns/{id}/... routes, because a workshop is a
// campaigns row (docs/workshop-plan.md section 1). These two endpoints are
// only the row's own lifecycle.

const createWorkshopSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  targetParty: z
    .object({
      size: z.number().int().min(1).max(8),
      level: z.number().int().min(1).max(20),
    })
    .partial()
    .default({}),
});

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  // Each workshop carries how much of each kind it holds, so the list and
  // the import picker can both say "3 lore, 2 tables" without a second
  // round trip per workshop.
  return Response.json({
    workshops: listWorkshopsForUser(user.id).map((workshop) => {
      const source = readImportSource(workshop.id);
      const contents = Object.fromEntries(
        IMPORT_KINDS.map((kind) => [kind, source[kind].length]),
      ) as Record<ImportKind, number>;
      return { ...publicCampaign(workshop as Campaign), contents };
    }),
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }

  const parsed = createWorkshopSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid workshop." }, { status: 400 });
  }

  const workshop = createWorkshop(user.id, parsed.data);
  return Response.json({ workshop: publicCampaign(workshop) }, { status: 201 });
}
