import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDatabase } from "@/lib/db/core";
import { getCampaignById } from "@/lib/db/campaigns";
import { getBeat, insertBeat, listBeats, updateBeat } from "@/lib/db/workshop-beats";
import { aspectOfBytes, importBridge } from "@/lib/db/atlas-region";
import { admitUpload, type UploadAccount, type UploadRefusal } from "@/lib/upload-budget";
import { decodeBundleImage, encodeBundleImage, type BundleImage } from "@/lib/workshop/bundle";
import { isUploadedImagePath } from "@/lib/uploads";
import { createRecord, getWorldDoc, nextEntry, saveWorldDoc, worldEntities, worldView, writeRecord, type WorldEntity } from "@/lib/db/world-forge";
import { firstSentence, readWorldForge, writeWorldForge, type ExportRecord, type WorldImport } from "@/lib/worldforge/format";
import { LIMITS, LINK_LABELS, isPlaceBinding, newId, parseRef, readEntry, refOf, remapDoc, type Binding, type Entry, type PlaceBindingKind, type WorldDoc, type WorldType } from "@/lib/worldforge/model";
import {
  IMPORT_SLICES,
  firstReadings,
  hashOf,
  mergeSliceRows,
  mergeValues,
  originFrom,
  originKey,
  ownedBy,
  planIds,
  remapEntryIds,
  remapIds,
  rowValue,
  settle,
  valueWords,
  type ImportSlice,
} from "@/lib/worldforge/import-merge";
import { mergeImportedLinks } from "@/lib/db/world-link-merge";
import { recordMediaFile } from "@/lib/media-access";
import { textKey } from "@/lib/language/text-logic";

// A WorldForge file into a workshop, and a workshop out as one. Importing
// into a workshop that already has a world adds to it: a type or a field of
// the same name is the same one; an entry or a row an earlier import of the
// same world brought is merged value by value, so what was changed here
// since stands (src/lib/worldforge/import-merge.ts); another world's rows
// keep their own ids even where the two worlds used the same ones.

export type WorldImportResult =
  | {
      created: number;
      updated: number;
      links: number;
      // What a second import of the same world did to the links it brought
      // before (src/lib/db/world-link-merge.ts).
      linksUpdated: number;
      linksRemoved: number;
      conflicts: string[];
      // Entries in the file matched to one already here by name alone.
      matched: string[];
      events: number;
      secrets: number;
      maps: number;
      beats: number;
      skipped: string[];
      // What the file held that did not come in whole, and what came in
      // differently on purpose (src/lib/worldforge/format.ts).
      losses: string[];
      notes: string[];
    }
  | { error: string; refusal?: UploadRefusal };

