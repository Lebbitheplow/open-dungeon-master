import type { Genre } from "@/lib/schemas/game-settings";
import { packFor, type SettingRef } from "@/lib/worlds/preset";
import { packArtKey, packArtUrl } from "@/lib/worlds/art";
import { getEntryDetail, searchMonsters } from "@/lib/content";
import { parseMonster, type EnemyStats } from "@/lib/bestiary/statblock";
import { findTableMonster } from "@/lib/bestiary/homebrew-monsters";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import { thresholdsForParty, xpForCr } from "@/lib/srd/encounter-math";
import highFantasyJson from "@/lib/bestiary/high-fantasy.json";
import darkFantasyJson from "@/lib/bestiary/dark-fantasy.json";
import cyberpunkJson from "@/lib/bestiary/cyberpunk.json";
import horrorJson from "@/lib/bestiary/horror.json";
import mysteryJson from "@/lib/bestiary/mystery.json";
import postApocalypticJson from "@/lib/bestiary/post-apocalyptic.json";
import steampunkJson from "@/lib/bestiary/steampunk.json";
import { findNamed, textKey } from "@/lib/language/text-logic";
import { SRD_CREATURES, senseWords, type SrdCreature } from "@/lib/srd/srd-creatures";
import { enemyAttackOf } from "@/lib/srd/creature-attacks";
import { proficiencyBonus } from "@/lib/srd";
import { getContentDb } from "@/lib/content/db";

// Curated per-genre enemy catalogs: real Open5e stat blocks under
// genre-appropriate names, so every setting fights with honest mechanics.
// cr and type are denormalized into the JSON so suggestions and thumbnails
// work without the content pack; scripts/test-bestiary.mjs verifies slugs,
// crs and types against it.

