// Painted icons (public/assets/icons, catalogue in scripts/icon-set.mjs).
//
// An icon is addressed by what it is and what it is called, the same way the
// catalogue keys it: a spell or a class feature by its name, an item by its
// name, an option by its kind and name, a condition or an action by its id.
// The path is computed, not looked up in the full manifest; a small index of
// the painted slugs says which files exist, so a name with no painting
// (homebrew, a pack item beyond the SRD) is skipped for its family's icon,
// then for nothing, and never asked of the server (PAINTED below).
// Pure, so scripts/test-icons.mjs drives it.

import paintedIcons from "@/lib/painted-icons.json";

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

// Things the engine offers that the catalogue never painted, each lent the
// painting closest in meaning so the screen does not ask for a file that is
// not there (scripts/test-hand-look.mjs walks every Hand card against disk).
const ICON_ALIASES: Record<string, { kind: IconKind; slug: string }> = {
  "action/search": { kind: "glyph", slug: "skill-perception" },
  "action/escape": { kind: "feature", slug: "escape-artist" },
  "action/stand-up": { kind: "condition", slug: "prone" },
  "feature/flurry-of-blows": { kind: "feature", slug: "martial-arts" },
};

export function iconPath(kind: IconKind, key: string): string {
  const slug = iconSlug(key);
  const alias = ICON_ALIASES[`${kind}/${slug}`];
  return alias ? `/assets/icons/${alias.kind}/${alias.slug}.webp` : `/assets/icons/${kind}/${slug}.webp`;
}

// Families: spell-<school>, item-<kind>, class-<classId>, option-<kind>, damage-<type>.
export function familyIconPath(family: string): string {
  return iconPath("family", family);
}

export type IconRef = { kind: IconKind; key: string; family?: string | null };

// The slugs each kind has a painting for (written by scripts/generate-icons.mjs
// beside the manifest; scripts/test-hand-look.mjs holds it to the folders).
// A path is still computed, never looked up, but a name with no painting is
// no longer asked for: a level-up page of pack spells used to fire a hundred
// requests for files that are not there. Glyphs are named in code only and
// are not listed.
const PAINTED: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(paintedIcons as Record<string, string[]>).map(([kind, slugs]) => [kind, new Set(slugs)]),
);

// Whether the file an icon path names is one the catalogue painted.
export function isPainted(src: string): boolean {
  const match = /^\/assets\/icons\/([a-z]+)\/([^/]+)\.webp$/.exec(src);
  if (!match) return true;
  const set = PAINTED[match[1]];
  return set ? set.has(match[2]) : true;
}

// The paths to try, in order: only the paintings that exist.
export function iconCandidates(ref: IconRef): string[] {
  const paths = [iconPath(ref.kind, ref.key)];
  if (ref.family) paths.push(familyIconPath(ref.family));
  return paths.filter(isPainted);
}