function saveImage(image: BundleImage | null, written: string[]): string {
  if (!image) return "";
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");
  mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${image.ext}`;
  writeFileSync(path.join(/*turbopackIgnore: true*/ dir, filename), image.bytes);
  written.push(`/uploads/${filename}`);
  recordMediaFile(`/uploads/${filename}`);
  return `/uploads/${filename}`;
}

// The file's types folded into the workshop's: one of the same name on the
// same shelf is the same type, and its fields match by name and kind.
function mergeTypes(doc: WorldDoc, incoming: WorldType[]) {
  const types = new Map<string, string>();
  const fields = new Map<string, Map<string, string>>();
  for (const type of incoming) {
    let target = doc.types.find((own) => own.shelf === type.shelf && textKey(own.name) === textKey(type.name));
    if (!target && doc.types.length < LIMITS.types) {
      target = { ...type, id: doc.types.some((own) => own.id === type.id) ? newId("t") : type.id, fields: [] };
      doc.types.push(target);
    }
    target ??= doc.types.find((own) => own.shelf === type.shelf) ?? doc.types[0];
    const map = new Map<string, string>();
    for (const field of type.fields) {
      let own = target.fields.find((entry) => entry.kind === field.kind && textKey(entry.name) === textKey(field.name));
      if (!own && target.fields.length < LIMITS.fieldsPerType) {
        own = { ...field, id: target.fields.some((entry) => entry.id === field.id) ? newId("f") : field.id };
        target.fields.push(own);
      }
      if (own) map.set(field.id, own.id);
    }
    types.set(type.id, target.id);
    fields.set(type.id, map);
  }
  return { types, fields };
}

type Values = Record<string, unknown>;
type Pending = { origin: string; key: string; source: string };

// A type field's name, by its id, for a report.
const fieldName = (doc: WorldDoc) => (id: string) => doc.types.flatMap((type) => type.fields).find((field) => field.id === id)?.name;

// An entry's type fields as values of their own, one per field.
const fieldValues = (fields: Entry["fields"]): Values => Object.fromEntries(Object.entries(fields).map(([id, value]) => [`fields.${id}`, value]));

// What an import compares on the entry WorldForge keeps beside a record.
function overlayValues(entry: Entry): Values {
  return {
    typeId: entry.typeId,
    folderId: entry.folderId,
    canon: entry.canon,
    article: entry.article,
    hiddenTruth: entry.hiddenTruth,
    notes: entry.notes,
    aliases: entry.aliases,
    tags: entry.tags,
    image: entry.image,
    bindings: entry.bindings,
    ...fieldValues(entry.fields),
  };
}

// The same for a whole entity, its record's own values included.
function recordValues(entity: WorldEntity): Values {
  const short = entity.shelf === "npc" || entity.shelf === "faction";
  return {
    name: entity.name,
    ...(short ? { tagline: entity.tagline } : { text: entity.text }),
    aliases: entity.aliases,
    tags: entity.tags,
    portrait: entity.portrait,
    typeId: entity.entry.typeId,
    folderId: entity.entry.folderId,
    canon: entity.entry.canon,
    article: entity.entry.article,
    hiddenTruth: entity.entry.hiddenTruth,
    notes: entity.entry.notes,
    ...fieldValues(entity.entry.fields),
    ...(entity.shelf === "lore" ? { dmOnly: entity.table.visibility === "dm" } : {}),
  };
}

// Taken values onto an entry, a type field at a time.
function applyOverlay(entry: Entry, take: Values): Entry {
  const fields = { ...entry.fields };
  const next = { ...entry } as Values;
  for (const [key, value] of Object.entries(take)) {
    if (key.startsWith("fields.")) {
      const id = key.slice("fields.".length);
      if (value === undefined) delete fields[id];
      else fields[id] = value as Entry["fields"][string];
    } else next[key] = value;
  }
  return readEntry({ ...next, fields });
}

// The taken values as a patch for nextEntry, the type fields merged onto
// the entry's own so a field nobody took is left as it is.
function entryPatch(entry: Entry | undefined, take: Values, portrait: string | undefined): Parameters<typeof nextEntry>[2] {
  const own = entry ?? readEntry({});
  const fields = applyOverlay(own, Object.fromEntries(Object.entries(take).filter(([key]) => key.startsWith("fields.")))).fields;
  const picked = Object.fromEntries(
    (["typeId", "folderId", "canon", "article", "hiddenTruth", "notes", "aliases", "tags"] as const).filter((key) => key in take).map((key) => [key, take[key]]),
  );
  return { ...picked, ...(portrait !== undefined ? { portrait } : {}), fields };
}

// Folders and calendars point at no entry, and entries point at them: they
// come in first. The rest point at entries, and come in after them.
const FIRST_SLICES = ["folders", "calendars"] as const satisfies readonly ImportSlice[];
const LATER_SLICES = IMPORT_SLICES.filter((slice) => !(FIRST_SLICES as readonly string[]).includes(slice));

// The slices given, of what an import brings, merged row by row.
function mergeSlices(
  doc: WorldDoc,
  moved: Pick<WorldDoc, ImportSlice>,
  mapped: Pick<WorldDoc, ImportSlice>,
  source: string,
  slices: readonly ImportSlice[],
  mapRow: (atlas: WorldDoc["maps"][number]) => WorldDoc["maps"][number] = (atlas) => atlas,
): { conflicts: string[]; pending: Pending[] } {
  const conflicts: string[] = [];
  const pending: Pending[] = [];
  for (const slice of slices) {
    const rows = (slice === "maps" ? moved.maps.map(mapRow) : moved[slice]) as unknown as Array<{ id: string } & Values>;
    const result = mergeSliceRows(doc, slice, rows, (mapped[slice] as Array<{ id: string }>).map((row) => row.id), source);
    conflicts.push(...result.conflicts);
    pending.push(...result.pending);
  }
  return { conflicts, pending };
}

export function importWorldForge(campaignId: string, account: UploadAccount, raw: unknown): WorldImportResult {
  const parsed = readWorldForge(raw);
  return "error" in parsed ? parsed : applyWorldImport(campaignId, account, parsed);
}

export function applyWorldImport(campaignId: string, account: UploadAccount, parsed: WorldImport): WorldImportResult {

  // Pictures are decoded and weighed against the upload budget first, so a
  // refused import writes nothing.
  const portraits = parsed.records.map((record) => (record.portrait ? decodeBundleImage(record.portrait) : null));
  const mapArt = new Map(Object.entries(parsed.mapImages).map(([id, url]) => [id, decodeBundleImage(url)]));
  const images = [...portraits, ...mapArt.values()].filter((image): image is BundleImage => image !== null);
  const refusal = admitUpload(account, images.reduce((sum, image) => sum + image.bytes.length, 0), images.length);
  if (refusal) return { error: refusal.error, refusal };

  // The world this file is: the id an ODM export carries, or else its name,
  // the one thing a WorldForge file says about itself.
  const legacySource = `wf:${parsed.worldName}`;
  const source = parsed.worldId ? `wf:${parsed.worldId}` : legacySource;

  const written: string[] = [];
  try {
    return getDatabase().transaction(() => {
      const before = getWorldDoc(campaignId);
      const doc = getWorldDoc(campaignId);
      const origins = (doc.origins ??= {});
      const typeMap = mergeTypes(doc, parsed.doc.types);
      const plan = planIds(doc, parsed.doc, source);
      const firstRows = mergeSlices(doc, remapIds(parsed.doc, plan), parsed.doc, source, FIRST_SLICES);

      const existing = worldEntities(campaignId, doc);
      const byRef = new Map(existing.map((entity) => [entity.ref, entity]));
      const owned = ownedBy(doc);
      // Entries imported before entries remembered their source: matched by
      // their WorldForge id alone, as they were then.
      const byWfId = new Map(
        existing.filter((entity) => entity.entry.wfId && !origins[originKey("entries", entity.ref)]).map((entity) => [`${entity.shelf}|${entity.entry.wfId}`, entity.ref]),
      );
      const byName = new Map(existing.map((entity) => [`${entity.shelf}|${textKey(entity.name)}`, entity.ref]));
      const refMap = new Map<string, string>();
      const fresh = new Set<string>();
      const skipped: string[] = [];
      const conflicts: string[] = [];
      const matched: string[] = [];
      const pending: Pending[] = [];
      let created = 0;
      let updated = 0;
      parsed.records.forEach((record, index) => {
        const typeId = typeMap.types.get(record.entry.typeId) ?? record.entry.typeId;
        const type = doc.types.find((entry) => entry.id === typeId) ?? doc.types.find((entry) => entry.shelf === record.shelf)!;
        const from = originFrom(source, "entries", record.entry.wfId || record.ref);
        const ownedRef = owned.get(from)?.slice("entries/".length);
        let ref = ownedRef && byRef.has(ownedRef) ? ownedRef : "";
        ref ||= byWfId.get(`${record.shelf}|${record.entry.wfId}`) ?? "";
        if (!ref) {
          // The same name here, the author's own or another world's: one
          // entry, said aloud so the author can check it is the same one.
          ref = byName.get(`${record.shelf}|${textKey(record.name)}`) ?? "";
          if (ref) matched.push(record.name);
        }
        const fieldIds = typeMap.fields.get(record.entry.typeId) ?? new Map<string, string>();
        const entry = remapEntryIds(
          { ...record.entry, fields: Object.fromEntries(Object.entries(record.entry.fields).map(([id, value]) => [fieldIds.get(id) ?? id, value])) },
          plan,
        );
        const short = record.shelf === "npc" || record.shelf === "faction";
        const theirs: Values = {
          name: record.name,
          ...(short ? { tagline: record.tagline } : { text: record.text }),
          aliases: entry.aliases,
          tags: record.tags,
          // A picture is compared by its bytes, and written only when taken.
          portrait: record.portrait ? `src:${hashOf(record.portrait)}` : "",
          typeId: type.id,
          folderId: entry.folderId,
          canon: entry.canon,
          article: entry.article,
          hiddenTruth: entry.hiddenTruth,
          notes: entry.notes,
          ...fieldValues(entry.fields),
          ...(record.shelf === "lore" ? { dmOnly: Boolean(record.dmOnly) } : {}),
        };
        let take: Values;
        if (ref) {
          updated += 1;
          const key = originKey("entries", ref);
          const prior = origins[key]?.from === from ? origins[key] : undefined;
          const merged = mergeValues(prior, recordValues(byRef.get(ref)!), theirs);
          take = merged.take;
          origins[key] = { from, at: merged.at };
          merged.pending.forEach((item) => pending.push({ origin: key, ...item }));
          for (const words of new Set(merged.clashes.map((key) => valueWords(key, fieldName(doc))))) conflicts.push(`${record.name}: kept your ${words} over the file's.`);
        } else {
          const made = createRecord(campaignId, type, record);
          if ("error" in made) {
            skipped.push(`${record.name}: ${made.error}`);
            return;
          }
          ref = made.ref;
          fresh.add(ref);
          created += 1;
          take = theirs;
          const key = originKey("entries", ref);
          origins[key] = { from, at: {} };
          for (const [value, reading] of Object.entries(theirs)) pending.push({ origin: key, key: value, source: hashOf(reading) });
        }
        refMap.set(record.ref, ref);
        const portrait = "portrait" in take ? saveImage(take.portrait ? portraits[index] : null, written) : undefined;
        writeRecord(
          campaignId,
          ref,
          {
            ...("name" in take ? { name: record.name } : {}),
            ...("tagline" in take ? { tagline: record.tagline } : {}),
            ...("text" in take ? { text: record.text } : {}),
            ...("aliases" in take ? { aliases: entry.aliases } : {}),
            ...("tags" in take ? { tags: record.tags } : {}),
            ...(portrait !== undefined ? { portrait } : {}),
          },
          type.shelf === "lore" && "typeId" in take ? type : undefined,
        );
        doc.entries[ref] = { ...nextEntry(doc, ref, entryPatch(doc.entries[ref], take, portrait)), wfId: record.entry.wfId };
        // Whether a lore entry is kept to the DM is merged like its other
        // values (src/lib/worldforge/import-merge.ts): the file's "kept to
        // the DM" comes in where nobody changed it here, and a campaign that
        // has since published or hidden the entry keeps its choice.
        // One that is not canon yet is held back from players by its canon
        // alone (src/lib/db/world-publication.ts), so its audience is left
        // as the author set it and publishing it later needs no second step.
        const lore = parseRef(ref);
        if (lore?.shelf === "lore" && "dmOnly" in take) {
          getDatabase().prepare(`UPDATE lore_entries SET visibility = ? WHERE id = ?`).run(take.dmOnly ? "dm" : "party", lore.id);
        }
      });
      const after = new Map(worldEntities(campaignId, doc).map((entity) => [entity.ref, recordValues(entity)]));
      settle(doc, pending, (origin, key) => after.get(origin.slice("entries/".length))?.[key]);

      const mapped = remapDoc(parsed.doc, (ref) => refMap.get(ref) ?? null);
      const moved = remapIds(mapped, plan);
      const names = new Map(worldEntities(campaignId, doc).map((entity) => [entity.ref, entity.name]));
      const merged = mergeImportedLinks(doc.links, mapped.links, source, (ref) => names.get(ref) ?? "someone", [legacySource]);
      doc.links = merged.links;
      // A map's art is compared by its bytes too, and written once taken.
      const artUrl = new Map(mapped.maps.map((atlas) => [plan.maps.get(atlas.id) ?? atlas.id, parsed.mapImages[atlas.id] ?? ""]));
      const artBytes = new Map(mapped.maps.map((atlas) => [plan.maps.get(atlas.id) ?? atlas.id, mapArt.get(atlas.id) ?? null]));
      const rows = mergeSlices(doc, moved, mapped, source, LATER_SLICES, (atlas) => ({ ...atlas, image: artUrl.get(atlas.id) ? `src:${hashOf(artUrl.get(atlas.id))}` : "" }));
      doc.maps = doc.maps.map((atlas) => (atlas.image.startsWith("src:") ? { ...atlas, image: saveImage(artBytes.get(atlas.id) ?? null, written) } : atlas));
      settle(doc, [...firstRows.pending, ...rows.pending], (origin, key) => rowValue(doc, origin, key));
      conflicts.push(...merged.conflicts, ...firstRows.conflicts, ...rows.conflicts);

      // The file's top map and the Region map, by the Atlas-to-Region rules
      // (src/lib/db/atlas-region.ts): an undressed Region takes the map, and
      // the places this import made stand where their pins do.
      const root = moved.maps.find((atlas) => !atlas.parentPinId) ?? moved.maps[0];
      const aspects = new Map([...artBytes].map(([id, image]) => [id, image ? aspectOfBytes(image.bytes) : 0]));
      const bridge = importBridge(campaignId, before, doc, { rootId: root?.id ?? "", fresh, aspects });
      saveWorldDoc(campaignId, doc);
      bridge.finish();

      // The file's scenes, as storyboard cards in each story's order.
      const titles = new Set(listBeats(campaignId).map((beat) => textKey(beat.title)));
      const stories = [...new Set(parsed.beats.map((beat) => beat.story))];
      let beats = 0;
      for (const [row, story] of stories.entries()) {
        const ids: string[] = [];
        for (const beat of parsed.beats.filter((entry) => entry.story === story)) {
          if (titles.has(textKey(beat.title))) continue;
          const pov = parseRef(refMap.get(beat.pov));
          const place = parseRef(refMap.get(beat.place));
          const made = insertBeat(campaignId, {
            kind: "event",
            title: beat.title,
            body: beat.body,
            links: { ...(pov?.shelf === "npc" ? { npcId: pov.id } : {}), ...(place?.shelf === "location" ? { locationId: place.id } : {}) },
            edges: [],
            routes: {},
            x: 40 + ids.length * 280,
            y: 40 + row * 220,
          });
          if ("error" in made) break;
          ids.push(made.id);
          beats += 1;
        }
        ids.slice(0, -1).forEach((id, at) => {
          updateBeat(campaignId, id, { ...getBeat(id)!, edges: [ids[at + 1]] });
        });
      }
      return {
        created,
        updated,
        links: merged.added,
        linksUpdated: merged.updated,
        linksRemoved: merged.removed,
        conflicts,
        matched,
        events: mapped.events.length,
        secrets: mapped.secrets.length,
        maps: mapped.maps.length,
        beats,
        skipped,
        losses: parsed.losses,
        notes: [...parsed.notes, ...bridge.notes],
      };
    })();
  } catch (error) {
    // Files no committed row names are taken away again.
    for (const url of written) rmSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "public", url), { force: true });
    throw error;
  }
}

