import { z } from "zod";
import { hashPassword, startSession, verifyPassword } from "@/lib/auth";
import { getUserByUsername } from "@/lib/db/users";
import {
  checkLogin,
  recordLoginFailure,
  recordLoginSuccess,
  throttleKey,
} from "@/lib/login-throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(24),
  password: z.string().min(1).max(100),
});

// Unknown usernames still pay one scrypt verification against this hash so
// response timing does not reveal whether an account exists.
const DUMMY_HASH = hashPassword("odm-dummy-password");

export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(raw);
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
  await startSession(user.id);

  // Same shape as /api/auth/me: the client renders this object directly
  // (avatar in the header, admin link in the account menu).
  return Response.json({
    user: {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
    },
  });
}
