import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { comfyStatus, resolveComfyUrl } from "@/lib/comfyui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  url: z.string().trim().max(500).default(""),
});

// Reachability + checkpoint list for the Images panel's ComfyUI backend.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const status = await comfyStatus(parsed.data.url);

  return Response.json({
    ...status,
    url: resolveComfyUrl(parsed.data.url),
  });
}
