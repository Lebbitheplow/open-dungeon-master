import { engineFeatNamed, FEAT_TWINS } from "@/lib/srd/feat-effects";
import { SRD_ARMOR } from "@/lib/srd/armor";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

// A workshop entry under a published name is never that entry at the table:
// a spell called Revivify is the published Revivify on every list, a feat
// called Sharpshooter runs as the published feat, a "Longsword" on a sheet is
// the published longsword. So a published name is refused for a new entry,
// in the editor (this, pure, against the bundled names) and on the server
// (src/app/api/homebrew, which adds the content pack's names), with the
// reason and what to do instead. Kinds whose entries are picked by their own
// id (species, backgrounds, subclasses, hazards) can share a name freely.

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function publishedNameProblem(kind: string, name: string, morePublished?: (name: string) => boolean): string | null {
  const wanted = key(name);
  if (!wanted) {
    return null;
  }
  if (kind === "spell") {
    const known = bundledSpellFacts(name);
    if (known || morePublished?.(name)) {
      return `${known?.name ?? name.trim()} is a published spell's name, and at a table that name is always the published spell. Give your version a name of its own.`;
    }
  }
  if (kind === "feat") {
    const known = engineFeatNamed(name);
    if (known || FEAT_TWINS[wanted]) {
      return `${known ?? name.trim()} is a feat the engines already run by that name, so a workshop feat called that would never be read. Give yours a name of its own and set "Runs as" to ${known ?? "the feat"} to keep its rules.`;
    }
  }
  if (kind === "item") {
    const exact =
      SRD_WEAPONS.some((weapon) => key(weapon.name) === wanted) ||
      SRD_ARMOR.some((armor) => key(armor.name) === wanted) ||
      matchMagicItem(name) !== null ||
      Boolean(morePublished?.(name));
    if (exact) {
      return `${name.trim()} is published gear's name, and on a sheet that name is the published item, whatever this entry says. Give yours a name of its own.`;
    }
  }
  return null;
}
