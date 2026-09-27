import { getGlobalConfig } from "@/lib/db/app-settings";
import { removeCampaignAudio } from "@/lib/campaign-deletion";
import { deleteCampaign } from "@/lib/db/campaigns";
import { getDatabase, parseJson } from "@/lib/db/core";
import {
  clearDeletionRequest,
  deleteSessionsForUser,
  getUserById,
  listUsersDueForPurge,
  markDeletionRequested,
} from "@/lib/db/users";
import { campaignFilePaths, removeUnreferencedFiles } from "@/lib/image-files";
import { isUploadedImagePath } from "@/lib/uploads";

// Self-service account deletion, in two steps. The request stamps a due
// date on the user row and signs them out everywhere; the purge (run by the
// job loop once the date passes, or at once when the grace period is zero)
// erases every row the account owns and the pictures only it pointed at.
// Signing in before the due date and choosing "keep my account" clears the
// stamps, which is the whole undo.
//
// What the purge leaves behind, on purpose: the text of messages the person
// wrote at other people's tables (the author link is cut, the transcript
// stays whole for everyone else who was there), and campaign tools they made
// in other people's campaigns (roll tables, prepared encounters, sessions),
// which pass to that campaign's owner.

const DAY_MS = 24 * 60 * 60 * 1000;

export type DeletionSchedule = {
  requestedAt: string;
  dueAt: string;
  graceDays: number;
  // True when the grace period was zero and the account is already gone.
  purged: boolean;
};

export function deletionGraceDays(): number {
  return getGlobalConfig().accountDeletionGraceDays;
}

export function requestAccountDeletion(userId: string, now = Date.now()): DeletionSchedule {
  const graceDays = deletionGraceDays();
  const requestedAt = new Date(now).toISOString();
  const dueAt = new Date(now + graceDays * DAY_MS).toISOString();
  markDeletionRequested(userId, requestedAt, dueAt);
  // Every device is signed out, so a token a client app kept cannot keep
  // acting for an account its owner asked to erase.
  deleteSessionsForUser(userId);
  if (graceDays === 0) {
    purgeAccount(userId);
    return { requestedAt, dueAt, graceDays, purged: true };
  }
  return { requestedAt, dueAt, graceDays, purged: false };
}

// Returns false when nothing was pending (or the account no longer exists).
export function cancelAccountDeletion(userId: string): boolean {
  const user = getUserById(userId);
  if (!user || !user.deletionDueAt) {
    return false;
  }
  clearDeletionRequest(userId);
  return true;
}

// One pass for the job loop: purges everyone whose due date has passed and
// returns their ids. Each account is its own transaction, so one failure
// (a locked file, a foreign key surprise) cannot hold the others hostage.
export function purgeDueAccounts(now = Date.now()): string[] {
  const purged: string[] = [];
  for (const userId of listUsersDueForPurge(new Date(now).toISOString())) {
    try {
      purgeAccount(userId);
      purged.push(userId);
    } catch (error) {
      console.error(`[account-deletion] purge of ${userId} failed`, error);
    }
  }
  return purged;
}

type ImageRef = { url?: unknown } | null;

// Every /uploads/ picture this account is the reason for: the avatar and the
// portraits on its library characters and campaign sheets.
function uploadsOwnedBy(userId: string): string[] {
  const db = getDatabase();
  const rows = [
    ...(db
      .prepare(`SELECT avatar_json AS json FROM users WHERE id = ?`)
      .all(userId) as Array<{ json: string | null }>),
    ...(db
      .prepare(`SELECT portrait_json AS json FROM library_characters WHERE user_id = ?`)
      .all(userId) as Array<{ json: string | null }>),
    ...(db
      .prepare(`SELECT portrait_json AS json FROM character_sheets WHERE user_id = ?`)
      .all(userId) as Array<{ json: string | null }>),
  ];
  const urls = new Set<string>();
  for (const row of rows) {
    const url = parseJson<ImageRef>(row.json, null)?.url;
    if (isUploadedImagePath(url)) {
      urls.add(url);
    }
  }
  return [...urls];
}

// Erases the account now, whatever its due date says. Also what the admin
// panel's delete does.
export function purgeAccount(userId: string) {
  const db = getDatabase();
  const owned = db
    .prepare(`SELECT id FROM campaigns WHERE owner_user_id = ?`)
    .all(userId) as Array<{ id: string }>;
  // Read before the rows go: the account's own pictures, and every file its
  // campaigns and workshops name (covers, scene art, maps, NPC portraits).
  const files = [...uploadsOwnedBy(userId), ...owned.flatMap(({ id }) => campaignFilePaths(id))];

  db.transaction(() => {
    // Owned campaigns and workshops first: campaigns.owner_user_id is a
    // foreign key with no cascade, and deleteCampaign also sweeps the
    // companion bot users that exist only for their seats.
    for (const { id } of owned) {
      deleteCampaign(id);
    }

    // Seats held at other people's tables.
    for (const column of ["party_lead_user_id", "human_dm_user_id", "assistant_dm_user_id"]) {
      db.prepare(`UPDATE campaigns SET ${column} = NULL WHERE ${column} = ?`).run(userId);
    }

    // The transcript keeps its words, minus the link to a person.
    db.prepare(`UPDATE campaign_messages SET user_id = NULL WHERE user_id = ?`).run(userId);

    // Things only this person could act on.
    for (const table of [
      "pending_rolls",
      "item_proposals",
      "campaign_asks",
      "ask_briefs",
      "session_rsvps",
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }

    // Tools built for someone else's campaign stay usable there: they pass
    // to that campaign's owner rather than vanish from the table.
    for (const [table, column] of [
      ["dm_beats", "author_user_id"],
      ["roll_tables", "created_by_user_id"],
      ["encounter_templates", "created_by_user_id"],
      ["scheduled_sessions", "created_by_user_id"],
    ] as const) {
      db.prepare(
        `UPDATE ${table} SET ${column} =
           (SELECT c.owner_user_id FROM campaigns c WHERE c.id = ${table}.campaign_id)
         WHERE ${column} = ?`,
      ).run(userId);
    }

    // Everything with a cascading foreign key goes with the row: sessions,
    // memberships, sheets, library characters and rulesets, homebrew,
    // notes, private threads and whispers, pins, notifications, friends,
    // account invites.
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  })();

  removeUnreferencedFiles(files);
  for (const { id } of owned) {
    removeCampaignAudio(id);
  }
}
