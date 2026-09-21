import { createReadStream } from "node:fs";
import { statSync } from "node:fs";
import { Readable } from "node:stream";
import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { deleteBackup, resolveArchive } from "@/lib/ops/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Download one archive straight from the backup directory. The name is
// matched against the strict odm-backup-*.tar.gz shape and resolved inside
// the directory, so this can never read outside it.
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { name } = await params;
  const archive = resolveArchive(decodeURIComponent(name));
  if (!archive) {
    return Response.json({ error: "No such backup archive." }, { status: 404 });
  }
  const size = statSync(archive).size;
  return new Response(Readable.toWeb(createReadStream(archive)) as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const { name } = await params;
  if (!deleteBackup(decodeURIComponent(name))) {
    return Response.json({ error: "No such backup archive." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
