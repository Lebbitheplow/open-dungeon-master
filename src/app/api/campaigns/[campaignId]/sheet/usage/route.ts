import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetForUser, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Player self-service over the "spent" side of their own counters: spell
// slot used counts, hit dice spent, class resource pools, and which gear
// they are wearing or attuned to. The 5e gating falls out of the sheet data
// itself: only counters the sheet actually has can be adjusted (non-casters
// have no slots, classes without pools have no resources), only items they
// carry can be equipped, and max values never change here. Every write
// carries an audit pre-image so the party lead can undo it.
const usageSchema = z
  .object({
    slots: z
      .record(z.string().regex(/^[1-9]$/), z.number().int().min(0).max(10))
      .optional(),
    hitDiceSpent: z.number().int().min(0).max(20).optional(),
    resources: z.record(z.string().max(40), z.number().int().min(0).max(200)).optional(),
    // Worn/attuned state keyed by the exact item name on their sheet.
    // Equipping armor moves their derived AC (src/lib/srd/armor.ts).
    gear: z
      .record(
        z.string().max(80),
        z.object({ equipped: z.boolean().optional(), attuned: z.boolean().optional() }),
      )
      .optional(),
  })
  .refine(
    (value) =>
      value.slots !== undefined ||
      value.hitDiceSpent !== undefined ||
      value.resources !== undefined ||
      value.gear !== undefined,
    { message: "Nothing to adjust." },
  );

const clampUsed = (value: number, max: number) => Math.max(0, Math.min(value, max));

export async function POST(
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

  const raw = await request.json().catch(() => ({}));
  const parsed = usageSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid adjustment." },
      { status: 400 },
    );
  }

  // 5e timing: spending is legitimate bookkeeping any time, but resources
  // only come back at rests, so mid-combat recovery is refused. The party
  // lead's Adjust dialog stays unrestricted for genuine corrections.
  if (getActiveEncounter(campaignId)) {
    const recovers =
      Object.entries(parsed.data.slots ?? {}).some(([level, used]) => {
        const existing = sheet.spellcasting?.slots[level];
        return existing !== undefined && used < existing.used;
      }) ||
      (parsed.data.hitDiceSpent !== undefined && parsed.data.hitDiceSpent < sheet.hitDice.spent) ||
      Object.entries(parsed.data.resources ?? {}).some(([id, used]) => {
        const existing = sheet.resources[id];
        return existing !== undefined && used < existing.used;
      });
    if (recovers) {
      return Response.json(
        {
          error:
            "Resources recover at rests, not mid-combat. Ask the party lead if this needs correcting.",
        },
        { status: 409 },
      );
    }
  }

  const patch: FullPatchSheetInput = {};

  if (parsed.data.slots) {
    if (!sheet.spellcasting) {
      return Response.json({ error: `${sheet.name} has no spell slots.` }, { status: 403 });
    }
    const slots = { ...sheet.spellcasting.slots };
    let changed = false;
    for (const [level, used] of Object.entries(parsed.data.slots)) {
      const existing = slots[level];
      if (!existing) {
        continue;
      }
      slots[level] = { max: existing.max, used: clampUsed(used, existing.max) };
      changed = true;
    }
    if (changed) {
      patch.spellcasting = { ...sheet.spellcasting, slots };
    }
  }

  if (parsed.data.hitDiceSpent !== undefined) {
    patch.hitDice = {
      ...sheet.hitDice,
      spent: clampUsed(parsed.data.hitDiceSpent, sheet.hitDice.total),
    };
  }

  if (parsed.data.resources) {
    const resources = { ...sheet.resources };
    let changed = false;
    for (const [id, used] of Object.entries(parsed.data.resources)) {
      const existing = resources[id];
      if (!existing) {
        continue;
      }
      resources[id] = { max: existing.max, used: clampUsed(used, existing.max) };
      changed = true;
    }
    if (changed) {
      patch.resources = resources;
    }
  }

  if (parsed.data.gear) {
    const gear = parsed.data.gear;
    // Equipping is opt-in per sheet: the first time anyone touches a toggle,
    // every other item is explicitly marked unworn so the AC engine stops
    // treating the whole pack as worn.
    const explicit = sheet.equipment.some((item) => item.equipped) ||
      Object.values(gear).some((entry) => entry.equipped);
    const equipment = sheet.equipment.map((item) => {
      const entry = gear[item.name];
      const equipped = entry?.equipped ?? item.equipped ?? (explicit ? false : undefined);
      const attuned = entry?.attuned ?? item.attuned;
      return {
        ...item,
        ...(equipped === undefined ? {} : { equipped }),
        ...(attuned === undefined ? {} : { attuned }),
      };
    });
    if (Object.keys(gear).some((name) => !sheet.equipment.some((item) => item.name === name))) {
      return Response.json(
        { error: `${sheet.name} does not carry one of those items.` },
        { status: 400 },
      );
    }
    patch.equipment = equipment;
  }

  if (!Object.keys(patch).length) {
    return Response.json(
      { error: "None of those counters exist on this character." },
      { status: 400 },
    );
  }

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
    delta: patch as Record<string, unknown>,
    reason: `Adjusted by ${context.user.username}`,
    seq: allocateSeq(campaignId),
    before: sheet,
    patch: patch as Record<string, unknown>,
  });
  publishPersisted(campaignId, "sheet_audit", { entry, characterName: sheet.name });
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });

  return Response.json({ sheet: updated });
}
