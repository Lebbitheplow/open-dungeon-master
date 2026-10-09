// A background's kit lines that leave something to the player, answered.
//
// PR #114 read background kits into catalog items and left a choice line as
// written ("A dagger, quarterstaff, or spear"), since no code can guess the
// pick. This is the link from the line to the pick (issue #127). Two kinds:
//
//   - A line that names the same choice as the background's tool grant ("a
//     set of artisan's tools of your choice", "a gaming set of your choice")
//     is filled from the tools the character is proficient with, the
//     background's own choice list first: a Court Servant who picked
//     calligrapher's supplies carries calligrapher's supplies.
//   - An either-or line whose every alternative is a catalog item ("a dagger
//     or light hammer") is a pick, stored on the sheet as the alternative's
//     words (backgroundChoices.gear); unanswered, the book's first.
//   - An alternative that is a tool KIND rather than an item ("one set of
//     artisan's tools or one instrument", "lute or other musical
//     instrument") opens on the tools of that kind, the way a class kit's
//     "any musical instrument" does; the pick is stored as the tool's name,
//     and until it is made the tool the character is trained with, or the
//     kind's first (Smoebo's follow-up on issue #127).
//
// Anything else stays as written, as before. Pure, and shared by the builder
// (what the chips show) and the server (what the free kit is), so the two
// can never disagree about what the character carries.
import { matchGear, resolveGearLine } from "@/lib/srd/adventuring-gear";
import type { KitItem } from "@/lib/srd/starting-kit";
import { ARTISANS_TOOLS, GAMING_SETS, MUSICAL_INSTRUMENTS, splitToolGrants } from "@/lib/srd/tool-choices";

const lower = (value: string) => value.trim().toLowerCase();

// ---- a tool-kind line, filled from the character's training ----

type ToolKind = { pattern: RegExp; from: string[] };

const TOOL_KINDS: ToolKind[] = [
  { pattern: /artisan'?s'? tools?/i, from: ARTISANS_TOOLS },
  { pattern: /musical instruments?|\binstrument\b/i, from: MUSICAL_INSTRUMENTS },
  { pattern: /gaming sets?|set of dice or deck of cards/i, from: GAMING_SETS },
];

// Whether a line hands over a tool the player chose the proficiency for,
// rather than a named item: "of your choice", "to match your choice of tool
// proficiency", or the bare "a set of dice or deck of cards".
export function isToolChoiceLine(line: string): boolean {
  const text = lower(line);
  if (/to match your choice of tool proficiency/.test(text)) {
    return true;
  }
  if (/set of dice or deck of cards/.test(text)) {
    return true;
  }
  return /of your choice|one of your choice/.test(text) && TOOL_KINDS.some((kind) => kind.pattern.test(text));
}

// The catalog's name for a tool the character is trained with ("Calligrapher's
// Supplies"), or the tool's own words when the catalog has no row for it
// (a dragonchess set is still a dragonchess set).
function toolItemName(tool: string): string {
  const found = matchGear(tool);
  return found ? found.name : tool.trim().replace(/^./, (first) => first.toUpperCase());
}

// The tool a choice line comes to: among the character's tools, one the
// line's kind covers, preferring the background's own choice lists (its
// pick is the one the line is about), and never the same tool twice across
// the kit. Null when nothing fits yet (the pick is still owed).
export function fillToolLine(
  line: string,
  input: { tools: string[]; backgroundTools: string[]; used: Set<string> },
): string | null {
  const text = lower(line);
  const held = input.tools.map(lower);
  const choices = splitToolGrants(input.backgroundTools).choices;
  const preferred = new Set(choices.flatMap((choice) => choice.from.map(lower)));
  let pool: string[];
  if (/to match your choice of tool proficiency/.test(text)) {
    pool = [...preferred];
  } else {
    const kinds = TOOL_KINDS.filter((kind) => kind.pattern.test(text));
    pool = kinds.flatMap((kind) => kind.from.map(lower));
  }
  const candidates = held.filter((tool) => pool.includes(tool) && !input.used.has(tool));
  const pick = candidates.find((tool) => preferred.has(tool)) ?? candidates[0];
  if (!pick) {
    return null;
  }
  input.used.add(pick);
  return toolItemName(pick);
}

// ---- an either-or line, answered by the player ----

export type GearAlternative = {
  // The book's words for the alternative.
  label: string;
  // What it comes to; for a kind, the tool it currently comes to.
  items: KitItem[];
  // A tool kind rather than an item: every tool it may come to, catalog
  // names, in the SRD's order.
  options?: string[];
};

// The tools a kind phrase ("artisan's tools", "other musical instrument",
// "gaming set") may come to, or null when the phrase is not a kind.
function kindOptions(phrase: string): string[] | null {
  const text = lower(phrase).replace(/^(?:other|any|another)\s+/, "");
  const kinds = TOOL_KINDS.filter((kind) => kind.pattern.test(text));
  if (!kinds.length || resolveGearLine(phrase).resolved) {
    return null;
  }
  return kinds.flatMap((kind) => kind.from.map(toolItemName));
}

