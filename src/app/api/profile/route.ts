import { z } from "zod";
import { cancelAccountDeletion, requestAccountDeletion } from "@/lib/account-deletion";
import { currentUser, endSession, unauthorized, verifyPassword } from "@/lib/auth";
import {
  NO_PASSWORD_SENTINEL,
  getUserByUsername,
  getUserSettings,
  setUserAvatar,
  updateUserSettings,
} from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const volumeSchema = z.number().min(0).max(1);

// Audio preferences synced across browsers (src/lib/audio-prefs.ts). Voice
// device prefs stay client-side on purpose; see useVoicePrefs.ts.
const settingsSchema = z.object({
  narrationVolume: volumeSchema.optional(),
  narrationMuted: z.boolean().optional(),
  ambienceVolume: volumeSchema.optional(),
  ambienceMuted: z.boolean().optional(),
  chimeMuted: z.boolean().optional(),
});

const patchSchema = z.object({
  avatar: z
    .object({ url: z.string().max(300).startsWith("/uploads/") })
    .nullable()
    .optional(),
  settings: settingsSchema.optional(),
  // "Keep my account": calls off a pending deletion before its due date.
  keepAccount: z.literal(true).optional(),
});

const deleteSchema = z.object({
  password: z.string().max(100).optional(),
});

// The profile as the account holds it. The audio hooks hydrate their
// localStorage cache from here once per page load.
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  return Response.json({
    avatar: user.avatar,
    settings: getUserSettings(user.id),
    deletionDueAt: user.deletionDueAt,
  });
}

// Account profile updates: the avatar, a partial settings patch, and/or
// keeping an account that was scheduled for deletion. Every key is optional
// so a caller only touches what it sent.
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

  let avatar = user.avatar;
  if (parsed.data.avatar !== undefined) {
    setUserAvatar(user.id, parsed.data.avatar);
    avatar = parsed.data.avatar;
  }
  const settings = parsed.data.settings
    ? updateUserSettings(user.id, parsed.data.settings)
    : getUserSettings(user.id);
  let deletionDueAt = user.deletionDueAt;
  if (parsed.data.keepAccount) {
    cancelAccountDeletion(user.id);
    deletionDueAt = null;
  }
  return Response.json({ avatar, settings, deletionDueAt });
}

// Self-service account deletion. Schedules the purge for the end of the
// server's grace period (immediate when that is zero) and signs the account
// out everywhere; see src/lib/account-deletion.ts for what goes and what
// stays. Password accounts must re-enter their password; Discord-only
// accounts (no password) are guarded by the typed confirmation in the
// settings dialog instead.
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

  const schedule = requestAccountDeletion(user.id);
  // The sessions are already gone; this only drops the browser cookie.
  await endSession();
  return Response.json({
    ok: true,
    dueAt: schedule.dueAt,
    graceDays: schedule.graceDays,
    purged: schedule.purged,
  });
}
