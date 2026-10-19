// The other English spellings of an English reference name, for the lookups
// that compare a written name whole (the SRD gear, armour and weapon tables,
// the content pack's weights). They are written onto the reference side, from
// the English rows themselves, and never applied to what a table writes: a
// name in any language is compared as written, and "Torches" finds the Torch
// because the Torch's row is also spelled "torches". Pure.

// A key's plural forms, the key first: "torch" is also "torches", "ration"
// "rations", "supply" "supplies". The last word pluralizes, so "hempen rope"
// is also "hempen ropes".
export function pluralForms(key: string): string[] {
  const forms = [key, `${key}s`];
  if (/(?:s|x|z|ch|sh)$/.test(key)) {
    forms.push(`${key}es`);
  }
  if (/[^aeiou]y$/.test(key)) {
    forms.push(`${key.slice(0, -1)}ies`);
  }
  return forms;
}

// Every spelling of each row, to the row: each row's own spellings first,
// then their plurals, so a plural never shadows another row's name. The first
// row a spelling belongs to keeps it.
export function spellingIndex<T>(rows: readonly T[], spellings: (row: T) => string[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const pass of [spellings, (row: T) => spellings(row).flatMap(pluralForms)]) {
    for (const row of rows) {
      for (const spelling of pass(row)) {
        if (spelling && !index.has(spelling)) {
          index.set(spelling, row);
        }
      }
    }
  }
  return index;
}

// A creature form's English spellings, its name first: "the wolf", "a wolf",
// "wolf form", "brown bear shape" (a wild shape, a polymorph, a summon or a
// familiar asked for the way English names it).
export function creatureSpellings(name: string): [string, ...string[]] {
  return [name, `the ${name}`, `a ${name}`, `an ${name}`, `${name} form`, `${name} shape`];
}
