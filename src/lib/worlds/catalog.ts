// What a pack may reskin, as lists a picker can offer.
//
// A pack renames things the engine already has, by id (races, classes,
// backgrounds) or by canonical name (spells, items, features). Pick, do not
// type: a person choosing "Dwarf (Hill)" from a list cannot misspell
// "hill_dwarf", and the validator never has to tell them. Spells, items and
// monsters are searched live through /api/content, because the content pack
// is a database and not a bundle; these are the catalogs that ship in the
// app itself.
//
// Client-safe: reads the same SRD JSON the character builder ships.
import { ALL_CLASSES, SRD_BACKGROUNDS, SRD_RACES } from "@/lib/srd";
import { CUSTOM_BACKGROUNDS } from "@/lib/backgrounds";
import { CUSTOM_CLASS_FEATURES } from "@/lib/classes";
import classFeaturesJson from "@/lib/srd/class-features.json";
import subclassesJson from "@/lib/srd/subclasses.json";

export type CatalogOption = { value: string; label: string };

export const RACE_OPTIONS: CatalogOption[] = SRD_RACES.map((race) => ({
  value: race.id,
  label: race.name,
})).sort((a, b) => a.label.localeCompare(b.label));

// Casters get a casting label ("Programs", "Prayers"); a non-caster must not.
export const CLASS_OPTIONS: Array<CatalogOption & { caster: boolean }> = ALL_CLASSES.map(
  (klass) => ({
    value: klass.id,
    label: klass.name,
    caster: klass.spellAbility !== null,
  }),
).sort((a, b) => a.label.localeCompare(b.label));

export const BACKGROUND_OPTIONS: CatalogOption[] = [
  ...SRD_BACKGROUNDS.map((entry) => ({ value: entry.id, label: entry.name })),
  ...CUSTOM_BACKGROUNDS.map((entry) => ({ value: entry.id, label: entry.name })),
].sort((a, b) => a.label.localeCompare(b.label));

export function isCasterClass(id: string): boolean {
  return CLASS_OPTIONS.find((option) => option.value === id)?.caster ?? false;
}

export function catalogLabel(options: readonly CatalogOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

// Every feature name a sheet can carry from the tables in src/lib/srd: class
// features by level, subclass features, the genre classes' own, and the
// racial traits. One entry per name, sorted, with the class or race it came
// from so a picker can say "Sneak Attack (Rogue)" and a person can find it.
type RawTable = {
  levels: Record<string, string[]>;
  subclasses?: Array<{ name: string; levels: Record<string, string[]> }>;
};

// subclasses.json stores each feature as { n: name, d: rules text }.
type AuthoredSubclass = { name: string; levels: Record<string, Array<{ n: string }>> };

function collect(into: Map<string, string>, names: string[], source: string) {
  for (const name of names) {
    if (!into.has(name)) into.set(name, source);
  }
}

function buildFeatureOptions(): CatalogOption[] {
  const found = new Map<string, string>();
  const srd = (classFeaturesJson as { classes: Record<string, RawTable> }).classes;
  const classNames = new Map(ALL_CLASSES.map((klass) => [klass.id, klass.name]));
  for (const [classId, table] of Object.entries(srd)) {
    const label = classNames.get(classId) ?? classId;
    for (const names of Object.values(table.levels)) collect(found, names, label);
  }
  const authored = (subclassesJson as { classes: Record<string, AuthoredSubclass[]> }).classes;
  for (const [classId, entries] of Object.entries(authored)) {
    const label = classNames.get(classId) ?? classId;
    for (const entry of entries) {
      for (const features of Object.values(entry.levels)) {
        collect(found, features.map((feature) => feature.n), `${label}, ${entry.name}`);
      }
    }
  }
  for (const [classId, table] of Object.entries(CUSTOM_CLASS_FEATURES)) {
    const label = classNames.get(classId) ?? classId;
    for (const names of Object.values(table.levels)) collect(found, names, label);
    for (const sub of table.subclasses) {
      for (const names of Object.values(sub.levels)) collect(found, names, `${label}, ${sub.name}`);
    }
  }
  for (const race of SRD_RACES) {
    collect(found, race.traits, race.name);
  }
  return [...found.entries()]
    .map(([value, source]) => ({ value, label: `${value} (${source})` }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

let featureOptions: CatalogOption[] | null = null;

export function FEATURE_OPTIONS(): CatalogOption[] {
  return (featureOptions ??= buildFeatureOptions());
}

export const ALIGNMENT_OPTIONS: CatalogOption[] = [
  { value: "LG", label: "Lawful good" },
  { value: "NG", label: "Neutral good" },
  { value: "CG", label: "Chaotic good" },
  { value: "LN", label: "Lawful neutral" },
  { value: "N", label: "Neutral" },
  { value: "CN", label: "Chaotic neutral" },
  { value: "LE", label: "Lawful evil" },
  { value: "NE", label: "Neutral evil" },
  { value: "CE", label: "Chaotic evil" },
];

// The eight genres a pack may sit on, minus custom, with the labels the
// campaign wizard uses.
export const GENRE_OPTIONS: CatalogOption[] = [
  { value: "high_fantasy", label: "High fantasy" },
  { value: "dark_fantasy", label: "Dark fantasy" },
  { value: "mystery", label: "Mystery" },
  { value: "horror", label: "Horror" },
  { value: "cyberpunk", label: "Cyberpunk" },
  { value: "steampunk", label: "Steampunk" },
  { value: "post_apocalyptic", label: "Post-apocalyptic" },
];
