import { z } from "zod";
import { currentUser, endSession, unauthorized, verifyPassword } from "@/lib/auth";
import {
  NO_PASSWORD_SENTINEL,
  deleteUserCascade,
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
  return Response.json({ avatar: user.avatar, settings: getUserSettings(user.id) });
}

// Account profile updates: the avatar, and/or a partial settings patch.
// Both keys are optional so a caller only touches what it sent.
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
  return Response.json({ avatar, settings });
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
