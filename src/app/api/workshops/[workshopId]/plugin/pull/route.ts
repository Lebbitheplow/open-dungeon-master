import { isErrorResponse, requireWorkshop } from "@/lib/workshop-api";
import { exportWorkshopBundle } from "@/lib/db/workshop-bundle";
import { getPackDraft, savePackDraft } from "@/lib/db/world-pack-drafts";
import { mergePulled, type PulledFlavour } from "@/lib/worlds/draft";
import { compileToPack } from "@/lib/workshop/to-pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/workshops/[workshopId]/plugin/pull
//
// "Pull from this workshop": the setting half of a pack, read out of the
// workshop's own lore, places, hook cards and cast, and added to the draft.
// It goes through the same bundle export and compile the Share tool uses
// (src/lib/workshop/to-pack.ts), so what a pack can take from a workshop is
// decided in exactly one place. The manifest the export wants is filled from
// the draft where it can be and with placeholders where it cannot, because
// this call only reads the compile's tables and never keeps the manifest.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workshopId: string }> },
) {
  const { workshopId } = await params;
  const context = await requireWorkshop(workshopId);
  if (isErrorResponse(context)) {
    return context;
  }
  const stored = getPackDraft(workshopId, context.workshop.gameSettings.genre);
  const exported = exportWorkshopBundle(workshopId, {
    name: stored.draft.name.trim() || context.workshop.title,
    blurb: stored.draft.blurb.trim() || "Pulled into a world pack draft.",
    inspiredBy: stored.draft.inspiredBy.trim() || "This workshop.",
    rightsHolder: stored.draft.rightsHolder,
  });
  if ("error" in exported) {
    return Response.json({ error: exported.error }, { status: 400 });
  }
  const compiled = compileToPack(exported.bundle);
  const merged = mergePulled(stored.draft, compiled.draft as PulledFlavour);
  const saved = savePackDraft(workshopId, merged.draft);
  return Response.json({
    ...saved,
    added: merged.added,
    warnings: compiled.warnings,
    refusals: compiled.refusals.filter((refusal) => refusal.field !== "races, classes, backgrounds, spells, items, features"),
  });
}
