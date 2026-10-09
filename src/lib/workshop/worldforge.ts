import { generateOverworldTerrain, fnv1a, OVERWORLD_HEIGHT, OVERWORLD_WIDTH } from "@/lib/overworld/logic";
import { IMAGE_DATA_URL, WORKSHOP_BUNDLE_VERSION } from "@/lib/workshop/bundle-schema";

// A world from WorldForge (Smoebo's world-building app), arriving as its
// JSON export, turned into a workshop bundle the ordinary import reads
// (src/lib/workshop/bundle.ts readBundle). Only the export's data format is
// read here; nothing of WorldForge's own code is used.
//
//   characters -> the Cast (aliases, where they live, how they stand with
//                 each other, their portrait)
//   factions   -> factions, with the characters linked to them as members
//   locations  -> places, linked to each other, pinned on a region map
//   any other  -> lore (an artifact is magic lore, a custom type "other")
//   events     -> history lore, and one chronology across the calendars
//   secrets, hidden truths, author-only fields, non-canon entries
//              -> DM-only lore
//   scenes     -> storyboard cards in each story's order
//   stubs      -> one DM-only note of open questions
//
// SECURITY: the export is untrusted. Every string is cut to the bundle's
// limits before the bundle schema checks it again, every list is capped, and
// the export's `settings` block (which can hold an image service's API key)
// is never read.

type Raw = Record<string, unknown>;

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const record = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});

// Whether a parsed file is a WorldForge export rather than a bundle.
export function isWorldForgeExport(value: unknown): boolean {
  const raw = record(value);
  return typeof raw.worldName === "string" && Array.isArray(raw.entities) && typeof raw.version === "number" && raw.kind === undefined;
}

type Entity = {
  id: string;
  name: string;
  type: string;
  summary: string;
  notes: string;
  hiddenTruth: string;
  aliases: string[];
  tags: string[];
  canon: string;
  categoryId: string;
  links: Array<{ targetId: string; label: string; hidden: boolean }>;
  fields: Raw;
};

function entityOf(raw: unknown): Entity | null {
  const row = record(raw);
  const id = text(row.id, 80);
  const name = text(row.name, 120);
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    type: text(row.type, 40) || "Other",
    summary: text(row.summary, 6_000),
    notes: text(row.notes, 6_000),
    hiddenTruth: text(row.hiddenTruth, 4_000),
    aliases: list(row.aliases, 12).map((alias) => text(alias, 80)).filter(Boolean),
    tags: list(row.tags, 12).map((tag) => text(tag, 40)).filter(Boolean),
    canon: text(row.canon, 20) || "canon",
    categoryId: text(row.categoryId, 80),
    links: list(row.links, 40)
      .map((link) => record(link))
      .map((link) => ({ targetId: text(link.targetId, 80), label: text(link.label, 80), hidden: link.veracity === "hidden" }))
      .filter((link) => link.targetId),
    fields: record(row.fields),
  };
}

// How a link reads as a standing between two people (src/lib/dm/npc-logic.ts
// relations run -3 to +3).
function standingOf(label: string): number {
  const words = label.toLowerCase();
  if (/(enemy|rival|hates?|betray|murder|killed|death of|feud|nemesis)/.test(words)) return -2;
  if (/(spouse|wife|husband|parent|child|son|daughter|sibling|brother|sister|loved?|friend|ally|mentor|student|apprentice)/.test(words)) return 2;
  return 0;
}

const portrait = (images: Raw, id: string) => {
  const url = typeof images[id] === "string" ? (images[id] as string) : "";
  return url.length <= 11_000_000 && IMAGE_DATA_URL.test(url) ? url : "";
};

