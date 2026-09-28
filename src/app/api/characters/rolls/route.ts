import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { getCampaignById, isCampaignMember } from "@/lib/db/campaigns";
import {
  openAbilityPool,
  openWealthRoll,
  rollAbilityPool,
  rollStartingWealth,
} from "@/lib/db/creation-rolls";
import { describeWealthDice, startingWealthDice } from "@/lib/srd/starting-wealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The dice a character is built with are thrown here, by the server, and
// kept (src/lib/db/creation-rolls.ts): the six ability totals of the 4d6
// method, and the starting wealth of a table that rolls it. The builder asks
// for a roll and shows what came back; a sheet that claims rolled scores or
// rolled coin is held to what is on record here when it is saved.

const rollSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("abilities") }),
  z.object({
    kind: z.literal("wealth"),
    campaignId: z.string().trim().min(1),
    classId: z.string().trim().min(1).max(60),
  }),
]);

// Whether this table rolls starting wealth for this player, or why not.
function wealthRefusal(userId: string, campaignId: string): Response | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign || !isCampaignMember(campaignId, userId)) {
    return Response.json({ error: "That campaign is not one of yours." }, { status: 404 });
  }
  if ((campaign.gameSettings.startingWealth ?? "equipment") !== "rolled") {
    return Response.json(
      {
        error:
          "This table starts characters with their class's equipment and their background's coin; starting wealth is not rolled here.",
      },
      { status: 409 },
    );
  }
  return null;
}

const wealthAnswer = (classId: string, roll: { faces: number[]; gold: number }) => ({
  classId,
  faces: roll.faces,
  gold: roll.gold,
  dice: describeWealthDice(startingWealthDice(classId)),
});

// The rolls still open for this player: what a builder opened again shows
// instead of asking for new dice.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const params = new URL(request.url).searchParams;
  const campaignId = (params.get("campaignId") ?? "").trim();
  const classId = (params.get("classId") ?? "").trim();
  let wealth = null;
  if (campaignId && classId && !wealthRefusal(user.id, campaignId)) {
    const open = openWealthRoll(user.id, campaignId, classId);
    wealth = open ? wealthAnswer(classId, open) : null;
  }
  return Response.json({ abilities: openAbilityPool(user.id), wealth });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const parsed = rollSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json(
      { error: "Say which dice to roll: the ability scores, or a class's starting wealth at a table." },
      { status: 400 },
    );
  }
  if (parsed.data.kind === "abilities") {
    // Six that add up to 70 or more stand: asking again answers with the
    // same six.
    return Response.json({ abilities: rollAbilityPool(user.id) });
  }
  const refused = wealthRefusal(user.id, parsed.data.campaignId);
  if (refused) {
    return refused;
  }
  // Rolled once for a class at a table: asking again answers with the same
  // coin.
  const roll = rollStartingWealth(user.id, parsed.data.campaignId, parsed.data.classId);
  return Response.json({ wealth: wealthAnswer(parsed.data.classId, roll) });
}
