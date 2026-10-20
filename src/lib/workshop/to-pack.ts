import type { WorkshopBundle } from "@/lib/workshop/bundle";
import { asciiSlugOf, textKey } from "@/lib/language/text-logic";
import { leadOf } from "@/lib/worldforge/account";
import { PLAY_WORDS } from "@/lib/worldforge/play-fields";
import { packOmissions, type PackOmission } from "@/lib/workshop/to-pack-omissions";
import { accountOfRow, readBundleWorld, type WorldRow } from "@/lib/workshop/to-pack-world";

export type { PackOmission } from "@/lib/workshop/to-pack-omissions";

// Compiling a workshop into a world pack, and saying plainly what does not
// travel.
//
// The plan's line was "a workshop that is only reskins can compile straight
// to a world pack". Building this found that the premise is half true, and
// the honest version is worth stating rather than papering over:
//
// A world pack is a PURE NAME MAPPING (docs/worlds.md, src/lib/worlds/
// types.ts). Its substance is the reskin tables: races, classes, spells,
// items and features renamed. A workshop holds none of those. Nothing in
// phases 1 to 8 produces a reskin, because a reskin is not a prep artefact,
// it is a translation table for the engine's own vocabulary. Adding an
// editor for one would be a new subsystem, which is exactly what risk 4 in
// the plan says not to do.
//
// So this compiles the OTHER half of a pack, which a workshop does produce
// in quantity and which is the tedious half to type by hand: the seeds and
// the flavour. Factions, places, hooks, a glossary, name seeds, the theme
// and the premise. The reskin tables come out empty, the notes say so, and
// the result is a starting point a person finishes in a text editor rather
// than a finished pack pretending otherwise.
//
// What goes in (audit finding WF-18):
//
//   - factions: the workshop's own factions, the ones its Factions tool and
//     WorldForge write, plus any older lore entry filed under "factions".
//     Each line is the faction's own one-line summary, then where it is
//     based and who belongs to it, as far as the pack's 200 characters go:
//     a pack's faction is a name and a line, so its members and seat ride in
//     the line rather than in fields an older install would not read.
//   - places and glossary: each entry's account (WF-13, ./to-pack-world.ts
//     accountOfRow), cut where a sentence ends.
//   - only what may be published: a lore entry kept for the DM and an entry
//     that is not canon stay out, because a pack has no private part and no
//     way to mark a line as unsettled.
//
// What stays out is named entry by entry (./to-pack-omissions.ts), so the
// author reads the whole list before publishing and nothing goes silently.
//
// Pure, and it takes a bundle rather than a database, so the same function
// serves the export path and the test.

// The pack schema's own limits, restated here so a compile that would fail
// worldPackSchema.parse gets truncated with a warning instead.
const FACTION_NAME_MAX = 60;
const FACTION_BLURB_MAX = 200;
const LOCATION_NAME_MAX = 60;
const LOCATION_BLURB_MAX = 200;
const HOOK_MAX = 240;
const GLOSSARY_TERM_MAX = 40;
const GLOSSARY_MEANING_MAX = 160;
const NAME_SEED_MAX = 40;
export const SEEDS_PER_LIST = 40;
// A faction's own line keeps at least this much room before its members
// are cut short to make space.
const SUMMARY_FLOOR = 100;
// The default Faction type's "Seat of power" field (src/lib/worldforge/model.ts).
const SEAT_FIELD = "f_seat";

export type CompiledPack = {
  // Not a WorldPack: it is a DRAFT of one, missing the reskin tables and the
  // franchise metadata a person has to choose. Typed loosely on purpose, so
  // nothing here can be mistaken for something worldPackSchema has accepted.
  draft: Record<string, unknown>;
  // What a pack never takes from a workshop, said once: the reskin tables.
  notes: string[];
  // Everything the workshop holds that the draft leaves out, kind by kind,
  // each with the exact entries it names.
  omissions: PackOmission[];
  warnings: string[];
  // How many rows of real content the draft carries. Zero means the compile
  // produced nothing worth downloading, which the UI says rather than
  // handing over an empty file.
  filled: number;
};

// What the compile took from the world beyond each row's name and line, so
// the report leaves out only what is really left out.
export type Carried = {
  // World links folded into a faction's line, by link id.
  links: Set<string>;
  // Field values folded into a faction's line, as "<ref> <field id>".
  fields: Set<string>;
  // Entries whose account was cut to fit a pack line.
  shortened: string[];
};

