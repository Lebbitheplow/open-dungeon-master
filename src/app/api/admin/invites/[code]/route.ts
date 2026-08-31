import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { deleteAccountInvite } from "@/lib/db/account-invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Revoking an account invite only stops future registrations; accounts
// already created with it stay.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { code } = await params;
  if (!deleteAccountInvite(code.toUpperCase())) {
    return Response.json({ error: "No such invite code." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
