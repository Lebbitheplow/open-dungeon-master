import { z } from "zod";
import {
  currentSessionTokenHash,
  currentUser,
  hashPassword,
  unauthorized,
  verifyPassword,
} from "@/lib/auth";
import {
  NO_PASSWORD_SENTINEL,
  deleteSessionsForUser,
  getUserByUsername,
  setUserPassword,
} from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: z.string().min(8).max(100),
});

// Changes the caller's password (also the only way out of the
// must_change_password gate after an admin reset). Every other session is
// revoked so a stolen cookie dies with the old password.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = changeSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid input." },
      { status: 400 },
    );
  }

  const account = getUserByUsername(user.username);
  if (!account) {
    return unauthorized();
  }
  if (account.passwordHash === NO_PASSWORD_SENTINEL) {
    return Response.json(
      { error: "This account signs in with Discord and has no password." },
      { status: 400 },
    );
  }
  if (!verifyPassword(parsed.data.currentPassword, account.passwordHash)) {
    return Response.json({ error: "Current password is wrong." }, { status: 403 });
  }

  setUserPassword(user.id, hashPassword(parsed.data.newPassword), false);
  const keep = await currentSessionTokenHash();
  deleteSessionsForUser(user.id, keep ?? undefined);
  return Response.json({ ok: true });
}