export function worldForgeToBundle(raw: unknown): Record<string, unknown> {
  const world = record(raw);
  const worldName = text(world.worldName, 70) || "A WorldForge world";
  const entities = list(world.entities, 2_000).map(entityOf).filter((entity): entity is Entity => entity !== null);
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "";
  const categories = new Map(list(world.categories, 200).map((row) => [text(record(row).id, 80), text(record(row).name, 40)]));
  const calendars = new Map(
    list(world.calendars, 20).map((row) => {
      const calendar = record(row);
      return [text(calendar.id, 80), { name: text(calendar.name, 80), abbrev: text(calendar.abbrev, 12), offset: Number(calendar.epochOffset) || 0, notes: text(calendar.notes, 400) }];
    }),
  );
  const types = new Map(list(world.types, 60).map((row) => [text(record(row).name, 40), list(record(row).fields, 40).map(record)]));
  const images = record(record(world.media).entityImages);
  const yearOf = (value: unknown) => {
    const year = record(value);
    const calendar = calendars.get(text(year.calendarId, 80));
    return year.yearNum === undefined ? "" : `${String(year.yearNum)}${calendar?.abbrev ? ` ${calendar.abbrev}` : ""}`;
  };
  // An entity's own fields, the author-only ones apart.
  const fieldLines = (entity: Entity) => {
    const open: string[] = [];
    const hidden: string[] = [];
    for (const field of types.get(entity.type) ?? []) {
      const value = entity.fields[text(field.id, 80)];
      if (value === undefined || value === null || value === "") continue;
      const shown = field.kind === "year" ? yearOf(value) : typeof value === "object" ? "" : String(value).slice(0, 200);
      if (!shown) continue;
      (field.authorOnly === true ? hidden : open).push(`${text(field.name, 60)}: ${shown}`);
    }
    return { open, hidden };
  };
  const tagsOf = (entity: Entity) => [...entity.tags, categories.get(entity.categoryId) ?? "", entity.canon !== "canon" ? entity.canon : ""].filter(Boolean).slice(0, 12);
  const linked = (entity: Entity, type: string) => entity.links.filter((link) => byId.get(link.targetId)?.type === type);

  const people = entities.filter((entity) => entity.type === "Character");
  const places = entities.filter((entity) => entity.type === "Location");
  const factions = entities.filter((entity) => entity.type === "Faction");
  const others = entities.filter((entity) => !["Character", "Location", "Faction"].includes(entity.type));
  const lore: Array<Record<string, unknown>> = [];

  const npcs = people.slice(0, 300).map((person) => {
    const home = linked(person, "Location")[0];
    const relations = linked(person, "Character")
      .filter((link) => !link.hidden)
      .map((link) => ({ npcName: nameOf(link.targetId), score: standingOf(link.label), note: link.label }));
    const fields = fieldLines(person);
    return {
      name: person.name,
      attitude: "indifferent",
      trait: [person.summary, fields.open.join("; ")].filter(Boolean).join(" ").slice(0, 500),
      location: home ? nameOf(home.targetId).slice(0, 120) : "",
      role: "",
      aliases: person.aliases,
      personality: "",
      goals: "",
      relations: JSON.stringify(relations).slice(0, 8_000),
      portrait: portrait(images, person.id),
      voice: null,
      statBlock: "",
    };
  });

  const locations = places.slice(0, 300).map((place) => {
    const fields = fieldLines(place);
    const pins = list(world.pins, 400).map(record).filter((pin) => text(pin.entityId, 80) === place.id && text(pin.notes, 400));
    return {
      name: place.name,
      layoutDescription: [place.summary, place.notes, ...fields.open, ...pins.map((pin) => text(pin.notes, 400))].filter(Boolean).join("\n\n").slice(0, 8_000),
      connections: linked(place, "Location").map((link) => nameOf(link.targetId).slice(0, 120)).slice(0, 40),
      map: null,
      ambience: null,
    };
  });

  const bundleFactions = factions.slice(0, 60).map((faction) => ({
    name: faction.name.slice(0, 80),
    blurb: faction.summary.slice(0, 400),
    goal: "",
    attitude: "neutral",
    power: 1,
    tags: faction.tags.slice(0, 8),
    // Everyone linked to it, from either side.
    members: [
      ...new Set([
        ...people.filter((person) => person.links.some((link) => link.targetId === faction.id)).map((person) => person.name),
        ...linked(faction, "Character").map((link) => nameOf(link.targetId)),
      ]),
    ].slice(0, 40),
    portrait: portrait(images, faction.id),
  }));

  // Everything else is lore: an artifact as magic, a custom type as other.
  for (const thing of others) {
    const fields = fieldLines(thing);
    lore.push({
      category: /artifact|item|relic|spell|magic/i.test(thing.type) ? "magic" : /religion|deity|god/i.test(thing.type) ? "religion" : "other",
      title: thing.name,
      body: [thing.summary, thing.notes, ...fields.open].filter(Boolean).join("\n\n"),
      tags: [thing.type.toLowerCase(), ...tagsOf(thing)].slice(0, 20),
      visibility: thing.canon === "canon" ? "party" : "dm",
      image: portrait(images, thing.id),
    });
  }
  // What only the DM may know: hidden truths, author-only fields, the links
  // the export marks hidden, and every entry that is not canon.
  for (const entity of entities) {
    const fields = fieldLines(entity);
    const secretLinks = entity.links.filter((link) => link.hidden).map((link) => `${entity.name} ${link.label} ${nameOf(link.targetId)}.`);
    const truth = [entity.hiddenTruth, ...fields.hidden, ...secretLinks].filter(Boolean);
    if (truth.length) {
      lore.push({ category: entity.type === "Faction" ? "factions" : "history", title: `The truth about ${entity.name}`.slice(0, 200), body: truth.join("\n\n"), tags: tagsOf(entity), visibility: "dm" });
    }
  }
  for (const row of list(world.secrets, 300).map(record)) {
    const knowers = Object.values(record(row.knownBy)).flatMap((story) => Object.keys(record(story)).map(nameOf)).filter(Boolean);
    lore.push({
      category: "history",
      title: text(row.title, 200) || "A secret",
      body: [text(row.notes, 6_000), knowers.length ? `Known by: ${[...new Set(knowers)].join(", ")}.` : "", text(row.entityId, 80) ? `It concerns ${nameOf(text(row.entityId, 80))}.` : ""].filter(Boolean).join("\n\n"),
      tags: ["secret"],
      visibility: "dm",
    });
  }

  // The timeline: each event as history, and one chronology across calendars.
  const events = list(world.events, 400).map(record).filter((event) => text(event.title, 200));
  const absolute = (event: Raw) => (Number(event.yearNum) || 0) + (calendars.get(text(event.calendarId, 80))?.offset ?? 0);
  for (const event of events) {
    const when = text(event.year, 40) || yearOf(event);
    const who = list(event.entityIds, 20).map((id) => nameOf(text(id, 80))).filter(Boolean);
    lore.push({
      category: "history",
      title: text(event.title, 200),
      body: [when ? `${when}${text(event.era, 80) ? `, ${text(event.era, 80)}` : ""}.` : "", text(event.body, 6_000), who.length ? `Concerns ${who.join(", ")}.` : ""].filter(Boolean).join("\n\n"),
      tags: [text(event.era, 40)].filter(Boolean),
      visibility: text(event.canon, 20) && text(event.canon, 20) !== "canon" ? "dm" : "party",
    });
  }
  if (events.length > 1) {
    const ordered = [...events].sort((a, b) => absolute(a) - absolute(b));
    lore.push({
      category: "history",
      title: `Chronology of ${worldName}`.slice(0, 200),
      body: ordered.map((event) => `- ${text(event.year, 40) || yearOf(event)}: ${text(event.title, 200)}`).join("\n").slice(0, 20_000),
      tags: ["timeline"],
      visibility: "party",
    });
  }
  if (calendars.size) {
    lore.push({
      category: "culture",
      title: "How years are counted",
      body: [...calendars.values()].map((calendar) => `${calendar.name}${calendar.abbrev ? ` (${calendar.abbrev})` : ""}${calendar.notes ? `: ${calendar.notes}` : ""}`).join("\n"),
      tags: ["calendar"],
      visibility: "party",
    });
  }
  const openStubs = list(world.stubs, 200).map(record).filter((stub) => text(stub.status, 20) !== "resolved" && text(stub.name, 120));
  if (openStubs.length) {
    lore.push({
      category: "other",
      title: "Open questions from WorldForge",
      body: openStubs.map((stub) => `- ${text(stub.name, 120)}${text(stub.note, 300) ? `: ${text(stub.note, 300)}` : ""}`).join("\n"),
      tags: ["stub"],
      visibility: "dm",
    });
  }

  // The stories, as storyboard cards in order, each pointing at its next.
  const npcIndex = new Map(people.slice(0, 300).map((person, index) => [person.id, index]));
  const placeIndex = new Map(places.slice(0, 300).map((place, index) => [place.id, index]));
  const stories = list(world.stories, 20).map(record);
  const scenes = list(world.scenes, 200).map(record);
  const storyboard: Array<Record<string, unknown>> = [];
  for (const [row, story] of stories.entries()) {
    const own = scenes.filter((scene) => text(scene.storyId, 80) === text(story.id, 80)).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    own.forEach((scene, at) => {
      const index = storyboard.length;
      const pov = npcIndex.get(text(scene.povEntityId, 80));
      const place = placeIndex.get(text(scene.locationEntityId, 80));
      storyboard.push({
        kind: "event",
        title: text(scene.title, 200) || `Scene ${at + 1}`,
        body: [text(scene.gist, 3_000), list(scene.castEntityIds, 12).map((id) => nameOf(text(id, 80))).filter(Boolean).join(", ")].filter(Boolean).join("\n\nWith: ").slice(0, 4_000),
        edges: at < own.length - 1 ? [index + 1] : [],
        routes: [],
        links: { ...(pov === undefined ? {} : { npc: pov }), ...(place === undefined ? {} : { location: place }) },
        // One row per story on the board, its scenes left to right.
        x: 40 + at * 280,
        y: 40 + row * 220,
      });
    });
  }

  // The world map: its pinned places anchored where the pins stand, over the
  // map's own picture when the export carries one.
  const maps = list(world.maps, 40).map(record);
  const root = maps.find((map) => !map.parentPinId) ?? maps[0];
  const rootPins = root ? list(world.pins, 400).map(record).filter((pin) => text(pin.mapId, 80) === text(root.id, 80)) : [];
  const anchors = rootPins
    .map((pin) => ({ location: placeIndex.get(text(pin.entityId, 80)), x: Number(pin.x), y: Number(pin.y) }))
    .filter((pin): pin is { location: number; x: number; y: number } => pin.location !== undefined && Number.isFinite(pin.x) && Number.isFinite(pin.y))
    .map((pin) => ({ location: pin.location, x: Math.round(Math.min(1, Math.max(0, pin.x)) * (OVERWORLD_WIDTH - 1)), y: Math.round(Math.min(1, Math.max(0, pin.y)) * (OVERWORLD_HEIGHT - 1)) }));
  const backdrop = root ? text(record(record(world.media).mapBackgrounds)[text(root.id, 80)], 11_000_000) : "";
  const seed = fnv1a(worldName);
  const overworld = anchors.length
    ? {
        seed,
        width: OVERWORLD_WIDTH,
        height: OVERWORLD_HEIGHT,
        terrain: generateOverworldTerrain(seed),
        params: {},
        notes: text(root?.name, 120),
        anchors,
        backdrop: IMAGE_DATA_URL.test(backdrop) ? backdrop : "",
      }
    : null;

  const story = stories[0];
  const counts = `${people.length} characters, ${places.length} places, ${factions.length} factions`;
  return {
    kind: "odm.workshop",
    version: WORKSHOP_BUNDLE_VERSION,
    manifest: {
      name: worldName,
      blurb: (text(story?.summary, 200) || `A world from WorldForge: ${counts}.`).slice(0, 200),
      version: "1.0.0",
      author: "",
      homepage: "",
      inspiredBy: `An original world written in WorldForge (${counts})`.slice(0, 200),
      rightsHolder: "",
    },
    premise: text(story?.summary, 500),
    lore: lore.slice(0, 500),
    locations,
    npcs,
    factions: bundleFactions,
    storyboard,
    overworld,
  };
}
