import { z } from "zod";
import { findCampaignByInviteCode } from "@/lib/db/campaigns";
import { variantWidth } from "@/lib/image-format";
import { servedSegments } from "@/lib/image-variants";
import { checkLogin, clientIp, recordLoginFailure } from "@/lib/login-throttle";
import { serveGeneratedFile } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const codeSchema = z.string().trim().toUpperCase().min(4).max(12);
const COVER_PATH = /^\/(uploads|generated)\/(.+)$/;

// GET /api/campaigns/join/cover/XXXX. The cover on an invite page, for a
// guest who has no session yet: uploads and generated pictures are behind
// the login, so the join preview (src/lib/join-preview.ts) names this
// address instead. The room code is the key, as it is for the preview, and
// a wrong one costs the same lockout.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const parsed = codeSchema.safeParse((await params).code);
  if (!parsed.success) {
    return Response.json({ error: "Invalid invite code." }, { status: 400 });
  }
  const throttle = `join-preview:${clientIp(request)}`;
  const gate = checkLogin(throttle);
  if (gate.blocked) {
    return Response.json(
      { error: `Too many attempts. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }
  const campaign = findCampaignByInviteCode(parsed.data);
  if (!campaign || campaign.kind !== "campaign") {
    recordLoginFailure(throttle);
    return Response.json({ error: "No table answers to that code." }, { status: 404 });
  }
  const match = COVER_PATH.exec(campaign.cover?.url ?? "");
  if (!match) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const root = match[1];
  const segments = match[2].split("/");
  const width = variantWidth(new URL(request.url).searchParams.get("w"));
  const served = width ? await servedSegments(root, segments, width) : segments;
  return serveGeneratedFile(root, served, request);
}
