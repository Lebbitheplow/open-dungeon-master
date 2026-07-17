import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { getSheetForUser } from "@/lib/db/sheets";
import { insertRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression, type Advantage } from "@/lib/dice";
import { computeSheetDerived, findSkill } from "@/lib/srd";
import { publishPersisted } from "@/lib/events";
import { ABILITIES } from "@/lib/schemas/sheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Manual player rolls: a raw expression, or a named check/save resolved from
// the player's own sheet.
const rollRequestSchema = z.union([
  z.object({
    expression: z.string().trim().min(2).max(60),
  }),
  z.object({
    kind: z.enum(["skill_check", "saving_throw", "ability_check"]),
    skill: z.string().max(40).optional(),
    ability: z.enum(ABILITIES).optional(),
    advantage: z.enum(["none", "advantage", "disadvantage"]).default("none"),
  }),
]);

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

  const sheet = getSheetForUser(campaignId, context.user.id);
  const input = parsed.data;

  let expression: string;
  let kind: "skill_check" | "saving_throw" | "ability_check" | "custom" = "custom";
  let detail = "";
  let advantage: Advantage = "none";

  if ("expression" in input) {
    expression = input.expression;
  } else {
    if (!sheet) {
      return Response.json(
        { error: "Create a character before rolling checks." },
        { status: 400 },
      );
    }
    const derived = computeSheetDerived(sheet);
    kind = input.kind;
    advantage = input.advantage;

    if (input.kind === "skill_check") {
      const skill = input.skill ? findSkill(input.skill) : null;
      if (!skill) {
        return Response.json({ error: "Unknown skill." }, { status: 400 });
      }
      detail = skill.id;
      expression = d20Expression(derived.skills[skill.id] ?? 0, advantage);
    } else {
      const ability = input.ability;
      if (!ability) {
        return Response.json({ error: "Missing ability." }, { status: 400 });
      }
      detail = ability;
      const modifier =
        input.kind === "saving_throw" ? derived.saves[ability] : derived.abilityMods[ability];
      expression = d20Expression(modifier, advantage);
    }
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

  const roll = insertRoll({
    campaignId,
    characterId: sheet?.id ?? null,
    requestedBy: "player",
    kind,
    detail,
    advantage,
    result,
  });

  publishPersisted(campaignId, "roll_result", { roll });

  return Response.json({ roll }, { status: 201 });
}
