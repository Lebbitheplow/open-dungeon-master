import { isErrorResponse, requireWorkshop, type WorkshopContext } from "@/lib/workshop-api";
import { exportWorkshopBundle } from "@/lib/db/workshop-bundle";
import { getPackDraft, savePackDraft } from "@/lib/db/world-pack-drafts";
import { mergePulled, type PulledFlavour } from "@/lib/worlds/draft";
import { compileToPack, notInDraft, type CompiledPack, type SettingLists } from "@/lib/workshop/to-pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/workshops/[workshopId]/plugin/pull
//
// "Pull from this workshop": the setting half of a pack, read out of the
// workshop's own factions, lore, places, hook cards and cast, and added to
// the draft. It goes through the same bundle export and compile the Share
// tool uses (src/lib/workshop/to-pack.ts), so what a pack can take from a
// workshop is decided in exactly one place. The manifest the export wants is
// filled from the draft where it can be and with placeholders where it
// cannot, because this call only reads the compile's tables and never keeps
// the manifest.
//
//   GET   what a pull would bring (`pulled`, the setting lists) and what the
//         pack leaves out of this workshop (`omissions`), without changing
//         the draft: the Publish tab's list before anything is published.
//   POST  the pull itself, answering the saved draft, how many entries it
//         added and the same list, measured against the draft it saved.

type Compiled = { stored: ReturnType<typeof getPackDraft>; compiled: CompiledPack } | Response;

function compile(workshopId: string, context: WorkshopContext): Compiled {
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
  return { stored, compiled: compileToPack(exported.bundle) };
}

// The compile's lists against a draft: the omissions, with what the draft
// does not hold first.
function report(compiled: CompiledPack, draft: SettingLists) {
  const pulled = compiled.draft as unknown as SettingLists;
  const missing = notInDraft(pulled, draft);
  return {
    pulled: { factions: pulled.factions, locations: pulled.locations, hooks: pulled.hooks, glossary: pulled.glossary },
    omissions: [...(missing ? [missing] : []), ...compiled.omissions],
    warnings: compiled.warnings,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ workshopId: string }> }) {
  const { workshopId } = await params;
  const context = await requireWorkshop(workshopId);
  if (isErrorResponse(context)) {
    return context;
  }
  const outcome = compile(workshopId, context);
  if (outcome instanceof Response) {
    return outcome;
  }
  return Response.json(report(outcome.compiled, outcome.stored.draft));
}

export async function POST(_request: Request, { params }: { params: Promise<{ workshopId: string }> }) {
  const { workshopId } = await params;
  const context = await requireWorkshop(workshopId);
  if (isErrorResponse(context)) {
    return context;
  }
  const outcome = compile(workshopId, context);
  if (outcome instanceof Response) {
    return outcome;
  }
  const merged = mergePulled(outcome.stored.draft, outcome.compiled.draft as PulledFlavour);
  const saved = savePackDraft(workshopId, merged.draft);
  return Response.json({
    ...saved,
    added: merged.added,
    ...report(outcome.compiled, saved.draft),
  });
}
