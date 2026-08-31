import { z } from "zod";
import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { getFloor, setFloor, type Floor } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { skipCurrentTurn } from "@/lib/dm/encounter-tools";
import { requestDmTurn } from "@/lib/dm/loop";
import { publishPersisted } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A person running the table wants the opposite verb too: not only "let
// them go" but "hold it", and "you two, now". `set` takes the floor
// straight there; without it the route keeps its original release-only
// behavior, so nothing that already calls it changes.
const setFloorSchema = z.object({
  set: z.enum(["open", "hold", "spotlight"]).optional(),
  // spotlight only.
  characterIds: z.array(z.string()).max(12).optional(),
  prompt: z.string().trim().max(300).optional(),
});

// Release, layered: a hold opens into its stored next floor (which may be a
// spotlight); a spotlight force-opens. Releasing a partially answered
// spotlight hands the answers so far to the DM; releasing a hold or a fully
// unanswered spotlight wakes nobody (there is nothing to answer).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const floor = getFloor(campaignId);

  const parsed = setFloorSchema.safeParse(await request.json().catch(() => ({})));
  const wanted = parsed.success ? parsed.data.set : undefined;
  if (wanted) {
    // Initiative is the encounter's to own; nothing sets the floor into or
    // out of it but the combat engine.
    if (floor.mode === "initiative") {
      return Response.json(
        { error: "The initiative order owns the floor while a fight is running." },
        { status: 409 },
      );
    }
    let next: Floor;
    if (wanted === "open") {
      next = { mode: "open" };
    } else if (wanted === "hold") {
      next = { mode: "hold", next: { mode: "open" } };
    } else {
      const wantedIds = new Set(parsed.data?.characterIds ?? []);
      const userIds = [
        ...new Set(
          listSheets(campaignId)
            .filter((sheet) => wantedIds.has(sheet.id) && !sheet.isCompanion)
            .map((sheet) => sheet.userId),
        ),
      ];
      if (!userIds.length) {
        return Response.json(
          { error: "Pick at least one player character to give the floor to." },
          { status: 400 },
        );
      }
      next = {
        mode: "spotlight",
        userIds,
        prompt: parsed.data?.prompt ?? "",
        respondedUserIds: [],
      };
    }
    setFloor(campaignId, next);
    publishPersisted(campaignId, "floor_changed", { floor: next });
    return Response.json({ ok: true, floor: next });
  }

  // In combat, "release" means skip the absent player's turn: the pointer
  // advances and the DM plays any intervening enemies.
  if (floor.mode === "initiative") {
    if (skipCurrentTurn(campaignId)) {
      requestDmTurn(campaignId);
    }
    return Response.json({ ok: true });
  }
  const next: Floor = floor.mode === "hold" ? floor.next : { mode: "open" };
  setFloor(campaignId, next);
  publishPersisted(campaignId, "floor_changed", { floor: next });
  if (floor.mode === "spotlight" && floor.respondedUserIds.length) {
    requestDmTurn(campaignId);
  }
  return Response.json({ ok: true });
}
