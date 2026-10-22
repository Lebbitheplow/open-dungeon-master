// The genre classes' one-line rules text: the `d` beside each name in the
// six src/lib/classes/*-features.json catalogs. Kept out of every page's
// first load (issue 411): together the catalogs' text is about 24 KiB gzip,
// and a table holds one genre's classes or none. The names the grant tables
// need ride in feature-names.json, generated from the same catalogs.
//
// On the server every catalog is registered at once (feature-text-all.ts,
// which the DM prompt imports). In the browser a genre's catalog is fetched
// the first time a sheet holding one of its classes asks for a feature's
// text (useClassFeatureText), and classFeatureDescription answers null until
// it has landed.
//
// Import only data and pure modules here: client components reach it
// through src/lib/help.
import namesJson from "@/lib/classes/feature-names.json";
import { textKey } from "@/lib/language/text-logic";
import { workshopClassDef } from "@/lib/classes/workshop-registry";

export type RawFeature = { n: string; d: string };
export type FeaturesFile = {
  classes: Record<
    string,
    { levels: Record<string, RawFeature[]>; subclass: { name: string; levels: Record<string, RawFeature[]> } }
  >;
};

// Which catalog holds a class's text.
const CATALOG_OF: Record<string, string> = Object.fromEntries(
  Object.entries((namesJson as { classes: Record<string, { file: string }> }).classes).map(([classId, table]) => [
    classId,
    table.file,
  ]),
);

// One dynamic import per catalog, written out so a bundler makes each its
// own chunk.
const LOADERS: Record<string, () => Promise<unknown>> = {
  cyberpunk: () => import("@/lib/classes/cyberpunk-features.json"),
  "dark-fantasy": () => import("@/lib/classes/dark-fantasy-features.json"),
  horror: () => import("@/lib/classes/horror-features.json"),
  mystery: () => import("@/lib/classes/mystery-features.json"),
  "post-apocalyptic": () => import("@/lib/classes/post-apocalyptic-features.json"),
  steampunk: () => import("@/lib/classes/steampunk-features.json"),
};

const TEXT: Record<string, Record<string, string>> = {};
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

// A catalog's text by class, then by feature name. A subclass feature that
// shares a base feature's name keeps the subclass's line, as it always did.
export function registerFeatureText(file: FeaturesFile): void {
  for (const [classId, table] of Object.entries(file.classes)) {
    const descriptions: Record<string, string> = {};
    for (const features of [...Object.values(table.levels), ...Object.values(table.subclass.levels)]) {
      for (const feature of features) {
        descriptions[textKey(feature.n)] = feature.d;
      }
    }
    TEXT[classId] = descriptions;
  }
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

// Rules text for a custom class feature, or null: an SRD feature name needs
// no gloss (the model knows it), and in the browser a genre's text is null
// until its catalog has landed.
// A workshop class's words ride its registration (workshop-registry.ts).
export function classFeatureDescription(classId: string, featureName: string): string | null {
  const key = textKey(featureName);
  return TEXT[classId]?.[key] ?? workshopClassDef(classId)?.text[key] ?? null;
}

// Fetches the catalogs these classes' text lives in, once each. SRD and
// homebrew class ids have none to fetch. A fetch that fails is tried again
// by the next sheet that asks.
export function loadClassFeatureText(classIds: readonly string[]): Promise<void> {
  const catalogs = new Set<string>();
  for (const classId of classIds) {
    const catalog = CATALOG_OF[classId];
    if (catalog && !TEXT[classId]) {
      catalogs.add(catalog);
    }
  }
  return Promise.all(
    [...catalogs].map((catalog) => {
      let job = pending.get(catalog);
      if (!job) {
        job = LOADERS[catalog]()
          .then((loaded) => registerFeatureText(((loaded as { default?: unknown }).default ?? loaded) as FeaturesFile))
          .catch(() => {
            pending.delete(catalog);
          });
        pending.set(catalog, job);
      }
      return job;
    }),
  ).then(() => undefined);
}

// For useSyncExternalStore: a number that changes whenever text arrives.
export function featureTextVersion(): number {
  return version;
}

export function onFeatureText(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
