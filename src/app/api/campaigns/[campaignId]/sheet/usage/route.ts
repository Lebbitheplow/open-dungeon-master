import { z } from "zod";
import { capsFor, isErrorResponse, isLead, requireMember } from "@/lib/campaign-api";
import { allocateSeq } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById, getSheetForUser, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import type { FullPatchSheetInput } from "@/lib/schemas/sheet";
import { publishPersisted } from "@/lib/events";
import { spendAction } from "@/lib/dm/action-budget";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { canAct } from "@/lib/dm/can-act";
import { attunementRefusal, gearChanges, usageLowers, usageSpendsHitDice } from "@/lib/dm/usage-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The counters on a character sheet: spell slot used counts, hit dice spent,
// class resource pools, and which gear is worn or attuned. The 5e gating
// falls out of the sheet data itself: only counters the sheet actually has
// can be adjusted (non-casters have no slots, classes without pools have no
// resources), only items they carry can be equipped, and max values never
// change here. Every write carries an audit pre-image so it can be undone.
//
// Who may do what (src/lib/dm/usage-rules.ts):
//   A player SPENDS on their own sheet: a used count may go up, never down.
//   Uses come back at rests, which the engine runs.
//   The DM (human or assistant) and the party lead CORRECT: they may lower a
//   used count, in or out of a fight, on their own sheet or on the one named
//   by `characterId`.
const usageSchema = z
  .object({
    // Whose sheet, for a correction by the DM or the lead. Anyone else is
    // answered on their own sheet whatever they name.
    characterId: z.string().max(80).optional(),
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

const refuse = (error: string, status = 409) => Response.json({ error }, { status });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));
  // The DM seats hold no character of their own, so the sheet has to be
  // found before the body is judged: a correction names it.
  const corrects = capsFor(context).role === "dm" || isLead(context);
  const named =
    corrects && raw && typeof raw === "object" && typeof raw.characterId === "string"
      ? getSheetById(raw.characterId)
      : null;
  if (named && named.campaignId !== campaignId) {
    return Response.json({ error: "Character not found." }, { status: 404 });
  }
  const sheet = named ?? getSheetForUser(campaignId, context.user.id);
  if (!sheet) {
    return Response.json({ error: "You have no character in this campaign." }, { status: 404 });
  }

  const parsed = usageSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid adjustment." },
      { status: 400 },
    );
  }

  const encounter = getActiveEncounter(campaignId);
  const lead = "Ask the DM or the party lead if the count needs correcting.";

  if (!corrects) {
    if (sheet.deathSaves?.dead) {
      return refuse(`${sheet.name} is dead and spends nothing. ${lead}`);
    }
    if (usageLowers(sheet, parsed.data)) {
      return refuse(
        `Spell slots, hit dice and class features come back at rests, so a player can only mark them spent. ${lead}`,
      );
    }
    // SRD 5.1: hit dice are spent at the end of a short rest, and the rest
    // is the engine's (take_rest with a short rest rolls them and heals).
    // A counter a player could tick outside one is a die spent for nothing,
    // or a rest that never happened.
    if (usageSpendsHitDice(sheet, parsed.data)) {
      return refuse(
        `Hit dice are spent at the end of a short rest, which the DM runs; ask the DM for a short rest and ${sheet.name} spends them there.`,
      );
    }
  }

  // Gear has its own clock, and it binds whoever is asking: putting armor
  // on is not a correction. A wrong flag is fixed through the lead's sheet
  // edit or the DM's update_sheet.
  const changes = parsed.data.gear
    ? gearChanges(sheet, parsed.data.gear)
    : { armor: [], shields: [], attunement: [] };
  if (parsed.data.gear) {
    if (Object.keys(parsed.data.gear).some((name) => !sheet.equipment.some((item) => item.name === name))) {
      return Response.json(
        { error: `${sheet.name} does not carry one of those items.` },
        { status: 400 },
      );
    }
    if (sheet.deathSaves?.dead && (changes.armor.length || changes.shields.length || changes.attunement.length)) {
      return refuse(`${sheet.name} is dead and cannot change what they wear or are attuned to.`);
    }
    const attuneProblem = attunementRefusal(sheet, parsed.data.gear);
    if (attuneProblem) {
      return refuse(attuneProblem);
    }
  }
  let shieldBudget: ReturnType<typeof spendAction> | null = null;
  if (encounter && parsed.data.gear) {
    if (changes.armor.length) {
      return refuse(
        `Armor takes minutes to put on or take off, so ${changes.armor[0]} cannot change during a fight. A shield takes one action, and weapons are free.`,
      );
    }
    if (changes.attunement.length) {
      return refuse(
        `Attuning to an item, or ending it, takes a short rest, so ${changes.attunement[0]} cannot change during a fight.`,
      );
    }
    if (changes.shields.length) {
      const able = canAct({ sheet, encounter, kind: "action" });
      if (!able.ok) {
        return refuse(able.error);
      }
      const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet));
      if (!budget) {
        return refuse(
          `Putting on or taking off a shield takes an action, so ${sheet.name} can do it on their own turn.`,
        );
      }
      shieldBudget = spendAction(budget, "action", "Handling a shield", sheet.name);
      if (!shieldBudget.ok) {
        return refuse(shieldBudget.error);
      }
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
      // An attuned item works only while worn, so attuning on a sheet that
      // says what it wears puts the item on.
      const wornByAttuning = explicit && entry?.attuned === true && entry.equipped === undefined;
      const equipped = wornByAttuning
        ? true
        : entry?.equipped ?? item.equipped ?? (explicit ? false : undefined);
      const attuned = entry?.attuned ?? item.attuned;
      return {
        ...item,
        ...(equipped === undefined ? {} : { equipped }),
        ...(attuned === undefined ? {} : { attuned }),
      };
    });
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
  // Charged only once the write is in, so a refusal never costs the action.
  if (encounter && shieldBudget?.ok) {
    storeBudget(encounter, shieldBudget.budget);
  }

  const own = sheet.userId === context.user.id;
  const entry = insertSheetAudit({
    campaignId,
    characterId: sheet.id,
    turnId: null,
    actor: own ? "player" : "lead",
    kind: own ? "player_adjust" : "lead_edit",
    delta: patch as Record<string, unknown>,
    reason: `${own ? "Adjusted" : "Corrected"} by ${context.user.username}`,
    seq: allocateSeq(campaignId),
    before: sheet,
    patch: patch as Record<string, unknown>,
  });
  publishPersisted(campaignId, "sheet_audit", { entry, characterName: sheet.name });
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });

  return Response.json({ sheet: updated });
}
