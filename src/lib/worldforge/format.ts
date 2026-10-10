import {
  CANON_STATES,
  LIMITS,
  LORE_CATEGORIES,
  defaultTypes,
  readDoc,
  readEntry,
  refOf,
  type Entry,
  type LoreCategory,
  type Shelf,
  type WorldDoc,
  type WorldType,
} from "./model.ts";

// WorldForge's own file, both ways: its JSON export (format version 4) read
// into a workshop with nothing dropped, and a workshop written back out as a
// file WorldForge opens. Pure: the database half is src/lib/db/world-forge.ts.
//
// SECURITY: an export is untrusted. Every value goes through the model's
// floors (src/lib/worldforge/model.ts readDoc, readEntry), images must be
// inline pictures under a size cap, and the export's `settings` block, which
// can hold an image service's API key, is never read and never written.

type Raw = Record<string, unknown>;
const rec = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : typeof value === "number" && Number.isFinite(value) ? String(value) : "");
const wfKey = (value: unknown) => str(value, 80).replace(/[^\w.-]/g, "_");

export const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 8_000_000;
const picture = (value: unknown) => (typeof value === "string" && value.length <= MAX_IMAGE_CHARS && IMAGE_DATA_URL.test(value) ? value : "");

export function isWorldForgeExport(value: unknown): boolean {
  const raw = rec(value);
  return typeof raw.worldName === "string" && Array.isArray(raw.entities) && typeof raw.version === "number" && raw.kind === undefined;
}

// Which shelf a WorldForge type belongs on, by its name.
export function shelfForTypeName(name: string): Shelf {
  const words = name.toLowerCase();
  if (/\b(character|person|people|npc|hero|villain)s?\b/.test(words)) return "npc";
  if (/\b(location|place|region|city|town|village|settlement|landmark|realm|country|kingdom|dungeon)s?\b/.test(words)) return "location";
  if (/\b(faction|organi[sz]ation|guild|order|house|clan|cult|company|church)s?\b/.test(words)) return "faction";
  return "lore";
}

export function loreCategoryForTypeName(name: string): LoreCategory {
  const words = name.toLowerCase();
  if (/artifact|item|relic|magic|spell|weapon/.test(words)) return "magic";
  if (/deity|god|religion|faith|church|pantheon/.test(words)) return "religion";
  if (/culture|race|species|people|language|custom/.test(words)) return "culture";
  if (/event|history|war|era|age/.test(words)) return "history";
  if (/region|land|geograph|sea|mountain|forest/.test(words)) return "geography";
  if (/faction|guild|order/.test(words)) return "factions";
  return LORE_CATEGORIES.includes(words as LoreCategory) ? (words as LoreCategory) : "other";
}

