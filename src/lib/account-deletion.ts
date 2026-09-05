import fs from "node:fs";
import path from "node:path";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { deleteCampaign } from "@/lib/db/campaigns";
import { getDatabase, parseJson } from "@/lib/db/core";
import {
  clearDeletionRequest,
  deleteSessionsForUser,
  getUserById,
  listUsersDueForPurge,
  markDeletionRequested,
} from "@/lib/db/users";
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

// Text columns that can carry an image path. Portraits are shared by
// reference when a character or NPC is copied between campaigns, so a file
// is only removed once no row anywhere points at it.
function imageBearingColumns(): Array<[table: string, column: string]> {
  const db = getDatabase();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  const columns: Array<[string, string]> = [];
  for (const { name: table } of tables) {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
      name: string;
      type: string;
    }>;
    for (const column of info) {
      if (/^TEXT/i.test(column.type) && /_(json|path|url)$/.test(column.name)) {
        columns.push([table, column.name]);
      }
    }
  }
  return columns;
}

function uploadStillReferenced(url: string, columns: Array<[string, string]>): boolean {
  const db = getDatabase();
  for (const [table, column] of columns) {
    const hit = db
      .prepare(`SELECT 1 FROM "${table}" WHERE "${column}" LIKE ? LIMIT 1`)
      .get(`%${url}%`);
    if (hit) {
      return true;
    }
  }
  return false;
}

function removeUploadFile(url: string) {
  // isUploadedImagePath already pinned the shape to /uploads/<uuid>.<ext>,
  // so the filename cannot climb out of the uploads directory.
  const filename = url.slice("/uploads/".length);
  const file = path.join(process.cwd(), "public", "uploads", filename);
  try {
    fs.rmSync(file, { force: true });
  } catch (error) {
    console.error(`[account-deletion] could not remove ${url}`, error);
  }
}

// Erases the account now, whatever its due date says. Also what the admin
// panel's delete does.
export function purgeAccount(userId: string) {
  const db = getDatabase();
  const uploads = uploadsOwnedBy(userId);

  db.transaction(() => {
    // Owned campaigns and workshops first: campaigns.owner_user_id is a
    // foreign key with no cascade, and deleteCampaign also sweeps the
    // companion bot users that exist only for their seats.
    const owned = db
      .prepare(`SELECT id FROM campaigns WHERE owner_user_id = ?`)
      .all(userId) as Array<{ id: string }>;
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

  if (uploads.length > 0) {
    const columns = imageBearingColumns();
    for (const url of uploads) {
      if (!uploadStillReferenced(url, columns)) {
        removeUploadFile(url);
      }
    }
  }
}
