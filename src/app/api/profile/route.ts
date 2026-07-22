import { z } from "zod";
import { currentUser, endSession, unauthorized, verifyPassword } from "@/lib/auth";
import {
  NO_PASSWORD_SENTINEL,
  deleteUserCascade,
  getUserByUsername,
  setUserAvatar,
} from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  avatar: z
    .object({ url: z.string().max(300).startsWith("/uploads/") })
    .nullable(),
});

const deleteSchema = z.object({
  password: z.string().max(100).optional(),
});

// Account profile updates; today just the avatar.
export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid profile update." }, { status: 400 });
  }

  setUserAvatar(user.id, parsed.data.avatar);
  return Response.json({ avatar: parsed.data.avatar });
}

// Self-service account deletion. Removes the caller's owned campaigns and
// character sheets via deleteUserCascade. Password accounts must re-enter their
// password; Discord-only accounts (no password) are guarded by the typed
// confirmation in the settings dialog instead.
export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const account = getUserByUsername(user.username);
  if (!account) {
    return unauthorized();
  }

  if (account.passwordHash !== NO_PASSWORD_SENTINEL) {
    if (!parsed.data.password) {
      return Response.json({ error: "Password is required." }, { status: 400 });
    }
    if (!verifyPassword(parsed.data.password, account.passwordHash)) {
      return Response.json({ error: "Password is wrong." }, { status: 403 });
    }
  }

  deleteUserCascade(user.id);
  await endSession();
  return Response.json({ ok: true });
}
