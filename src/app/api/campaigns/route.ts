import { z } from "zod";
import { campaignCreationRefusal, canCreateCampaigns } from "@/lib/shared-host";
import { currentUser, unauthorized } from "@/lib/auth";
import { createCampaign, listCampaignsForUser, publicCampaign, type Campaign } from "@/lib/db/campaigns";
import { playingAsByCampaign } from "@/lib/db/sheets";
import { homeGlanceFor, partyFacesByCampaign } from "@/lib/db/home-glance";
import { gameSettingsSchema } from "@/lib/schemas/game-settings";
import { capabilitiesSnapshot, narrationAvailable, NO_STORYTELLER_MESSAGE, storytellerConfigured } from "@/lib/capabilities";
import { narratorIsAi } from "@/lib/dm/viewer";
import { CAMPAIGN_DIFFICULTIES } from "@/lib/campaign-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createCampaignSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  theme: z.string().trim().max(120).default(""),
  maxPlayers: z.number().int().min(1).max(8).default(5),
  startingLevel: z.number().int().min(1).max(20).default(1),
  difficulty: z.enum(CAMPAIGN_DIFFICULTIES).default("normal"),
  // Narration is the one switch the route decides when unsaid (POST below),
  // so it is carved out of the partial: zod fills a field's default through
  // .partial(), which would say "on" for a caller that said nothing.
  gameSettings: gameSettingsSchema.partial().extend({ ttsEnabled: z.boolean().optional() }).default({}),
});

// Whether this server has an AI storyteller, for the shells' Quick start
// (an AI-run one-evening adventure, offered on the website only where one
// exists). The capability probes are cached; a cold one gets a short budget
// and, past it, the field is left out and the shells keep offering the door.
async function offersStory(): Promise<boolean | undefined> {
  const budget = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 800));
  const answer = capabilitiesSnapshot()
    .then((snapshot) => snapshot.story.configured)
    .catch(() => undefined);
  return Promise.race([answer, budget]);
}

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const story = offersStory();
  // The desktop and Android shells draw a home screen from this list alone:
  // each tile wants the cover (on the summary) and the name of the character
  // the caller plays there, so both ride here rather than costing a snapshot
  // fetch per campaign. One query covers every campaign's playingAs.
  const playingAs = playingAsByCampaign(user.id);
  const campaigns = listCampaignsForUser(user.id);
  // The title screen's glance (recap, chapter, scene painting, party faces)
  // rides the same list for the same reason.
  const faces = partyFacesByCampaign(
    campaigns.map((campaign) => campaign.id),
    new Map(campaigns.map((campaign) => [campaign.id, campaign.genre])),
  );
  return Response.json({
    campaigns: campaigns.map((campaign) => ({
      ...publicCampaign(campaign as Campaign),
      playingAs: playingAs.get(campaign.id) ?? null,
      glance: homeGlanceFor(campaign.id, faces.get(campaign.id) ?? []),
    })),
    // The shells' home menus offer New campaign and Quick start only where
    // this account may start one (src/lib/shared-host.ts).
    canCreateCampaigns: canCreateCampaigns(user),
    // And Quick start only where an AI storyteller can run it.
    offersStory: await story,
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (user.mustChangePassword) {
    return Response.json({ error: "Set a new password to continue." }, { status: 403 });
  }
  if (!canCreateCampaigns(user)) {
    return campaignCreationRefusal();
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = createCampaignSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid campaign settings." }, { status: 400 });
  }

  // A create that says nothing about narration (an app shell's, a script's)
  // starts it on only where the server can read aloud, the rule the
  // new-campaign dialog applies for itself before it sends (issue 275).
  const gameSettings = { ...parsed.data.gameSettings };
  if (gameSettings.ttsEnabled === undefined) {
    gameSettings.ttsEnabled = await narrationAvailable();
  }
  // No storyteller, no AI seat: the creator hides the AI seats when the
  // server says so, and this holds the same line for every other caller (a
  // shell, a script, a creator whose capability check never answered). A
  // seat the caller did not name follows the server: the AI where there is
  // one, a person where there is none, rather than a table that fails on
  // its first turn.
  // Read off the raw body: zod fills the seat's default through .partial(),
  // so parsed.data cannot tell a caller who said "ai" from one who said
  // nothing.
  const namedSeat =
    typeof raw === "object" && raw !== null && typeof raw.gameSettings === "object" && raw.gameSettings !== null && "dmMode" in raw.gameSettings;
  const storyteller = await storytellerConfigured();
  if (!namedSeat) {
    gameSettings.dmMode = storyteller ? "ai" : "human";
  } else if (narratorIsAi(gameSettings.dmMode ?? "ai") && !storyteller) {
    return Response.json({ error: NO_STORYTELLER_MESSAGE, reason: "no_storyteller" }, { status: 409 });
  }
  const campaign = createCampaign(user.id, { ...parsed.data, gameSettings });
  return Response.json({ campaign: publicCampaign(campaign) }, { status: 201 });
}
