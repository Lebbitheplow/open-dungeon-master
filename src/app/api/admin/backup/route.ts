import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { backupDir, createBackup, listBackups } from "@/lib/ops/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists the verified archives in the backup directory (ODM_BACKUP_DIR, by
// default ~/odm-backups, the same place scripts/odm-backup.mjs writes).
export async function GET() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  return Response.json({ backups: listBackups(), dir: backupDir() });
}

// A point-in-time snapshot of the campaign state: the encrypted database
// (VACUUM INTO, so it is consistent even mid-game) plus uploads, generated
// media, models and .env.server. The archive contains the database
// encryption key; treat it as a secret.
export async function POST() {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  try {
    const backup = await createBackup();
    return Response.json({ backup });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Backup failed." },
      { status: 500 },
    );
  }
}
