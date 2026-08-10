import type { Genre } from "@/lib/schemas/game-settings";
import { packFor, type SettingRef } from "@/lib/worlds/preset";
import { getEntryDetail, searchMonsters } from "@/lib/content";
import { parseMonster, type EnemyStats } from "@/lib/bestiary/statblock";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import { thresholdsForParty, xpForCr } from "@/lib/srd/encounter-math";
import highFantasyJson from "@/lib/bestiary/high-fantasy.json";
import darkFantasyJson from "@/lib/bestiary/dark-fantasy.json";
import cyberpunkJson from "@/lib/bestiary/cyberpunk.json";
import horrorJson from "@/lib/bestiary/horror.json";
import mysteryJson from "@/lib/bestiary/mystery.json";
import postApocalypticJson from "@/lib/bestiary/post-apocalyptic.json";
import steampunkJson from "@/lib/bestiary/steampunk.json";

// Curated per-genre enemy catalogs: real Open5e stat blocks under
// genre-appropriate names, so every setting fights with honest mechanics.
// cr is denormalized into the JSON so suggestions work without the content
// pack; scripts/test-bestiary.mjs verifies slugs and crs against it.

export type BestiaryEntry = {
  slug: string;
  name: string;
  cr: number;
  blurb: string;
};

type CatalogFile = { entries: BestiaryEntry[] };

const CATALOGS: Partial<Record<Genre, CatalogFile>> = {
  high_fantasy: highFantasyJson,
  dark_fantasy: darkFantasyJson,
  cyberpunk: cyberpunkJson,
  horror: horrorJson,
  mystery: mysteryJson,
  post_apocalyptic: postApocalypticJson,
  steampunk: steampunkJson,
};

export function bestiaryForGenre(genre: Genre): BestiaryEntry[] {
  return (CATALOGS[genre] ?? CATALOGS.high_fantasy!).entries;
}

// The catalog a campaign actually fights with: its genre's list, with the
// selected world pack's own monsters overlaid by slug (the pack wins) and its
// pack-only slugs appended. Structurally satisfied by GameSettings, so callers
// pass campaign.gameSettings straight in.
export function bestiaryFor(setting: SettingRef): BestiaryEntry[] {
  const base = bestiaryForGenre(setting.genre as Genre);
  const pack = packFor(setting);
  if (!pack?.monsters.length) {
    return base;
  }
  const overrides = new Map(pack.monsters.map((entry) => [entry.slug, entry]));
  const merged = base.map((entry) => overrides.get(entry.slug) ?? entry);
  const seen = new Set(base.map((entry) => entry.slug));
  return [...merged, ...pack.monsters.filter((entry) => !seen.has(entry.slug))];
}

export function reskinFor(setting: SettingRef, slug: string): BestiaryEntry | null {
  return bestiaryFor(setting).find((entry) => entry.slug === slug) ?? null;
}

// A shortlist of genre-fitting enemies the party could plausibly face:
// everything from the catalog up to the CR a solo monster could carry at the
// party's deadly budget, keeping a few overspill entries for named threats.
export function suggestEnemies(
  setting: SettingRef,
  partyLevels: number[],
  limit = 10,
): BestiaryEntry[] {
  const deadly = thresholdsForParty(partyLevels.length ? partyLevels : [1]).deadly;
  const catalog = bestiaryFor(setting);
  const usable = catalog.filter((entry) => xpForCr(entry.cr) <= deadly);
  if (!usable.length) {
    return catalog.slice(0, limit);
  }
  // Spread picks across the usable CR range instead of clustering low.
  const sorted = [...usable].sort((a, b) => a.cr - b.cr);
  if (sorted.length <= limit) {
    return sorted;
  }
  const picks: BestiaryEntry[] = [];
  for (let index = 0; index < limit; index += 1) {
    picks.push(sorted[Math.floor((index * (sorted.length - 1)) / (limit - 1))]);
  }
  return [...new Set(picks)];
}

export type ResolvedMonster = {
  slug: string;
  baseName: string;
  reskinName: string | null;
  stats: EnemyStats;
};

function fromContent(slug: string): { name: string; stats: EnemyStats } | null {
  const entry = getEntryDetail("monsters", slug);
  if (!entry) {
    return null;
  }
  const cr = typeof entry.data.cr === "number" ? entry.data.cr : 0;
  return { name: entry.name, stats: parseMonster(entry.data, cr) };
}

// Resolves a model-supplied monster reference: exact Open5e slug, then a
// catalog reskin name, then an Open5e name search. Degrades to synthesized
// stats for catalog slugs when the content pack is absent.
export function resolveMonster(ref: string, setting: SettingRef): ResolvedMonster | null {
  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }

  const slugified = trimmed.toLowerCase().replace(/['.]/g, "").replace(/[\s_]+/g, "-");
  const direct = fromContent(slugified);
  if (direct) {
    return {
      slug: slugified,
      baseName: direct.name,
      reskinName: reskinFor(setting, slugified)?.name ?? null,
      stats: direct.stats,
    };
  }

  const catalogMatch = bestiaryFor(setting).find(
    (entry) => entry.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (catalogMatch) {
    const content = fromContent(catalogMatch.slug);
    return {
      slug: catalogMatch.slug,
      baseName: content?.name ?? catalogMatch.name,
      reskinName: catalogMatch.name,
      stats: content?.stats ?? synthesizeStats(catalogMatch.cr),
    };
  }

  const searched = searchMonsters({ q: trimmed, limit: 5 });
  const best =
    searched.find((entry) => entry.name.toLowerCase() === trimmed.toLowerCase()) ??
    searched.find((entry) => entry.source === "open5e");
  if (best && best.source === "open5e") {
    const cr = typeof best.data.cr === "number" ? best.data.cr : 0;
    return {
      slug: best.slug,
      baseName: best.name,
      reskinName: reskinFor(setting, best.slug)?.name ?? null,
      stats: parseMonster(best.data, cr),
    };
  }
  return null;
}