const MAX_EXPORT_IMAGE_CHARS = 60 * 1024 * 1024;

export function exportWorldForge(campaignId: string): Record<string, unknown> {
  const campaign = getCampaignById(campaignId);
  const { doc, entities } = worldView(campaignId);
  let budget = MAX_EXPORT_IMAGE_CHARS;
  // Whose pictures did not fit: written into the file, so whoever imports
  // it is told rather than finding them gone.
  const omitted: string[] = [];
  const inline = (url: string, whose: string) => {
    if (!isUploadedImagePath(url)) return "";
    try {
      const encoded = encodeBundleImage(url, readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "public", url)));
      if (!encoded) return "";
      if (encoded.length > budget) {
        omitted.push(whose);
        return "";
      }
      budget -= encoded.length;
      return encoded;
    } catch {
      return "";
    }
  };
  const records: ExportRecord[] = entities.map((entity) => ({
    ref: entity.ref,
    shelf: entity.shelf,
    name: entity.name,
    tagline: entity.tagline,
    text: entity.text,
    tags: entity.tags,
    portrait: inline(entity.portrait, entity.name),
    entry: { ...entity.entry, aliases: entity.aliases },
    createdAt: entity.createdAt,
    ...(entity.shelf === "lore" && entity.table.visibility === "dm" ? { dmOnly: true } : {}),
  }));
  const mapImages: Record<string, string> = {};
  for (const atlas of doc.maps) {
    const image = inline(atlas.image, `the ${atlas.name} map`);
    if (image) mapImages[atlas.id] = image;
  }
  return writeWorldForge({
    worldName: campaign?.title ?? "A world",
    // The workshop's id names the world for good: renaming it later does
    // not make a second import of the file a different world.
    worldId: `odm-${campaignId}`,
    omitted,
    premise: campaign?.description ?? "",
    records,
    doc,
    beats: listBeats(campaignId).map((beat) => ({
      id: beat.id,
      title: beat.title,
      body: beat.body,
      pov: beat.links.npcId ? refOf("npc", beat.links.npcId) : "",
      place: beat.links.locationId ? refOf("location", beat.links.locationId) : "",
    })),
    mapImages,
    now: new Date().toISOString(),
  });
}

