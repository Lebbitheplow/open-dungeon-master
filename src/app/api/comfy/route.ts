import { z } from "zod";
import { comfyStatus, resolveComfyUrl } from "@/lib/comfyui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  url: z.string().trim().max(500).default(""),
});

// Reachability + checkpoint list for the Images panel's ComfyUI backend.
export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json().catch(() => ({})));
  const status = await comfyStatus(body.url);

  return Response.json({
    ...status,
    url: resolveComfyUrl(body.url),
  });
}
