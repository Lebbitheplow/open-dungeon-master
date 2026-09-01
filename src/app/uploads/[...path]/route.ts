import { currentUser, unauthorized } from "@/lib/auth";
import { serveGeneratedFile } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves runtime-uploaded images (avatars and portraits); public/uploads is
// not covered by build-time static serving, so files uploaded while the
// server runs would 404 until a restart without this route. Login required:
// these are player uploads, not a public gallery.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!(await currentUser())) {
    return unauthorized();
  }
  const { path: segments } = await params;
  return serveGeneratedFile("uploads", segments);
}
