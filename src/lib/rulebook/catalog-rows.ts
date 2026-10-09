import bookJson from "@/lib/rulebook/srd-5.1.json";
import type { RulebookData, RulebookPage } from "@/lib/rulebook/types";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";

// The bundled book's spells and magic items as catalog rows, in the shape
// the content pack serves them (src/lib/content/index.ts): what the
// workshop's "start from" and the pickers search when no content pack is
// installed, so a server without one can still copy Revivify or a Flame
// Tongue with its whole text, its casting facts and its mechanics
// (src/lib/workshop/catalog-mechanics.ts reads the mechanics by name). Each
// row names the book page it came from (`rulebook`), which is also how a
// copy remembers its source.

const PAGES = (bookJson as unknown as RulebookData).pages;

export type BundledSpellRow = {
  slug: string;
  name: string;
  source: "srd";
  documentSlug: "wotc-srd";
  document: string;
  level: number;
  school: string;
  classes: string[];
  ritual: boolean;
  concentration: boolean;
  aliases: string[];
  rulebook: string;
  data: Record<string, unknown>;
};

export type BundledItemRow = {
  slug: string;
  name: string;
  source: "srd";
  documentSlug: "wotc-srd";
  document: string;
  kind: "magic_item";
  rarity: string;
  cost: string;
  category: string;
  weight: number;
  rulebook: string;
  data: Record<string, unknown>;
};

const BOOK = "SRD 5.1 (the bundled book)";

// "*3rd-level evocation (ritual)*", "*Evocation cantrip*".
function spellHead(meta: string): { level: number; school: string; ritual: boolean } {
  const text = meta.replace(/\*/g, "").trim().toLowerCase();
  const cantrip = /^(\w+) cantrip/.exec(text);
  const levelled = /^(\d)\w*-level (\w+)/.exec(text);
  return {
    level: cantrip ? 0 : levelled ? Number(levelled[1]) : 0,
    school: cantrip ? cantrip[1] : levelled ? levelled[2] : "",
    ritual: /\(ritual\)/.test(text),
  };
}

// "**Casting Time:** 1 action" and the rest of the header, then the body,
// with "***At Higher Levels***." split off as the pack splits it.
export function spellFieldsFromPage(page: Pick<RulebookPage, "md" | "meta">): Record<string, unknown> {
  const blocks = page.md.split(/\n\n+/);
  const head = spellHead(page.meta ?? blocks[0] ?? "");
  const field = (label: string) =>
    blocks.map((block) => new RegExp(`^\\*\\*${label}:\\*\\*\\s*([\\s\\S]*)$`).exec(block.trim())?.[1]?.trim()).find(Boolean) ?? "";
  const body = blocks.filter((block, index) => index > 0 && !/^\*\*[A-Za-z ]+:\*\*/.test(block.trim()));
  const at = body.findIndex((block) => /^\*\*\*At Higher Levels/i.test(block.trim()));
  const desc = (at === -1 ? body : body.slice(0, at)).join("\n\n").trim();
  const higher = at === -1 ? "" : body.slice(at).join("\n\n").replace(/^\*\*\*At Higher Levels\*\*\*\.?\s*/i, "").trim();
  const components = field("Components");
  const duration = field("Duration");
  return {
    desc,
    higher_level: higher,
    level: head.level,
    level_int: head.level,
    school: head.school,
    ritual: head.ritual,
    concentration: /^concentration/i.test(duration),
    casting_time: field("Casting Time"),
    range: field("Range"),
    components,
    material: /\(([^)]+)\)/.exec(components)?.[1] ?? "",
    duration,
  };
}

export function bundledSpellRows(q = ""): BundledSpellRow[] {
  const wanted = q.trim().toLowerCase();
  return PAGES.filter((page) => page.kind === "spell" && (!wanted || page.title.toLowerCase().includes(wanted))).map((page) => {
    const data = spellFieldsFromPage(page);
    const facts = bundledSpellFacts(page.title);
    return {
      slug: `srd:${page.id}`,
      name: page.title,
      source: "srd" as const,
      documentSlug: "wotc-srd" as const,
      document: BOOK,
      level: Number(data.level),
      school: String(data.school),
      classes: facts?.classes ?? [],
      ritual: data.ritual === true,
      concentration: data.concentration === true,
      aliases: facts?.aliases ?? [],
      rulebook: page.id,
      data: { ...data, classes: facts?.classes ?? [] },
    };
  });
}