// The first sentence, for the one-line summary a Cast member or a faction
// keeps in its own row.
export function firstSentence(text: string, max: number): string {
  const line = text.split(/\n/)[0].trim();
  const sentence = line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line;
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 3).trimEnd()}...`;
}

export type ImportedRecord = {
  // A stand-in ref, "<shelf>:wf~<id>", until the record exists.
  ref: string;
  shelf: Shelf;
  name: string;
  // Cast and factions: the one-liner for their own row.
  tagline: string;
  // Places and lore: their own long text.
  text: string;
  loreCategory: LoreCategory;
  tags: string[];
  portrait: string;
  entry: Entry;
};

export type ImportedBeat = { wfId: string; title: string; body: string; story: string; order: number; pov: string; place: string };

export type WorldImport = {
  worldName: string;
  premise: string;
  records: ImportedRecord[];
  doc: WorldDoc;
  beats: ImportedBeat[];
  mapImages: Record<string, string>;
};

export function readWorldForge(raw: unknown): WorldImport | { error: string } {
  const world = rec(raw);
  if (!isWorldForgeExport(world)) {
    return { error: "Not a WorldForge export." };
  }
  const worldName = str(world.worldName, 70) || "A WorldForge world";

  // Types first: every entity names one, and its fields are keyed to it.
  const fileTypes = list(world.types, LIMITS.types).map(rec);
  const types: WorldType[] = (fileTypes.length ? fileTypes : defaultTypes()).map((type) => {
    const name = str(type.name, 40) || "Other";
    // A file this workshop wrote says where each type lives; WorldForge's
    // own files do not, so the name decides.
    const shelf = ["npc", "location", "faction", "lore"].includes(type.shelf as string) ? (type.shelf as Shelf) : shelfForTypeName(name);
    return {
      id: wfKey(type.id) || `t_${wfKey(name)}`,
      name,
      color: typeof type.color === "string" ? type.color : "#7a6e54",
      shelf,
      loreCategory: LORE_CATEGORIES.includes(type.loreCategory as LoreCategory) ? type.loreCategory : loreCategoryForTypeName(name),
      fields: list(type.fields, LIMITS.fieldsPerType).map(rec).map((field) => ({ ...field, id: wfKey(field.id) })),
    } as WorldType;
  });
  const typeByName = new Map(types.map((type) => [type.name.toLowerCase(), type]));
  // An entity can name a type the file's list does not carry (WorldForge
  // seeds its five defaults without writing them out): the type is made
  // from its name, coloured like WorldForge's default of that name if any.
  const typeNamed = (raw: unknown): WorldType => {
    const name = str(raw, 40) || "Other";
    const known = typeByName.get(name.toLowerCase());
    if (known) return known;
    const seed = defaultTypes().find((type) => type.name.toLowerCase() === name.toLowerCase());
    const made: WorldType = {
      id: `t_${wfKey(name).toLowerCase()}`,
      name,
      color: seed?.color ?? "#7a6e54",
      shelf: seed?.shelf ?? shelfForTypeName(name),
      loreCategory: seed?.loreCategory ?? loreCategoryForTypeName(name),
      fields: [],
    };
    types.push(made);
    typeByName.set(name.toLowerCase(), made);
    return made;
  };

  const images = rec(rec(world.media).entityImages);
  const entities = list(world.entities, LIMITS.entries).map(rec).filter((entity) => wfKey(entity.id) && str(entity.name, 120));
  const refById = new Map<string, string>();
  const records: ImportedRecord[] = [];
  for (const entity of entities) {
    const type = typeNamed(entity.type);
    const id = wfKey(entity.id);
    if (refById.has(id)) continue;
    const ref = refOf(type.shelf, `wf~${id}`);
    refById.set(id, ref);
    const summary = str(entity.summary, LIMITS.article);
    // Places and lore keep their text in their own row, which holds 2,000
    // and 4,000 characters; a longer article keeps the whole of it here.
    const longRow = type.shelf === "location" || type.shelf === "lore";
    const rowCap = type.shelf === "location" ? 2_000 : 4_000;
    const entry = readEntry({
      typeId: type.id,
      folderId: wfKey(entity.categoryId),
      canon: entity.canon,
      article: !longRow || summary.length > rowCap ? summary : "",
      hiddenTruth: entity.hiddenTruth,
      notes: entity.notes,
      fields: entity.fields,
      aliases: entity.aliases,
      wfId: id,
    });
    records.push({
      ref,
      shelf: type.shelf,
      name: str(entity.name, 80),
      tagline: longRow ? "" : firstSentence(summary, type.shelf === "npc" ? 200 : 400),
      text: longRow ? summary.slice(0, rowCap) : "",
      loreCategory: type.loreCategory,
      tags: list(entity.tags, 8).map((tag) => str(tag, 40)).filter(Boolean),
      portrait: picture(images[id]),
      entry,
    });
  }
  const refOfWf = (value: unknown) => refById.get(wfKey(value)) ?? "";

  const links = entities.flatMap((entity) =>
    list(entity.links, 60).map(rec).map((link) => ({
      id: `l_${wfKey(entity.id)}_${wfKey(link.targetId)}_${str(link.label, 40).replace(/\W+/g, "-")}`,
      from: refOfWf(entity.id),
      to: refOfWf(link.targetId),
      label: str(link.label, 60),
      veracity: link.veracity,
      oneway: link.oneway === true,
      rank: link.rank,
    })),
  );

  const doc = readDoc({
    types,
    entries: Object.fromEntries(records.map((record) => [record.ref, record.entry])),
    links,
    folders: list(world.categories, LIMITS.folders).map(rec).map((folder) => ({ id: wfKey(folder.id), name: folder.name, parentId: wfKey(folder.parentId) })),
    calendars: list(world.calendars, LIMITS.calendars).map(rec).map((calendar) => ({ ...calendar, id: wfKey(calendar.id) })),
    events: list(world.events, LIMITS.events).map(rec).map((event) => ({
      id: wfKey(event.id),
      title: event.title,
      body: event.body,
      era: event.era,
      when: { calendarId: wfKey(event.calendarId), yearNum: event.yearNum, year: event.year },
      refs: list(event.entityIds, LIMITS.refs).map(refOfWf),
      canon: CANON_STATES.includes(event.canon as never) ? event.canon : "canon",
    })),
    secrets: list(world.secrets, LIMITS.secrets).map(rec).map((secret) => ({
      id: wfKey(secret.id),
      title: secret.title,
      subject: refOfWf(secret.entityId),
      notes: secret.notes,
      // Who knows, in any of the file's stories. A story's reader learning
      // a secret is not the party learning it, so nothing starts revealed.
      knownBy: Object.values(rec(secret.knownBy)).flatMap((story) => Object.keys(rec(story))).map(refOfWf),
      partyKnows: false,
    })),
    stubs: list(world.stubs, LIMITS.stubs).map(rec).map((stub) => ({ id: wfKey(stub.id), name: stub.name, note: stub.note, source: "import", status: stub.status === "dismissed" ? "dismissed" : "open" })),
    maps: list(world.maps, LIMITS.maps).map(rec).map((atlas) => ({
      id: wfKey(atlas.id),
      name: atlas.name,
      image: "",
      parentPinId: wfKey(atlas.parentPinId),
      regions: list(atlas.regions, LIMITS.regions).map(rec).map((region) => ({ ...region, id: wfKey(region.id), ref: refOfWf(region.entityId) })),
    })),
    pins: list(world.pins, LIMITS.pins).map(rec).map((pin) => ({
      id: wfKey(pin.id),
      // A pin with no map belongs to the first (WorldForge's own rule).
      mapId: wfKey(pin.mapId) || wfKey(rec(list(world.maps, 1)[0]).id),
      x: pin.x,
      y: pin.y,
      name: pin.name,
      ref: refOfWf(pin.entityId),
      linkedMapId: wfKey(pin.linkedMapId),
      notes: pin.notes,
    })),
  });

  const stories = new Map(list(world.stories, 40).map(rec).map((story) => [wfKey(story.id), str(story.name, 80)]));
  const premise = str(rec(list(world.stories, 1)[0]).summary, 500);
  const scenes = list(world.scenes, 400).map(rec);
  const bodies = rec(world.sceneBodies);
  const beats = scenes
    .filter((scene) => str(scene.title, 120) && typeof scene.order === "number")
    .sort((a, b) => str(a.storyId, 80).localeCompare(str(b.storyId, 80)) || (a.order as number) - (b.order as number))
    .map((scene) => ({
      wfId: wfKey(scene.id),
      title: str(scene.title, 120),
      body: str(scene.gist, 2_000) || str(bodies[wfKey(scene.id)], 2_000),
      story: stories.get(wfKey(scene.storyId)) ?? "",
      order: scene.order as number,
      pov: refOfWf(scene.povEntityId),
      place: refOfWf(scene.locationEntityId),
    }));

  const backgrounds = rec(rec(world.media).mapBackgrounds);
  const mapImages: Record<string, string> = {};
  for (const atlas of doc.maps) {
    const image = picture(backgrounds[atlas.id]);
    if (image) mapImages[atlas.id] = image;
  }
  return { worldName, premise, records, doc, beats, mapImages };
}

// ---- out ----

export type ExportRecord = { ref: string; shelf: Shelf; name: string; tagline: string; text: string; tags: string[]; portrait: string; entry: Entry; createdAt: string };
export type ExportBeat = { id: string; title: string; body: string; pov: string; place: string };

export function writeWorldForge(input: {
  worldName: string;
  premise: string;
  records: ExportRecord[];
  doc: WorldDoc;
  beats: ExportBeat[];
  mapImages: Record<string, string>;
  now: string;
}): Record<string, unknown> {
  const { doc } = input;
  const live = new Set(input.records.map((record) => record.ref));
  const idOf = (ref: string) => {
    const record = input.records.find((entry) => entry.ref === ref);
    return record?.entry.wfId || `odm_${ref.replace(/[^\w]+/g, "_")}`;
  };
  const typeName = (record: ExportRecord) => doc.types.find((type) => type.id === record.entry.typeId && type.shelf === record.shelf)?.name ?? doc.types.find((type) => type.shelf === record.shelf)?.name ?? "Other";
  const entityImages: Record<string, string> = {};
  for (const record of input.records) if (record.portrait) entityImages[idOf(record.ref)] = record.portrait;
  const storyId = "st_odm_board";
  return {
    version: 4,
    exportedAt: input.now,
    worldName: input.worldName,
    entities: input.records.map((record) => ({
      id: idOf(record.ref),
      name: record.name,
      type: typeName(record),
      ...(record.entry.folderId ? { categoryId: record.entry.folderId } : {}),
      aliases: record.entry.aliases,
      summary: record.entry.article || record.text || record.tagline,
      hiddenTruth: record.entry.hiddenTruth,
      notes: record.entry.notes,
      tags: record.tags,
      canon: record.entry.canon,
      createdAt: record.createdAt,
      fields: record.entry.fields,
      links: doc.links
        .filter((link) => link.from === record.ref && live.has(link.to))
        .map((link) => ({
          targetId: idOf(link.to),
          label: link.label,
          ...(link.veracity !== "known" ? { veracity: link.veracity } : {}),
          ...(link.oneway ? { oneway: true } : {}),
          ...(link.rank ? { rank: link.rank } : {}),
        })),
    })),
    // `shelf` and `loreCategory` are this workshop's, for a round trip;
    // WorldForge reads past keys it does not know.
    types: doc.types.map((type) => ({ id: type.id, name: type.name, color: type.color, fields: type.fields, shelf: type.shelf, loreCategory: type.loreCategory })),
    categories: doc.folders.map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parentId || null })),
    calendars: doc.calendars,
    events: doc.events.map((event) => ({
      id: event.id,
      title: event.title,
      body: event.body,
      era: event.era,
      year: event.when.year,
      yearNum: event.when.yearNum ?? "",
      calendarId: event.when.calendarId,
      entityIds: event.refs.filter((ref) => live.has(ref)).map(idOf),
      canon: event.canon,
    })),
    secrets: doc.secrets.map((secret) => ({
      id: secret.id,
      title: secret.title,
      ...(live.has(secret.subject) ? { entityId: idOf(secret.subject) } : {}),
      notes: secret.notes,
      knownBy: { [storyId]: Object.fromEntries(secret.knownBy.filter((ref) => live.has(ref)).map((ref) => [idOf(ref), "start"])) },
      audienceReveal: {},
    })),
    stubs: doc.stubs.map((stub) => ({ id: stub.id, name: stub.name, note: stub.note, source: "manual", status: stub.status, createdAt: input.now })),
    maps: doc.maps.map((atlas) => ({
      id: atlas.id,
      name: atlas.name,
      parentPinId: atlas.parentPinId || null,
      regions: atlas.regions.map((region) => ({ id: region.id, name: region.name, points: region.points, color: region.color, notes: region.notes, ...(live.has(region.ref) ? { entityId: idOf(region.ref) } : {}) })),
    })),
    pins: doc.pins.map((pin) => ({
      id: pin.id,
      mapId: pin.mapId,
      x: pin.x,
      y: pin.y,
      name: pin.name,
      notes: pin.notes,
      ...(live.has(pin.ref) ? { entityId: idOf(pin.ref), type: typeName(input.records.find((record) => record.ref === pin.ref)!) } : {}),
      ...(pin.linkedMapId ? { linkedMapId: pin.linkedMapId } : {}),
    })),
    stories: input.beats.length ? [{ id: storyId, name: `${input.worldName}: the storyboard`, summary: input.premise }] : [],
    scenes: input.beats.map((beat, order) => ({
      id: beat.id,
      storyId,
      title: beat.title,
      gist: beat.body,
      order,
      ...(live.has(beat.pov) ? { povEntityId: idOf(beat.pov) } : {}),
      ...(live.has(beat.place) ? { locationEntityId: idOf(beat.place) } : {}),
      castEntityIds: [],
    })),
    media: { entityImages, mapBackgrounds: input.mapImages },
  };
}
