import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { comfyStatus, resolveComfyUrl } from "@/lib/comfyui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  url: z.string().trim().max(500).default(""),
});

// Reachability + checkpoint list for the Images panel's ComfyUI backend.
// Admin only: the caller supplies the URL the server will fetch, which in a
// player's hands is a free port scanner against the host's network.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
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
