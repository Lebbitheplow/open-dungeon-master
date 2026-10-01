// The rows a character is judged against, looked up: the bundled tables,
// the content pack, and the homebrew of whoever owns the table. This is the
// half of the legality check that reads a database; the rules themselves are
// pure (src/lib/srd/sheet-legality.ts) and are handed what this finds.
import {
  listArchetypes,
  listBackgrounds,
  listClasses,
  listRaces,
  searchFeats,
  searchSpells,
  spellNameMatches,
} from "@/lib/content";
import { getContentDb } from "@/lib/content/db";
import { packRaceOptions, srdRaceFor } from "@/lib/content/race-options";
import {
  mergedBackgroundOptions,
  packClassOptions,
  srdClassOptions,
  srdRaceOptions,
  type ContentRow,
} from "@/lib/characters/options";
import { openAbilityPool, openWealthRoll } from "@/lib/db/creation-rolls";
import { defaultRng } from "@/lib/dice";
import { costToCopper } from "@/lib/dm/shop-logic";
import type { GameSettings } from "@/lib/schemas/game-settings";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import authoredFeatsJson from "@/lib/srd/authored-feats.json";
import { bundledSubclassName } from "@/lib/srd/features";
import { srdRaceId } from "@/lib/srd/race-id";
import { checklistSpell } from "@/lib/srd/spell-lists";
import { bundledSpellSchool } from "@/lib/srd/spell-facts";
import {
  bundledPriceCopper,
  looksMagical,
  type ItemPrice,
  type PriceLookup,
} from "@/lib/srd/starting-wealth";
import type {
  BackgroundGrants,
  ClassGrants,
  Door,
  FeatFacts,
  LegalityContext,
  RaceGrants,
  SpellFacts,
} from "@/lib/srd/legality/types";

const lower = (value: string) => value.trim().toLowerCase();
const AUTHORED_FEATS = (authoredFeatsJson as { feats: FeatFacts[] }).feats;

// Only the variant human is handed a feat by its race.
function racialFeats(raceId: string): number {
  return srdRaceId(raceId) === "variant_human" ? 1 : 0;
}

// ---- classes, races, backgrounds ----

export function classGrantsFor(classId: string): ClassGrants | null {
  const id = lower(classId);
  // The bundled row first: it is the one the engines' own tables are keyed
  // by, and the pack's copy of an SRD class says the same in prose.
  const bundled = srdClassOptions().find((option) => option.id === id);
  if (bundled) {
    return bundled;
  }
  const rows = listClasses({ limit: 200 }) as ContentRow[];
  return packClassOptions(rows).find((option) => lower(option.id) === id) ?? null;
}

// Every row a race id may mean, the likeliest first. A content pack can
// carry a third-party race under the slug a bundled one uses (Tome of
// Heroes' drow beside the SRD family's), and a sheet built from the bundled
// list holds the bundled id, so both readings are offered and the sheet is
// judged against the one it fits.
export function raceCandidatesFor(raceId: string, homebrewOwnerId?: string): RaceGrants[] {
  const id = raceId.trim();
  if (!id) {
    return [];
  }
  const found: RaceGrants[] = [];
  const rows = listRaces({ limit: 200, userId: homebrewOwnerId });
  const packed = rows.length
    ? packRaceOptions(
        rows.map((row) => ({
          slug: row.slug,
          name: row.name,
          documentSlug: row.documentSlug,
          data: row.data,
        })),
        [id],
      ).find((option) => option.id === id)
    : undefined;
  if (packed) {
    found.push({ ...packed, feats: racialFeats(packed.id) });
  }
  const bundled = srdRaceFor(id);
  const option = bundled ? srdRaceOptions().find((entry) => entry.id === bundled.id) : undefined;
  if (option) {
    found.push({ ...option, id, feats: racialFeats(option.id) });
  }
  return found;
}

export function raceGrantsFor(raceId: string, homebrewOwnerId?: string): RaceGrants | null {
  return raceCandidatesFor(raceId, homebrewOwnerId)[0] ?? null;
}

export function backgroundGrantsFor(
  backgroundId: string,
  homebrewOwnerId?: string,
): BackgroundGrants | null {
  const id = backgroundId.trim();
  if (!id) {
    return null;
  }
  const rows = listBackgrounds({ limit: 200, userId: homebrewOwnerId }) as ContentRow[];
  const options = mergedBackgroundOptions(rows);
  return (
    options.find((option) => option.id === id) ??
    options.find((option) => lower(option.id).replace(/-/g, "_") === lower(id).replace(/-/g, "_")) ??
    null
  );
}

// ---- prices ----

let priceIndex: Map<string, ItemPrice> | null = null;

const priceKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\(\s*\d+\s*\)\s*$/, " ")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();

