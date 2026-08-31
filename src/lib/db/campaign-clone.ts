import { getDatabase, nowIso } from "@/lib/db/core";
import { createCampaign, listCampaignsForUser, type Campaign } from "@/lib/db/campaigns";
import { createWorkshop, listWorkshopsForUser } from "@/lib/db/workshops";
import { getImportSourceForUser } from "@/lib/db/import-sources";
import { runContentImport } from "@/lib/db/content-import";
import { copyBeats } from "@/lib/db/workshop-beats";
import { dedupeName, IMPORT_KINDS, type ImportKind } from "@/lib/workshop/import";

// Cloning a whole campaign or workshop.
//
// A clone is a NEW ROW plus a full content import into it, not a row-by-row
// copy of the campaigns table. That is the honest shape: what a person means
// by "copy this campaign" is the world, not the transcript. So the prep
// travels (lore, places, region, cast, maps, fights, tables, house rules)
// and the play does not (messages, sheets, members, invite code, the floor,
// the clock, whose turn it was). The copy starts in the lobby with one seat
// filled, exactly like a campaign somebody just made.
//
// Kind never changes. Cloning a workshop gives a workshop; cloning a
// campaign gives a campaign. Turning prep into a table already has a door,
// and it is the workshop picker in the create-campaign dialog.

// Everything except the storyboard, which a workshop clone handles itself.
// See copyBeats: a board reaching another workshop must stay a board.
const BOARDLESS_KINDS = IMPORT_KINDS.filter(
  (kind): kind is ImportKind => kind !== "storyboard",
);

export type CloneOutcome = { campaign: Campaign; copied: number };

function takenTitles(userId: string): Set<string> {
  const titles = [
    ...listCampaignsForUser(userId).map((campaign) => campaign.title),
    ...listWorkshopsForUser(userId).map((workshop) => workshop.title),
  ];
  return new Set(titles.map((title) => title.trim().toLowerCase()));
}

export function cloneCampaign(
  userId: string,
  sourceId: string,
  requestedTitle?: string,
): CloneOutcome | { error: string } {
  const source = getImportSourceForUser(sourceId, userId);
  if (!source) {
    return { error: "Not found." };
  }
  // Trimmed before the numbering, not after, so a long title cannot lose the
  // "(2)" that makes it distinct.
  const base = (requestedTitle?.trim() || `${source.title} (copy)`).slice(0, 72);
  const title = dedupeName(base, takenTitles(userId));

  const created =
    source.kind === "workshop"
      ? createWorkshop(userId, {
          title,
          description: source.description,
          targetParty: source.gameSettings.targetParty,
        })
      : createCampaign(userId, {
          title,
          description: source.description,
          theme: source.theme,
          maxPlayers: source.maxPlayers,
          startingLevel: source.startingLevel,
          difficulty: source.difficulty,
          gameSettings: source.gameSettings,
        });

  // The story's spine lives in columns rather than rows, so the import never
  // sees it. A campaign clone carries it: a copy that lost the arc, the
  // outline and the quest log would be the same world with the plot cut out.
  // A workshop has none of the three, which is why this is campaign-only.
  if (source.kind !== "workshop") {
    getDatabase()
      .prepare(
        `UPDATE campaigns SET settings_json = ?, dm_outline = ?, story_arc_json = ?,
           quest_log_json = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        JSON.stringify(source.settings),
        source.dmOutline,
        source.storyArc ? JSON.stringify(source.storyArc) : "",
        JSON.stringify(source.questLog),
        nowIso(),
        created.id,
      );
  }

  const result = runContentImport({
    sourceId: source.id,
    campaignId: created.id,
    selection: source.kind === "workshop" ? BOARDLESS_KINDS : IMPORT_KINDS,
    houseRulesMode: "replace",
  });
  if ("error" in result) {
    return { error: result.error };
  }

  const copied =
    result.copied +
    (source.kind === "workshop" ? copyBeats(source.id, created.id, result.idMap) : 0);

  return { campaign: created, copied };
}
