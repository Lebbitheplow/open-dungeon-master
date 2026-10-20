// The other English spellings of an English reference name, for the lookups
// that compare a written name whole (the SRD gear, armour and weapon tables,
// the content pack's weights). They are written onto the reference side, from
// the English rows themselves, and never applied to what a table writes: a
// name in any language is compared as written, and "Torches" finds the Torch
// because the Torch's row is also spelled "torches". Pure.

// A key's plural forms, the key first: "torch" is also "torches", "ration"
// "rations", "supply" "supplies", "elf" "elves". The last word pluralizes,
// so "hempen rope" is also "hempen ropes".
export function pluralForms(key: string): string[] {
  const forms = [key, `${key}s`];
  if (/(?:s|x|z|ch|sh)$/.test(key)) {
    forms.push(`${key}es`);
  }
  if (/[^aeiou]y$/.test(key)) {
    forms.push(`${key.slice(0, -1)}ies`);
  }
  if (/[lr]f$/.test(key)) {
    forms.push(`${key.slice(0, -1)}ves`);
  }
  return forms;
}

// Whether two keys of ODM's English rules vocabulary (a creature type, a
// race, a terrain) are one, written in the singular or the plural:
// "monstrosity" and "monstrosities", "orc" and "orcs", "dwarf" and
// "dwarves". A feature records its picks either way ("Favored Enemy:
// undead, fiends").
export function sameRulesKey(a: string, b: string): boolean {
  return pluralForms(a).includes(b) || pluralForms(b).includes(a);
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
