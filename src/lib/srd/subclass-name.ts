// Whether the free-text subclass on a sheet names a given subclass. One rule
// for every reader (the feature grants in features.ts, the option slots in
// options.ts): the exact name or an alias, or either with its title taken off
// on both sides and compared whole. A string that is merely part of a name
// matches nothing, so a paladin whose subclass reads "Oath" is granted no
// oath's features, and a fighter whose subclass reads "Master" opens no
// maneuvers.

export const normalizeSubclassName = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

// A subclass name with its title taken off, so a sheet that stores the short
// form ("Evocation", "Devotion") still names the subclass it means. Only a
// whole title comes off: "Oath", "Domain" and "School" are titles with
// nothing left, and name no subclass.
const SUBCLASS_TITLES =
  /^(oath of the|oath of|circle of the|circle of|college of|school of|path of the|path of|way of the|way of|the)\s+/;

export function strippedSubclassName(value: string): string {
  return normalizeSubclassName(value).replace(SUBCLASS_TITLES, "").replace(/\s+domain$/, "").trim();
}

// Exact name or alias.
export function subclassNamedExactly(stored: string, name: string, aliases: string[] = []): boolean {
  const wanted = normalizeSubclassName(stored);
  return (
    Boolean(wanted) &&
    [name, ...aliases].some((candidate) => normalizeSubclassName(candidate) === wanted)
  );
}

// The same, with the titles off on both sides.
export function subclassNamedBare(stored: string, name: string, aliases: string[] = []): boolean {
  const bare = strippedSubclassName(stored);
  return Boolean(bare) && [name, ...aliases].some((candidate) => strippedSubclassName(candidate) === bare);
}

export function subclassNamed(stored: string, name: string, aliases: string[] = []): boolean {
  return subclassNamedExactly(stored, name, aliases) || subclassNamedBare(stored, name, aliases);
}
