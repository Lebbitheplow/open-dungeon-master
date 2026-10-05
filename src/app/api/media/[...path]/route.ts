import { GET as generated } from "@/app/generated/[...path]/route";
import { GET as generatedAudio } from "@/app/generated-audio/[...path]/route";
import { GET as uploads } from "@/app/uploads/[...path]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where src/proxy.ts sends /uploads, /generated and /generated-audio, so a
// file under public/ is always answered by the route that checks the login
// and never by Next's static serving. The address the page asked for does
// not change; each folder keeps its own handler and its own rules.
const ROOTS: Record<string, typeof uploads> = {
  uploads,
  generated,
  "generated-audio": generatedAudio,
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const [root, ...segments] = (await params).path;
  const handler = Object.hasOwn(ROOTS, root) ? ROOTS[root] : null;
  if (!handler || !segments.length) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return handler(request, { params: Promise.resolve({ path: segments }) });
}
