// The picks a class feature lets come from any class's spell list, as the
// level-up dialog and the builder's spell step offer them (issue #570, the
// SRD text audit, CLS-19 to CLS-22): a bard's Magical Secrets, a Lore bard's
// Additional Magical Secrets, a Pact of the Tome warlock's Book of Shadows.
// The level-up route took these picks by name (src/lib/srd/class-spell-grants.ts)
// while both screens listed only the class's own spells, so a player could
// not make them.
//
// This says how many such picks the screen offers as their own group, what
// the group is called, and how many new spells and cantrips the class's own
// list keeps, by the count the level-up route keeps
// (src/lib/srd/level-up-spells.ts). The route stays the authority: the
// screen proposes, the route accepts or refuses.
//
// Pure, no JSX, so scripts/test-any-list-picks.mjs drives it.
import type { ClassSpellGrants } from "@/lib/srd/class-spell-grants";
import { textKey } from "@/lib/language/text-logic";

export type AnyListGroup = {
  // The feature or features the picks come from, as the SRD names them.
  feature: string;
  // "Magical Secrets: 2 spells from any class".
  title: string;
  // Where the picks may come from and how they count.
  hint: string;
  // The picks the group takes at this level.
  slots: number;
  // Levelled spells (Magical Secrets), or cantrips only (the Book of Shadows).
  spells: boolean;
  // Cantrips: the Book of Shadows' always, a bard's while a new cantrip is
  // open (the route counts one among the cantrips known).
  cantrips: boolean;
  // Whether a pick also takes a place in the class's own count: a cantrip
  // through Magical Secrets takes a cantrip known; in the builder, where the
  // whole list is chosen at once, every pick sits inside the list's count.
  sharesCantrips: boolean;
  sharesSpells: boolean;
};

export type SpellPickRooms = {
  group: AnyListGroup | null;
  // How many of the group's picks, in the order made, still fit: a spell
  // given back from a swap can take a slot away again.
  kept: number;
  // New levelled spells and cantrips the class's own list may still take.
  spells: number;
  cantrips: number;
};

const ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

// How many spells the caster holds off the class's list, as the level-up
// route counts them against the features' number: neither granted nor on
// the list (`onList` takes in a patron's expanded spells and a Divine Soul's
// cleric list), the race's cantrips left out by their count. Levelled spells
// count only where the feature takes them (Magical Secrets).
export function offListHeld(input: {
  grants: Pick<ClassSpellGrants, "anyList" | "anyListSpells">;
  cantrips: readonly string[];
  spells: readonly string[];
  onList: (name: string) => boolean;
  // The granted spells (a subclass's, find familiar).
  granted: (name: string) => boolean;
  freeCantrips: number;
}): number {
  if (!input.grants.anyList) {
    return 0;
  }
  const off = (names: readonly string[]) => {
    const seen = new Set<string>();
    return names.filter((name) => {
      const key = textKey(name);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return !input.granted(name) && !input.onList(name);
    }).length;
  };
  const cantrips = Math.max(0, off(input.cantrips) - input.freeCantrips);
  return cantrips + (input.grants.anyListSpells ? off(input.spells) : 0);
}

type Source = ClassSpellGrants["sources"][number];

// The features whose picks are open: the one this level brings when the
// open picks are no more than it gives (a Lore bard reaching 10th, the
// Additional Magical Secrets already taken), every one held otherwise. A
// class's sources differ by whether they sit on top of its count.
function sourcesOpen(grants: Pick<ClassSpellGrants, "sources">, before: Pick<ClassSpellGrants, "sources">, open: number): Source[] {
  const was = (source: Source) => before.sources.find((held) => held.onTop === source.onTop)?.count ?? 0;
  const arriving = grants.sources.filter((source) => source.count > was(source));
  const brought = arriving.reduce((sum, source) => sum + source.count - was(source), 0);
  return arriving.length && open <= brought ? arriving : grants.sources.filter((source) => source.count > 0);
}

