import { currentUser, unauthorized } from "@/lib/auth";
import { serveGeneratedFile } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves runtime-generated images (scene art and maps); public/generated is
// not covered by build-time static serving. Login required: scene art can
// spoil a table's story for outsiders.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!(await currentUser())) {
    return unauthorized();
  }
  const { path: segments } = await params;
  return serveGeneratedFile("generated", segments);
}
