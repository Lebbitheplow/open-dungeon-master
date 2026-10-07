import { raceMechanics, type RaceMechanics } from "@/lib/content/mechanics";
import { SRD_RACES, type SrdRace } from "@/lib/srd";
import { srdRaceId } from "@/lib/srd/race-id";
import { isEdition2024 } from "@/lib/content/edition";

// The content pack's race rows, turned into the shape the character builder
// works from. Three things happen here that raceMechanics alone cannot do:
//
// - A subrace row (Hill Dwarf under Dwarf) carries only what it adds, so its
//   parent's speed, languages and ability bumps are folded in. Without this a
//   pack Hill Dwarf had +1 Wisdom, no +2 Constitution, and spoke only Common.
// - A row the bundled SRD also describes (the wotc-srd rows, the expanded
//   pack's copies) takes its mechanics from
//   src/lib/srd/races.json, which is what actually grants skills, tools,
//   cantrips and free languages; the pack keeps its prose. A third-party row
//   that only shares a slug (Tome of Heroes' drow) is its own race.
// - Anything else is parsed from the pack's prose.
// - A parent whose rules require a subrace (the SRD's Dwarf, a gearforged
//   without its chassis) is not an option itself; its subraces are, unless a
//   stored character already sits on the parent (`keepIds`).
// - A 2024 species (src/lib/content/edition.ts) is not offered to the 2014
//   builder, again unless a stored character already names it.
// - A race the bundled documents print twice (the SRD's High Elf and the
//   expanded pack's Elf (High), rule for rule the same) is offered once, the
//   SRD's copy, unless a stored character sits on the other (issue #116).
// - A third-party row under a bundled race's slug (Tome of Heroes' Drow
//   beside the SRD drow) gets an id that carries its document, "toh-drow".
//   Every reader keys a race by srdRaceId(id): the dialog's trait list, the
//   innate spells, the hit point bonus, the server's trait grant. Under the
//   bare slug they all answered for the SRD drow (issue #115); under the
//   prefixed id none of them match, and the row's own rules stand.

// Content-pack slugs are kebab-case and the pack's own copies of SRD rows
// carry an "odm-" prefix; the bundled ids are snake_case.
export function canonicalRaceId(raceId: string): string {
  return srdRaceId(raceId);
}

export function srdRaceFor(raceId: string): SrdRace | null {
  const id = canonicalRaceId(raceId);
  return SRD_RACES.find((entry) => entry.id === id) ?? null;
}

export type RaceRow = {
  slug: string;
  name: string;
  documentSlug: string;
  // The document's title, when the caller has it ("Tome of Heroes").
  document?: string;
  data: Record<string, unknown>;
};

// The documents whose rows the bundled SRD tables describe, the SRD's first.
const BUNDLED_DOCUMENTS = ["wotc-srd", "odm-expanded"];
const isBundledDocument = (documentSlug: string) => BUNDLED_DOCUMENTS.includes(documentSlug);
const documentRank = (documentSlug: string) => {
  const rank = BUNDLED_DOCUMENTS.indexOf(documentSlug);
  return rank === -1 ? BUNDLED_DOCUMENTS.length : rank;
};

export type PackRaceOption = {
  id: string;
  name: string;
  note: string;
  // The pack row behind the option, for its write-up; differs from the id
  // only for a third-party row under a bundled slug (see optionIdFor).
  slug: string;
  documentSlug: string;
  // The book it comes from, by title.
  source: string;
} & RaceMechanics;

// The id the builder and the sheet use for a pack row. A stored character
// that already names the bare slug keeps it (`keepIds`), so an edit lands
// on the row it was built from; new characters get the prefixed id.
export function optionIdFor(
  row: Pick<RaceRow, "slug" | "documentSlug">,
  keepIds: ReadonlySet<string> = new Set(),
): string {
  const collides =
    !isBundledDocument(row.documentSlug) && srdRaceFor(row.slug) !== null && !keepIds.has(row.slug);
  return collides ? `${row.documentSlug}-${row.slug}` : row.slug;
}

const GRANT_KEYS = [
  "skills",
  "skillChoice",
  "asiChoice",
  "cantripChoice",
  "tools",
  "toolChoice",
  "armor",
  "weapons",
] as const;

