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

export type GearAlternative = { label: string; items: KitItem[] };

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
  if (!/\bor\b/i.test(text) || isToolChoiceLine(text)) {
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
  return alternatives;
}

// ---- the whole kit ----

export type BackgroundGearChoice = {
  // The line as the book wrote it.
  line: string;
  alternatives: GearAlternative[];
  // Which alternative the sheet carries.
  chosen: number;
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
    if (isToolChoiceLine(line)) {
      const item = fillToolLine(line, { tools: input.tools, backgroundTools: input.backgroundTools, used });
      toolLines.push({ line, item });
      names.push(item ?? line);
      continue;
    }
    const alternatives = gearAlternatives(line);
    if (!alternatives) {
      names.push(line);
      continue;
    }
    const asked = (input.picks[choices.length] ?? "").trim();
    let chosen = asked ? alternatives.findIndex((entry) => lower(entry.label) === lower(asked)) : 0;
    if (chosen < 0) {
      problems.push(
        `The background's kit offers ${alternatives.map((entry) => entry.label.toLowerCase()).join(" or ")}; "${asked}" is not one of them.`,
      );
      chosen = 0;
    }
    choices.push({ line, alternatives, chosen });
    for (const item of alternatives[chosen].items) {
      for (let count = 0; count < item.qty; count += 1) {
        names.push(item.name);
      }
    }
  }
  return { names, choices, toolLines, problems };
}