const LEAD_IN = /^(?:a set of either|one set of either|either|a set of|one set of|a|an|one)\s+/i;

// Ammunition is not in the gear table; the sheet names it with a count
// ("Arrows" x20, as a fighter's "Crossbow Bolts" x20 arrive).
const AMMO = /\b(\d+)\s+(crossbow bolts|bolts|arrows|sling bullets|bullets|blowgun needles|needles)\b/i;
const AMMO_NAMES: Record<string, string> = {
  "crossbow bolts": "Crossbow Bolts",
  bolts: "Crossbow Bolts",
  arrows: "Arrows",
  "sling bullets": "Sling Bullets",
  bullets: "Sling Bullets",
  "blowgun needles": "Blowgun Needles",
  needles: "Blowgun Needles",
};

// A phrase as catalog items, with any ammunition in it counted out first.
function resolveAlternative(phrase: string): { items: KitItem[]; resolved: boolean } {
  const items: KitItem[] = [];
  let rest = phrase;
  for (let ammo = AMMO.exec(rest); ammo; ammo = AMMO.exec(rest)) {
    items.push({ name: AMMO_NAMES[ammo[2].toLowerCase()], qty: Math.max(1, Math.min(999, Number(ammo[1]))) });
    rest = rest.replace(ammo[0], "").replace(/\s+(?:and|with)\s*$/i, "").replace(/^\s*(?:and|with)\s+/i, "").trim();
  }
  if (!rest) {
    return { items, resolved: items.length > 0 };
  }
  const line = resolveGearLine(rest.replace(/\bwith\b/gi, "and"));
  return { items: [...line.items, ...items], resolved: line.resolved };
}

// The alternatives of a choice line, each the words the book uses and the
// catalog items they come to; null when the line is not a choice or any
// alternative is something the catalog does not know (the line then stays
// as written, which is what #114 decided for it).
export function gearAlternatives(line: string): GearAlternative[] | null {
  // "(one of your choice)": the tool grant's line, not an either-or.
  if (isToolChoiceLine(line)) {
    return null;
  }
  let text = line.trim().replace(/\s+/g, " ").replace(/\.$/, "");
  text = text.replace(/\s*\(if proficient\)/i, "");
  // "Hunting gear (a shortbow with 20 arrows, or a hunting trap)": the
  // choice is inside the brackets when the outside is only a heading the
  // catalog has no item for. "Holy symbol (amulet or reliquary)" is one
  // item with a detail, and stays so.
  const bracketed = /^([^(]*)\(([^)]*)\)\s*$/.exec(text);
  if (
    bracketed &&
    !/\bor\b/i.test(bracketed[1]) &&
    /\bor\b/i.test(bracketed[2]) &&
    !resolveGearLine(bracketed[1].replace(LEAD_IN, "")).resolved
  ) {
    text = bracketed[2];
  } else {
    text = text.replace(/\s*\([^)]*\)/g, "");
  }
  if (!/\bor\b/i.test(text)) {
    return null;
  }
  // "A donkey or mule with bit and bridle": what follows "with" rides on
  // every alternative.
  const withTail = /^(.*\bor\b.*?)\s+with\s+(.+)$/i.exec(text);
  const head = (withTail ? withTail[1] : text).replace(LEAD_IN, "");
  const tail = withTail ? withTail[2] : "";
  const parts = head
    .split(/\s*,\s*or\s+|\s+or\s+|\s*,\s*/i)
    .map((part) => part.trim().replace(LEAD_IN, ""))
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const last = parts[parts.length - 1].split(" ");
  const alternatives: GearAlternative[] = [];
  for (const part of parts) {
    const phrase = tail ? `${part} and ${tail}` : part;
    const options = tail ? null : kindOptions(part);
    if (options) {
      alternatives.push({ label: part.replace(/^./, (first) => first.toUpperCase()), items: [{ name: options[0], qty: 1 }], options });
      continue;
    }
    let resolved = resolveAlternative(phrase);
    // "cold-weather or warm-weather clothes": an earlier alternative may
    // share the last one's noun.
    for (let take = 1; !resolved.resolved && take < last.length && part !== parts[parts.length - 1]; take += 1) {
      const borrowed = `${part} ${last.slice(-take).join(" ")}`;
      resolved = resolveAlternative(tail ? `${borrowed} and ${tail}` : borrowed);
    }
    if (!resolved.resolved) {
      return null;
    }
    alternatives.push({ label: phrase.replace(/^./, (first) => first.toUpperCase()), items: resolved.items });
  }
  // "Lute or other musical instrument": the kind is the instruments the
  // line did not already name.
  const named = new Set(alternatives.filter((entry) => !entry.options).flatMap((entry) => entry.items.map((item) => lower(item.name))));
  for (const entry of alternatives) {
    if (entry.options && named.size) {
      entry.options = entry.options.filter((name) => !named.has(lower(name)));
      entry.items = [{ name: entry.options[0], qty: 1 }];
    }
  }
  return alternatives;
}

