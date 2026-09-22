import { currentUser, unauthorized } from "@/lib/auth";
import { variantWidth } from "@/lib/image-format";
import { servedSegments } from "@/lib/image-variants";
import { serveGeneratedFile } from "@/lib/serve-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves runtime-generated images (scene art and maps); public/generated is
// not covered by build-time static serving. Login required: scene art can
// spoil a table's story for outsiders.
//
// ?w=256 or ?w=1024 asks for the smaller WebP copy written beside the
// original (src/lib/image-variants.ts); when there is none, the original
// goes out under the same headers.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!(await currentUser())) {
    return unauthorized();
  }
  const { path: segments } = await params;
  const width = variantWidth(new URL(request.url).searchParams.get("w"));
  const served = width ? await servedSegments("generated", segments, width) : segments;
  return serveGeneratedFile("generated", served, request);
}
