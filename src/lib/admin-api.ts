import { currentUser, unauthorized } from "@/lib/auth";
import type { User } from "@/lib/db/users";

// Resolves the logged-in global admin, or the error Response the route
// should return. Every /api/admin/* handler calls this first.
export async function requireAdmin(): Promise<User | Response> {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  if (!user.isAdmin) {
    return Response.json({ error: "Admins only." }, { status: 403 });
  }
  return user;
}

export function isErrorResponse(value: User | Response): value is Response {
  return value instanceof Response;
}
