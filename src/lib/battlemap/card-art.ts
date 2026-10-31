import { iconSlug, isPainted, iconPath, type IconRef } from "@/lib/icons";
import { weaponNamed } from "@/lib/srd/weapons";
import itemArtwork from "./card-art.json";

const ITEM_ART = new Map<string, string>(Object.entries(itemArtwork));
const GENRE_ACTIONS = new Set([
  "attack",
  "cast",
  "dash",
  "disengage",
  "dodge",
  "help",
  "hide",
  "ready",
  "grapple",
  "shove",
  "use-object",
  "end-turn",
  "search",
  "escape",
  "stand-up",
]);

// The five non-fantasy presets have their own core-action paintings. Dark
// fantasy deliberately stays on the medieval set for now, and high fantasy,
// custom and an unknown value use the original action art as their fallback.
const GENRE_VARIANTS = new Set(["mystery", "horror", "cyberpunk", "steampunk", "post_apocalyptic"]);

function genreActionKey(key: string, genre?: string | null): string | null {
  // The Hand deals unarmed-strike for both regular and bonus punches. The
  // genre set's legacy attack filename now depicts that fist, not a weapon.
  const slug = iconSlug(key);
  const action = slug === "unarmed-strike" ? "attack" : slug;
  return genre && GENRE_VARIANTS.has(genre) && GENRE_ACTIONS.has(action) ? `${iconSlug(genre)}-${action}` : null;
}

// The Hand has room for rectangular art; inventory and shop icons stay compact.
// Unmapped or unavailable paintings keep the existing item/family fallback.
// A weapon is found by its whole name as weaponNamed reads it, so a shop's
// "Crossbow, hand" (the book's order) or a "Longsword +1" shows its weapon.
export function cardArtwork(icon: IconRef, genre?: string | null): IconRef {
  const baseKey =
    icon.kind === "item"
      ? ITEM_ART.get(iconSlug(weaponNamed(icon.key)?.name ?? icon.key))
      : icon.kind === "action" ? icon.key : null;
  if (!baseKey) return icon;

  const variant = genreActionKey(baseKey, genre);
  if (variant && isPainted(iconPath("action", variant))) {
    return { kind: "action", key: variant, family: icon.family };
  }

  if (icon.kind === "action") return icon;
  return isPainted(iconPath("action", baseKey)) ? { kind: "action", key: baseKey, family: icon.family } : icon;
}