export type BestiaryEntry = {
  slug: string;
  name: string;
  cr: number;
  // SRD creature type in lowercase ("undead"): what the entry is, and which
  // thumbnail plate it draws (monsterThumbnail in src/lib/ui.tsx).
  type: string;
  blurb: string;
  // The selected world pack's own picture for this entry, when it carries
  // one; absent, the tile draws the type's placeholder plate.
  art?: string;
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
  const withArt = (entry: (typeof pack.monsters)[number]): BestiaryEntry => {
    const key = packArtKey("monster", entry.slug);
    return pack.artKeys.includes(key)
      ? { ...entry, art: packArtUrl(pack.id, key, pack.version) }
      : { ...entry };
  };
  const overrides = new Map(pack.monsters.map((entry) => [entry.slug, withArt(entry)]));
  // A pack that says nothing about type inherits the genre's answer for the
  // same slug, so a reskin never loses its thumbnail by leaving the field out.
  const merged = base.map((entry) => {
    const override = overrides.get(entry.slug);
    return override ? { ...override, type: override.type || entry.type } : entry;
  });
  const seen = new Set(base.map((entry) => entry.slug));
  return [...merged, ...pack.monsters.filter((entry) => !seen.has(entry.slug)).map(withArt)];
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

const SAVE_FIELDS = { str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma" } as const;

// An SRD 5.1 creature from the bundled creature table (src/lib/srd/
// srd-creatures.json), for a server with no content pack: without it a
// goblin fought as a challenge-1/4 guess (AC 12, 14 hit points, one untyped
// "Strike") where its block prints AC 15, 7 hit points and a scimitar. The
// table's lines are read as a pack row's are (parseMonster: the traits the
// engine plays, a breath weapon, spellcasting, reactions and legendary
// actions), and its attacks, Multiattack and saves are the table's own.
// With the pack, its corrected rows answer (pack-corrections.ts), as before.
function fromSrdTable(ref: string, slug: string): { name: string; slug: string; stats: EnemyStats } | null {
  if (getContentDb()) {
    return null;
  }
  const creature = SRD_CREATURES.find((entry) => entry.slug === slug) ?? findNamed(SRD_CREATURES, ref, (entry) => [entry.name]);
  return creature ? { name: creature.name, slug: creature.slug, stats: tableStats(creature) } : null;
}

function tableStats(creature: SrdCreature): EnemyStats {
  const pb = proficiencyBonus(Math.max(1, creature.cr));
  const sectioned = (label: string) =>
    creature.traits
      .filter((line) => line.startsWith(`${label}: `))
      .map((line) => line.slice(label.length + 2))
      .map((line) => ({ name: line.slice(0, Math.max(0, line.indexOf(". "))), desc: line.slice(line.indexOf(". ") + 2) }));
  const row: Record<string, unknown> = {
    name: creature.name,
    slug: creature.slug,
    size: creature.size,
    type: creature.type,
    armor_class: creature.ac,
    hit_points: creature.hp,
    speed: creature.speeds,
    senses: senseWords(creature.senses),
    damage_resistances: creature.resist ?? "",
    damage_immunities: creature.immune ?? "",
    damage_vulnerabilities: creature.vulnerable ?? "",
    condition_immunities: creature.conditionImmune ?? "",
    cr: creature.cr,
    actions: [],
    special_abilities: creature.traits
      .filter((line) => !/^(?:Reaction|Legendary action): /.test(line))
      .map((line) => ({ name: line.slice(0, Math.max(0, line.indexOf(": "))), desc: line.slice(line.indexOf(": ") + 2) })),
    reactions: sectioned("Reaction"),
    legendary_actions: sectioned("Legendary action"),
  };
  for (const [ability, field] of Object.entries(SAVE_FIELDS) as Array<[keyof typeof SAVE_FIELDS, string]>) {
    const score = creature.abilities[ability];
    row[field] = score;
    row[`${field}_save`] = creature.saves?.includes(ability) ? Math.floor((score - 10) / 2) + pb : null;
  }
  // No printed block: the table keeps an attack's numbers, not its line.
  const stats = parseMonster(row, creature.cr);
  delete stats.printed;
  return {
    ...stats,
    attacks: creature.attacks.map(enemyAttackOf),
    attacksPerTurn: creature.attacksPerTurn ?? 1,
    ...(creature.routines ? { routines: creature.routines } : {}),
    // A challenge 0 creature with an attack is worth 10 XP (SRD 5.1,
    // Challenge); the row above carries the attacks only here.
    xp: creature.cr === 0 && creature.attacks.length ? xpForCr(0) : stats.xp,
  };
}

// Resolves a monster reference: a hand-built monster by its unambiguous
// slug, then an exact Open5e slug, then an SRD creature of the bundled
// table by its slug or name, then a catalog reskin name, then an Open5e
// name search, and finally a hand-built monster by name. Degrades to
// synthesized stats for a catalog slug that is neither in the content pack
// nor in the table.
//
// The two homebrew lookups sit at opposite ends on purpose. "homebrew:<id>"
// names one row and nothing else, so it wins outright. A NAME is ambiguous,
// and a DM who happens to have built something called "Goblin" must not
// thereby change what every existing campaign means by a goblin, so the
// published monsters answer first and the hand-built one is the fallback.
//
// `userId` is whose homebrew to consider: the campaign owner, threaded from
// the rim. Without it this behaves exactly as it did before homebrew
// monsters existed.
// `userIds` is whose hand-built monsters count: at a table, everyone who
// runs it (src/lib/db/homebrew.ts tableAuthors), so a monster any DM seat
// prepared answers to its name whichever seat starts the fight. `userId` is
// one author, for a workshop's own shelf.
export function resolveMonster(
  ref: string,
  setting: SettingRef,
  options: { userId?: string; userIds?: string[] } = {},
): ResolvedMonster | null {
  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }
  const authors = [...new Set([...(options.userIds ?? []), ...(options.userId ? [options.userId] : [])].filter(Boolean))];

  if (authors.length && trimmed.startsWith("homebrew:")) {
    const own = findTableMonster(authors, trimmed);
    return own
      ? { slug: own.slug, baseName: own.draft.name, reskinName: null, stats: own.draft.stats }
      : null;
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

  // No pack row: an SRD creature fights with its bundled block.
  const table = fromSrdTable(trimmed, slugified);
  if (table) {
    return {
      slug: table.slug,
      baseName: table.name,
      reskinName: reskinFor(setting, table.slug)?.name ?? null,
      stats: table.stats,
    };
  }

  const catalogMatch = bestiaryFor(setting).find(
    (entry) => textKey(entry.name) === textKey(trimmed),
  );
  if (catalogMatch) {
    const content = fromContent(catalogMatch.slug) ?? fromSrdTable(catalogMatch.slug, catalogMatch.slug);
    return {
      slug: catalogMatch.slug,
      baseName: content?.name ?? catalogMatch.name,
      reskinName: catalogMatch.name,
      stats: content?.stats ?? synthesizeStats(catalogMatch.cr),
    };
  }

  // A published monster of exactly this name, then the table's own monster
  // of exactly this name, and only then the search's nearest published one:
  // a hand-built "Brassbound Tidewarden" is not whatever the search finds first.
  const searched = searchMonsters({ q: trimmed, limit: 5 });
  const exact = searched.find((entry) => textKey(entry.name) === textKey(trimmed));
  const own = authors.length && !(exact && exact.source === "open5e") ? findTableMonster(authors, trimmed) : null;
  if (own) {
    return { slug: own.slug, baseName: own.draft.name, reskinName: null, stats: own.draft.stats };
  }
  const best = exact ?? searched.find((entry) => entry.source === "open5e");
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

// What a roster line names a monster by: its own name when that name finds
// it again, else its ref. resolveMonster reads a published monster's name
// before a hand-built one's, so a homebrew construct called "Bandit" written
// by name would deploy the rulebook bandit.
export function rosterLabel(
  ref: string,
  name: string,
  setting: SettingRef,
  options: { userId?: string; userIds?: string[] } = {},
): string {
  const exact = resolveMonster(ref, setting, options);
  const byName = resolveMonster(name, setting, options);
  return exact && byName && byName.slug === exact.slug ? name : ref;
}
