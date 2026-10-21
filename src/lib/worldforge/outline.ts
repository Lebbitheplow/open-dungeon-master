import { LINK_LABELS, typeFor, type Shelf, type WorldDoc, type WorldType } from "./model.ts";
import type { ForgeLink } from "./forge.ts";
import type { Named } from "./text.ts";
import { textKey } from "../language/text-logic.ts";
import { RESERVED_RULE, reservedCreature } from "../bestiary/reserved-creatures.ts";

// "Draft a world from this idea" (plan M5 item 1, audit WF-08), the pure
// half; the model calls are in src/lib/dm/world-outline.ts. The forge
// (forge.ts) extracts what notes name and invents nothing; this is the other
// operation, and it drafts. Its answer is an outline to review, never a
// write: people, places, factions and lore as World entries, and a few
// playable creatures and items, each counted. The author ticks what to make.
// A ticked entry is made as a World entry; a ticked creature or item goes
// through the Bestiary's or Homebrew's own builder and validator, one model
// call each, so an accepted outline can never start more generation than
// the rows it shows. Coerced the forge's way: resolve generously, store
// strictly, and say what was left out.

export const OUTLINE_ITEM_KINDS = ["weapon", "armor", "gear", "magic_item"] as const;
export type OutlineItemKind = (typeof OUTLINE_ITEM_KINDS)[number];

// The most of each an outline holds. The prompt asks for fewer.
export const OUTLINE_CAPS = { npc: 6, location: 5, faction: 3, lore: 4, creature: 3, item: 3, links: 30 } as const;

export type OutlineEntry = { key: string; shelf: Shelf; name: string; typeId: string; summary: string; hiddenTruth: string; existing: string };
export type OutlineAsset = { key: string; kind: "creature" | "item"; name: string; summary: string; cr: number; basis: string; itemKind: OutlineItemKind };
export type Outline = { premise: string; entries: OutlineEntry[]; assets: OutlineAsset[]; links: ForgeLink[]; left: string[] };
export type OutlineCounts = { people: number; places: number; factions: number; lore: number; creatures: number; items: number };

type Raw = Record<string, unknown>;
const rec = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

// The challenge ratings a stat block can carry, below 1 the SRD's fractions.
const CRS = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, at) => at + 1)];
export function nearestCr(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim().replace(/^1\/(\d)$/, (_, d) => String(1 / Number(d)))) : NaN;
  if (!Number.isFinite(number)) return 1;
  return CRS.reduce((best, cr) => (Math.abs(cr - number) < Math.abs(best - number) ? cr : best), 1);
}

