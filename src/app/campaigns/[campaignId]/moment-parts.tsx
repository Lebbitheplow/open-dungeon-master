"use client";

import { useEffect } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { CharacterPortrait } from "@/lib/ui";

// What the table's moments share (Moments.tsx, ArrivalBanner.tsx): a
// character's face and Escape as a way out. Kept apart so the lobby's
// banner does not bring the table's set pieces with it.

export function Face({ sheet }: { sheet: Pick<CharacterSheet, "name" | "race" | "class" | "gender" | "portrait"> }) {
  return sheet.portrait ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={sheet.portrait.url} alt={sheet.name} />
  ) : (
    <CharacterPortrait look={{ race: sheet.race, class: sheet.class, gender: sheet.gender }} alt={sheet.name} size="size-full" />
  );
}

// A set piece covers the table, and its only way out was a click on the
// stage itself, which a keyboard cannot reach: Escape skips it too. Taken in
// the capture phase and stopped there, so a dialog under the moment does not
// close with it.
export function useEscapeToSkip(active: boolean, onSkip: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onSkip();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, onSkip]);
}