// The group's sentence. `own` is the class's name as a sentence reads it
// ("bard"). `ownAbove`: the group leaves out the class's own list, which the
// book above holds (the builder); otherwise it lists it too, as Magical
// Secrets allows ("including this one").
function hintFor(input: { sources: Source[]; spells: boolean; cantrips: boolean; own: string; maxLevel: number; ownAbove: boolean }): string {
  const lists = input.ownAbove
    ? `any other class's spell list (the ${input.own}'s own are above)`
    : `any class's spell list, the ${input.own}'s included`;
  if (!input.spells) {
    // The Book of Shadows: cantrips only.
    const from = input.ownAbove ? `Cantrips from ${lists}.` : `Any class's cantrips, the ${input.own}'s included.`;
    return `${from} Your Book of Shadows holds them, on top of the cantrips you know.`;
  }
  const reach = ORDINALS[input.maxLevel] ? `a spell up to ${ORDINALS[input.maxLevel]} level` : "a spell of a level you can cast";
  const from = `From ${lists}: ${reach}${input.cantrips ? " or a cantrip" : ""}.`;
  // A class has at most one source on top of its count.
  const extra = input.sources.find((source) => source.onTop);
  const counted = !extra
    ? " They count among your spells known."
    : input.sources.every((source) => source.onTop)
      ? " They come on top of your spells known."
      : ` The ${extra.count} from ${extra.feature} come on top of your spells known.`;
  const cantrip = input.cantrips
    ? ` A cantrip chosen here also takes one of your ${input.ownAbove ? "cantrips known" : "new cantrips"}.`
    : "";
  return `${from}${counted}${cantrip}`;
}

const featureOf = (sources: Source[]) => sources.map((source) => source.feature).join(" and ");

function titleFor(feature: string, slots: number, spells: boolean): string {
  const noun = spells ? (slots === 1 ? "spell" : "spells") : slots === 1 ? "cantrip" : "cantrips";
  return `${feature}: ${slots} ${noun} from any class`;
}

// The group the level offers, the picks of it that still fit, and what the
// class's own list keeps. `spells` and `cantrips` are the room the counts
// leave this level (the features' extras included, a swapped-out spell's
// place too). Magical Secrets' spells are in the Spells Known number, so the
// group takes its picks out of the room for new spells; the Book of Shadows'
// out of the room for new cantrips (its three sit on top of the count).
export function spellPickRooms(input: {
  grants: ClassSpellGrants;
  // The class at the level it held, as the route reads it.
  before: Pick<ClassSpellGrants, "anyList" | "sources">;
  keptOff: number;
  spells: number;
  cantrips: number;
  // The group's picks so far, in the order made: true for a cantrip.
  picks: readonly boolean[];
  // For the hint: the class's name as a sentence reads it ("bard") and the
  // highest spell level it casts.
  own: string;
  maxLevel: number;
}): SpellPickRooms {
  const { grants } = input;
  const plain: SpellPickRooms = { group: null, kept: 0, spells: input.spells, cantrips: input.cantrips };
  // As the route counts: the off-list spells held use up the features'
  // number as far as it reached before this level.
  const open = Math.max(0, grants.anyList - Math.min(input.before.anyList, input.keptOff));
  if (!open) {
    return plain;
  }
  const levelled = grants.anyListSpells;
  const slots = Math.min(open, levelled ? input.spells : input.cantrips);
  if (slots <= 0) {
    return plain;
  }
  // A cantrip taken through Magical Secrets also takes a new cantrip, which
  // the route counts among the cantrips known.
  let cantripsLeft = levelled ? input.cantrips : input.cantrips - slots;
  let kept = 0;
  for (const cantrip of input.picks) {
    if (kept >= slots || (!cantrip && !levelled) || (cantrip && levelled && cantripsLeft <= 0)) {
      break;
    }
    if (cantrip && levelled) {
      cantripsLeft -= 1;
    }
    kept += 1;
  }
  const offersCantrips = !levelled || input.cantrips > 0;
  const sources = sourcesOpen(grants, input.before, open);
  const feature = featureOf(sources);
  return {
    group: {
      feature,
      title: titleFor(feature, slots, levelled),
      hint: hintFor({ sources, spells: levelled, cantrips: levelled && offersCantrips, own: input.own, maxLevel: input.maxLevel, ownAbove: false }),
      slots,
      spells: levelled,
      cantrips: offersCantrips,
      // The Book of Shadows' room was carved out above; a Magical Secrets
      // cantrip still needs a new cantrip.
      sharesCantrips: levelled,
      sharesSpells: false,
    },
    kept,
    spells: levelled ? input.spells - slots : input.spells,
    cantrips: Math.max(0, cantripsLeft),
  };
}

