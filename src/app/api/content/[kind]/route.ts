import { currentUser, unauthorized } from "@/lib/auth";
import { contentPackInstalled } from "@/lib/content/db";
import {
  listArchetypes,
  listBackgrounds,
  listClasses,
  listConditions,
  listRaces,
  searchFeats,
  searchItems,
  searchMonsters,
  searchSpells,
  type ItemEntry,
} from "@/lib/content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ITEM_KINDS = new Set(["weapon", "armor", "gear", "magic_item"]);

// GET /api/content/spells?q=fire&class=wizard&level=3
// GET /api/content/items?q=rope&kind=gear
// GET /api/content/archetypes?class=fighter
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }

  const { kind } = await params;
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
  const base = {
    q,
    userId: user.id,
    ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
    ...(Number.isFinite(offsetRaw) ? { offset: offsetRaw } : {}),
  };

  let results: unknown[];
  switch (kind) {
    case "spells": {
      const levelRaw = Number.parseInt(url.searchParams.get("level") ?? "", 10);
      results = searchSpells({
        ...base,
        classSlug: url.searchParams.get("class") ?? undefined,
        ...(Number.isFinite(levelRaw) ? { level: levelRaw } : {}),
      });
      break;
    }
    case "items": {
      const itemKind = url.searchParams.get("kind") ?? undefined;
      results = searchItems({
        ...base,
        ...(itemKind && ITEM_KINDS.has(itemKind)
          ? { kind: itemKind as ItemEntry["kind"] }
          : {}),
      });
      break;
    }
    case "feats":
      results = searchFeats(base);
      break;
    case "conditions":
      results = listConditions(base);
      break;
    case "backgrounds":
      results = listBackgrounds(base);
      break;
    case "races":
      results = listRaces({
        ...base,
        includeSubraces: url.searchParams.get("subraces") !== "0",
      });
      break;
    case "classes":
      results = listClasses(base);
      break;
    case "archetypes": {
      const classSlug = url.searchParams.get("class") ?? "";
      results = classSlug ? listArchetypes(classSlug, base) : [];
      break;
    }
    case "monsters": {
      const maxCrRaw = Number.parseFloat(url.searchParams.get("maxCr") ?? "");
      results = searchMonsters({
        ...base,
        ...(Number.isFinite(maxCrRaw) ? { maxCr: maxCrRaw } : {}),
      });
      break;
    }
    default:
      return Response.json({ error: "Unknown content kind." }, { status: 404 });
  }

  return Response.json({ results, packInstalled: contentPackInstalled() });
}
