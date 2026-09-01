import { currentUser, unauthorized } from "@/lib/auth";
import { serveGeneratedFile } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves the fetched ambience library (public/ambience). Not covered by
// build-time static serving: the files arrive when someone runs
// scripts/fetch-ambience.mjs, which is usually long after the build.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!(await currentUser())) {
    return unauthorized();
  }
  const { path: segments } = await params;
  return serveGeneratedFile("ambience", segments);
}
