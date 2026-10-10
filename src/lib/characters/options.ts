// The rows a character is built from: every race, class and background the
// bundled data and the content pack offer, in one shape. The character
// builder draws its pickers from these and the server reads the same rows to
// check what a request claims (src/lib/characters/catalog.ts), so the screen
// and the rule cannot drift apart. Pure functions on plain data: no React,
// no database.
import {
  backgroundMechanics,
  classMechanics,
  type ClassMechanics,
  type RaceMechanics,
} from "@/lib/content/mechanics";
import { CUSTOM_BACKGROUNDS } from "@/lib/backgrounds";
import { CUSTOM_CLASSES } from "@/lib/classes";
import type { Genre } from "@/lib/schemas/game-settings-options";
import { SRD_BACKGROUNDS, SRD_CLASSES, SRD_RACES } from "@/lib/srd";
import { resolveBackgroundGear } from "@/lib/srd/adventuring-gear";

// `source` is the book an entry comes from, by title ("Tome of Heroes"), and
// `documentSlug` its pack document; both absent on bundled rows. The pickers
// group and label by them (issue #116).
export type RaceOption = {
  id: string;
  name: string;
  note: string;
  // The pack row behind a content-pack race, when its id is not the slug
  // (src/lib/content/race-options.ts optionIdFor).
  slug?: string;
  documentSlug?: string;
  source?: string;
} & RaceMechanics;
export type ClassOption = { id: string; name: string } & ClassMechanics & {
    documentSlug?: string;
    source?: string;
    // Catalog-only extras; absent on SRD and Open5e rows.
    genres?: Genre[];
    blurb?: string;
    knownCaster?: boolean;
    castingLabel?: string | null;
    spellListFrom?: string | null;
    // The content pack's write-up, shown under the class select.
    desc?: string;
    // Secret languages the class teaches (Druidic, Thieves' Cant).
    languages?: string[];
  };
export type BackgroundOption = {
  id: string;
  name: string;
  skills: string[];
  // A pick of skills on top of the fixed ones (a pack artisan's "either
  // Insight or History").
  skillChoice?: { count: number; from: string[] };
  // Grants beyond skills.
  tools?: string[];
  languages?: number;
  // Languages the background names outright (a pack forest dweller's Sylvan).
  knownLanguages?: string[];
  // The kit, without its coin: the purse is money, not an item.
  equipment?: string[];
  // The background's starting coin in gold pieces.
  purse?: number;
  // Catalog-only extras; absent on Open5e rows.
  genres?: Genre[];
  blurb?: string;
  // The named feature the background grants, and what it does.
  feature?: string;
  featureDesc?: string;
  // The content pack's write-up, shown under the background select.
  desc?: string;
  documentSlug?: string;
  source?: string;
};

export type ContentRow = {
  slug: string;
  name: string;
  source: string;
  documentSlug: string;
  // The document's title, as the content API serves it.
  document?: string;
  data: Record<string, unknown>;
};

// A background's kit names its coin among its items ("15 gp", "a belt pouch
// containing 10 gp"). The coin is the character's starting gold; what held
// it stays in the pack.
export function splitPurse(kit: string[] | undefined): { equipment: string[]; purse: number } {
  let purse = 0;
  const equipment: string[] = [];
  for (const line of kit ?? []) {
    const bare = /^\s*(\d[\d,]*)\s*gp\s*$/i.exec(line);
    if (bare) {
      purse += Number(bare[1].replace(/,/g, ""));
      continue;
    }
    const held = /^(.*?)\s*(?:containing|with|holding)\s+(\d[\d,]*)\s*gp\b.*$/i.exec(line);
    if (held) {
      purse += Number(held[2].replace(/,/g, ""));
      const container = held[1].trim().replace(/[,;]$/, "");
      if (container) {
        equipment.push(container);
      }
      continue;
    }
    equipment.push(line);
  }
  // The kit as catalog items, the way a class kit arrives: a pack opened
  // into its contents, counts as quantities, the book's names ("Clothes,
  // Common"); a line the catalog does not know stays as written
  // (src/lib/srd/adventuring-gear.ts, issue #113).
  return { equipment: resolveBackgroundGear(equipment), purse };
}

export function srdRaceOptions(): RaceOption[] {
  return SRD_RACES.map((race) => ({
    id: race.id,
    name: race.name,
    speed: race.speed,
    asi: race.asi,
    // The bundled half-elf lists its free pick among its languages; the pick
    // is counted in bonusLanguages, so the placeholder is not a language.
    languages: race.languages.filter((language) => !/of your choice/i.test(language)),
    bonusLanguages: race.bonusLanguages ?? 0,
    traitsSummary: race.traits.join(" · "),
    traitNames: race.traits,
    choiceTraitNames: [],
    skills: race.skills,
    skillChoice: race.skillChoice,
    asiChoice: race.asiChoice,
    cantripChoice: race.cantripChoice,
    tools: race.tools,
    toolChoice: race.toolChoice,
    armor: race.armor,
    weapons: race.weapons,
    note: race.traits.join(" · "),
  }));
}

