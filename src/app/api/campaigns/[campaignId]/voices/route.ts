import { z } from "zod";
import { isDm, isErrorResponse, requireMember, steersStory, type MemberContext } from "@/lib/campaign-api";
import { publishCast } from "@/lib/dm/cast";
import { normalizeNpcVoice } from "@/lib/npcs/forge";
import { castUnvoiced, setRosterVoice, voiceRoster, type RosterEntry } from "@/lib/tts-roster";
import { baseCreatureName } from "@/lib/tts-segments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Who reads whose lines aloud (issue 97): one voice per character, cast
// member and kind of monster. Whoever runs the story sets any of them; a
// player sets their own character's, and is shown no one else's.

function runsTheTable(context: MemberContext): boolean {
  return steersStory(context) || isDm(context);
}

function visibleRoster(context: MemberContext): Array<Omit<RosterEntry, "gender" | "aliases" | "ownerUserId"> & { mine: boolean }> {
  const all = runsTheTable(context);
  return voiceRoster(context.campaign.id)
    .filter((entry) => all || entry.ownerUserId === context.user.id)
    .map(({ key, kind, name, portraitUrl, voice, ownerUserId }) => ({
      key,
      kind,
      name,
      portraitUrl,
      voice,
      mine: ownerUserId === context.user.id,
    }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  return Response.json({ roster: visibleRoster(context), canCast: runsTheTable(context) });
}

const putSchema = z.object({
  key: z.string().trim().min(4).max(120).regex(/^(pc|npc|monster):.+/),
  // null hands the speaker back to the narrator.
  voice: z.object({ voiceId: z.string().trim().min(1).max(120), speed: z.number().min(0.7).max(1.4).default(1) }).nullable(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = putSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Pick a voice." }, { status: 400 });
  }
  const { key } = parsed.data;
  const voice = parsed.data.voice ? normalizeNpcVoice(parsed.data.voice) : null;
  const all = runsTheTable(context);
  let entry: Pick<RosterEntry, "key" | "name" | "kind" | "ownerUserId"> | undefined = voiceRoster(campaignId).find(
    (candidate) => candidate.key === key,
  );
  // A monster may be given a voice before it ever stands on the board.
  if (!entry && key.startsWith("monster:") && all) {
    const name = baseCreatureName(key.slice("monster:".length));
    entry = { key: `monster:${name.toLowerCase()}`, name, kind: "monster", ownerUserId: "" };
  }
  if (!entry) {
    return Response.json({ error: "No one by that name at this table." }, { status: 404 });
  }
  if (!all && entry.ownerUserId !== context.user.id) {
    return Response.json({ error: "Only the Dungeon Master can choose that voice." }, { status: 403 });
  }
  if (!setRosterVoice(campaignId, entry, voice)) {
    return Response.json({ error: "No one by that name at this table." }, { status: 404 });
  }
  if (entry.kind === "npc") {
    publishCast(campaignId);
  }
  return Response.json({ roster: visibleRoster(context) });
}

// Cast everyone who has no voice yet, in one go.
export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  if (!runsTheTable(context)) {
    return Response.json({ error: "Only the Dungeon Master can cast the table." }, { status: 403 });
  }
  const cast = await castUnvoiced(campaignId, voiceRoster(campaignId), context.campaign.gameSettings.ttsVoice);
  return Response.json({ roster: visibleRoster(context), cast });
}
