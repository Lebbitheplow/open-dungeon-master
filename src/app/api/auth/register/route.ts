import { z } from "zod";
import { hashPassword, startSession } from "@/lib/auth";
import { createUser, getUserByUsername } from "@/lib/db/users";

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
  if (getUserByUsername(username)) {
    return Response.json({ error: "That username is taken." }, { status: 409 });
  }

  const user = createUser(username, hashPassword(password));
  await startSession(user.id);

  return Response.json({ user: { id: user.id, username: user.username } }, { status: 201 });
}
