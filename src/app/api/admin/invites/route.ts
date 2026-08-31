import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { createAccountInvite, listAccountInvites } from "@/lib/db/account-invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Account invite codes for invite-only signup mode. Codes are not secrets
// from the admin, so GET returns them in full.
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json({ invites: listAccountInvites() });
}

const createSchema = z.object({
  note: z.string().trim().max(200).default(""),
  maxUses: z.number().int().min(1).max(1000).default(1),
  // Days from now; 0 or absent = never expires.
  expiresInDays: z.number().int().min(0).max(365).default(0),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid input." },
      { status: 400 },
    );
  }
  const { note, maxUses, expiresInDays } = parsed.data;
  const expiresAt =
    expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
  const invite = createAccountInvite(admin.id, { note, maxUses, expiresAt });
  return Response.json({ invite }, { status: 201 });
}
