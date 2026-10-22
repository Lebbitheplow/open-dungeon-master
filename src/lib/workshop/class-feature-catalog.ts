// Every class and subclass feature the bundled tables carry, for the
// workshop's class editor to borrow from: a DM building a "Spellblade" picks
// the fighter's Extra Attack or the wizard's Arcane Recovery instead of
// retyping it, and the row keeps the name the engines run it by. Its own
// module, so the help text it reads stays out of the workshop's first load:
// only the class editor (loaded when opened) imports it.

import { describeFeature } from "@/lib/help";
import { classFeaturesFor } from "@/lib/srd/features";
import { FEATURE_CLASSES, subclassFeatureCatalog, type CatalogFeature } from "@/lib/workshop/feature-catalog";

let cached: CatalogFeature[] | null = null;

export function classFeatureCatalog(): CatalogFeature[] {
  if (cached) {
    return cached;
  }
  const own: CatalogFeature[] = FEATURE_CLASSES.flatMap((classId) =>
    classFeaturesFor(classId, "", 20).map((feature) => ({
      classId,
      subclass: "",
      level: feature.level ?? 1,
      name: feature.name,
      text: describeFeature(classId, "", feature.name) ?? "",
    })),
  );
  cached = [...own, ...subclassFeatureCatalog()];
  return cached;
}
