import { setFloor, type Floor } from "@/lib/db/campaigns";
import { floorAfterRelease } from "@/lib/dm/encounter-tools";
import { publishPersisted } from "@/lib/events";

// A spotlighted player has answered the GM: their move, their line, or the
// direction they send as party lead, which the GM answers at once all the
// same. Once every spotlighted player has, the spotlight gives way to the
// fight's floor or the open table. A direction used not to count, so a
// spotlight its player had answered that way stayed up over the next turns.
// Synchronous, so a caller's read of the floor and this write stay atomic.
// Returns whether the spotlight still waits on someone.
export function answerSpotlight(campaignId: string, floor: Floor, userId: string): boolean {
  if (floor.mode !== "spotlight") {
    return false;
  }
  const responded =
    floor.userIds.includes(userId) && !floor.respondedUserIds.includes(userId)
      ? [...floor.respondedUserIds, userId]
      : floor.respondedUserIds;
  const allAnswered = floor.userIds.every((id) => responded.includes(id));
  if (allAnswered || responded !== floor.respondedUserIds) {
    const next: Floor = allAnswered ? floorAfterRelease(campaignId) : { ...floor, respondedUserIds: responded };
    setFloor(campaignId, next);
    publishPersisted(campaignId, "floor_changed", { floor: next });
  }
  return !allAnswered;
}
