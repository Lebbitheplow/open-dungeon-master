// The pure half of the lineage grid and the class cards: which plate a card
// shows, its one-line character, its chips, what a trait row opens onto, and
// the order the carousel walks. No React and no fetches, so
// scripts/test-lineage-cards.mjs drives every rule here
// (docs/visual-overhaul-plan.md 7.3 and 7.5).

import { characterPlaceholder, normalizeGender, raceFamily } from "@/lib/placeholders";
import type { Ability } from "@/lib/schemas/sheet";
import { canonicalRaceId, srdRaceFor } from "@/lib/content/race-options";

const BASE = "/assets/placeholders";

// What the parser and the "leaves you to choose" list need from a race. Both
// the bundled SRD rows and the builder's RaceOption satisfy it.
export type LineageEntry = {
  id: string;
  name: string;
  asi: Partial<Record<Ability, number>>;
  asiChoice?: { count: number; amount: number };
  bonusLanguages?: number;
  skillChoice?: { count: number };
  cantripChoice?: { list: string; count: number };
  toolChoice?: { count: number; from: string[] };
};

// Shared with the help layer and the feature grants, so a pack slug, an
// "odm-" copy and a bundled id all find the same lineage.
export { canonicalRaceId, srdRaceFor };

// Pack lineages beyond the SRD still deserve a face. Most are a heritage or a
// variant of a family we have painted, so the family word in the slug or the
// name picks the plate. Order matters: "half-elf" before "elf", a gearforged
// "dwarf chassis" is a construct before it is a dwarf.
const FAMILY_WORDS: Array<[RegExp, string]> = [
  [/chassis|gearforged|warforged/, "warforged"],
  [/drow/, "drow"],
  [/half[\s_-]?elf/, "half-elf"],
  [/half[\s_-]?orc|(^|[\s_])orc([\s_]|$)/, "half-orc"],
  [/dwarf/, "dwarf"],
  [/halfling|lightfoot|stout/, "halfling"],
  [/elf/, "elf"],
  [/gnome/, "gnome"],
  [/dragonborn/, "dragonborn"],
  [/tiefling/, "tiefling"],
  [/aasimar/, "aasimar"],
  [/goliath/, "goliath"],
  [/firbolg/, "firbolg"],
  [/tabaxi|catfolk|pantheran|malkin/, "tabaxi"],
  [/kenku|ravenfolk/, "kenku"],
  [/tortle/, "tortle"],
  [/genasi/, "genasi"],
  [/changeling/, "changeling"],
  [/bugbear/, "bugbear"],
  [/goblin/, "goblin"],
  [/lizardfolk/, "lizardfolk"],
  [/human/, "human"],
];

export function lineageFamily(raceId: string, name = ""): string | null {
  const direct = raceFamily(canonicalRaceId(raceId));
  if (direct) {
    return direct;
  }
  const haystack = `${canonicalRaceId(raceId)} ${name.toLowerCase()}`;
  return FAMILY_WORDS.find(([pattern]) => pattern.test(haystack))?.[1] ?? null;
}

// The plate a lineage card shows, in the gender the player gave on step one.
export function lineageArt(raceId: string, name = "", gender?: string | null): string {
  const family = lineageFamily(raceId, name);
  if (!family) {
    return characterPlaceholder({ gender });
  }
  return `${BASE}/character-race/${family}-${normalizeGender(gender)}.webp`;
}

function stableBit(value: string): number {
  let acc = 0;
  for (let index = 0; index < value.length; index += 1) {
    acc = (acc * 31 + value.charCodeAt(index)) >>> 0;
  }
  return acc & 1;
}

// The plate a class card shows. The setting classes were painted in two
// genders only, and a card is a picture of the class rather than of this
// character, so an unstated gender borrows one of the two instead of falling
// through to the hooded stranger.
export function classArt(classId: string, gender?: string | null): string {
  const own = characterPlaceholder({ class: classId, gender });
  if (own.includes("/character-class/") || normalizeGender(gender) !== "neutral") {
    return own;
  }
  const borrowed = characterPlaceholder({
    class: classId,
    gender: stableBit(classId) ? "feminine" : "masculine",
  });
  return borrowed.includes("/character-class/") ? borrowed : own;
}

