import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { setUserAvatar } from "@/lib/db/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  avatar: z
    .object({ url: z.string().max(300).startsWith("/uploads/") })
    .nullable(),
});

// Account profile updates; today just the avatar.
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

  setUserAvatar(user.id, parsed.data.avatar);
  return Response.json({ avatar: parsed.data.avatar });
}
