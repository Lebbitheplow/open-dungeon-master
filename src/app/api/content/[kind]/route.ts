import { currentUser, unauthorized } from "@/lib/auth";
import { catalogPrices } from "@/lib/characters/catalog";
import { contentPackInstalled } from "@/lib/content/db";
import { contentScopeFor, unadmittedNames } from "@/lib/content/scope";
import { bundledItemRows, bundledSpellRows } from "@/lib/rulebook/catalog-rows";
import { bundledGearRows } from "@/lib/workshop/bundled-gear-rows";
import { bundledArchetypeRows, bundledBackgroundRows, bundledRaceRows, withMechanics } from "@/lib/workshop/catalog-mechanics";
import { hazardCatalog } from "@/lib/workshop/hazard-catalog";
import {
  listArchetypes,
  listBackgrounds,
  listClasses,
  listConditions,
  listRaces,
  searchFeats,
  searchHomebrewHazards,
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
//
// `campaign=<id>`: the search a table makes, its homebrew read from whoever
// runs it (src/lib/content/scope.ts); without it, the asker's own shelf.
//
// `packInstalled` says whether the optional content pack is there. It is not
// whether the search found anything: without the pack the table's homebrew,
// ODM's own feats and backgrounds, and (for "start from", mechanics=1) the
// bundled book's spells, magic items, races and subclasses still answer, and
// each row's `source` says where it came from.
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
  const scope = contentScopeFor(url, user.id);
  if ("error" in scope) {
    return Response.json({ error: scope.error }, { status: scope.status });
  }
  const q = url.searchParams.get("q") ?? "";
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const offsetRaw = Number.parseInt(url.searchParams.get("offset") ?? "", 10);
  const base = {
    q,
    userIds: scope.userIds,
    ...(Number.isFinite(limitRaw) ? { limit: limitRaw } : {}),
    ...(Number.isFinite(offsetRaw) ? { offset: offsetRaw } : {}),
  };
  const packInstalled = contentPackInstalled();
  const mechanics = url.searchParams.get("mechanics") === "1";
  const fromBook = url.searchParams.get("book") === "1";
  // The bundled rows a search has no SRD row of the same name for.
  const notFiled = <T extends { name: string }>(found: unknown[], bundled: T[]): T[] => {
    const filed = new Set((found as Array<{ name: string; documentSlug?: string }>).filter((row) => row.documentSlug === "wotc-srd").map((row) => row.name.trim().toLowerCase()));
    return bundled.filter((row) => !filed.has(row.name.trim().toLowerCase()));
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
      // No pack: the bundled book's spells, whole, for the workshop to copy.
      // `book=1` (the rulebook's "start a copy"): the book's own rows beside
      // the pack's, for a page the pack files under no SRD row.
      if ((!packInstalled || fromBook) && mechanics) {
        results = [...results, ...notFiled(results, bundledSpellRows(q)).slice(0, base.limit ?? 50)];
      }
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
      // No pack: the bundled book's magic items and its weapons, armour and
      // adventuring gear, whole, for the workshop to copy.
      if ((!packInstalled || fromBook) && mechanics) {
        const bundled = [
          ...(!itemKind || itemKind === "magic_item" ? bundledItemRows(q) : []),
          ...(itemKind === "magic_item" || packInstalled ? [] : bundledGearRows(q, itemKind)),
        ];
        results = [...results, ...notFiled(results, bundled).slice(0, base.limit ?? 50)];
      }
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
      // The table's own hazards, then the SRD's traps, poisons and diseases,
      // bundled (hazard-catalog.ts), so either can be started from.
      return Response.json({
        results: [...searchHomebrewHazards(base), ...hazardCatalog(q)],
        packInstalled,
        unadmitted: unadmittedNames(scope, user.id, kind, q),
      });
    default:
      return Response.json({ error: "Unknown content kind." }, { status: 404 });
  }

  // The workshop's "start from" asks for what the engine runs, too.
  if (mechanics) {
    results = withMechanics(kind, results, { classSlug: url.searchParams.get("class") ?? undefined });
    // The builder's own backgrounds no content row carries (the Guild
    // Artisan, a setting's Corpo Dropout) can be started from too, and with
    // no pack its races and subclasses.
    if (kind === "backgrounds") {
      results = [...results, ...bundledBackgroundRows(q, results as Array<{ slug: string }>)];
    }
    if (kind === "races" && !packInstalled) {
      results = [...results, ...bundledRaceRows(q, results as Array<{ name: string }>)];
    }
    if (kind === "archetypes" && !packInstalled) {
      results = [...results, ...bundledArchetypeRows(url.searchParams.get("class") ?? "", q, results as Array<{ name: string }>)];
    }
  }
  return Response.json({ results, packInstalled, unadmitted: unadmittedNames(scope, user.id, kind, q) });
}
