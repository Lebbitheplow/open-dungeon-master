import { currentUser, unauthorized } from "@/lib/auth";
import { catalogPrices } from "@/lib/characters/catalog";
import { contentPackInstalled } from "@/lib/content/db";
import { bundledBackgroundRows, withMechanics } from "@/lib/workshop/catalog-mechanics";
import { hazardCatalog } from "@/lib/workshop/hazard-catalog";
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
        // A feat's pick: a 1st-level divination or enchantment spell
        // (school=divination,enchantment), an attack cantrip (attack=1),
        // exactly that level (exact=1).
        school: url.searchParams.get("school") ?? undefined,
        attack: url.searchParams.get("attack") === "1",
        exactLevel: url.searchParams.get("exact") === "1",
      });
      break;
    }
    case "items": {
      const itemKind = url.searchParams.get("kind") ?? undefined;
      // The price rides with the row, worked out by the same catalog the
      // sheet route will charge by, so the builder's purse and the server
      // agree even where the pack files a name twice (issue #136).
      results = searchItems({
        ...base,
        ...(itemKind && ITEM_KINDS.has(itemKind)
          ? { kind: itemKind as ItemEntry["kind"] }
          : {}),
      }).map((entry) => (entry.source === "open5e" ? { ...entry, price: catalogPrices(entry.name) } : entry));
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
    case "hazards":
      // The SRD's traps, poisons and diseases, bundled (hazard-catalog.ts).
      return Response.json({ results: hazardCatalog(q), packInstalled: true });
    default:
      return Response.json({ error: "Unknown content kind." }, { status: 404 });
  }

  // The workshop's "start from" asks for what the engine runs, too.
  if (url.searchParams.get("mechanics") === "1") {
    results = withMechanics(kind, results, { classSlug: url.searchParams.get("class") ?? undefined });
    // The builder's own backgrounds no content row carries (the Guild
    // Artisan, a setting's Corpo Dropout) can be started from too.
    if (kind === "backgrounds") {
      results = [...results, ...bundledBackgroundRows(q, results as Array<{ slug: string }>)];
    }
  }
  return Response.json({ results, packInstalled: contentPackInstalled() });
}