// The result is never longer than `max`, ellipsis included. Getting that
// wrong is not cosmetic: these limits are worldPackSchema's own, and a
// "clipped" string two characters over the line fails the parse of the very
// file this function exists to make parseable.
function clip(text: string, max: number): string {
  const trimmed = (text ?? "").replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

// A pack id is also a filename stem, and its regex is the only thing between
// a downloaded manifest and an arbitrary write path (src/lib/worlds/types.ts
// says so in its own comment). So this derives a SAFE id and falls back to a
// fixed one rather than ever emitting something that might not match.
export function packIdFrom(name: string): string {
  const slug = asciiSlugOf(name ?? "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 50);
  return /^[a-z][a-z0-9_]{2,49}$/.test(slug) ? slug : "my_world";
}

// "A", "A and B", "A, B and C".
function listed(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function uniqueByKey(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = textKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// One line in a pack's short slot: the entry's summary, on one line and cut
// where a sentence ends, with whether it had to be cut.
function lineOf(text: string, max: number): { line: string; cut: boolean } {
  const flat = clip(text, Number.POSITIVE_INFINITY);
  const line = leadOf(flat, max);
  return { line, cut: line.length < flat.length };
}

// A faction's line: its summary, then its seat, then its members, as many as
// fit. Answers which members and seats made it in, so their links count as
// carried.
function factionLine(summary: string, homes: string[], members: string[]): { blurb: string; cut: boolean; homes: number; members: number } {
  const seat = homes.length ? `Based in ${listed(homes)}.` : "";
  const flat = clip(summary, Number.POSITIVE_INFINITY);
  for (let shown = members.length; shown >= 0; shown -= 1) {
    const rest = members.length - shown;
    const names = members.slice(0, shown);
    const who = shown ? `Members: ${rest ? `${names.join(", ")} and ${rest} more` : listed(names)}.` : "";
    const tail = [seat, who].filter(Boolean).join(" ");
    const room = FACTION_BLURB_MAX - (tail ? tail.length + (flat ? 1 : 0) : 0);
    if (tail && room < Math.min(flat.length, SUMMARY_FLOOR)) continue;
    const { line, cut } = lineOf(flat, Math.max(0, room));
    return { blurb: [line, tail].filter(Boolean).join(" "), cut, homes: homes.length, members: shown };
  }
  // A seat so long that even the summary would not fit beside it.
  const { line, cut } = lineOf(flat, FACTION_BLURB_MAX);
  return { blurb: line, cut, homes: 0, members: 0 };
}

export function compileToPack(bundle: WorkshopBundle): CompiledPack {
  const warnings: string[] = [];
  const world = readBundleWorld(bundle);
  const { doc, rows } = world;
  const carried: Carried = { links: new Set(), fields: new Set(), shortened: [] };
  const open = (row: WorldRow) => !row.held;

  // ---- factions ----

  // The workshop's own factions, with who belongs and where they sit. A
  // member is a character the faction row names (its Cast members) or one a
  // known link puts there in the words play reads for a faction ("member
  // of", src/lib/worldforge/play-fields.ts); a seat is a place a known link
  // in play's words for a home puts the faction in, or its Seat of power
  // field.
  const heldCast = new Set(rows.npc.filter((npc) => !open(npc)).map((npc) => textKey(npc.name)));
  const factions = rows.faction.filter(open).map((row) => {
    const index = Number(row.ref.slice("faction:#".length));
    const memberLinks = doc.links.filter(
      (link) => link.to === row.ref && PLAY_WORDS.faction.includes(link.label) && link.veracity === "known" && world.byRef.get(link.from)?.shelf === "npc" && open(world.byRef.get(link.from)!),
    );
    const homeLinks = doc.links.filter(
      (link) => link.from === row.ref && PLAY_WORDS.home.includes(link.label) && link.veracity === "known" && world.byRef.get(link.to)?.shelf === "location" && open(world.byRef.get(link.to)!),
    );
    const seatField = row.entry.fields[SEAT_FIELD];
    const seatText = typeof seatField === "string" ? seatField : "";
    const homes = uniqueByKey([...homeLinks.map((link) => world.nameOf(link.to)), ...(seatText ? [seatText] : [])]);
    const members = uniqueByKey([
      ...bundle.factions[index].members.filter((name) => !heldCast.has(textKey(name))),
      ...memberLinks.map((link) => world.nameOf(link.from)),
    ]);
    // The row's own line is the summary the table already sees; an entry
    // with only an article gives its opening instead.
    const summary = row.text.trim() || accountOfRow(row);
    const line = factionLine(summary, homes, members);
    if (line.cut) carried.shortened.push(row.name);
    if (line.homes) {
      for (const link of homeLinks) carried.links.add(link.id);
      if (seatText) carried.fields.add(`${row.ref} ${SEAT_FIELD}`);
    }
    const shownMembers = new Set(members.slice(0, line.members).map(textKey));
    for (const link of memberLinks) {
      if (shownMembers.has(textKey(world.nameOf(link.from)))) carried.links.add(link.id);
    }
    return { name: clip(row.name, FACTION_NAME_MAX), blurb: line.blurb };
  });
  // Older lore filed under "factions", for a workshop written before the
  // Factions tool; a native faction of the same name wins.
  const factionKeys = new Set(factions.map((entry) => textKey(entry.name)));
  for (const row of rows.lore.filter(open)) {
    const lore = bundle.lore[Number(row.ref.slice("lore:#".length))];
    if (lore.category !== "factions" || factionKeys.has(textKey(row.name))) continue;
    const { line, cut } = lineOf(accountOfRow(row), FACTION_BLURB_MAX);
    if (cut) carried.shortened.push(row.name);
    factionKeys.add(textKey(row.name));
    factions.push({ name: clip(row.name, FACTION_NAME_MAX), blurb: line });
  }

  // ---- the rest of the lore, places, hooks and names ----

  const glossary = rows.lore
    .filter((row) => open(row) && bundle.lore[Number(row.ref.slice("lore:#".length))].category !== "factions")
    .map((row) => {
      const { line, cut } = lineOf(accountOfRow(row), GLOSSARY_MEANING_MAX);
      if (cut) carried.shortened.push(row.name);
      return { term: clip(row.name, GLOSSARY_TERM_MAX), meaning: line };
    })
    .filter((entry) => entry.term && entry.meaning);

  const locations = rows.location.filter(open).map((row) => {
    const { line, cut } = lineOf(accountOfRow(row), LOCATION_BLURB_MAX);
    if (cut) carried.shortened.push(row.name);
    return { name: clip(row.name, LOCATION_NAME_MAX), blurb: line };
  });

  // Hooks are the storyboard's hook cards, which is the one beat kind that
  // means exactly what a pack's `hooks` field means.
  const hooks = bundle.storyboard
    .filter((beat) => beat.kind === "hook")
    .map((beat) => clip(`${beat.title}. ${beat.body}`, HOOK_MAX))
    .filter(Boolean);

  const people = rows.npc
    .filter(open)
    .map((row) => clip(row.name, NAME_SEED_MAX))
    .filter(Boolean)
    .slice(0, SEEDS_PER_LIST);
  const places = rows.location
    .filter(open)
    .map((row) => clip(row.name, NAME_SEED_MAX))
    .filter(Boolean)
    .slice(0, SEEDS_PER_LIST);

  // ---- what did not travel ----

  const notes = [
    "A pack's reskin tables (races, classes, backgrounds, spells, items, features) rename what the engine already has. A workshop holds no reskins, so these come out empty and are yours to write.",
  ];
  const omissions = packOmissions(bundle, world, carried);

  if (!bundle.manifest.rightsHolder.trim()) {
    warnings.push(
      "No rights holder is set, so this compiles as an original world. If it is built on somebody else's setting, fill that in before sharing it.",
    );
  }

  const draft = {
    id: packIdFrom(bundle.manifest.name),
    name: bundle.manifest.name,
    blurb: bundle.manifest.blurb,
    version: bundle.manifest.version,
    author: bundle.manifest.author,
    homepage: bundle.manifest.homepage,
    inspiredBy: bundle.manifest.inspiredBy,
    rightsHolder: bundle.manifest.rightsHolder,
    // A franchise is a grouping choice, not something a workshop knows. It
    // defaults to the pack's own name, which renders as a single button.
    franchise: clip(bundle.manifest.name, 60) || "My world",
    edition: "",
    editionOrder: 0,
    baseGenre: bundle.genre,
    dmFlavor: "",
    mapStyle: "",
    portraitStyle: "",
    sceneStyle: "",
    nameHints: "",
    raceHint: "",
    companionRaces: [],
    theme: clip(bundle.theme || bundle.manifest.name, 120),
    premise: clip(bundle.premise || bundle.manifest.blurb, 500),
    races: [],
    classes: [],
    backgrounds: [],
    spells: [],
    items: [],
    features: [],
    monsters: [],
    alignments: [],
    nameSeeds: { people, places },
    factions,
    locations,
    hooks,
    glossary,
  };

  return {
    draft,
    notes,
    omissions,
    warnings,
    filled: factions.length + locations.length + hooks.length + glossary.length,
  };
}

// The setting lists a compile filled that a draft does not hold (yet): what
// Pull from this workshop would add, or what the author took out. Matched
// by name as mergePulled matches them (src/lib/worlds/draft.ts).
export type SettingLists = {
  factions: Array<{ name: string }>;
  locations: Array<{ name: string }>;
  hooks: string[];
  glossary: Array<{ term: string }>;
};

export function notInDraft(compiled: SettingLists, draft: SettingLists): PackOmission | null {
  const missing = (incoming: string[], held: string[], kind: string) => {
    const have = new Set(held.map(textKey));
    return incoming.filter((name) => name && !have.has(textKey(name))).map((name) => `${kind}: ${name}`);
  };
  const assets = [
    ...missing(compiled.factions.map((entry) => entry.name), draft.factions.map((entry) => entry.name), "Faction"),
    ...missing(compiled.locations.map((entry) => entry.name), draft.locations.map((entry) => entry.name), "Place"),
    ...missing(compiled.hooks, draft.hooks, "Hook"),
    ...missing(compiled.glossary.map((entry) => entry.term), draft.glossary.map((entry) => entry.term), "Glossary"),
  ];
  return assets.length
    ? {
        key: "not-pulled",
        group: "setting",
        label: "Not in the draft",
        reason: "The workshop has these and the pack draft does not, so the pack leaves them out. Pull from this workshop adds them; one you took out on purpose can stay out.",
        assets,
      }
    : null;
}
