import { z } from "zod";
import { hashPassword, startSession } from "@/lib/auth";
import { consumeAccountInvite } from "@/lib/db/account-invites";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { findCampaignByInviteCode } from "@/lib/db/campaigns";
import { countUsers, createUser, getUserByUsername } from "@/lib/db/users";
import { checkLogin, recordLoginFailure } from "@/lib/login-throttle";
import { resolveSignupMode } from "@/lib/schemas/global-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_-]+$/, "Letters, numbers, _ and - only."),
  password: z.string().min(8).max(100),
  // Account invite code, required while the server's signup mode is
  // "invite". Not a campaign room code.
  inviteCode: z.string().trim().max(40).optional(),
  // Campaign room code from a /join/CODE signup (same shape the join route
  // takes). On an invite-only server a live room code vouches for the
  // signup; it is looked up, never spent.
  joinCode: z.string().trim().toUpperCase().min(4).max(12).optional(),
});

export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid input." },
      { status: 400 },
    );
  }

  const { username, password, inviteCode, joinCode } = parsed.data;

  // Wrong invite codes and username probes share the login throttle's
  // escalating lockout, keyed by IP: registration is the one auth surface
  // an anonymous caller can hammer.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const throttle = `register:${ip}`;
  const gate = checkLogin(throttle);
  if (gate.blocked) {
    return Response.json(
      { error: `Too many attempts. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  // The very first account becomes the admin and may always register, even
  // if signups were somehow disabled before any user existed.
  const isFirstUser = countUsers() === 0;
  const signupMode = resolveSignupMode(getGlobalConfig());
  if (!isFirstUser && signupMode === "closed") {
    return Response.json({ error: "Signups are disabled." }, { status: 403 });
  }
  if (!isFirstUser && signupMode === "invite" && !inviteCode) {
    // A live campaign room code also vouches for a signup: room codes only
    // reach people a member chose to invite. Looked up, never consumed, so
    // the same code still joins the campaign right after.
    if (!joinCode) {
      return Response.json(
        { error: "This server needs an invite code to create an account." },
        { status: 403 },
      );
    }
    if (!findCampaignByInviteCode(joinCode)) {
      recordLoginFailure(throttle);
      return Response.json(
        { error: "That room code does not match a campaign on this server." },
        { status: 403 },
      );
    }
  }
  if (getUserByUsername(username)) {
    recordLoginFailure(throttle);
    return Response.json({ error: "That username is taken." }, { status: 409 });
  }
  // Spend the invite only after the cheap rejections, so a typo'd username
  // does not burn a single-use code.
  if (!isFirstUser && signupMode === "invite" && inviteCode) {
    if (!consumeAccountInvite(inviteCode)) {
      recordLoginFailure(throttle);
      return Response.json(
        { error: "That invite code is not valid (or has been used up)." },
        { status: 403 },
      );
    }
  }

  const user = createUser(username, hashPassword(password), { isAdmin: isFirstUser });
  await startSession(user.id);

  return Response.json(
    {
      user: {
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
        mustChangePassword: user.mustChangePassword,
      },
    },
    { status: 201 },
  );
}