// A lineage's two-word character, read off whichever ability it favours.
const ASI_CHARACTER: Record<Ability, string> = {
  str: "Built to endure",
  dex: "Quick and sure",
  con: "Hard to put down",
  int: "Studied and sharp",
  wis: "Watchful",
  cha: "Commands a room",
};

export function lineageTagline(entry: Pick<LineageEntry, "asi" | "asiChoice">): string {
  const bumps = Object.entries(entry.asi).filter(([, bonus]) => (bonus ?? 0) > 0) as Array<
    [Ability, number]
  >;
  if (bumps.length === 6) {
    return "Adaptable";
  }
  if (!bumps.length) {
    return entry.asiChoice ? "Yours to shape" : "";
  }
  // Array.sort is stable, so a tie keeps the order the race lists them in.
  const [top] = [...bumps].sort((a, b) => b[1] - a[1]);
  return ASI_CHARACTER[top[0]] ?? "";
}

export type AsiChip = { ability: string; bonus: string; label: string };

export function asiChips(asi: Partial<Record<Ability, number>>): AsiChip[] {
  const bumps = Object.entries(asi).filter(([, bonus]) => (bonus ?? 0) !== 0) as Array<
    [Ability, number]
  >;
  // Six equal bumps read better as one chip than as the first two of six.
  if (bumps.length === 6 && bumps.every(([, bonus]) => bonus === bumps[0][1])) {
    const bonus = `+${bumps[0][1]}`;
    return [{ ability: "ALL", bonus, label: `ALL ${bonus}` }];
  }
  return bumps.map(([ability, value]) => {
    const bonus = value > 0 ? `+${value}` : String(value);
    return { ability: ability.toUpperCase(), bonus, label: `${ability.toUpperCase()} ${bonus}` };
  });
}

const COUNT_WORD: Record<number, string> = { 1: "One", 2: "Two", 3: "Three", 4: "Four" };
const countWord = (count: number) => COUNT_WORD[count] ?? String(count);

// Everything the lineage leaves to the player, which is what the section
// under the grid is there to collect.
export function lineageChoices(entry: LineageEntry): string[] {
  const out: string[] = [];
  if (entry.asiChoice) {
    out.push(
      `${countWord(entry.asiChoice.count)} ${entry.asiChoice.count === 1 ? "ability" : "abilities"} to raise by ${entry.asiChoice.amount}`,
    );
  }
  if (entry.bonusLanguages) {
    out.push(
      `${countWord(entry.bonusLanguages)} bonus ${entry.bonusLanguages === 1 ? "language" : "languages"}`,
    );
  }
  if (entry.skillChoice) {
    out.push(
      `${countWord(entry.skillChoice.count)} skill ${entry.skillChoice.count === 1 ? "proficiency" : "proficiencies"}`,
    );
  }
  if (entry.cantripChoice) {
    out.push(
      `${countWord(entry.cantripChoice.count)} ${entry.cantripChoice.list} ${entry.cantripChoice.count === 1 ? "cantrip" : "cantrips"}`,
    );
  }
  if (entry.toolChoice) {
    out.push(
      `${countWord(entry.toolChoice.count)} ${entry.toolChoice.count === 1 ? "set" : "sets"} of artisan's tools`,
    );
  }
  return out;
}

export type ParsedTrait = { head: string; body: string | null };

