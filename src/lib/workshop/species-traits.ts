import { raceMechanics, traitHeading } from "@/lib/content/mechanics";
import { DAMAGE_TYPES } from "@/lib/dm/damage-logic";
import { pcResistances } from "@/lib/dm/pc-defenses";
import { byName, textKey } from "@/lib/language/text-logic";

// The traits a workshop species can borrow from the published ones: the
// species editor's "Add a published trait". A trait named as published is
// what the engine runs (src/lib/srd/race-id.ts speciesHoldsTrait), so a
// homebrew Half-Dragon that borrows the Dragonborn's Draconic Ancestry and
// Breath Weapon asks its player for a dragon and breathes as one. Pure, for
// the editor and the tests alike.

export type PublishedTrait = { name: string; text: string; from: string[] };

// A trait paragraph per name, out of a race's markdown: "**_Keen Senses._**
// You have proficiency...", "***Brave.*** You have advantage..." and a
// hand-typed "**Ember Blood.** You have resistance..." alike, each heading
// read the way the table reads it (src/lib/content/mechanics.ts
// traitHeading).
export function traitParagraphs(markdown: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const line of String(markdown ?? "").split("\n")) {
    const head = traitHeading(line);
    if (head) {
      current = head.name;
      out.set(current, head.rest);
    } else if (current && line.trim()) {
      out.set(current, `${out.get(current)} ${line.trim()}`.trim());
    }
  }
  return out;
}

// A paragraph whose name is marked some other way than the table reads a
// trait ("**Breath Weapon** You...", "**Breath Weapon:**", "*Breath
// Weapon.*"), and, in a text whose other traits are marked, one that opens
// with a plain "Breath Weapon. You...".
const MARKED_LIKE_A_TRAIT = /^(?:\*{1,3}|_{1,2}|\*\*_|_\*\*)([^*_\n]{2,60}?)(?:\*{1,3}|_{1,2}|_\*\*|\*\*_)(?![*_])\s*[:.–-]?\s*\S/;
const PLAIN_LIKE_A_TRAIT = /^([A-Z][\w’'()-]*(?:\s+(?:of|the|and|[A-Z][\w’'()-]*)){0,4})\.\s+[A-Z]/;

// The paragraphs that read like a trait the table does not see, each with
// the name it seems to give: the table runs only what traitHeading reads,
// so a trait written another way grants nothing and is never said to.
// Bullets (a trait's options) and table rows are no trait's opening.
export function unreadTraitLines(traits: string): Array<{ name: string; line: string }> {
  const lines = String(traits ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const headed = lines.some((line) => traitHeading(line) !== null);
  const out: Array<{ name: string; line: string }> = [];
  for (const line of lines) {
    if (traitHeading(line) || /^[*-]\s/.test(line) || line.startsWith("|")) continue;
    const said = MARKED_LIKE_A_TRAIT.exec(line)?.[1] ?? (headed ? PLAIN_LIKE_A_TRAIT.exec(line)?.[1] : undefined);
    const name = said?.replace(/[\s:.–-]+$/, "").trim();
    if (name) out.push({ name, line });
  }
  return out;
}

// Every trait the catalog's species print, once per name, with the species
// that print it, by name.
export function publishedTraits(rows: Array<{ name: string; traits: string }>): PublishedTrait[] {
  const found = new Map<string, PublishedTrait>();
  for (const row of rows) {
    for (const [name, text] of traitParagraphs(row.traits)) {
      const held = found.get(textKey(name));
      if (!held) {
        found.set(textKey(name), { name, text, from: [row.name] });
        continue;
      }
      if (!held.from.includes(row.name)) held.from.push(row.name);
      if (!held.text) held.text = text;
    }
  }
  return [...found.values()].sort(byName);
}

// The trait names the engine reads off a species's text, as the builder and
// the server read them (raceMechanics).
export function heldTraitNames(traits: string): string[] {
  return raceMechanics({ traits }).traitNames;
}

// The damage a species resists at the table, read off its trait names the
// way the damage engine reads them (src/lib/dm/pc-defenses.ts): "Fire
// Resistance", "Celestial Resistance (necrotic and radiant)", Hellish
// Resistance. A trait's words alone resist nothing there.
export function resistedByTraits(traits: string): string[] {
  const held = pcResistances({ race: "", features: heldTraitNames(traits).map((name) => ({ name })) });
  return held ? held.split(", ") : [];
}

// A resistance as a trait named the way the damage engine reads it.
export function resistanceTrait(type: string): Pick<PublishedTrait, "name" | "text"> {
  return { name: `${type.charAt(0).toUpperCase()}${type.slice(1)} Resistance`, text: `You have resistance to ${type} damage.` };
}

// Traits whose words resist a damage type their names do not carry
// ("**_Ember Blood._** You have resistance to fire damage."), which the
// table would never apply.
export function unreadResistances(traits: string): Array<{ trait: string; types: string[] }> {
  const read = new Set(resistedByTraits(traits));
  const out: Array<{ trait: string; types: string[] }> = [];
  for (const [trait, text] of traitParagraphs(traits)) {
    const said = [...text.toLowerCase().matchAll(/\bresistan(?:ce|t) (?:to|against) ([^.;]*?) damage\b/g)].flatMap((clause) =>
      DAMAGE_TYPES.filter((type) => new RegExp(`\\b${type}\\b`).test(clause[1])),
    );
    const types = [...new Set(said)].filter((type) => !read.has(type));
    if (types.length) out.push({ trait, types });
  }
  return out;
}

// The text with one trait more, in the book's words, unless the species
// already holds one of that name.
export function withTrait(traits: string, trait: Pick<PublishedTrait, "name" | "text">): string {
  const wanted = textKey(trait.name);
  if (heldTraitNames(traits).some((name) => textKey(name) === wanted)) {
    return traits;
  }
  const paragraph = `**_${trait.name}._** ${trait.text}`.trim();
  return traits.trim() ? `${traits.trimEnd()}\n\n${paragraph}` : paragraph;
}
