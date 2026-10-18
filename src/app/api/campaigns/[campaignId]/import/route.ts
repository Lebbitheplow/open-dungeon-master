import { z } from "zod";
import { isErrorResponse, requireMember, steersStory } from "@/lib/campaign-api";
import { getImportSourceForUser } from "@/lib/db/import-sources";
import { planContentImport, runContentImport } from "@/lib/db/content-import";
import { IMPORT_KINDS } from "@/lib/workshop/import";
import { publishEphemeral } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bringing prep into a table (docs/workshop-plan.md phase 3).
//
// The source is a workshop or another campaign; both are campaigns rows, so
// both are the same copy. Who may copy out of which is decided once in
// src/lib/db/import-sources.ts.
//
// GET plans without writing, so the picker can show counts and warnings
// before anything is copied. POST does the same planning again server-side
// and then executes it, because a plan the client hands back is a plan a
// client could have edited.
//
// Prep keeps arriving after session one: the lobby offers this, and so does
// the table's Setup tab once play has begun. An ended campaign takes nothing
// more, the same line the campaign route draws for its details.

const importSchema = z.object({
  sourceId: z.string().trim().min(1).max(80),
  select: z.array(z.enum(IMPORT_KINDS)).min(1),
  houseRules: z.enum(["replace", "append"]).default("replace"),
  // What an earlier import from the same source already brought: kept as
  // the campaign has it, or copied again under a number.
  again: z.enum(["skip", "copy"]).default("skip"),
  // A board meeting an arc the table is playing: leave the arc alone, or
  // add the board's beats as its next act (#157).
  arc: z.enum(["leave", "append"]).default("leave"),
  // Kinds WorldForge needs that the DM chose to leave behind (audit finding
  // WF-07): without them a ticked WorldForge brings its people, places,
  // factions and lore with it.
  exclude: z.array(z.enum(IMPORT_KINDS)).max(IMPORT_KINDS.length).default([]),
});

const previewSchema = importSchema.partial({ select: true, houseRules: true, again: true, arc: true, exclude: true });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const url = new URL(request.url);
  const parsed = previewSchema.safeParse({
    sourceId: url.searchParams.get("sourceId") ?? "",
    select: url.searchParams.getAll("select"),
    again: url.searchParams.get("again") ?? undefined,
    arc: url.searchParams.get("arc") ?? undefined,
    exclude: url.searchParams.getAll("exclude"),
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid preview." }, { status: 400 });
  }
  // The source has to be one this caller may copy out of. Membership in the
  // target is checked above; these are two separate permissions and both are
  // required.
  const source = getImportSourceForUser(parsed.data.sourceId, context.user.id);
  if (!source || source.id === campaignId) {
    return Response.json({ error: "Source not found." }, { status: 404 });
  }
  const selection = parsed.data.select?.length ? parsed.data.select : IMPORT_KINDS;
  return Response.json({
    plan: planContentImport(source.id, campaignId, selection, {
      again: parsed.data.again,
      arcMode: parsed.data.arc,
      exclude: parsed.data.exclude,
    }),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  // Furnishing a table with lore, places and prepared fights is a story
  // decision, so it follows story authority: the party lead in an AI-run
  // campaign, the DM once a person runs it.
  if (!steersStory(context)) {
    return Response.json(
      { error: "Only the person steering the story can import prep." },
      { status: 403 },
    );
  }
  if (context.campaign.status === "ended") {
    return Response.json({ error: "The campaign has ended." }, { status: 400 });
  }
  const parsed = importSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid import." }, { status: 400 });
  }
  const source = getImportSourceForUser(parsed.data.sourceId, context.user.id);
  if (!source || source.id === campaignId) {
    return Response.json({ error: "Source not found." }, { status: 404 });
  }

  const result = runContentImport({
    sourceId: source.id,
    campaignId,
    selection: parsed.data.select,
    houseRulesMode: parsed.data.houseRules,
    again: parsed.data.again,
    arcMode: parsed.data.arc,
    exclude: parsed.data.exclude,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  // An import touches a dozen tables at once (lore, places, quests, the arc,
  // house rules), which no one incremental event expresses. At a table in
  // play every open seat reloads its snapshot instead, so what was brought in
  // shows without a refresh. Contentless: each seat reads back only what it
  // may.
  publishEphemeral(campaignId, "prep_imported", {});
  return Response.json({
    plan: result.plan,
    copied: result.copied,
    kept: result.kept,
    unbound: result.unbound,
    beatsAdded: result.beatsAdded,
    // What the picker reports after an import: a reimport's kept edits,
    // monsters nothing here answers to, and the hand-built monsters brought
    // into this table's bestiary. These were computed and then dropped here.
    ...(result.worldConflicts?.length ? { worldConflicts: result.worldConflicts } : {}),
    ...(result.unresolved?.length ? { unresolved: result.unresolved } : {}),
    ...(result.monstersBrought?.length ? { monstersBrought: result.monstersBrought } : {}),
    ...(result.monstersReused?.length ? { monstersReused: result.monstersReused } : {}),
    ...(result.itemsBrought?.length ? { itemsBrought: result.itemsBrought } : {}),
    ...(result.itemsReused?.length ? { itemsReused: result.itemsReused } : {}),
  });
}
