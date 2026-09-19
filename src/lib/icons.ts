// Painted icons (public/assets/icons, catalogue in scripts/icon-set.mjs).
//
// An icon is addressed by what it is and what it is called, the same way the
// catalogue keys it: a spell or a class feature by its name, an item by its
// name, an option by its kind and name, a condition or an action by its id.
// The path is computed, not looked up, so nothing has to load a manifest of
// two thousand entries; a name with no painting (homebrew, a pack item beyond
// the SRD) simply fails to load and the component falls back to the family
// icon, then to nothing. Pure, so scripts/test-icons.mjs drives it.

export type IconKind = "spell" | "item" | "feature" | "option" | "feat" | "condition" | "action" | "glyph" | "family";

// The catalogue's slug rule, kept identical to scripts/icon-set.mjs.
export function iconSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function iconPath(kind: IconKind, key: string): string {
  return `/assets/icons/${kind}/${iconSlug(key)}.webp`;
}

// Families: spell-<school>, item-<kind>, class-<classId>, option-<kind>, damage-<type>.
export function familyIconPath(family: string): string {
  return iconPath("family", family);
}

export type IconRef = { kind: IconKind; key: string; family?: string | null };

// The paths to try, in order.
export function iconCandidates(ref: IconRef): string[] {
  const paths = [iconPath(ref.kind, ref.key)];
  if (ref.family) paths.push(familyIconPath(ref.family));
  return paths;
}
