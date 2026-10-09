import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { applyForge } from "@/lib/db/world-forge-io";
import { askTheWorld, draftEntry, forgeFromNotes, paintEntry } from "@/lib/dm/world-ai";
import { imagesAvailable } from "@/lib/capabilities";
import { publishEphemeral } from "@/lib/events";
import { parseRef } from "@/lib/worldforge/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// WorldForge's AI tools (src/lib/dm/world-ai.ts), the DM's alone. The forge,
// ask and draft only answer; nothing is written until the DM keeps it
// ("apply" writes a forge preview's ticked rows). Paint queues a picture on
// the media queue and answers at once.
const ref = z.string().max(100).refine((value) => parseRef(value) !== null);
const bodySchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("forge"), text: z.string().trim().min(1).max(20_000), hint: z.string().trim().max(300).default("") }),
  z.object({ tool: z.literal("ask"), question: z.string().trim().min(1).max(1_000) }),
  z.object({ tool: z.literal("draft"), ref, hint: z.string().trim().max(300).default("") }),
  z.object({ tool: z.literal("paint"), ref }),
  z.object({ tool: z.literal("apply"), entities: z.array(z.unknown()).max(60), links: z.array(z.unknown()).max(120), stubs: z.array(z.string().max(120)).max(60).default([]) }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "That request is not one WorldForge knows." }, { status: 400 });
  }
  const body = parsed.data;
  const answer = (result: object) => ("error" in result ? Response.json(result, { status: 502 }) : Response.json(result));
  switch (body.tool) {
    case "forge":
      return answer(await forgeFromNotes(context.campaign, body.text, body.hint));
    case "ask":
      return answer(await askTheWorld(context.campaign, body.question));
    case "draft":
      return answer(await draftEntry(context.campaign, body.ref, body.hint));
    case "paint":
      if (!(await imagesAvailable())) {
        return Response.json({ error: "This server has no image backend to paint with." }, { status: 409 });
      }
      return paintEntry(context.campaign, body.ref) ? Response.json({ queued: true }) : Response.json({ error: "No such entry." }, { status: 404 });
    case "apply": {
      const result = applyForge(campaignId, body);
      publishEphemeral(campaignId, "world_updated", { at: Date.now() });
      return Response.json(result);
    }
  }
}