// A "tool of your choice" line as a kind choice, for when no training can
// fill it: a background that hands out "a musical instrument of your
// choice" without teaching one (a homebrew row, say) still lets the player
// name it, instead of pointing at a pick the Calling step never asks for.
export function kindAlternatives(line: string): GearAlternative[] | null {
  const text = line.trim().replace(/\s*\([^)]*\)/g, "").replace(/\s+(?:of your choice|one of your choice)\s*$/i, "");
  const parts = text
    .replace(LEAD_IN, "")
    .split(/\s*,\s*or\s+|\s+or\s+|\s*,\s*/i)
    .map((part) => part.trim().replace(LEAD_IN, ""))
    .filter(Boolean);
  const alternatives: GearAlternative[] = [];
  for (const part of parts) {
    const options = kindOptions(part);
    if (!options) {
      return null;
    }
    alternatives.push({ label: part.replace(/^./, (first) => first.toUpperCase()), items: [{ name: options[0], qty: 1 }], options });
  }
  return alternatives.length ? alternatives : null;
}

// ---- the whole kit ----

export type BackgroundGearChoice = {
  // The line as the book wrote it.
  line: string;
  alternatives: GearAlternative[];
  // Which alternative the sheet carries.
  chosen: number;
  // The words the sheet stores for it (backgroundChoices.gear): the
  // alternative's, or the tool's name when the alternative is a kind.
  pick: string;
};

export type BackgroundKit = {
  // One name per piece, the shape the free-kit ledger and the chips take.
  names: string[];
  // The either-or lines, in kit order, for the gear step's pills.
  choices: BackgroundGearChoice[];
  // Tool-kind lines, with the tool each came to, or null while the pick is
  // still owed on the class step.
  toolLines: Array<{ line: string; item: string | null }>;
  problems: string[];
};

// The background's kit as the character carries it. `equipment` is the kit
// as the builder's options hold it (resolveBackgroundGear: catalog names,
// and the choice lines as written); `picks` is backgroundChoices.gear, the
// chosen alternative of each either-or line by its words, in order.
export function expandBackgroundGear(
  equipment: string[] | undefined,
  input: { tools: string[]; backgroundTools: string[]; picks: string[] },
): BackgroundKit {
  const names: string[] = [];
  const choices: BackgroundGearChoice[] = [];
  const toolLines: BackgroundKit["toolLines"] = [];
  const problems: string[] = [];
  const used = new Set<string>();
  for (const line of equipment ?? []) {
    if (/^\s*\d[\d,]*\s*gp\s*$/i.test(line)) {
      names.push(line);
      continue;
    }
    let alternatives: GearAlternative[] | null = null;
    if (isToolChoiceLine(line)) {
      const item = fillToolLine(line, { tools: input.tools, backgroundTools: input.backgroundTools, used });
      // No tool to fill it from and no pick owed on the Calling step: the
      // player names the tool here instead.
      alternatives = item || splitToolGrants(input.backgroundTools).choices.length ? null : kindAlternatives(line);
      if (!alternatives) {
        toolLines.push({ line, item });
        names.push(item ?? line);
        continue;
      }
    }
    alternatives ??= gearAlternatives(line);
    if (!alternatives) {
      names.push(line);
      continue;
    }
    const asked = (input.picks[choices.length] ?? "").trim();
    // A pick is the alternative's words, or, for a kind, the tool's name.
    let chosen = asked ? alternatives.findIndex((entry) => lower(entry.label) === lower(asked)) : 0;
    let named: string | undefined;
    if (asked && chosen < 0) {
      chosen = alternatives.findIndex((entry) => entry.options?.some((name) => lower(name) === lower(asked)));
      named = alternatives[chosen]?.options?.find((name) => lower(name) === lower(asked));
    }
    if (chosen < 0) {
      problems.push(
        `The background's kit offers ${alternatives.map((entry) => entry.label.toLowerCase()).join(" or ")}; "${asked}" is not one of them.`,
      );
      chosen = 0;
    }
    const taken = alternatives[chosen];
    if (taken.options) {
      // Unnamed: a tool of the kind the character is trained with, not yet
      // handed out by another line, else the kind's first.
      const held = input.tools.map(lower);
      const tool =
        named ??
        taken.options.find((name) => held.includes(lower(name)) && !used.has(lower(name))) ??
        taken.options[0];
      used.add(lower(tool));
      alternatives = alternatives.map((entry, at) => (at === chosen ? { ...entry, items: [{ name: tool, qty: 1 }] } : entry));
    }
    choices.push({ line, alternatives, chosen, pick: taken.options ? alternatives[chosen].items[0].name : taken.label });
    for (const item of alternatives[chosen].items) {
      for (let count = 0; count < item.qty; count += 1) {
        names.push(item.name);
      }
    }
  }
  return { names, choices, toolLines, problems };
}
