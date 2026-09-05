import { z } from "zod";
import { findCampaignByInviteCode } from "@/lib/db/campaigns";
import { joinPreviewFor } from "@/lib/join-preview";
import { checkLogin, recordLoginFailure, recordLoginSuccess } from "@/lib/login-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.string().trim().toUpperCase().min(4).max(12);

// GET /api/campaigns/join/preview?code=XXXX. Unauthenticated on purpose: the
// invite landing page runs before sign-in. A room code is the only key, so a
// wrong guess costs the caller the same escalating lockout a wrong password
// does, per address rather than per user because there is no user yet.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse(url.searchParams.get("code") ?? "");
  if (!parsed.success) {
    return Response.json({ error: "Invalid invite code." }, { status: 400 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const throttle = `join-preview:${ip}`;
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
  recordLoginSuccess(throttle);
  return Response.json({ preview: joinPreviewFor(campaign) });
}
