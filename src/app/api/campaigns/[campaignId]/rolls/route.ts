import { z } from "zod";
import { capsFor, isErrorResponse, requireMember } from "@/lib/campaign-api";
import { listSheets } from "@/lib/db/sheets";
import { actingSheetFor } from "@/lib/character-seat";
import { insertRoll, listRollsVisibleTo } from "@/lib/db/rolls";
import { rollExpression, type Advantage } from "@/lib/dice";
import { trayExpressionProblem } from "@/lib/dice/tray-rules";
import { findSkill } from "@/lib/srd";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import { moteAfterRoll, moteOf, type HeldMote } from "@/lib/dm/authored-mote";
import { publishPersisted } from "@/lib/events";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { ABILITIES } from "@/lib/schemas/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual rolls: a raw expression, or a named check/save from the caller's
// own sheet, resolved the way the DM's request_roll resolves it. `secret`
// rolls behind the screen: a DM seat's secret roll is the DM's alone ("dm"),
// a player's is theirs and the DM's ("self"). `characterId` names which of
// the caller's characters rolls (the sheet on screen); unnamed, the dice
// belong to the one whose turn it is, else the selected one
// (src/lib/character-seat.ts).
const rollRequestSchema = z.union([
  z.object({
    expression: z.string().trim().min(2).max(60),
    secret: z.boolean().default(false),
    characterId: z.string().max(80).optional(),
  }),
  z.object({
    kind: z.enum(["skill_check", "saving_throw", "ability_check"]),
    skill: z.string().max(40).optional(),
    ability: z.enum(ABILITIES).optional(),
    advantage: z.enum(["none", "advantage", "disadvantage"]).default("none"),
    secret: z.boolean().default(false),
    characterId: z.string().max(80).optional(),
  }),
]);

// The roll log as this seat may read it. The shared event stream carries
// the redacted version of a blind or DM-only roll, so whoever is allowed the
// number re-fetches it here, the same ping-and-self-fetch the fogged battle
// map and the DM's enemy numbers already use.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const ownedCharacterIds = listSheets(campaignId)
    .filter((sheet) => sheet.userId === context.user.id)
    .map((sheet) => sheet.id);
  return Response.json({
    rolls: listRollsVisibleTo(campaignId, capsFor(context), ownedCharacterIds, 20),
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

  const raw = await request.json().catch(() => ({}));
  const parsed = rollRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid roll request." }, { status: 400 });
  }

  const input = parsed.data;
  const sheet = actingSheetFor(campaignId, context.user.id, input.characterId);
  if (input.characterId && !sheet) {
    return Response.json({ error: "That is not one of your characters." }, { status: 404 });
  }

  let expression: string;
  let kind: "skill_check" | "saving_throw" | "ability_check" | "custom" = "custom";
  let detail = "";
  let advantage: Advantage = "none";
  // What a named roll spends (a held Bardic Inspiration die, Guidance, a
  // Help), and a Creation bard's mote riding that die: settled once the dice
  // are down, as the DM's request settles them.
  let spent: string | undefined;
  let mote: HeldMote | null = null;

  if ("expression" in input) {
    // Loose dice are still dice: the log never holds a number a player wrote.
    // Nothing on the sheet rides them either: the tray throws what it was
    // asked to throw.
    const problem = trayExpressionProblem(input.expression);
    if (problem) {
      return Response.json({ error: problem }, { status: 400 });
    }
    expression = input.expression;
  } else {
    if (!sheet) {
      return Response.json(
        { error: "Create a character before rolling checks." },
        { status: 400 },
      );
    }
    if (input.kind === "skill_check" && !(input.skill && findSkill(input.skill))) {
      return Response.json({ error: "Unknown skill." }, { status: 400 });
    }
    if (input.kind !== "skill_check" && !input.ability) {
      return Response.json({ error: "Missing ability." }, { status: 400 });
    }
    // The dead roll nothing: not at the DM's word (src/lib/dm/invoke-roll.ts),
    // and not from their own sheet.
    if (sheet.deathSaves?.dead) {
      return Response.json({ error: `${sheet.name} is dead and makes no rolls.` }, { status: 409 });
    }
    // A check or a save is play, and it spends what rides it (a held
    // inspiration die, Guidance, a Help): it waits out a table break. Loose
    // dice from the tray are only dice, and go on.
    const paused = refuseDuringBreak(campaignId);
    if (paused) {
      return paused;
    }
    kind = input.kind;
    advantage = input.advantage;
    // The one resolution every check and save passes through, with the same
    // extras the DM's request_roll reads (src/lib/dm/invoke-roll.ts): the
    // sheet's modifiers and features, the conditions that shape the d20 or
    // decide the roll outright, exhaustion, Bless and Guidance, the lasting
    // effects on this kind of roll, an ally's aura on a save, and a held die
    // the roll spends. Building the number here from the sheet alone kept the
    // aura and lost the rest, so a +5 blessing counted when the DM asked for
    // the check and not when the player rolled it. The caller's advantage is
    // one source among the others, as the DM console's is.
    const args: RollArgs = {
      kind: input.kind,
      advantage: input.advantage,
      ...(input.kind === "skill_check" ? { skill: input.skill } : {}),
      ...(input.ability ? { ability: input.ability } : {}),
    };
    const resolved = resolveRollExpression(args, sheet, rollExtrasFor(context.campaign, sheet, input.kind));
    if ("error" in resolved) {
      return Response.json({ error: resolved.error }, { status: 400 });
    }
    if ("autoFail" in resolved) {
      // Nothing is left to the dice (a paralyzed character's Dexterity save),
      // so none are thrown and nothing is logged; the roller is told why.
      return Response.json(
        { error: `${sheet.name} automatically fails: ${resolved.notes.join("; ")}.`, autoFailed: true },
        { status: 409 },
      );
    }
    expression = resolved.expression;
    detail = resolved.detail;
    spent = resolved.spendInspiration;
    mote = moteOf(sheet, spent);
  }

  let result;
  try {
    result = rollExpression(expression);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Bad dice expression." },
      { status: 400 },
    );
  }

  // A held die rode this roll, so this roll spends it.
  if (sheet && spent) {
    spendRollCarriers(campaignId, sheet.id, spent);
  }

  const dmSeat = capsFor(context).adjudicates;
  const roll = insertRoll({
    campaignId,
    characterId: sheet?.id ?? null,
    requestedBy: dmSeat ? "dm" : "player",
    kind,
    detail,
    advantage,
    result,
    visibility: input.secret ? (dmSeat ? "dm" : "self") : "public",
  });

  publishPersisted(campaignId, "roll_result", { roll, source: "digital" });

  // A mote spent on a save leaves its temporary hit points (src/lib/dm/authored-mote.ts).
  if (sheet && mote) {
    moteAfterRoll(context.campaign, sheet, mote, kind, result);
  }

  return Response.json({ roll }, { status: 201 });
}