// Name to price, built once from the pack's items. A name the pack lists as
// mundane gear is mundane, whatever else shares it (a Potion of Healing is
// both a magic item row and a 50 gp gear row); a name it lists only as a
// magic item is one.
function packPrices(): Map<string, ItemPrice> {
  if (priceIndex) {
    return priceIndex;
  }
  const index = new Map<string, ItemPrice>();
  const db = getContentDb();
  if (db) {
    const rows = db.prepare(`SELECT name, kind, cost FROM items`).all() as Array<{
      name: string;
      kind: string;
      cost: string | null;
    }>;
    for (const row of rows) {
      const key = priceKey(row.name);
      if (!key) {
        continue;
      }
      const magic = row.kind === "magic_item";
      const copper = magic ? null : costToCopper(row.cost ?? "");
      const held = index.get(key);
      if (!held || (held.magic && !magic) || (held.copper === null && copper !== null && !magic)) {
        index.set(key, { copper, magic });
      }
    }
  }
  priceIndex = index;
  return index;
}

export const catalogPrices: PriceLookup = (name) => {
  const bundled = bundledPriceCopper(name);
  if (bundled !== null && !looksMagical(name)) {
    return { copper: bundled, magic: false };
  }
  const packed = packPrices().get(priceKey(name));
  if (packed) {
    return packed;
  }
  return { copper: bundled, magic: looksMagical(name) };
};

// ---- spells, feats, subclasses ----

export function spellFactsFor(name: string, homebrewOwnerId?: string): SpellFacts | null {
  const wanted = name.trim();
  if (!wanted) {
    return null;
  }
  // What is published answers first; the table owner's homebrew only for a
  // name nobody published.
  const published = searchSpells({ q: wanted, limit: 20 }).find((entry) =>
    spellNameMatches(entry, wanted),
  );
  const listed = checklistSpell(wanted);
  if (published || listed) {
    return {
      name: published?.name ?? listed!.name,
      level: published?.level ?? listed!.level,
      classes: [...new Set([...(published?.classes ?? []), ...(listed?.classes ?? [])].map(lower))],
      school: published?.school ? lower(published.school) : bundledSpellSchool(published?.name ?? listed!.name),
    };
  }
  if (!homebrewOwnerId) {
    return null;
  }
  const brewed = searchSpells({ q: wanted, userId: homebrewOwnerId, limit: 20 }).find(
    (entry) => entry.source === "homebrew" && spellNameMatches(entry, wanted),
  );
  return brewed
    ? { name: brewed.name, level: brewed.level, classes: brewed.classes.map(lower), school: brewed.school ? lower(brewed.school) : null }
    : null;
}

export function featFactsFor(name: string, homebrewOwnerId?: string): FeatFacts | null {
  const wanted = lower(name);
  if (!wanted) {
    return null;
  }
  const authored = AUTHORED_FEATS.find((feat) => lower(feat.name) === wanted);
  if (authored) {
    return { name: authored.name, prerequisite: authored.prerequisite ?? "" };
  }
  const found = searchFeats({ q: name.trim(), limit: 50, userId: homebrewOwnerId }).find(
    (entry) => lower(entry.name) === wanted,
  );
  return found
    ? { name: found.name, prerequisite: String(found.data.prerequisite ?? "") }
    : null;
}

export function subclassIsOffered(
  classId: string,
  name: string,
  homebrewOwnerId?: string,
): boolean {
  if (bundledSubclassName(classId, name)) {
    return true;
  }
  const wanted = lower(name);
  return listArchetypes(classId, { limit: 200, userId: homebrewOwnerId }).some(
    (entry) => lower(entry.name) === wanted || lower(entry.slug) === wanted,
  );
}

// ---- the context ----

export type ContextInput = {
  door: Door;
  level: number;
  sheet: Pick<CreateSheetInput, "class" | "race" | "background">;
  // Whoever is making the character: their open rolls are read.
  userId: string;
  // The table, when there is one: its settings and its owner's homebrew.
  campaign?: { id: string; ownerUserId: string; gameSettings: GameSettings } | null;
  baseline?: { sheet: CreateSheetInput; level: number } | null;
};

export function legalityContextsFor(input: ContextInput): LegalityContext[] {
  const base = legalityContextFor(input);
  const races = raceCandidatesFor(input.sheet.race, input.campaign?.ownerUserId);
  return races.length ? races.map((race) => ({ ...base, race })) : [base];
}

export function legalityContextFor(input: ContextInput): LegalityContext {
  const owner = input.campaign?.ownerUserId;
  const settings = input.campaign?.gameSettings;
  const made = input.door === "table" || (input.door === "library" && !input.baseline);
  return {
    door: input.door,
    level: input.level,
    hpMethod: settings ? (settings.hpMethod ?? "average") : null,
    startingWealth: settings?.startingWealth ?? "equipment",
    classOf: classGrantsFor,
    race: raceGrantsFor(input.sheet.race, owner),
    background: backgroundGrantsFor(input.sheet.background, owner),
    baseline: input.baseline ?? null,
    abilityPool: made ? (openAbilityPool(input.userId)?.totals ?? null) : null,
    wealthRoll:
      input.door === "table" && input.campaign && settings?.startingWealth === "rolled"
        ? (openWealthRoll(input.userId, input.campaign.id, input.sheet.class)?.gold ?? null)
        : null,
    priceOf: catalogPrices,
    spellOf: (name) => spellFactsFor(name, owner),
    featOf: (name) => featFactsFor(name, owner),
    subclassOffered: (classId, name) => subclassIsOffered(classId, name, owner),
    rollDie: defaultRng,
  };
}
