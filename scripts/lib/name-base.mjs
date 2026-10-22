// The SRD weapon or suit a content-pack row of another document is built on,
// read once from the row's own English name, for the generators that write
// it onto the row (scripts/generate-magic-items.mjs, scripts/
// generate-item-tags.mjs). The engines then read the base off the row and
// never a word inside a name a table wrote.
//
// The name holds it as whole words, longest first ("Constant Dagger" is a
// dagger, "Animated Chain Mail" chain mail, a "Kite shield" a shield).
// Ammunition names the weapon that shoots it and is none, and a "Shield +1"
// is read as a shield with the bonus its name declares (src/lib/srd/
// item-row.ts), as it is carried.
import { register } from "node:module";

register("./register-alias.mjs", import.meta.url);
const { SRD_WEAPONS } = await import("../../src/lib/srd/weapons.ts");
const { SRD_ARMOR } = await import("../../src/lib/srd/armor-table.ts");
const { textKey } = await import("../../src/lib/language/text-logic.ts");
const { pluralForms } = await import("../../src/lib/srd/name-forms.ts");

const BASES = {
  weapon: SRD_WEAPONS.filter((weapon) => weapon.category === "simple" || weapon.category === "martial"),
  armor: SRD_ARMOR.filter((armor) => !armor.genres),
};

// kind: "weapon" or "armor". The base's name, or null.
export function nameBase(name, kind) {
  const words = ` ${textKey(name)} `;
  if (/\+\d/.test(name) || (kind === "weapon" && /\b(?:arrow|bolt|bullet|needle)s?\b/.test(words))) {
    return null;
  }
  const held = BASES[kind].filter((row) => pluralForms(textKey(row.name)).some((form) => words.includes(` ${form} `)));
  held.sort((a, b) => b.name.length - a.name.length);
  return held[0]?.name ?? null;
}
