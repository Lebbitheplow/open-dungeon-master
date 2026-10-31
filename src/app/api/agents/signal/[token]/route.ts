import { pollLinkAnswer } from "@/lib/agents/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A player's poll link (docs/player-webhooks.md): no login, since the link
// itself is the secret, made for an agent's hook that can only poll and holds
// no credential. It answers what this one character may do now, the same
// opportunities a pushed webhook carries, and nothing else. An unknown,
// revoked, replaced or switched-off link is a 404, so a guess learns
// nothing. A link that stopped on its own (its player left the table, or
// the seat left its character with no hero to follow) is a 410 that says
// so, with no names (issue 654): before, it read like a mistyped link and
// the agent had nothing to go on.
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const answer = pollLinkAnswer(token);
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (answer.status === 404) {
    return Response.json({ error: "Not found." }, { status: 404, headers });
  }
  if (answer.status === 410) {
    return Response.json({ error: answer.error, stopped: answer.stopped }, { status: 410, headers });
  }
  if (answer.status === 429) {
    return Response.json(
      { error: "Too soon; check again shortly." },
      { status: 429, headers: { ...headers, "Retry-After": String(answer.retryAfterSec) } },
    );
  }
  return Response.json(answer.body, { headers });
}
