import { z } from "zod";
import { hashPassword, startSession } from "@/lib/auth";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { countUsers, createUser, getUserByUsername } from "@/lib/db/users";

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

  const { username, password } = parsed.data;
  // The very first account becomes the admin and may always register, even
  // if signups were somehow disabled before any user existed.
  const isFirstUser = countUsers() === 0;
  if (!isFirstUser && !getGlobalConfig().signupsEnabled) {
    return Response.json({ error: "Signups are disabled." }, { status: 403 });
  }
  if (getUserByUsername(username)) {
    return Response.json({ error: "That username is taken." }, { status: 409 });
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
