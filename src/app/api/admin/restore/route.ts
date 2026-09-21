import { isErrorResponse, requireAdmin } from "@/lib/admin-api";
import { BackupError, restoreBackup, verifyBackup } from "@/lib/ops/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = {
  parse(raw: unknown) {
    const body = raw as { name?: unknown; mode?: unknown };
    if (typeof body?.name !== "string" || !body.name) {
      throw new Error("A backup archive name is required.");
    }
    const mode = body.mode === "live" ? "live" : "verify";
    return { name: body.name, mode } as const;
  },
};

// POST { name, mode: "verify" | "live" }.
//
// "verify" is the safe rehearsal the CLI calls a dry run: safe-path checks,
// extract, open the encrypted database with the archived key, integrity
// check, and campaign/user/message counts. "live" runs the same proof first
// and only then replaces the managed state paths. The server keeps its open
// database handle until it restarts, so a live restore is not finished until
// the service restarts, and anything played in between is lost.
export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isErrorResponse(admin)) {
    return admin;
  }
  const raw = await request.json().catch(() => null);
  let parsed: { name: string; mode: "verify" | "live" };
  try {
    parsed = bodySchema.parse(raw);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }

  try {
    if (parsed.mode === "verify") {
      const { proof, sha256 } = await verifyBackup(parsed.name);
      return Response.json({ ok: true, mode: "verify", proof, sha256 });
    }
    const { proof } = await restoreBackup(parsed.name);
    return Response.json({ ok: true, mode: "live", proof, restartRequired: true });
  } catch (error) {
    const status = error instanceof BackupError ? error.status : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Restore failed." },
      { status },
    );
  }
}
