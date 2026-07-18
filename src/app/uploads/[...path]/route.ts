import { serveGeneratedFile } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves runtime-uploaded images (avatars and portraits); public/uploads is
// not covered by build-time static serving, so files uploaded while the
// server runs would 404 until a restart without this route.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  return serveGeneratedFile("uploads", segments);
}
