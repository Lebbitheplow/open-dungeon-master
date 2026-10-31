import { getSheetForUser, listSheets } from "@/lib/db/sheets";

// A player as the story knows them: the character in their seat, else any
// other of theirs that is not a companion; null when they have none. The
// table's lines that the GM reads name this, never the account (#594, #658):
// an account name in a note reached the GM's narration.
export function storyNameOf(campaignId: string, userId: string): string | null {
  const seated = getSheetForUser(campaignId, userId);
  const own = seated && !seated.isCompanion
    ? seated
    : listSheets(campaignId).find((sheet) => sheet.userId === userId && !sheet.isCompanion);
  return own?.name ?? null;
}