// The builder's group: the whole list is chosen at once, so the group holds
// every pick the build has made off the class's list, up to the features'
// whole number, as the creation check counts them
// (src/lib/srd/legality/spells.ts, spellNameProblems), and each pick also
// takes its place in the list's count. The class's own spells stay in the
// book above. `cantrips` and `spells` are the chosen ones, the free ones (a
// race's, a feat's, a subclass's) left out.
export function builderAnyListGroup(input: {
  grants: ClassSpellGrants;
  cantrips: readonly string[];
  spells: readonly string[];
  onList: (name: string) => boolean;
  cantripCap: number | null;
  // The class's name as a sentence reads it ("bard").
  own: string;
  maxLevel: number;
}): { group: AnyListGroup | null; chosen: string[] } {
  const { grants } = input;
  if (!grants.anyList) {
    return { group: null, chosen: [] };
  }
  const levelled = grants.anyListSpells;
  const off = (names: readonly string[]) => names.filter((name) => !input.onList(name));
  const chosen = [...off(input.cantrips), ...(levelled ? off(input.spells) : [])];
  const offersCantrips = !levelled || (input.cantripCap ?? 0) > 0;
  const sources = grants.sources.filter((source) => source.count > 0);
  const feature = featureOf(sources);
  return {
    group: {
      feature,
      title: titleFor(feature, grants.anyList, levelled),
      hint: hintFor({ sources, spells: levelled, cantrips: levelled && offersCantrips, own: input.own, maxLevel: input.maxLevel, ownAbove: true }),
      slots: grants.anyList,
      spells: levelled,
      cantrips: offersCantrips,
      sharesCantrips: true,
      sharesSpells: levelled,
    },
    chosen,
  };
}

// Why a spell in the group cannot be picked now, or null when it can: the
// group's picks are all made, or the count the pick also takes a place in
// is full. `short` is the tile's line, `long` the note a tap shows.
export function anyListPickRefusal(input: {
  group: AnyListGroup;
  // The group's picks that still fit.
  picked: number;
  cantrip: boolean;
  // Room the class's own counts still have after their picks: new cantrips
  // (or cantrips known in the builder), and spells known (the builder).
  cantripsOpen: number;
  spellsOpen?: number;
  name: string;
}): { short: string; long: string } | null {
  if (input.picked >= input.group.slots) {
    return {
      short: "All chosen",
      long: `That is every ${input.group.feature} pick. Untick one to choose ${input.name}.`,
    };
  }
  if (input.cantrip && input.group.sharesCantrips && input.cantripsOpen <= 0) {
    return {
      short: "Cantrips full",
      long: `A cantrip chosen here also takes one of your cantrips, and they are all chosen. Untick one to choose ${input.name}.`,
    };
  }
  if (!input.cantrip && input.group.sharesSpells && (input.spellsOpen ?? 0) <= 0) {
    return {
      short: "Known spells full",
      long: `A spell chosen here also takes one of your spells known, and they are all chosen. Untick one above to choose ${input.name}.`,
    };
  }
  return null;
}

export type AnyListRow = {
  name: string;
  level: number;
  slug?: string;
  source?: string;
  document?: string;
  documentSlug?: string;
  data?: Record<string, unknown>;
};

// A tile of the group's spell book, shaped as SpellBook's (SpellTile).
export type AnyListTile = {
  name: string;
  level: number;
  state: "ready" | "available";
  note?: string;
  blocked?: string;
  data?: Record<string, unknown>;
  slug?: string;
  homebrew?: boolean;
  source?: string;
};

// The group's tiles: every class's spells the group takes, less those the
// caster holds or is granted. A spell chosen from the class's own list says
// so (`elsewhere`) rather than being chosen twice.
export function anyListTiles(input: {
  group: AnyListGroup;
  pool: readonly AnyListRow[];
  // What the caster holds or is granted.
  held: (name: string) => boolean;
  picks: readonly string[];
  elsewhere: (name: string) => string | null;
  refusal: (name: string, cantrip: boolean) => { short: string } | null;
}): AnyListTile[] {
  const picked = new Set(input.picks.map(textKey));
  const seen = new Set<string>();
  return input.pool.flatMap((row): AnyListTile[] => {
    const key = textKey(row.name);
    if (seen.has(key) || input.held(row.name) || !(row.level === 0 ? input.group.cantrips : input.group.spells)) {
      return [];
    }
    seen.add(key);
    const chosen = picked.has(key);
    return [
      {
        name: row.name,
        level: row.level,
        state: chosen ? "ready" : "available",
        ...(chosen ? { note: "New" } : {}),
        ...(chosen ? {} : { blocked: input.elsewhere(row.name) ?? input.refusal(row.name, row.level === 0)?.short }),
        data: row.data,
        slug: row.slug,
        homebrew: row.source === "homebrew",
        ...(row.document && row.documentSlug !== "wotc-srd" ? { source: row.document } : {}),
      },
    ];
  });
}
