"use client";

import { useEffect, useSyncExternalStore } from "react";
import { featureTextVersion, loadClassFeatureText, onFeatureText } from "@/lib/classes/feature-text";

// Asks for the rules text of these classes' features (src/lib/classes/
// feature-text.ts) and renders again once it lands, so a genre class's
// feature explains itself on the sheet without its catalog riding in the
// first load. Returns a number that changes as text arrives, for a memo that
// reads describeFeature. The server snapshot is 0: the page is rendered
// there without the text, and the browser's first render matches it.
export function useClassFeatureText(classIds: ReadonlyArray<string | null | undefined>): number {
  const version = useSyncExternalStore(onFeatureText, featureTextVersion, () => 0);
  const wanted = [...new Set(classIds.filter((id): id is string => Boolean(id)))].sort().join(" ");
  useEffect(() => {
    if (wanted) {
      void loadClassFeatureText(wanted.split(" "));
    }
  }, [wanted]);
  return version;
}