function withParent(
  sub: RaceMechanics,
  subData: Record<string, unknown>,
  parent: RaceMechanics,
): RaceMechanics {
  const asi: RaceMechanics["asi"] = { ...parent.asi };
  for (const [ability, bonus] of Object.entries(sub.asi)) {
    const key = ability as keyof RaceMechanics["asi"];
    asi[key] = (asi[key] ?? 0) + (bonus ?? 0);
  }
  const ownSpeed = subData.speed !== undefined || Array.isArray(subData.traits);
  const ownLanguages = subData.languages !== undefined;
  const merged: RaceMechanics = {
    ...sub,
    asi,
    speed: ownSpeed ? sub.speed : parent.speed,
    languages: ownLanguages ? sub.languages : parent.languages,
    bonusLanguages: ownLanguages ? sub.bonusLanguages : parent.bonusLanguages,
    traitsSummary: [parent.traitsSummary, sub.traitsSummary].filter(Boolean).join(" · "),
    // The subrace is the parent's "choose one of these" already answered.
    traitNames: [
      ...parent.traitNames.filter((name) => !parent.choiceTraitNames.includes(name)),
      ...sub.traitNames,
    ],
  };
  const choice = ownLanguages ? sub.languageChoice : parent.languageChoice;
  if (choice) {
    merged.languageChoice = choice;
  } else {
    delete merged.languageChoice;
  }
  for (const key of GRANT_KEYS) {
    const value = sub[key] ?? parent[key];
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  // A gearforged's two picks and its human chassis's one are three picks.
  if (
    sub.asiChoice &&
    parent.asiChoice &&
    sub.asiChoice.amount === parent.asiChoice.amount &&
    !sub.asiChoice.from &&
    !parent.asiChoice.from
  ) {
    merged.asiChoice = { count: sub.asiChoice.count + parent.asiChoice.count, amount: sub.asiChoice.amount };
  }
  return merged;
}

function withSrd(parsed: RaceMechanics, srd: SrdRace): RaceMechanics {
  const merged: RaceMechanics = {
    speed: srd.speed,
    asi: srd.asi,
    languages: srd.languages.filter((language) => !/of your choice/i.test(language)),
    bonusLanguages: srd.bonusLanguages ?? 0,
    traitsSummary: parsed.traitsSummary || srd.traits.join(" · "),
    traitNames: parsed.traitNames,
    choiceTraitNames: parsed.choiceTraitNames,
  };
  for (const key of GRANT_KEYS) {
    if (srd[key] !== undefined) {
      (merged as Record<string, unknown>)[key] = srd[key];
    }
  }
  return merged;
}

// `keepIds` are rows offered even though their rules ask for a subrace: a
// character saved on a bare Dwarf before its subraces stood alone keeps its
// race in an edit instead of falling to the list's first row.
export function packRaceOptions(rows: RaceRow[], keepIds: Iterable<string> = []): PackRaceOption[] {
  const keptIds = new Set(keepIds);
  const idFor = (row: RaceRow) => optionIdFor(row, keptIds);
  const kept = (row: RaceRow) => keptIds.has(row.slug) || keptIds.has(idFor(row));
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  // The one copy offered of each race the bundled documents print twice.
  const copyOffered = new Map<string, RaceRow>();
  for (const row of rows) {
    if (!isBundledDocument(row.documentSlug) || !srdRaceFor(row.slug)) {
      continue;
    }
    const id = canonicalRaceId(row.slug);
    const held = copyOffered.get(id);
    if (!held || documentRank(row.documentSlug) < documentRank(held.documentSlug)) {
      copyOffered.set(id, row);
    }
  }
  const secondCopy = (row: RaceRow) => {
    const offeredCopy = copyOffered.get(canonicalRaceId(row.slug));
    return Boolean(offeredCopy) && offeredCopy !== row && isBundledDocument(row.documentSlug) && !kept(row);
  };
  const parsed = new Map<string, RaceMechanics>();
  const mechanicsFor = (row: RaceRow): RaceMechanics => {
    let mechanics = parsed.get(row.slug);
    if (!mechanics) {
      mechanics = raceMechanics(row.data);
      parsed.set(row.slug, mechanics);
    }
    return mechanics;
  };
  const parentSlugs = new Set(rows.map((row) => String(row.data.parent_slug ?? "")));
  const needsSubrace = (row: RaceRow) =>
    !kept(row) &&
    parentSlugs.has(row.slug) && (row.documentSlug === "wotc-srd" || mechanicsFor(row).choiceTraitNames.length > 0);
  const offered = (row: RaceRow) =>
    !needsSubrace(row) && !secondCopy(row) && (!isEdition2024(row.documentSlug) || kept(row));
  return rows.filter(offered).map((row) => {
    let mechanics = mechanicsFor(row);
    const parentSlug = String(row.data.parent_slug ?? "");
    const parent = parentSlug && parentSlug !== row.slug ? bySlug.get(parentSlug) : undefined;
    if (parent) {
      mechanics = withParent(mechanics, row.data, mechanicsFor(parent));
    }
    const srd = isBundledDocument(row.documentSlug) ? srdRaceFor(row.slug) : null;
    if (srd) {
      mechanics = withSrd(mechanics, srd);
    }
    if (!mechanics.languages.length) {
      mechanics = { ...mechanics, languages: ["Common"] };
    }
    return {
      id: idFor(row),
      name: row.name,
      ...mechanics,
      note: mechanics.traitsSummary,
      slug: row.slug,
      documentSlug: row.documentSlug,
      source: row.document ?? row.documentSlug,
    };
  });
}