// The WorldForge of one campaign copied into another, its refs rewritten to
// the copies of the records that travelled; a ref whose record did not
// travel is dropped with whatever only it held up. A second copy of the
// same workshop merges value by value against what the first one brought
// (src/lib/worldforge/import-merge.ts), so what the campaign changed since
// stands. Types merge by name, fields and all, so neither side loses a
// field; links merge by the source link they came from
// (world-link-merge.ts). What both sides changed comes back in `conflicts`.
// A place's battle maps and encounters (Binding "map", "encounter") are
// rows of the source too: `resolveRecord` names their copies here, and a
// link whose row did not travel is dropped and counted in `unbound`.
export function copyWorldDoc(
  sourceId: string,
  targetId: string,
  resolve: (shelf: "npc" | "location" | "faction" | "lore", id: string) => string | null,
  resolveRecord: (kind: PlaceBindingKind, id: string) => string | null = () => null,
): { count: number; conflicts: string[]; unbound: number } {
  const source = `campaign:${sourceId}`;
  const sourceDoc = getWorldDoc(sourceId);
  const toCopy = (ref: string) => {
    const parsed = parseRef(ref);
    const copy = parsed ? resolve(parsed.shelf, parsed.id) : null;
    return parsed && copy ? refOf(parsed.shelf, copy) : null;
  };
  const mapped = remapDoc(sourceDoc, toCopy);
  const target = getWorldDoc(targetId);
  const origins = (target.origins ??= {});
  const typeMap = mergeTypes(target, mapped.types);
  const plan = planIds(target, mapped, source);
  const moved = remapIds(mapped, plan);
  const firstRows = mergeSlices(target, moved, mapped, source, FIRST_SLICES);
  const names = new Map(worldEntities(targetId, target).map((entity) => [entity.ref, entity.name]));
  const conflicts: string[] = [];
  const pending: Pending[] = [];
  let entries = 0;
  let unbound = 0;
  const moveBinding = (binding: Binding): Binding | null => {
    if (!isPlaceBinding(binding.kind)) return binding;
    const copy = binding.ref.startsWith("@") ? null : resolveRecord(binding.kind, binding.ref);
    if (!copy) unbound += 1;
    return copy ? { kind: binding.kind, ref: copy } : null;
  };
  for (const [sourceRef, raw] of Object.entries(sourceDoc.entries)) {
    const ref = toCopy(sourceRef);
    if (!ref) continue;
    entries += 1;
    const fieldIds = typeMap.fields.get(raw.typeId) ?? new Map<string, string>();
    const entry = remapEntryIds(
      {
        ...raw,
        typeId: typeMap.types.get(raw.typeId) ?? raw.typeId,
        fields: Object.fromEntries(Object.entries(raw.fields).map(([id, value]) => [fieldIds.get(id) ?? id, value])),
        bindings: raw.bindings.map(moveBinding).filter((binding): binding is Binding => binding !== null),
      },
      plan,
    );
    const key = originKey("entries", ref);
    const from = originFrom(source, "entries", sourceRef);
    const own = target.entries[ref];
    if (!own) {
      target.entries[ref] = entry;
      origins[key] = { from, at: firstReadings(overlayValues(entry)) };
      continue;
    }
    const prior = origins[key]?.from === from ? origins[key] : undefined;
    const merged = mergeValues(prior, overlayValues(own), overlayValues(entry));
    target.entries[ref] = { ...applyOverlay(own, merged.take), wfId: own.wfId || entry.wfId };
    origins[key] = { from, at: merged.at };
    merged.pending.forEach((item) => pending.push({ origin: key, ...item }));
    for (const words of new Set(merged.clashes.map((key) => valueWords(key, fieldName(target))))) conflicts.push(`${names.get(ref) ?? "An entry"}: kept your ${words} over the import's.`);
  }
  settle(target, pending, (origin, value) => {
    const own = target.entries[origin.slice("entries/".length)];
    return own ? overlayValues(own)[value] : undefined;
  });
  const merged = mergeImportedLinks(target.links, mapped.links, source, (ref) => names.get(ref) ?? "someone");
  target.links = merged.links;
  const rows = mergeSlices(target, moved, mapped, source, LATER_SLICES);
  settle(target, [...firstRows.pending, ...rows.pending], (origin, value) => rowValue(target, origin, value));
  saveWorldDoc(targetId, target);
  return {
    count: entries + merged.added + merged.updated + mapped.events.length + mapped.secrets.length,
    conflicts: [...conflicts, ...merged.conflicts, ...firstRows.conflicts, ...rows.conflicts],
    unbound,
  };
}

