import { z } from "zod";
import { isErrorResponse, requireMember } from "@/lib/campaign-api";
import { offeredSubclasses, raceGrantsFor } from "@/lib/characters/catalog";
import { settingClassIds } from "@/lib/classes";
import { packClassIds } from "@/lib/dm/companion-tools";
import { tableAuthors } from "@/lib/db/homebrew";
import { getSheetForUser, ownLivingSheet } from "@/lib/db/sheets";
import { subclassExtrasFor } from "@/lib/db/subclass-extras";
import { freeCantripCount } from "@/lib/srd/free-cantrips";
import { levelUpOptions } from "@/lib/srd/level-up-options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const characterIdQuery = z.string().trim().min(1).max(80).optional();

// What the player's next level offers, before it is taken: whether it is
// earned, the hit points, and every choice it opens with the names to send
// back (src/lib/srd/level-up-options.ts). The level itself is the PATCH on
// /sheet, which judges the choices; this only reads. ?class= asks about a
// level in another class (multiclassing), ?subclass= what a subclass the
// level owes would open with it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const query = new URL(request.url).searchParams;
  // Which of the player's characters to ask about: left out, the one they
  // have selected. A connected agent names the character its link wakes,
  // which at a table of several characters each need not be that one
  // (issue 654), so it reads the level it is about to take.
  const named = characterIdQuery.safeParse(query.get("characterId") ?? undefined);
  if (!named.success) {
    return Response.json({ error: "That character id is not valid." }, { status: 400 });
  }
  const sheet = named.data ? ownLivingSheet(campaignId, context.user.id, named.data) : getSheetForUser(campaignId, context.user.id);
  if (named.data && !sheet) {
    return Response.json({ error: "That is not one of your characters at this table." }, { status: 404 });
  }
  if (!sheet) {
    return Response.json({ error: "You have no character in this campaign." }, { status: 404 });
  }
  const classId = query.get("class") ?? undefined;
  // An id no class has is refused as an unknown class below.
  if (classId !== undefined && classId.length > 60) {
    return Response.json({ error: "That class id is too long." }, { status: 400 });
  }
  const subclass = query.get("subclass") ?? undefined;
  if (subclass !== undefined && subclass.length > 80) {
    return Response.json({ error: "That subclass name is too long." }, { status: 400 });
  }
  // The table's homebrew, whoever of its DM seats wrote it, as the level-up.
  const owner = tableAuthors(context.campaign.id);
  // How many cantrips the species leaves to the player. A table's sheet
  // keeps the race's features, not its picks, and only the server knows a
  // homebrew species, so the level-up dialog reads the number here.
  const racialCantripChoice = raceGrantsFor(sheet.race, owner)?.cantripChoice?.count ?? 0;
  const options = levelUpOptions(sheet, {
    hpMethod: context.campaign.gameSettings.hpMethod ?? "average",
    multiclassAllowed: context.campaign.gameSettings.multiclassingEnabled !== false,
    classId,
    subclass,
    subclassesOf: (id) => offeredSubclasses(id, owner),
    freeCantrips: freeCantripCount(sheet, racialCantripChoice),
    subclassExtras: subclassExtrasFor(owner),
    settingClassIds: settingClassIds(context.campaign.gameSettings.genre, packClassIds(context.campaign.gameSettings)),
  });
  if ("error" in options) {
    return Response.json({ error: options.error }, { status: 400 });
  }
  return Response.json({ ...options, racialCantripChoice });
}
