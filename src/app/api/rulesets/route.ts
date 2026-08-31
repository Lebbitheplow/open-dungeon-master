import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { createRuleset, listRulesetsForUser, captureRulesetFromCampaign } from "@/lib/db/rulesets";
import { getCampaignForUser } from "@/lib/db/campaigns";
import { createRulesetSchema } from "@/lib/schemas/ruleset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The per-user ruleset library (docs/workshop-plan.md section 2).
//
// POST takes either a full ruleset or a `captureFrom` campaign id, because a
// DM more often arrives at their table's rules by tinkering at a table than
// by filling in a form.

const postSchema = z.union([
  createRulesetSchema,
  z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300).default(""),
    captureFrom: z.string().trim().min(1).max(80),
  }),
]);

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({ rulesets: listRulesetsForUser(user.id) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid ruleset." }, { status: 400 });
  }

  if ("captureFrom" in parsed.data) {
    // Membership is the gate: you may capture the rules of a table you sit
    // at, which includes a workshop you own.
    if (!getCampaignForUser(parsed.data.captureFrom, user.id)) {
      return Response.json({ error: "Campaign not found." }, { status: 404 });
    }
    const ruleset = captureRulesetFromCampaign(
      user.id,
      parsed.data.captureFrom,
      parsed.data.name,
      parsed.data.description,
    );
    return ruleset
      ? Response.json({ ruleset }, { status: 201 })
      : Response.json({ error: "Could not capture those rules." }, { status: 400 });
  }

  return Response.json({ ruleset: createRuleset(user.id, parsed.data) }, { status: 201 });
}