export function outlineMessages(input: { idea: string; worldName: string; types: WorldType[]; known: string[]; hint: string }) {
  const lore = input.types.filter((type) => type.shelf === "lore").map((type) => type.name);
  return [
    {
      role: "system" as const,
      content: [
        `You sketch a tabletop world, ${input.worldName}, from its game master's idea. This is an outline for them to review and pick from, not finished writing.`,
        'Reply with one JSON object and nothing else: {"premise":"","people":[{"name":"","summary":"","hiddenTruth":""}],"places":[{"name":"","summary":""}],"factions":[{"name":"","summary":""}],"lore":[{"name":"","type":"","summary":""}],"creatures":[{"name":"","summary":"","basis":"","cr":1}],"items":[{"name":"","summary":"","kind":""}],"links":[{"from":"","to":"","label":""}]}',
        '"premise" is two sentences on what the world is and what is at stake in it.',
        "Propose 3 to 5 people, 2 to 4 places, 1 to 3 factions and 1 to 3 lore entries. Propose at most 3 creatures and at most 3 items, and only ones the idea calls for.",
        `A lore entry's "type" is exactly one of: ${lore.join(", ")}.`,
        '"summary" is one or two sentences in the world\'s own voice: never mention the idea, the game or the players. No game statistics anywhere.',
        '"hiddenTruth" only for a person with a secret; otherwise "".',
        `${RESERVED_RULE} A creature's "basis" is the name of the SRD creature it is or is built on, or "" for an original design. "cr" is its challenge rating, from 0 to 30.`,
        'An item\'s "kind" is exactly one of: weapon, armor, gear, magic_item.',
        `"label" is exactly one of: ${LINK_LABELS.join(", ")}. "from" and "to" are names from your outline or names the world already has. Leave a relationship out rather than invent a word.`,
        "Every name is new unless it is one the world already has and you mean that same thing.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        input.known.length ? `The world already has: ${input.known.slice(0, 200).join(", ")}.` : "",
        input.hint ? `The game master asks: ${input.hint}` : "",
        "The idea:",
        input.idea,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

const SHELF_LISTS: ReadonlyArray<{ field: string; shelf: Shelf; noun: [string, string] }> = [
  { field: "people", shelf: "npc", noun: ["person", "people"] },
  { field: "places", shelf: "location", noun: ["place", "places"] },
  { field: "factions", shelf: "faction", noun: ["faction", "factions"] },
  { field: "lore", shelf: "lore", noun: ["lore entry", "lore entries"] },
];

export function readOutlineReply(reply: Raw | null, doc: Pick<WorldDoc, "types">, named: Named[]): Outline {
  const byHandle = new Map<string, string>();
  for (const entry of named) for (const handle of [entry.name, ...entry.aliases]) byHandle.set(textKey(handle), entry.ref);
  const left: string[] = [];
  const seen = new Set<string>();
  const fresh = (name: string) => {
    const key = textKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const over = (asked: number, cap: number, noun: [string, string]) => {
    if (asked > cap) left.push(`The model proposed ${asked} ${noun[1]}; an outline keeps ${cap} at most, so the rest were left out.`);
  };

  const entries: OutlineEntry[] = [];
  for (const { field, shelf, noun } of SHELF_LISTS) {
    const rows = list(reply?.[field]).map(rec).filter((row) => str(row.name, 80));
    over(rows.length, OUTLINE_CAPS[shelf as keyof typeof OUTLINE_CAPS], noun);
    for (const row of rows.slice(0, OUTLINE_CAPS[shelf as keyof typeof OUTLINE_CAPS])) {
      const name = str(row.name, 80);
      if (!fresh(name)) continue;
      const lore = shelf === "lore" ? doc.types.find((type) => type.shelf === "lore" && textKey(type.name) === textKey(str(row.type, 40))) : undefined;
      entries.push({
        key: `o:e${entries.length}`,
        shelf,
        name,
        typeId: (lore ?? typeFor(doc, shelf, "")).id,
        summary: str(row.summary, 2_000),
        hiddenTruth: shelf === "npc" ? str(row.hiddenTruth, 1_000) : "",
        existing: byHandle.get(textKey(name)) ?? "",
      });
    }
  }

  const assets: OutlineAsset[] = [];
  const creatures = list(reply?.creatures).map(rec).filter((row) => str(row.name, 80));
  over(creatures.length, OUTLINE_CAPS.creature, ["creature", "creatures"]);
  for (const row of creatures.slice(0, OUTLINE_CAPS.creature)) {
    const name = str(row.name, 80);
    const summary = str(row.summary, 1_000);
    const basis = str(row.basis, 80);
    const reserved = reservedCreature(name, basis, summary);
    if (reserved) {
      left.push(`“${name}” was left out: it reads as a ${reserved}, which is not a creature ODM makes. Ask for a creature from the SRD or an original one.`);
      continue;
    }
    if (!fresh(name)) continue;
    assets.push({ key: `o:a${assets.length}`, kind: "creature", name, summary, cr: nearestCr(row.cr), basis, itemKind: "gear" });
  }
  const items = list(reply?.items).map(rec).filter((row) => str(row.name, 80));
  over(items.length, OUTLINE_CAPS.item, ["item", "items"]);
  for (const row of items.slice(0, OUTLINE_CAPS.item)) {
    const name = str(row.name, 80);
    if (!fresh(name)) continue;
    const kind = OUTLINE_ITEM_KINDS.find((entry) => entry === textKey(str(row.kind, 20)).replace(/ /g, "_")) ?? "gear";
    assets.push({ key: `o:a${assets.length}`, kind: "item", name, summary: str(row.summary, 1_000), cr: 0, basis: "", itemKind: kind });
  }

  const endpoint = (value: unknown) => {
    const key = textKey(str(value, 80));
    const entry = entries.find((row) => textKey(row.name) === key);
    if (entry) return entry.existing || entry.key;
    const asset = assets.find((row) => textKey(row.name) === key);
    return asset ? asset.key : byHandle.get(key) ?? "";
  };
  const links: ForgeLink[] = [];
  const linkSeen = new Set<string>();
  for (const row of list(reply?.links).map(rec).slice(0, 120)) {
    const label = (LINK_LABELS as readonly string[]).find((word) => word === textKey(str(row.label, 40)));
    const from = endpoint(row.from);
    const to = endpoint(row.to);
    const key = `${from}|${to}|${label}`;
    if (!label || !from || !to || from === to || linkSeen.has(key)) continue;
    if (links.length >= OUTLINE_CAPS.links) break;
    linkSeen.add(key);
    links.push({ from, to, label });
  }
  return { premise: str(reply?.premise, 600), entries, assets, links, left };
}

export function outlineCounts(outline: Pick<Outline, "entries" | "assets">): OutlineCounts {
  const shelf = (wanted: Shelf) => outline.entries.filter((entry) => entry.shelf === wanted).length;
  return {
    people: shelf("npc"),
    places: shelf("location"),
    factions: shelf("faction"),
    lore: shelf("lore"),
    creatures: outline.assets.filter((asset) => asset.kind === "creature").length,
    items: outline.assets.filter((asset) => asset.kind === "item").length,
  };
}
