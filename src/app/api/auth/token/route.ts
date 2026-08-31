import { z } from "zod";
import { hashPassword, mintSession, verifyPassword } from "@/lib/auth";
import { getUserByUsername } from "@/lib/db/users";
import {
  checkLogin,
  recordLoginFailure,
  recordLoginSuccess,
  throttleKey,
} from "@/lib/login-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Login for native client apps: same credentials and throttle as
// /api/auth/login, but the session comes back as a bearer token in the body
// instead of a cookie. Every API route accepts it via Authorization: Bearer.
const tokenSchema = z.object({
  username: z.string().trim().min(1).max(24),
  password: z.string().min(1).max(100),
});

// Unknown usernames still pay one scrypt verification against this hash so
// response timing does not reveal whether an account exists.
const DUMMY_HASH = hashPassword("odm-dummy-password");

export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = throttleKey(parsed.data.username, ip);
  const gate = checkLogin(key);
  if (gate.blocked) {
    return Response.json(
      { error: `Too many attempts. Try again in ${gate.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } },
    );
  }

  const user = getUserByUsername(parsed.data.username);
  const valid = user
    ? verifyPassword(parsed.data.password, user.passwordHash)
    : verifyPassword(parsed.data.password, DUMMY_HASH) && false;
  if (!user || !valid) {
    recordLoginFailure(key);
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }

  recordLoginSuccess(key);
  const session = mintSession(user.id);

  return Response.json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
    },
  });
}