// "*Weapon (any sword), rare (requires attunement)*".
function itemHead(meta: string): { category: string; rarity: string; attunement: string } {
  const text = meta.replace(/\*/g, "").trim();
  const attunement = /\((requires attunement[^)]*)\)/i.exec(text)?.[1] ?? "";
  const withoutAttunement = text.replace(/\s*\(requires attunement[^)]*\)/i, "");
  const comma = withoutAttunement.search(/,\s*(?:common|uncommon|rare|very rare|legendary|artifact|rarity varies)\b/i);
  const category = (comma === -1 ? withoutAttunement : withoutAttunement.slice(0, comma)).trim();
  const rarity = comma === -1 ? "" : withoutAttunement.slice(comma + 1).trim();
  return { category, rarity, attunement };
}

export function bundledItemRows(q = ""): BundledItemRow[] {
  const wanted = q.trim().toLowerCase();
  return PAGES.filter((page) => page.kind === "item" && (!wanted || page.title.toLowerCase().includes(wanted))).map((page) => {
    const head = itemHead(page.meta ?? "");
    const desc = page.md.split(/\n\n+/).slice(1).join("\n\n").trim();
    return {
      slug: `srd:${page.id}`,
      name: page.title,
      source: "srd" as const,
      documentSlug: "wotc-srd" as const,
      document: BOOK,
      kind: "magic_item" as const,
      rarity: head.rarity,
      cost: "",
      category: head.category,
      weight: 0,
      rulebook: page.id,
      data: { desc, type: head.category, rarity: head.rarity, requires_attunement: head.attunement },
    };
  });
}

// The forms a race's name takes: the book's "Hill Dwarf" and "Elf, Drow",
// the builder's "Dwarf (Hill)", and the race it belongs to.
function raceNameForms(name: string): string[] {
  const clean = name.trim().toLowerCase();
  const paren = /^(.+?)\s*\((.+)\)$/.exec(clean);
  return paren ? [clean, `${paren[2]} ${paren[1]}`, `${paren[1]}, ${paren[2]}`] : [clean];
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The race page a race or subrace is printed on: the page that is it, or
// the one that holds it as a section ("## Hill Dwarf"), under any of its
// names; else the page of the race it belongs to ("Dwarf").
function racePageFor(raceName: string): RulebookPage | null {
  const forms = raceNameForms(raceName);
  const races = PAGES.filter((entry) => entry.kind === "race");
  return (
    races.find((entry) => forms.some((form) => entry.title.toLowerCase() === form || entry.title.toLowerCase().startsWith(`${form} (`))) ??
    races.find((entry) => forms.some((form) => new RegExp(`^##+ ${escapeRe(form)}\\s*$`, "im").test(entry.md))) ??
    races.find((entry) => entry.title.toLowerCase() === forms[0].split(/\s*\(/)[0]) ??
    null
  );
}

// A bundled race's traits in the book's own words, by trait name: the race
// page that is the race ("Dwarf") or holds it as a subrace ("## Hill
// Dwarf"), every "***Darkvision***. You can see..." paragraph on it.
export function bundledRaceTraitText(raceName: string): Map<string, string> {
  const page = racePageFor(raceName);
  const out = new Map<string, string>();
  for (const block of (page?.md ?? "").split(/\n\n+/)) {
    const head = /^\*\*\*([^*]+?)\*\*\*\.?\s*([\s\S]*)$/.exec(block.trim());
    if (head) {
      out.set(head[1].replace(/\.$/, "").trim(), head[2].trim());
    }
  }
  return out;
}

// A page whose title is not the catalog's name for it (an animated object,
// the drow and the deep gnome of the monster appendix): the name it is
// found under in the catalog. The +1, +2 and +3 families have no SRD row in
// the pack; the book's own row stands in (the content route's book=1).
export const PAGE_CATALOG_NAMES: Record<string, string> = {
  "animated-armor-animated-object-animated-object": "Animated Armor",
  "flying-sword-animated-object-animated-object": "Flying Sword",
  "rug-of-smothering-animated-object-animated-object": "Rug of Smothering",
  "elf-drow": "Drow",
  "gnome-deep-svirfneblin": "Deep Gnome (Svirfneblin)",
};

const PAGE_BY_CATALOG_NAME = new Map(Object.entries(PAGE_CATALOG_NAMES).map(([page, name]) => [name.toLowerCase(), page]));

// The page a published entry is printed on, or null: the crosswalk a copy
// keeps as its source (src/lib/rulebook/crosswalk.ts reads every page).
export function rulebookPageIdFor(kind: RulebookPage["kind"], name: string): string | null {
  const wanted = name.trim().toLowerCase();
  if (kind === "race") {
    return racePageFor(name)?.id ?? null;
  }
  const aliased = PAGE_BY_CATALOG_NAME.get(wanted);
  if (aliased && PAGES.some((page) => page.id === aliased && page.kind === kind)) return aliased;
  return PAGES.find((page) => page.kind === kind && page.title.toLowerCase() === wanted)?.id ?? null;
}
