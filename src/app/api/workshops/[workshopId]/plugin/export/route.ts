import { z } from "zod";
import { isErrorResponse, requireWorkshop } from "@/lib/workshop-api";
import { getPackDraft } from "@/lib/db/world-pack-drafts";
import { checkDraft } from "@/lib/worlds/draft-check";
import { exportDraft } from "@/lib/worlds/draft";
import { checkPackIntegrity } from "@/lib/worlds/draft-integrity";
import { installWorldPack } from "@/lib/worlds/install";
import { summarizePack } from "@/lib/worlds/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/workshops/[workshopId]/plugin/export
//
// The draft as a finished pack, or every reason it is not one yet. Three
// gates in order: the editor's own checks (./draft-check.ts), the schema
// (exportDraft), and the content pack (./draft-integrity.ts), so the file
// that comes back is one scripts/validate-world-packs.mjs would pass.
//
//   { }                 answer with the pack, for a download
//   { install: true }   also write it to this server's data/worlds
//
// Installing is the one admin-only branch, for the reason every world pack
// install is: it writes a file the whole server serves. The owner of a
// workshop who is not an admin still gets the file to hand to whoever is.
const bodySchema = z.object({ install: z.boolean().default(false) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const context = await requireWorkshop(workshopId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const install = parsed.success && parsed.data.install;
  if (install && !context.user.isAdmin) {
    return Response.json(
      { error: "Only an admin can install a world on this server. Download the file and hand it to one." },
      { status: 403 },
    );
  }

  const { draft } = getPackDraft(workshopId, context.workshop.gameSettings.genre);
  const check = checkDraft(draft);
  if (check.problems.length) {
    return Response.json({ error: "The pack is not finished.", problems: check.problems }, { status: 400 });
  }
  const outcome = exportDraft(draft);
  if ("error" in outcome) {
    return Response.json({ error: "The pack is not finished.", problems: [outcome.error] }, { status: 400 });
  }
  const integrity = checkPackIntegrity(outcome.pack);
  if (integrity.problems.length) {
    return Response.json({ error: "The pack names things the content pack does not have.", problems: integrity.problems }, { status: 400 });
  }

  // artKeys is the loader's word; the file a person downloads carries the
  // art itself and an empty artKeys, exactly as an installed manifest does.
  const pack = { ...outcome.pack, artKeys: [] };
  if (!install) {
    return Response.json({ pack, advice: check.advice, contentChecked: integrity.checked });
  }
  const result = await installWorldPack(pack);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({
    installed: summarizePack(result.pack, "installed"),
    replaced: result.replaced,
    advice: check.advice,
    contentChecked: integrity.checked,
  });
}
