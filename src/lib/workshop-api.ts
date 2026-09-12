import { currentUser, unauthorized } from "@/lib/auth";
import type { Campaign } from "@/lib/db/campaigns";
import type { User } from "@/lib/db/users";
import { getWorkshopForUser } from "@/lib/db/workshops";

export type WorkshopContext = { user: User; workshop: Campaign };

// Resolves the logged-in user and the workshop they own, or the error
// Response the route should return. getWorkshopForUser checks membership,
// ownership and kind together, so a campaign id sent to a workshop route is
// a 404 rather than a way to reach a playing table through prep.
export async function requireWorkshop(workshopId: string): Promise<WorkshopContext | Response> {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const workshop = getWorkshopForUser(workshopId, user.id);
  if (!workshop) {
    return Response.json({ error: "Workshop not found." }, { status: 404 });
  }
  return { user, workshop };
}

export function isErrorResponse(value: WorkshopContext | Response): value is Response {
  return value instanceof Response;
}
