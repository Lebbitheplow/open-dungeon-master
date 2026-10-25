import { capsFor, isErrorResponse, requirePrepAuthority } from "@/lib/campaign-api";
import { getEncounterTemplate, setTemplateCued } from "@/lib/db/encounter-templates";
import { deployTemplate } from "@/lib/dm/encounter-templates";
import { readyTemplates } from "@/lib/dm/prepared-encounter-tool";
import { preparedFit } from "@/lib/dm/prepared-fit";
import { fightingParty } from "@/lib/dm/party-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deploy a prepared encounter: one action at the table for what the DM
// already decided at home. It runs through the adjudication façade, so this
// is the same fight a typed roster would have produced, refusals and all.
//
// At an AI-narrated table the party lead holds the prep (#154), but the
// storyteller runs the fights: a fight the lead started from the side would
// open on a board nobody narrates. So the lead's Deploy is a CUE: a flag on
// the fight that puts it first, marked, in the storyteller's game state
// until it runs it with run_prepared_encounter
// (src/lib/dm/prepared-encounter-tool.ts), same roster, same map, same plan.
// Not a lead direction: those are posted in the transcript, and the name of
// the fight waiting for the party is a spoiler. `{ cue: false }` takes the
// cue back.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; templateId: string }> },
) {
  const { campaignId, templateId } = await params;
  const context = await requirePrepAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const template = getEncounterTemplate(templateId);
  if (!template || template.campaignId !== campaignId) {
    return Response.json({ error: "No such prepared encounter." }, { status: 404 });
  }

  if (capsFor(context).role !== "dm") {
    const cue = (await request.json().catch(() => ({})))?.cue !== false;
    if (cue && !readyTemplates(campaignId).some((entry) => entry.id === template.id)) {
      return Response.json(
        { error: "That fight has nobody in it yet. Give it a roster before the storyteller can run it." },
        { status: 409 },
      );
    }
    // A fight the storyteller could not run for this party is not cued to
    // be refused every turn (src/lib/dm/prepared-fit.ts); one beyond the
    // party is cut down to fit when it runs, which its readout says. A table
    // with nobody rolled up yet has no party to judge it against.
    const fit = cue && fightingParty(context.campaign).length ? preparedFit(context.campaign, template.enemies) : null;
    if (fit?.kind === "held" || fit?.kind === "unknown") {
      return Response.json(
        {
          error:
            fit.kind === "held"
              ? "That fight is beyond the party as it stands, even cut down to its strongest creature. Change its roster, or cue it when they are stronger."
              : `Nothing in this world is called "${fit.monster}". Fix the roster before the storyteller can run it.`,
        },
        { status: 409 },
      );
    }
    setTemplateCued(template.id, cue);
    return Response.json({ ok: true, cued: cue });
  }

  const outcome = await deployTemplate(context.campaign, context.user.id, template);
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 409 });
  }
  return Response.json({ ok: true, result: outcome.result, mapError: outcome.mapError ?? null });
}
