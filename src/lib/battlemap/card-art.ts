import { iconSlug, isPainted, iconPath, type IconRef } from "@/lib/icons";
import { weaponNamed } from "@/lib/srd/weapons";
import itemArtwork from "./card-art.json";

const ITEM_ART = new Map<string, string>(Object.entries(itemArtwork));

// The Hand has room for rectangular art; inventory and shop icons stay compact.
// Unmapped or unavailable paintings keep the existing item/family fallback.
// A weapon is found by its whole name as weaponNamed reads it, so a shop's
// "Crossbow, hand" (the book's order) or a "Longsword +1" shows its weapon.
export function cardArtwork(icon: IconRef): IconRef {
  if (icon.kind !== "item") return icon;
  const key = ITEM_ART.get(iconSlug(weaponNamed(icon.key)?.name ?? icon.key));
  return key && isPainted(iconPath("action", key)) ? { kind: "action", key, family: icon.family } : icon;
}
