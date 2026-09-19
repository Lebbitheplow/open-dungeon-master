"use client";

import { GameIcon } from "@/components/ui/GameIcon";
import type { IconRef } from "@/lib/icons";
import type { EditorKind } from "@/app/workshop/homebrew/types";

// The painted face of a piece of homebrew. An item or a spell named after
// something in the books gets that painting; anything else falls back to its
// family (a weapon, an evocation), and a kind with no family at all shows the
// homebrew glyph underneath, so every row has a face.

export const KIND_GLYPHS: Record<EditorKind, string> = {
  item: "tab-loot",
  spell: "rest-spell-slot",
  feat: "rest-inspiration",
  background: "tab-journal",
  race: "tab-characters",
  archetype: "rest-level-up",
};

const ITEM_FAMILIES: Record<string, string> = {
  weapon: "item-weapon",
  armor: "item-armor",
  gear: "item-gear",
  magic_item: "item-magic-item",
};

export function homebrewIcon(kind: string, name: string, data: Record<string, unknown>): IconRef | null {
  if (kind === "item") {
    return { kind: "item", key: name, family: ITEM_FAMILIES[String(data.itemKind ?? "gear")] ?? "item-gear" };
  }
  if (kind === "spell") {
    const school = String(data.school ?? "").toLowerCase();
    return { kind: "spell", key: name, family: school ? `spell-${school}` : null };
  }
  if (kind === "feat") {
    return { kind: "feat", key: name };
  }
  if (kind === "archetype" && data.classSlug) {
    return { kind: "family", key: `class-${String(data.classSlug)}` };
  }
  return null;
}

export function HomebrewPlate({ kind, name, data }: { kind: string; name: string; data: Record<string, unknown> }) {
  const icon = homebrewIcon(kind, name, data);
  return (
    <span className="relative grid size-12 shrink-0 place-items-center rounded-lg border border-amber-500/25 bg-stone-950/70">
      <GameIcon icon={{ kind: "glyph", key: KIND_GLYPHS[kind as EditorKind] ?? "system-homebrew" }} size="size-9" />
      {icon ? <GameIcon icon={icon} size="size-9" className="absolute" /> : null}
    </span>
  );
}
