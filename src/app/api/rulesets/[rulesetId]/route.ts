import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { getCampaignForUser } from "@/lib/db/campaigns";
import { getHouseRulesText } from "@/lib/db/rules";
import {
  applyRulesetToCampaign,
  deleteRuleset,
  getRulesetForUser,
  updateRuleset,
} from "@/lib/db/rulesets";
import { patchRulesetSchema } from "@/lib/schemas/ruleset";
import { rulesetChanges } from "@/lib/rulesets/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One ruleset: read it, edit it, delete it, or apply it to a table.
//
// POST is the apply. It answers with the changes it made rather than a bare
// ok, so the caller can show the DM what just happened to their table; the
// same list is available before the fact through `?preview=<campaignId>` on
// the GET, which is what the import preview uses.

const applySchema = z.object({
  campaignId: z.string().trim().min(1).max(80),
  houseRules: z.enum(["replace", "append"]).default("replace"),
});

async function resolve(rulesetId: string) {
  const user = await currentUser();
  if (!user) {
    return { error: unauthorized() };
  }
  const ruleset = getRulesetForUser(user.id, rulesetId);
  if (!ruleset) {
    return { error: Response.json({ error: "Ruleset not found." }, { status: 404 }) };
  }
  return { user, ruleset };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ rulesetId: string }> },
) {
  const { rulesetId } = await params;
  const resolved = await resolve(rulesetId);
  if (resolved.error) {
    return resolved.error;
  }
  const { ruleset, user } = resolved;

  const previewFor = new URL(request.url).searchParams.get("preview");
  if (previewFor) {
    const campaign = getCampaignForUser(previewFor, user.id);
    if (!campaign) {
      return Response.json({ error: "Campaign not found." }, { status: 404 });
    }
    return Response.json({
      ruleset,
      changes: rulesetChanges(ruleset, {
        variantRules: campaign.gameSettings.variantRules,
        houseRulesText: getHouseRulesText(campaign.id),
      }),
    });
  }
  return Response.json({ ruleset });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ rulesetId: string }> },
) {
  const { rulesetId } = await params;
  const resolved = await resolve(rulesetId);
  if (resolved.error) {
    return resolved.error;
  }
  const parsed = patchRulesetSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid change." }, { status: 400 });
  }
  const ruleset = updateRuleset(resolved.user.id, rulesetId, parsed.data);
  return Response.json({ ruleset });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ rulesetId: string }> },
) {
  const { rulesetId } = await params;
  const resolved = await resolve(rulesetId);
  if (resolved.error) {
    return resolved.error;
  }
  const parsed = applySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid apply." }, { status: 400 });
  }
  const { ruleset, user } = resolved;
  const campaign = getCampaignForUser(parsed.data.campaignId, user.id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found." }, { status: 404 });
  }
  // The rules are the table's, so changing them is the same authority that
  // edits the campaign's settings: the party lead, or the DM in a human-run
  // game (which is every workshop).
  const caps = campaign.dmUserId ? campaign.dmUserId === user.id : campaign.leadUserId === user.id;
  if (!caps) {
    return Response.json({ error: "Only the person running the table can do that." }, { status: 403 });
  }

  const changes = rulesetChanges(ruleset, {
    variantRules: campaign.gameSettings.variantRules,
    houseRulesText: getHouseRulesText(campaign.id),
  });
  applyRulesetToCampaign(ruleset, campaign.id, parsed.data.houseRules);
  return Response.json({ ok: true, changes });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ rulesetId: string }> },
) {
  const { rulesetId } = await params;
  const resolved = await resolve(rulesetId);
  if (resolved.error) {
    return resolved.error;
  }
  deleteRuleset(resolved.user.id, rulesetId);
  return Response.json({ ok: true });
}
