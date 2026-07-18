import { serveGeneratedFile } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves runtime-generated narration audio (public/generated-audio is not
// covered by build-time static serving).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;
  return serveGeneratedFile("generated-audio", segments);
}
