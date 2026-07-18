import { z } from "zod";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import {
  countAdmins,
  deleteUserCascade,
  getUserById,
  setUserAdmin,
} from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  isAdmin: z.boolean(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { userId } = await params;
  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }
  const target = getUserById(userId);
  if (!target) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  if (!parsed.data.isAdmin) {
    if (target.id === admin.id) {
      return Response.json({ error: "You can't demote yourself." }, { status: 400 });
    }
    if (target.isAdmin && countAdmins() <= 1) {
      return Response.json({ error: "There must be at least one admin." }, { status: 400 });
    }
  }
  setUserAdmin(target.id, parsed.data.isAdmin);
  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { userId } = await params;
  const target = getUserById(userId);
  if (!target) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }
  if (target.id === admin.id) {
    return Response.json({ error: "You can't delete your own account." }, { status: 400 });
  }
  deleteUserCascade(target.id);
  return Response.json({ ok: true });
}