// What the DM ticked in a forge preview (src/lib/worldforge/forge.ts),
// written: each new entry made on its type's shelf, the links between the
// new and the old, and the unticked names kept to write later when asked.
// Add-only, like WorldForge's forge: nothing that exists is rewritten.
export function applyForge(
  campaignId: string,
  input: { entities: unknown; links: unknown; stubs: unknown },
): { created: number; links: number; stubs: number; skipped: string[] } {
  const doc = getWorldDoc(campaignId);
  const live = new Set(worldEntities(campaignId, doc).map((entity) => entity.ref));
  const refs = new Map<string, string>();
  const skipped: string[] = [];
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  for (const raw of (Array.isArray(input.entities) ? input.entities : []).slice(0, 60)) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const name = text(row.name, 80);
    const type = doc.types.find((entry) => entry.id === row.typeId) ?? doc.types[0];
    const summary = text(row.summary, 2_000);
    const short = type.shelf === "npc" || type.shelf === "faction";
    const made = createRecord(campaignId, type, { name, tagline: short ? firstSentence(summary, type.shelf === "npc" ? 200 : 400) : "", text: short ? "" : summary });
    if ("error" in made) {
      skipped.push(`${name || "A nameless entry"}: ${made.error}`);
      continue;
    }
    const aliases = Array.isArray(row.aliases) ? row.aliases.map((alias) => text(alias, 80)).filter(Boolean) : [];
    writeRecord(campaignId, made.ref, { aliases });
    doc.entries[made.ref] = nextEntry(doc, made.ref, { typeId: type.id, article: short ? summary : "", hiddenTruth: text(row.hiddenTruth, 1_000), aliases });
    refs.set(text(row.key, 20), made.ref);
    live.add(made.ref);
  }
  const resolve = (value: unknown) => {
    const key = text(value, 120);
    return refs.get(key) ?? (live.has(key) ? key : "");
  };
  const known = new Set(doc.links.map((link) => `${link.from}|${link.to}|${link.label}`));
  let linked = 0;
  for (const raw of (Array.isArray(input.links) ? input.links : []).slice(0, 120)) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const from = resolve(row.from);
    const to = resolve(row.to);
    const label = (LINK_LABELS as readonly string[]).find((entry) => entry === text(row.label, 40).toLowerCase());
    if (!from || !to || from === to || !label || known.has(`${from}|${to}|${label}`) || doc.links.length >= LIMITS.links) continue;
    known.add(`${from}|${to}|${label}`);
    doc.links.push({ id: newId("l"), from, to, label, veracity: "known", oneway: false, rank: "" });
    linked += 1;
  }
  const names = new Set(doc.stubs.map((stub) => textKey(stub.name)));
  let stubs = 0;
  for (const raw of (Array.isArray(input.stubs) ? input.stubs : []).slice(0, 60)) {
    const name = text(raw, 120);
    if (!name || names.has(textKey(name)) || doc.stubs.length >= LIMITS.stubs) continue;
    names.add(textKey(name));
    doc.stubs.push({ id: newId("stub"), name, note: "", source: "scan", status: "open" });
    stubs += 1;
  }
  saveWorldDoc(campaignId, doc);
  return { created: refs.size, links: linked, stubs, skipped };
}
