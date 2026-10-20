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
import { recordManualTicks } from "@/lib/dm/manual-ticks";
import { attunementRefusal, gearChanges, gearPatch, usageLowers, usageSpendsHitDice } from "@/lib/dm/usage-rules";
import { acBreakdownFor } from "@/lib/srd";
import { armorChangeMinutes } from "@/lib/dm/don-doff";
import { gearKindOf, handsFor, handsFullError, handsFullFor, spendInteraction } from "@/lib/dm/gear-hands";
import { dualWields } from "@/lib/dm/attack-rules";
import { hasFastHands } from "@/lib/dm/bonus-routes";
import { advanceClock } from "@/lib/db/clock";

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
    // Players may name any sheet they own; DM/lead corrections may name any sheet.
    characterId: z.string().max(80).optional(),
    slots: z
      .record(z.string().regex(/^[1-9]$/), z.number().int().min(0).max(10))
      .optional(),
    hitDiceSpent: z.number().int().min(0).max(20).optional(),
    // Pact Magic slots used (a warlock's own pool, back on a short rest).
    pactUsed: z.number().int().min(0).max(10).optional(),
    resources: z.record(z.string().max(40), z.number().int().min(0).max(200)).optional(),
    // Worn/attuned state keyed by the exact item name on their sheet.
    // Equipping armor moves their derived AC (src/lib/srd/armor.ts).
    gear: z
      .record(
        z.string().max(80),
        // layered: worn beside another of its kind, the DM's exception to
        // the one-per-place rule (src/lib/srd/wear-slots.ts); the DM and
        // the party lead only.
        z.object({ equipped: z.boolean().optional(), attuned: z.boolean().optional(), layered: z.boolean().optional() }),
      )
      .optional(),
  })
  .refine(
    (value) =>
      value.slots !== undefined ||
      value.pactUsed !== undefined ||
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
    raw && typeof raw === "object" && typeof raw.characterId === "string"
      ? getSheetById(raw.characterId)
      : null;
  if (raw?.characterId && (!named || named.campaignId !== campaignId || (!corrects && (named.userId !== context.user.id || named.isCompanion)))) {
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
    const pact = sheet.spellcasting?.pact;
    if (usageLowers(sheet, parsed.data) || (pact && (parsed.data.pactUsed ?? pact.used) < pact.used)) {
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
    : { armor: [], shields: [], attunement: [], held: [] };
  let wornEquipment: FullPatchSheetInput["equipment"] | null = null;
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
    // Equipping is opt-in per sheet; what a never-touched sheet wore stays
    // on when it first says, and a second cloak, pair of boots or helmet is
    // refused with the rows to take off (src/lib/dm/usage-rules.ts).
    const armor = acBreakdownFor(sheet);
    const worn = gearPatch(sheet, parsed.data.gear, {
      corrects,
      armor: { armorName: armor.armorName, shieldName: armor.shieldName },
    });
    if ("error" in worn) {
      return Response.json(
        { error: worn.error, ...("conflict" in worn ? { wearConflict: worn.conflict } : {}) },
        { status: worn.status },
      );
    }
    wornEquipment = worn.equipment;
  }
  let shieldBudget: ReturnType<typeof spendAction> | null = null;
  if (encounter && parsed.data.gear) {
    // Two hands: a weapon or a shield taken up needs one free, as the DM's
    // handle_item asks (src/lib/dm/gear-hands.ts).
    const after = wornEquipment ?? sheet.equipment;
    for (const [name, change] of Object.entries(parsed.data.gear)) {
      const row = after.find((item) => item.name === name);
      const kind = row ? gearKindOf(row) : null;
      if (!row || change?.equipped !== true || (kind !== "weapon" && kind !== "shield")) {
        continue;
      }
      const full = handsFullFor(after, row);
      if (full.length) {
        return refuse(handsFullError(sheet.name, name, full, kind === "shield" ? "strapped on" : "drawn"));
      }
    }
    if (changes.armor.length) {
      return refuse(
        `Armor takes minutes to put on or take off, so ${changes.armor[0]} cannot change during a fight. A shield takes one action, and a weapon the free object interaction.`,
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
    // A weapon drawn or stowed, a ring or a cloak put on: the turn's free
    // object interaction, a second the Use an Object action (issue #424).
    // Dual Wielder draws two one-handed weapons with the one.
    if (changes.held.length) {
      const able = canAct({ sheet, encounter, kind: "free" });
      if (!able.ok) {
        return refuse(able.error);
      }
      let budget = shieldBudget?.ok ? shieldBudget.budget : budgetFor(encounter, sheet.id, attacksAllowedFor(sheet));
      if (!budget) {
        return refuse(`Drawing, stowing or putting something on happens on ${sheet.name}'s own turn.`);
      }
      for (const name of changes.held) {
        const row = sheet.equipment.find((item) => item.name === name);
        if (!row) {
          continue;
        }
        const on = parsed.data.gear[name]?.equipped === true;
        const spent = spendInteraction(budget, {
          what: `${on ? "drawing" : "putting away"} ${name}`,
          who: sheet.name,
          oneHandedWeapon: gearKindOf(row) === "weapon" && handsFor(row) === 1,
          dualWielder: dualWields(sheet.feats, sheet.campaignId),
          fastHands: hasFastHands(sheet),
        });
        if (!spent.ok) {
          return refuse(spent.error);
        }
        budget = spent.budget;
      }
      shieldBudget = { ok: true, budget };
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
      // A slot marked spent by hand pays for the cast it was ticked for
      // (src/lib/dm/manual-ticks.ts).
      recordManualTicks(sheet.id, Number(level), slots[level].used - existing.used);
      changed = true;
    }
    if (changed) {
      patch.spellcasting = { ...sheet.spellcasting, slots };
    }
  }

  // The pact pool is its own counter beside the shared slots.
  if (parsed.data.pactUsed !== undefined && sheet.spellcasting?.pact) {
    const pact = sheet.spellcasting.pact;
    const casting = patch.spellcasting ?? sheet.spellcasting;
    patch.spellcasting = { ...casting, pact: { ...pact, used: clampUsed(parsed.data.pactUsed, pact.max) } };
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

  if (wornEquipment) {
    patch.equipment = wornEquipment;
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
  // Out of a fight armor takes minutes to put on or take off, and ending an
  // attunement a short rest spent with the item; the clock moves by them
  // (SRD 5.1, Getting Into and Out of Armor; Attunement).
  const dressing = parsed.data.gear && !encounter ? armorChangeMinutes(sheet.equipment, parsed.data.gear) : null;
  if (dressing?.minutes) {
    advanceClock(campaignId, dressing.minutes, "minutes");
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

  return Response.json({ sheet: updated, ...(dressing?.minutes ? { timePassed: dressing.lines.join(" ") } : {}) });
}
