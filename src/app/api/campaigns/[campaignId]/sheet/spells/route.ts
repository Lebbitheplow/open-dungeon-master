import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { spellClassFor } from "@/lib/classes";
import { searchSpells, spellNameMatches } from "@/lib/content";
import { allocateSeq } from "@/lib/db/campaigns";
import { getSheetForUser, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { publishPersisted } from "@/lib/events";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import { checklistClassSpell } from "@/lib/srd/spell-lists";
import {
  casterViewsOf,
  changePreparation,
  maxSpellLevelOf,
  withCasterViews,
} from "@/lib/srd/spell-prep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Player self-service over what their caster has prepared, on 5e timing
// (src/lib/srd/spell-prep.ts): unpreparing takes effect at once, a newly
// prepared spell waits for the next long rest. Known casters and cantrips
// are refused; their lists change on a level-up. Audited like /sheet/usage
// so the party lead can undo it.
const spellsSchema = z.object({
  action: z.enum(["prepare", "unprepare", "cancel"]),
  spell: z.string().trim().min(1).max(80),
  // Which caster class, on a multiclass sheet. Defaults to the first one
  // that prepares spells.
  classId: z.string().trim().max(60).optional(),
});

// Always answers in JSON, so the sheet can say what went wrong instead of a
// bare "could not".
export async function POST(
  request: Request,
  context: { params: Promise<{ campaignId: string }> },
) {
  try {
    return await changeSpell(request, context);
  } catch (error) {
    console.error("[sheet/spells]", error);
    return Response.json(
      { error: `The server failed to change that spell: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 },
    );
  }
}

async function changeSpell(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const sheet = getSheetForUser(campaignId, context.user.id);
  if (!sheet) {
    return Response.json({ error: "You have no character in this campaign." }, { status: 404 });
  }
  if (!sheet.spellcasting) {
    return Response.json({ error: `${sheet.name} does not cast spells.` }, { status: 403 });
  }
  const parsed = spellsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid spell change." },
      { status: 400 },
    );
  }
  const { action, classId } = parsed.data;

  const views = casterViewsOf(sheet);
  const view = classId
    ? views.find((entry) => entry.classId.toLowerCase() === classId.toLowerCase())
    : (views.find((entry) => entry.style !== "known") ?? views[0]);
  if (!view) {
    return Response.json({ error: `${sheet.name} has no such caster class.` }, { status: 400 });
  }

  // The content pack is the class list: the spell must be on it at a level
  // this class can cast, and the sheet stores its canonical name.
  let spell = parsed.data.spell;
  let inClassList = false;
  if (action === "prepare" && view.style === "prepared") {
    const found = searchSpells({
      q: spell,
      userId: context.user.id,
      classSlug: spellClassFor(view.classId),
      level: maxSpellLevelOf(view),
      limit: 20,
    }).find((entry) => entry.level > 0 && spellNameMatches(entry, spell));
    const canonical =
      found?.name ??
      checklistClassSpell(spell, spellClassFor(view.classId), maxSpellLevelOf(view));
    if (canonical) {
      spell = canonical;
      inClassList = true;
    }
  }

  const result = changePreparation(view, action, spell, {
    abilities: sheet.abilities,
    inClassList,
  });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  const patch: FullPatchSheetInput = {
    spellcasting: withCasterViews(
      sheet.spellcasting,
      views.map((entry) => (entry === view ? result.view : entry)),
    ),
  };
  const updated = patchSheet(sheet.id, patch);
  if (!updated) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  const entry = insertSheetAudit({
    campaignId,
    characterId: sheet.id,
    turnId: null,
    actor: "player",
    kind: "player_adjust",
    delta: { spells: { action, spell } },
    reason: `${result.note} (${context.user.username})`,
    seq: allocateSeq(campaignId),
    before: sheet,
    patch: patch as Record<string, unknown>,
  });
  publishPersisted(campaignId, "sheet_audit", { entry, characterName: sheet.name });
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  return Response.json({ sheet: updated, note: result.note });
}
