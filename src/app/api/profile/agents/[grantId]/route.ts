import { currentUser, unauthorized } from "@/lib/auth";
import { revokeConnectionGrant } from "@/lib/agents/grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ grantId: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const { grantId } = await params;
  if (!revokeConnectionGrant(user.id, grantId)) {
    return Response.json({ error: "Connection not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
