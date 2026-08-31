import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { deleteCampaign, publicCampaign, type Campaign } from "@/lib/db/campaigns";
import {
  getWorkshopForUser,
  renameWorkshop,
  setWorkshopTargetParty,
} from "@/lib/db/workshops";
import { readImportSource } from "@/lib/db/content-import";
import { IMPORT_KINDS, type ImportKind } from "@/lib/workshop/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One workshop: read it, rename it, retarget the party it is built for, or
// throw it away. getWorkshopForUser checks membership, ownership and kind
// together, so a campaign id sent here is a 404 rather than a way to reach a
// playing table through a prep route.

const patchSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  targetParty: z
    .object({
      size: z.number().int().min(1).max(8),
      level: z.number().int().min(1).max(20),
    })
    .partial()
    .optional(),
});

async function resolve(workshopId: string) {
  const user = await currentUser();
  if (!user) {
    return { error: unauthorized() };
  }
  const workshop = getWorkshopForUser(workshopId, user.id);
  if (!workshop) {
    return { error: Response.json({ error: "Workshop not found." }, { status: 404 }) };
  }
  return { workshop };
}

// The same per-kind counts the list route serves, so WorkshopSummary's
// contents field is true from every route that hands one out.
function withContents(workshop: Campaign) {
  const source = readImportSource(workshop.id);
  const contents = Object.fromEntries(
    IMPORT_KINDS.map((kind) => [kind, source[kind].length]),
  ) as Record<ImportKind, number>;
  return { ...publicCampaign(workshop), contents };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  return Response.json({ workshop: withContents(resolved.workshop) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid change." }, { status: 400 });
  }
  const { workshop } = resolved;
  const { title, description, targetParty } = parsed.data;

  if (title !== undefined || description !== undefined) {
    renameWorkshop(
      workshop.id,
      title ?? workshop.title,
      description ?? workshop.description,
    );
  }
  if (targetParty) {
    setWorkshopTargetParty(workshop, targetParty);
  }

  const updated = getWorkshopForUser(workshop.id, workshop.ownerUserId);
  return Response.json({ workshop: updated ? withContents(updated) : null });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const resolved = await resolve(workshopId);
  if (resolved.error) {
    return resolved.error;
  }
  // Foreign keys cascade through every campaign-scoped table, which is the
  // same sweep a deleted campaign gets, and the reason a workshop needed no
  // teardown of its own.
  deleteCampaign(resolved.workshop.id);
  return Response.json({ ok: true });
}
