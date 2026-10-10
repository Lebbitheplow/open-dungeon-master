import { subclassFeatureDescription, subclassNamesFor, subclassTableFor } from "@/lib/srd/features";
import { effectsFor } from "@/lib/srd/feature-effects";
import { authoredFeatureTags, heldAuthored } from "@/lib/srd/authored-effects";

// Every subclass feature the bundled tables carry, for the workshop's
// subclass editor to borrow from: a DM building "Oath of Ash" picks the
// Champion's Improved Critical or the Oath of Vengeance's Vow of Enmity
// instead of retyping it, and the row keeps the name the engines key their
// effects by. Pure; the editor runs it in the browser.

export const FEATURE_CLASSES = [
  "barbarian", "bard", "cleric", "druid", "fighter", "monk",
  "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
] as const;

export type CatalogFeature = {
  classId: string;
  subclass: string;
  level: number;
  name: string;
  text: string;
};

let cached: CatalogFeature[] | null = null;

export function subclassFeatureCatalog(): CatalogFeature[] {
  if (cached) {
    return cached;
  }
  const out: CatalogFeature[] = [];
  for (const classId of FEATURE_CLASSES) {
    for (const subclass of subclassNamesFor(classId)) {
      const table = subclassTableFor(classId, subclass);
      for (const [level, names] of Object.entries(table?.levels ?? {})) {
        for (const name of names) {
          out.push({
            classId,
            subclass,
            level: Number(level),
            name,
            text: subclassFeatureDescription(classId, subclass, name) ?? "",
          });
        }
      }
    }
  }
  cached = out;
  return out;
}

// Whether a feature of this name, held by a character of this class, is one
// the engines run rather than one the DM reads: a rider, a defence, a spend
// or a reaction somewhere in feature-effects.ts or the authored layer.
export function engineRunsFeature(classId: string, name: string): string | null {
  const sheet = { class: classId, level: 20, features: [{ name, classId }] };
  const tag = authoredFeatureTags(sheet).get(name);
  if (tag) {
    return tag;
  }
  if (heldAuthored(sheet).length) {
    return "[server]";
  }
  return effectsFor({ class: classId, features: [{ name }] }).length ? "[server]" : null;
}