export function customClassOptions(): ClassOption[] {
  return CUSTOM_CLASSES.map((klass) => ({
    id: klass.id,
    name: klass.name,
    hitDie: klass.hitDie,
    saves: klass.saves,
    skillChoices: klass.skillChoices,
    armor: klass.armor,
    weapons: klass.weapons,
    tools: klass.tools ?? [],
    spellAbility: klass.spellAbility,
    casterType: klass.casterType,
    genres: klass.genres,
    blurb: klass.blurb,
    knownCaster: klass.knownCaster,
    castingLabel: klass.castingLabel,
    spellListFrom: klass.spellListFrom,
  }));
}

export function srdClassOptions(): ClassOption[] {
  return [
    ...SRD_CLASSES.map((klass) => ({
      id: klass.id,
      name: klass.name,
      blurb: klass.blurb,
      languages: klass.languages,
      hitDie: klass.hitDie,
      saves: klass.saves,
      skillChoices: klass.skillChoices,
      armor: klass.armor,
      weapons: klass.weapons,
      tools: klass.tools ?? [],
      spellAbility: klass.spellAbility,
      casterType: klass.casterType,
    })),
    ...customClassOptions(),
  ];
}

// The content pack's class rows beside the setting catalog. A pack row for a
// class the bundled SRD carries takes its numbers from the pack's text and
// its secret language and one-line pitch from the bundled entry, which Open5e
// says nothing about. Its training is the bundled entry's too, as the server
// reads it (catalog.ts classGrantsFor): the pack's druid armor is a sentence
// ("shields (druids will not wear armor or use shields made of metal)") that
// the sheet refuses and the no-metal rule cannot read.
export function packClassOptions(rows: ContentRow[]): ClassOption[] {
  const packOptions: ClassOption[] = rows.map((row) => {
    const bundled = SRD_CLASSES.find((klass) => klass.id === row.slug);
    return {
      id: row.slug,
      name: row.name,
      ...classMechanics(row.slug, row.data),
      ...(bundled
        ? { armor: bundled.armor, weapons: bundled.weapons, tools: bundled.tools ?? [] }
        : {}),
      desc: String(row.data?.desc ?? ""),
      blurb: bundled?.blurb,
      languages: bundled?.languages,
      documentSlug: row.documentSlug,
      source: row.document ?? row.documentSlug,
    };
  });
  const packIds = new Set(packOptions.map((option) => option.id));
  return [...packOptions, ...customClassOptions().filter((option) => !packIds.has(option.id))];
}

function customBackgroundOptions(): BackgroundOption[] {
  return CUSTOM_BACKGROUNDS.map((background) => ({
    id: background.id,
    name: background.name,
    skills: background.skills,
    tools: background.tools,
    languages: background.languages,
    ...splitPurse(background.equipment),
    genres: background.genres,
    blurb: background.blurb,
    feature: background.feature,
    featureDesc: background.featureDesc,
  }));
}

export function srdBackgroundOptions(): BackgroundOption[] {
  return [
    ...SRD_BACKGROUNDS.map((background) => ({
      id: background.id,
      name: background.name,
      skills: background.skills,
      tools: background.tools,
      languages: background.languages,
      ...splitPurse(background.equipment),
      blurb: background.blurb,
      feature: background.feature,
      featureDesc: background.featureDesc,
    })),
    ...customBackgroundOptions(),
  ];
}

// The content pack's backgrounds, added to the bundled list rather than
// replacing it. A pack row for a background the bundled SRD already carries
// (the wotc-srd acolyte, a third-party charlatan under the same slug) gives
// way to the bundled one, which is what grants the tools, languages, kit
// and feature; the pack's other backgrounds join after it with the write-up,
// feature text and grants their rows carry.
export function mergedBackgroundOptions(rows: ContentRow[]): BackgroundOption[] {
  const bundled = srdBackgroundOptions();
  const bundledIds = new Set(bundled.map((option) => option.id));
  const packBackgrounds: BackgroundOption[] = rows
    .filter((row) => !bundledIds.has(row.slug.toLowerCase().replace(/-/g, "_")))
    .map((row) => {
      const feature = String(row.data?.feature ?? "").trim();
      const featureDesc = String(row.data?.feature_desc ?? "").trim();
      const mechanics = backgroundMechanics(row.data);
      // A workshop background's kit is already catalog items, its coin its own.
      const grants = row.data?.grants as { purse?: unknown } | undefined;
      const kit =
        grants && typeof grants.purse === "number"
          ? { equipment: mechanics.equipment, purse: grants.purse }
          : splitPurse(mechanics.equipment);
      return {
        id: row.slug,
        name: row.name,
        ...mechanics,
        ...kit,
        desc: String(row.data?.desc ?? ""),
        ...(feature ? { feature } : {}),
        ...(featureDesc ? { featureDesc } : {}),
        documentSlug: row.documentSlug,
        source: row.document ?? row.documentSlug,
      };
    });
  const srdCount = SRD_BACKGROUNDS.length;
  return [...bundled.slice(0, srdCount), ...packBackgrounds, ...bundled.slice(srdCount)];
}
