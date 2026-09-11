import { z } from "zod";
import { hashPassword, startSession } from "@/lib/auth";
import { consumeAccountInvite } from "@/lib/db/account-invites";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { campaignAdmits } from "@/lib/db/campaigns";
import { countUsers, createUser, getUserByUsername } from "@/lib/db/users";
import { checkLogin, clientIp, recordLoginFailure } from "@/lib/login-throttle";
import { resolveSignupMode } from "@/lib/schemas/global-config";
import { isDeviceWorld } from "@/lib/server-env";

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
  const ip = clientIp(request);
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
  const deviceWorld = isDeviceWorld();
  const signupMode = resolveSignupMode(getGlobalConfig(), deviceWorld);
  if (!isFirstUser && signupMode === "closed") {
    return Response.json({ error: "Signups are disabled." }, { status: 403 });
  }
  // A room code that arrives with the signup must name a table that would
  // seat the player, whatever the signup rule: a code is the whole
  // invitation on a device world and a voucher on an invite-only server, so
  // one that matches nothing here (mistyped, or the table moved) is refused
  // now rather than after an account exists on the wrong world.
  if (joinCode) {
    const admitted = campaignAdmits(joinCode);
    if ("error" in admitted) {
      recordLoginFailure(throttle);
      return Response.json(
        {
          error:
            admitted.error === "No campaign with that invite code."
              ? "That room code does not match a campaign on this server."
              : admitted.error,
        },
        { status: 403 },
      );
    }
  }
  // A world one of the apps hosts has no passwords and no signup policy;
  // the room code its host read out is the only door. Without one there is
  // nothing to seat a stranger at, so an account is not made for them.
  if (!isFirstUser && deviceWorld && !joinCode) {
    return Response.json(
      { error: "Ask the host for the table's room code; that is the way into this world." },
      { status: 403 },
    );
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
