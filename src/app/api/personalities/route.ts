import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { insertPersonality, listPersonalities } from "@/lib/dm/personalities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DM personalities for the wizard: the stock set and the caller's own.
export async function GET() {
  const user = await currentUser();
  return Response.json({ personalities: listPersonalities(user?.id ?? null) });
}

const bodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  blurb: z.string().trim().max(160).default(""),
  gm: z.object({ strictness: z.enum(["lenient", "standard", "harsh"]), tone: z.array(z.string()).max(3) }),
  ttsVoice: z.string().trim().max(40).default("af_heart"),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid personality." }, { status: 400 });
  }
  return Response.json({ personality: insertPersonality(user.id, { ...parsed.data, gm: { strictness: parsed.data.gm.strictness, tone: parsed.data.gm.tone as never } }) });
}
