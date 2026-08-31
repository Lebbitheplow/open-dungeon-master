import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { getHomebrewMonster } from "@/lib/bestiary/homebrew-monsters";
import { getEntryDetail, searchSpells } from "@/lib/content";
import {
  buildCompare,
  COMPARE_KINDS,
  MAX_COMPARE,
  type CompareSubject,
} from "@/lib/reference/compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const compareSchema = z.object({
  kind: z.enum(COMPARE_KINDS),
  slugs: z.array(z.string().trim().min(1).max(120)).min(2).max(MAX_COMPARE),
});

// A homebrew slug is "homebrew:<id>", and getEntryDetail refuses those by
// design: the content database has no such row. Each kind reaches its own
// store instead, and a hand-built monster comes back already in the
// EnemyStats shape compare.ts expects.
function resolveSubject(
  kind: "spells" | "monsters",
  slug: string,
  userId: string,
): CompareSubject | null {
  if (slug.startsWith("homebrew:")) {
    const id = slug.slice("homebrew:".length);
    if (kind === "monsters") {
      const own = getHomebrewMonster(userId, id);
      return own
        ? {
            slug,
            name: own.draft.name,
            source: "homebrew",
            data: { stats: own.draft.stats },
          }
        : null;
    }
    // Homebrew spells have no lookup of their own, so the user's own list is
    // scanned. Bounded by how many spells one person writes.
    const own = searchSpells({ userId, limit: 200 }).find((entry) => entry.slug === slug);
    return own
      ? { slug, name: own.name, source: "homebrew", data: own.data }
      : null;
  }
  const entry = getEntryDetail(kind, slug);
  return entry ? { slug, name: entry.name, source: "open5e", data: entry.data } : null;
}

// POST /api/reference/compare { kind: "spells", slugs: [...] }
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const raw = await request.json().catch(() => ({}));
  const parsed = compareSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: `Pick between 2 and ${MAX_COMPARE} things of one kind.` },
      { status: 400 },
    );
  }
  const { kind, slugs } = parsed.data;
  const subjects: CompareSubject[] = [];
  for (const slug of [...new Set(slugs)]) {
    const subject = resolveSubject(kind, slug, user.id);
    if (!subject) {
      return Response.json({ error: `Nothing on file for "${slug}".` }, { status: 404 });
    }
    subjects.push(subject);
  }
  const table = buildCompare(kind, subjects);
  if ("error" in table) {
    return Response.json({ error: table.error }, { status: 400 });
  }
  return Response.json({ table });
}