// What a trait line opens onto. Three shapes appear in races.json:
// "Name (what it does)", where the bracket is the mechanic; "Grant (Feature
// Name)" and "+1 HP per level (Feature)", where the bracket is only the
// feature's name and the line itself is the mechanic; and a bare line, which
// may name a choice this step collects. A bare line with nothing behind it is
// a locked row: a name with no chevron.
export function parseTrait(line: string, entry: LineageEntry): ParsedTrait {
  const text = line.trim();
  const inverted = /^\+/.test(text) || /proficienc(y|ies)[^(]*\(/i.test(text);
  const match = inverted ? null : /^([^(]+?)\s*\((.+)\)$/.exec(text);
  if (match) {
    const body = match[2].trim();
    return { head: match[1].trim(), body: `${body[0].toUpperCase()}${body.slice(1)}.` };
  }
  if (/language/i.test(text) && entry.bonusLanguages) {
    const count = entry.bonusLanguages;
    return {
      head: text,
      body: `${countWord(count)} more ${count === 1 ? "tongue" : "tongues"} of your choice, asked for on this step.`,
    };
  }
  if (/cantrip/i.test(text) && entry.cantripChoice) {
    const { count, list } = entry.cantripChoice;
    return {
      head: text,
      body: `${countWord(count)} ${list} ${count === 1 ? "cantrip" : "cantrips"} of your choice, asked for on this step.`,
    };
  }
  if (/skill/i.test(text) && entry.skillChoice) {
    const { count } = entry.skillChoice;
    return {
      head: text,
      body: `${countWord(count)} ${count === 1 ? "skill" : "skills"} of your choice, asked for on this step.`,
    };
  }
  if (/tool/i.test(text) && entry.toolChoice) {
    return {
      head: text,
      body: `One of ${entry.toolChoice.from.join(", ")}, asked for on this step.`,
    };
  }
  return { head: text, body: null };
}

// The lines the accordion lists. A bundled race has them whole; a pack row
// only carries the builder's one-line summary, so that is split back apart.
export function traitLines(race: { id: string; note?: string }): string[] {
  const srd = srdRaceFor(race.id);
  if (srd) {
    return srd.traits;
  }
  return String(race.note ?? "")
    .split(" · ")
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---- the carousel's order ----

export type CardGroupLike<T> = { label: string | null; recommended?: boolean; options: T[] };
export type FlatCard<T> = { option: T; group: string | null; recommended: boolean };

// The carousel walks exactly the list the grid shows: group by group, in the
// picker's order, so "next" from the last recommended people is the first of
// the rest.
export function flattenGroups<T>(groups: Array<CardGroupLike<T>>): Array<FlatCard<T>> {
  return groups.flatMap((group) =>
    group.options.map((option) => ({
      option,
      group: group.label,
      recommended: Boolean(group.recommended),
    })),
  );
}

export function wrapIndex(index: number, delta: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (((index + delta) % length) + length) % length;
}

// The grid's search box: every word typed must appear in the name or in the
// canonical name behind a reskin. Groups left empty drop out.
export function filterGroups<T extends { name: string; meta?: string }>(
  groups: Array<CardGroupLike<T>>,
  query: string,
): Array<CardGroupLike<T>> {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return groups;
  }
  return groups
    .map((group) => ({
      ...group,
      options: group.options.filter((option) => {
        const haystack = `${option.name} ${option.meta ?? ""}`.toLowerCase();
        return words.every((word) => haystack.includes(word));
      }),
    }))
    .filter((group) => group.options.length > 0);
}

// A content pack can bring eighty peoples, and the choices a lineage leaves
// open sit under the grid, so a long grid starts folded: the recommended tier
// whole (it is what the setting says belongs here), the leading group whole
// when the list has groups at all (the standard classes ahead of the other
// settings' classes), then the first cards of the rest, and always the chosen
// card wherever it sits. Order never changes.
export function foldGroups<T extends { id: string }>(
  groups: Array<CardGroupLike<T>>,
  { limit, keepId }: { limit: number; keepId: string },
): { groups: Array<CardGroupLike<T>>; hidden: number } {
  let budget = limit;
  let hidden = 0;
  const folded = groups
    .map((group, index) => {
      if (group.recommended || (index === 0 && groups.length > 1)) {
        budget -= group.options.length;
        return group;
      }
      const options = group.options.filter((option) => {
        if (option.id === keepId) {
          return true;
        }
        if (budget > 0) {
          budget -= 1;
          return true;
        }
        hidden += 1;
        return false;
      });
      return { ...group, options };
    })
    .filter((group) => group.options.length > 0);
  return { groups: folded, hidden };
}
