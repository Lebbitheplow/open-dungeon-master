import { currentUser, unauthorized } from "@/lib/auth";
import { getEntryDetail } from "@/lib/content";
import { getHomebrew } from "@/lib/db/homebrew";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set([
  "spells",
  "feats",
  "conditions",
  "backgrounds",
  "races",
  "classes",
  "archetypes",
  "items",
  "monsters",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; slug: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const { kind, slug } = await params;
  if (!KINDS.has(kind)) {
    return Response.json({ error: "Unknown content kind." }, { status: 404 });
  }

  const decoded = decodeURIComponent(slug);
  if (decoded.startsWith("homebrew:")) {
    const entry = getHomebrew(user.id, decoded.slice("homebrew:".length));
    if (!entry) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    return Response.json({
      entry: {
        slug: decoded,
        name: entry.name,
        source: "homebrew",
        documentSlug: "homebrew",
        data: entry.data,
      },
    });
  }

  const entry = getEntryDetail(kind as Parameters<typeof getEntryDetail>[0], decoded);
  if (!entry) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ entry });
}
