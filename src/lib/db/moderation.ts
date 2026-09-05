import { getDatabase, nowIso, parseJson } from "@/lib/db/core";

// Reports, blocks and mutes. Play's user-generated-content and generative
// AI policies both want an in-app way to flag content and keep a person at
// arm's length; this server is the only moderator there is, so all three
// land here and surface in the admin panel.

export const REPORT_REASONS = [
  "harassment",
  "sexual",
  "hate",
  "violence",
  "spam",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ContentReport = {
  id: string;
  campaignId: string;
  campaignName: string;
  reporterUserId: string;
  reporterUsername: string;
  messageId: string | null;
  reportedUserId: string | null;
  reportedUsername: string | null;
  authorType: "player" | "dm" | "system";
  reason: ReportReason;
  details: string;
  excerpt: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
};

type ReportRow = {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  reporter_user_id: string;
  reporter_username: string | null;
  message_id: string | null;
  reported_user_id: string | null;
  reported_username: string | null;
  author_type: "player" | "dm" | "system";
  reason: ReportReason;
  details: string;
  excerpt: string;
  status: "open" | "resolved";
  created_at: string;
  resolved_at: string | null;
};

const EXCERPT_LIMIT = 600;

function mapReport(row: ReportRow): ContentReport {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignName: row.campaign_name ?? "(deleted campaign)",
    reporterUserId: row.reporter_user_id,
    reporterUsername: row.reporter_username ?? "(deleted account)",
    messageId: row.message_id,
    reportedUserId: row.reported_user_id,
    reportedUsername: row.reported_user_id ? (row.reported_username ?? "(deleted account)") : null,
    authorType: row.author_type,
    reason: row.reason,
    details: row.details,
    excerpt: row.excerpt,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

const REPORT_SELECT = `
  SELECT r.*, c.title AS campaign_name,
         reporter.username AS reporter_username,
         reported.username AS reported_username
  FROM content_reports r
  LEFT JOIN campaigns c ON c.id = r.campaign_id
  LEFT JOIN users reporter ON reporter.id = r.reporter_user_id
  LEFT JOIN users reported ON reported.id = r.reported_user_id
`;

export function createReport(input: {
  campaignId: string;
  reporterUserId: string;
  messageId?: string | null;
  reportedUserId?: string | null;
  authorType: "player" | "dm" | "system";
  reason: ReportReason;
  details?: string;
  excerpt?: string;
}): ContentReport {
  const id = crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO content_reports
         (id, campaign_id, reporter_user_id, message_id, reported_user_id, author_type,
          reason, details, excerpt, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.reporterUserId,
      input.messageId ?? null,
      input.reportedUserId ?? null,
      input.authorType,
      input.reason,
      (input.details ?? "").slice(0, 2000),
      (input.excerpt ?? "").slice(0, EXCERPT_LIMIT),
      nowIso(),
    );
  return getReport(id)!;
}

export function getReport(reportId: string): ContentReport | null {
  const row = getDatabase()
    .prepare(`${REPORT_SELECT} WHERE r.id = ?`)
    .get(reportId) as ReportRow | undefined;
  return row ? mapReport(row) : null;
}

export function listReports(status: "open" | "all" = "open", limit = 200): ContentReport[] {
  const where = status === "open" ? "WHERE r.status = 'open'" : "";
  const rows = getDatabase()
    .prepare(`${REPORT_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ?`)
    .all(limit) as ReportRow[];
  return rows.map(mapReport);
}

export function countOpenReports(): number {
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM content_reports WHERE status = 'open'`)
    .get() as { n: number };
  return row.n;
}

export function setReportStatus(
  reportId: string,
  status: "open" | "resolved",
  byUserId: string,
): ContentReport | null {
  const resolved = status === "resolved";
  getDatabase()
    .prepare(
      `UPDATE content_reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`,
    )
    .run(status, resolved ? nowIso() : null, resolved ? byUserId : null, reportId);
  return getReport(reportId);
}

// The reporter's own recent reports in a campaign, so the UI can show
// "already reported" without a second table.
export function hasReported(reporterUserId: string, messageId: string): boolean {
  return Boolean(
    getDatabase()
      .prepare(`SELECT 1 FROM content_reports WHERE reporter_user_id = ? AND message_id = ?`)
      .get(reporterUserId, messageId),
  );
}

// ---- blocks ---------------------------------------------------------

export type BlockedUser = {
  userId: string;
  username: string;
  avatar: { url: string } | null;
  createdAt: string;
};

export function blockUser(userId: string, blockedUserId: string): boolean {
  if (userId === blockedUserId) {
    return false;
  }
  const result = getDatabase()
    .prepare(
      `INSERT OR IGNORE INTO user_blocks (user_id, blocked_user_id, created_at) VALUES (?, ?, ?)`,
    )
    .run(userId, blockedUserId, nowIso());
  return result.changes > 0;
}

export function unblockUser(userId: string, blockedUserId: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM user_blocks WHERE user_id = ? AND blocked_user_id = ?`)
    .run(userId, blockedUserId);
  return result.changes > 0;
}

export function listBlockedUsers(userId: string): BlockedUser[] {
  const rows = getDatabase()
    .prepare(
      `SELECT b.blocked_user_id, b.created_at, u.username, u.avatar_json
       FROM user_blocks b
       JOIN users u ON u.id = b.blocked_user_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC`,
    )
    .all(userId) as Array<{
    blocked_user_id: string;
    created_at: string;
    username: string;
    avatar_json: string | null;
  }>;
  return rows.map((row) => ({
    userId: row.blocked_user_id,
    username: row.username,
    avatar: parseJson<{ url: string } | null>(row.avatar_json, null),
    createdAt: row.created_at,
  }));
}

export function listBlockedUserIds(userId: string): string[] {
  const rows = getDatabase()
    .prepare(`SELECT blocked_user_id FROM user_blocks WHERE user_id = ?`)
    .all(userId) as Array<{ blocked_user_id: string }>;
  return rows.map((row) => row.blocked_user_id);
}

// True when either has blocked the other. Contact is refused both ways: a
// block is meant to end the conversation, not to make it one-sided.
export function contactBlocked(userA: string, userB: string): boolean {
  return Boolean(
    getDatabase()
      .prepare(
        `SELECT 1 FROM user_blocks
         WHERE (user_id = ? AND blocked_user_id = ?) OR (user_id = ? AND blocked_user_id = ?)`,
      )
      .get(userA, userB, userB, userA),
  );
}

// ---- mutes ----------------------------------------------------------

export function setMemberMuted(campaignId: string, userId: string, muted: boolean): boolean {
  const result = getDatabase()
    .prepare(`UPDATE campaign_members SET muted = ? WHERE campaign_id = ? AND user_id = ?`)
    .run(muted ? 1 : 0, campaignId, userId);
  return result.changes > 0;
}

export function isMemberMuted(campaignId: string, userId: string): boolean {
  const row = getDatabase()
    .prepare(`SELECT muted FROM campaign_members WHERE campaign_id = ? AND user_id = ?`)
    .get(campaignId, userId) as { muted: number } | undefined;
  return Boolean(row?.muted);
}
