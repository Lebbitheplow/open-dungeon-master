// Whether the free-text subclass on a sheet names a given subclass. One rule
// for every reader (the feature grants in features.ts, the option slots in
// options.ts): the exact name or an alias, or one of the name's other English
// spellings, compared whole. A string that is merely part of a name matches
// nothing, so a paladin whose subclass reads "Oath" is granted no oath's
// features, and a fighter whose subclass reads "Master" opens no maneuvers.

import { textKey } from "@/lib/language/text-logic";

// The titles a published subclass is printed with. A sheet may store the
// short form ("Evocation", "Devotion") or another title ("Path of Berserker"),
// so a name is also spelled without its title, with any title, and with
// "Domain" after it. The spellings are written from the subclass's names; the
// stored value is compared as written.
const TITLES = ["oath of the", "oath of", "circle of the", "circle of", "college of", "school of", "path of the", "path of", "way of the", "way of", "the"];

function spellingsOf(name: string): string[] {
  const key = textKey(name);
  const title = TITLES.find((entry) => key.startsWith(`${entry} `));
  const bare = (title ? key.slice(title.length + 1) : key).replace(/ domain$/, "");
  if (!bare) {
    return [key];
  }
  return [key, bare, `${bare} domain`, ...TITLES.flatMap((entry) => [`${entry} ${bare}`, `${entry} ${bare} domain`])];
}

// Exact name or alias.
export function subclassNamedExactly(stored: string, name: string, aliases: string[] = []): boolean {
  const wanted = textKey(stored);
  return (
    Boolean(wanted) &&
    [name, ...aliases].some((candidate) => textKey(candidate) === wanted)
  );
}

// The same, through the names' other spellings.
export function subclassNamedBare(stored: string, name: string, aliases: string[] = []): boolean {
  const wanted = textKey(stored);
  return Boolean(wanted) && [name, ...aliases].some((candidate) => spellingsOf(candidate).includes(wanted));
}

export function subclassNamed(stored: string, name: string, aliases: string[] = []): boolean {
  return subclassNamedExactly(stored, name, aliases) || subclassNamedBare(stored, name, aliases);
}
