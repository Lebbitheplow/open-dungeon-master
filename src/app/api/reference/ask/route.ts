import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { previewSources, runRulesDesk } from "@/lib/reference/desk";
import { DESK_QUESTION_MAX } from "@/lib/reference/desk-logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const askSchema = z.object({
  question: z.string().trim().min(1).max(DESK_QUESTION_MAX),
});

// GET /api/reference/ask?q=... lists what the desk WOULD cite, without
// spending a model call, so a DM can see the retrieval found nothing before
// they wait for an answer assembled from nothing.
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json({ sources: q.trim() ? previewSources(user.id, q) : [] });
}

// POST /api/reference/ask asks it for real: one queued model call, grounded
// in the sources above, with every returned citation checked back against
// what was actually supplied.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = askSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Ask a question first." }, { status: 400 });
  }
  const result = await runRulesDesk({ userId: user.id, question: parsed.data.question });
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: 502 });
  }
  return Response.json({ result });
}
