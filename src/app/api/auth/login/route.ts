import { z } from "zod";
import { startSession, verifyPassword } from "@/lib/auth";
import { getUserByUsername } from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().trim().min(1).max(24),
  password: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }

  const user = getUserByUsername(parsed.data.username);
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return Response.json({ error: "Wrong username or password." }, { status: 401 });
  }

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
