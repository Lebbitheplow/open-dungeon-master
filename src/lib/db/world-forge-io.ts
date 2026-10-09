import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDatabase } from "@/lib/db/core";
import { getCampaignById } from "@/lib/db/campaigns";
import { getBeat, insertBeat, listBeats, updateBeat } from "@/lib/db/workshop-beats";
import { getOverworld, setOverworldAnchor, setOverworldBackdrop } from "@/lib/db/overworld";
import { admitUpload, type UploadAccount, type UploadRefusal } from "@/lib/upload-budget";
import { decodeBundleImage, encodeBundleImage, type BundleImage } from "@/lib/workshop/bundle";
import { isUploadedImagePath } from "@/lib/uploads";
import { createRecord, getWorldDoc, nextEntry, saveWorldDoc, worldEntities, worldView, writeRecord } from "@/lib/db/world-forge";
import { firstSentence, readWorldForge, writeWorldForge, type ExportRecord, type WorldImport } from "@/lib/worldforge/format";
import { LIMITS, LINK_LABELS, newId, parseRef, refOf, remapDoc, type WorldDoc, type WorldType } from "@/lib/worldforge/model";
import { mergeImportedLinks } from "@/lib/db/world-link-merge";

// A WorldForge file into a workshop, and a workshop out as one. Importing
// into a workshop that already has a world adds to it: a type, a field, a
// place or a person it already has (by name, or by the WorldForge id an
// earlier import of the same file left) is updated, not doubled.

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
      events: number;
      secrets: number;
      maps: number;
      beats: number;
      skipped: string[];
    }
  | { error: string; refusal?: UploadRefusal };

function saveImage(image: BundleImage | null, written: string[]): string {
  if (!image) return "";
  const dir = path.join(process.cwd(), "public", "uploads");
  mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${image.ext}`;
  writeFileSync(path.join(dir, filename), image.bytes);
  written.push(`/uploads/${filename}`);
  return `/uploads/${filename}`;
}

// The file's types folded into the workshop's: one of the same name on the
// same shelf is the same type, and its fields match by name and kind.
function mergeTypes(doc: WorldDoc, incoming: WorldType[]) {
  const types = new Map<string, string>();
  const fields = new Map<string, Map<string, string>>();
  for (const type of incoming) {
    let target = doc.types.find((own) => own.shelf === type.shelf && own.name.toLowerCase() === type.name.toLowerCase());
    if (!target && doc.types.length < LIMITS.types) {
      target = { ...type, id: doc.types.some((own) => own.id === type.id) ? newId("t") : type.id, fields: [] };
      doc.types.push(target);
    }
    target ??= doc.types.find((own) => own.shelf === type.shelf) ?? doc.types[0];
    const map = new Map<string, string>();
    for (const field of type.fields) {
      let own = target.fields.find((entry) => entry.kind === field.kind && entry.name.toLowerCase() === field.name.toLowerCase());
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

// Rows by id: the file's replace the workshop's of the same id, new ones
// are added up to the cap.
function mergeRows<T extends { id: string }>(own: T[], incoming: T[], cap: number): T[] {
  const byId = new Map(own.map((row) => [row.id, row]));
  for (const row of incoming) if (byId.has(row.id) || byId.size < cap) byId.set(row.id, row);
  return [...byId.values()];
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

  const written: string[] = [];
  try {
    return getDatabase().transaction(() => {
      const doc = getWorldDoc(campaignId);
      const typeMap = mergeTypes(doc, parsed.doc.types);
      doc.folders = mergeRows(doc.folders, parsed.doc.folders, LIMITS.folders);
      doc.calendars = mergeRows(doc.calendars, parsed.doc.calendars, LIMITS.calendars);

      const existing = worldEntities(campaignId, doc);
      const byWfId = new Map(existing.filter((entity) => entity.entry.wfId).map((entity) => [`${entity.shelf}|${entity.entry.wfId}`, entity.ref]));
      const byName = new Map(existing.map((entity) => [`${entity.shelf}|${entity.name.toLowerCase()}`, entity.ref]));
      const refMap = new Map<string, string>();
      const fresh = new Set<string>();
      const skipped: string[] = [];
      let created = 0;
      let updated = 0;
      parsed.records.forEach((record, index) => {
        const typeId = typeMap.types.get(record.entry.typeId) ?? record.entry.typeId;
        const type = doc.types.find((entry) => entry.id === typeId) ?? doc.types.find((entry) => entry.shelf === record.shelf)!;
        let ref = byWfId.get(`${record.shelf}|${record.entry.wfId}`) ?? byName.get(`${record.shelf}|${record.name.toLowerCase()}`) ?? "";
        if (ref) {
          updated += 1;
        } else {
          const made = createRecord(campaignId, type, record);
          if ("error" in made) {
            skipped.push(`${record.name}: ${made.error}`);
            return;
          }
          ref = made.ref;
          fresh.add(ref);
          created += 1;
        }
        refMap.set(record.ref, ref);
        const portrait = saveImage(portraits[index], written) || undefined;
        writeRecord(campaignId, ref, { name: record.name, tagline: record.tagline || undefined, text: record.text || undefined, aliases: record.entry.aliases, tags: record.tags, portrait }, type.shelf === "lore" ? type : undefined);
        const fieldIds = typeMap.fields.get(record.entry.typeId) ?? new Map<string, string>();
        const fields = Object.fromEntries(Object.entries(record.entry.fields).map(([id, value]) => [fieldIds.get(id) ?? id, value]));
        doc.entries[ref] = { ...nextEntry(doc, ref, { ...record.entry, typeId: type.id, fields, tags: record.tags, portrait }), wfId: record.entry.wfId };
        // An entry that is not canon yet does not belong in what players read.
        const lore = parseRef(ref);
        if (lore?.shelf === "lore" && record.entry.canon !== "canon") {
          getDatabase().prepare(`UPDATE lore_entries SET visibility = 'dm' WHERE id = ?`).run(lore.id);
        }
      });

      const mapped = remapDoc(parsed.doc, (ref) => refMap.get(ref) ?? null);
      const names = new Map(worldEntities(campaignId, doc).map((entity) => [entity.ref, entity.name]));
      const merged = mergeImportedLinks(doc.links, mapped.links, `wf:${parsed.worldName}`, (ref) => names.get(ref) ?? "someone");
      doc.links = merged.links;
      doc.events = mergeRows(doc.events, mapped.events, LIMITS.events);
      doc.secrets = mergeRows(doc.secrets, mapped.secrets, LIMITS.secrets);
      const stubNames = new Set(doc.stubs.map((stub) => stub.name.toLowerCase()));
      doc.stubs = mergeRows(doc.stubs, mapped.stubs.filter((stub) => !stubNames.has(stub.name.toLowerCase())), LIMITS.stubs);
      doc.maps = mergeRows(doc.maps, mapped.maps.map((atlas) => ({ ...atlas, image: saveImage(mapArt.get(atlas.id) ?? null, written) || doc.maps.find((own) => own.id === atlas.id)?.image || "" })), LIMITS.maps);
      doc.pins = mergeRows(doc.pins, mapped.pins, LIMITS.pins);
      saveWorldDoc(campaignId, doc);

      // Places pinned on the file's top map stand where their pins do on the
      // region map, when this import made them.
      const root = mapped.maps.find((atlas) => !atlas.parentPinId) ?? mapped.maps[0];
      if (root) {
        const region = getOverworld(campaignId);
        for (const pin of mapped.pins.filter((entry) => entry.mapId === root.id)) {
          const place = parseRef(pin.ref);
          if (place?.shelf === "location" && fresh.has(pin.ref)) {
            setOverworldAnchor(campaignId, place.id, { x: Math.round(pin.x * (region.width - 1)), y: Math.round(pin.y * (region.height - 1)) });
          }
        }
        const art = doc.maps.find((atlas) => atlas.id === root.id)?.image;
        if (art && !region.backdropPath) setOverworldBackdrop(campaignId, art);
      }

      // The file's scenes, as storyboard cards in each story's order.
      const titles = new Set(listBeats(campaignId).map((beat) => beat.title.toLowerCase()));
      const stories = [...new Set(parsed.beats.map((beat) => beat.story))];
      let beats = 0;
      for (const [row, story] of stories.entries()) {
        const ids: string[] = [];
        for (const beat of parsed.beats.filter((entry) => entry.story === story)) {
          if (titles.has(beat.title.toLowerCase())) continue;
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
        conflicts: merged.conflicts,
        events: mapped.events.length,
        secrets: mapped.secrets.length,
        maps: mapped.maps.length,
        beats,
        skipped,
      };
    })();
  } catch (error) {
    // Files no committed row names are taken away again.
    for (const url of written) rmSync(path.join(process.cwd(), "public", url), { force: true });
    throw error;
  }
}

const MAX_EXPORT_IMAGE_CHARS = 60 * 1024 * 1024;

export function exportWorldForge(campaignId: string): Record<string, unknown> {
  const campaign = getCampaignById(campaignId);
  const { doc, entities } = worldView(campaignId);
  let budget = MAX_EXPORT_IMAGE_CHARS;
  const inline = (url: string) => {
    if (!isUploadedImagePath(url)) return "";
    try {
      const encoded = encodeBundleImage(url, readFileSync(path.join(process.cwd(), "public", url)));
      if (!encoded || encoded.length > budget) return "";
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
    portrait: inline(entity.portrait),
    entry: { ...entity.entry, aliases: entity.aliases },
    createdAt: entity.createdAt,
  }));
  const mapImages: Record<string, string> = {};
  for (const atlas of doc.maps) {
    const image = inline(atlas.image);
    if (image) mapImages[atlas.id] = image;
  }
  return writeWorldForge({
    worldName: campaign?.title ?? "A world",
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
// travel is dropped with whatever only it held up. Types, calendars and the
// rest merge by id, so a second import of the same workshop updates; links
// merge by the source link they came from (world-link-merge.ts), and what
// both sides changed comes back in `conflicts`.
export function copyWorldDoc(
  sourceId: string,
  targetId: string,
  resolve: (shelf: "npc" | "location" | "faction" | "lore", id: string) => string | null,
): { count: number; conflicts: string[] } {
  const source = getWorldDoc(sourceId);
  const mapped = remapDoc(source, (ref) => {
    const parsed = parseRef(ref);
    const copy = parsed ? resolve(parsed.shelf, parsed.id) : null;
    return parsed && copy ? refOf(parsed.shelf, copy) : null;
  });
  const target = getWorldDoc(targetId);
  target.types = mergeRows(target.types, mapped.types, LIMITS.types);
  target.entries = { ...target.entries, ...mapped.entries };
  const names = new Map(worldEntities(targetId, target).map((entity) => [entity.ref, entity.name]));
  const merged = mergeImportedLinks(target.links, mapped.links, `campaign:${sourceId}`, (ref) => names.get(ref) ?? "someone");
  target.links = merged.links;
  for (const slice of ["folders", "calendars", "events", "secrets", "stubs", "maps", "pins"] as const) {
    (target as Record<string, unknown>)[slice] = mergeRows(target[slice] as Array<{ id: string }>, mapped[slice] as Array<{ id: string }>, LIMITS[slice]);
  }
  saveWorldDoc(targetId, target);
  return {
    count: Object.keys(mapped.entries).length + merged.added + merged.updated + mapped.events.length + mapped.secrets.length,
    conflicts: merged.conflicts,
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
  const names = new Set(doc.stubs.map((stub) => stub.name.toLowerCase()));
  let stubs = 0;
  for (const raw of (Array.isArray(input.stubs) ? input.stubs : []).slice(0, 60)) {
    const name = text(raw, 120);
    if (!name || names.has(name.toLowerCase()) || doc.stubs.length >= LIMITS.stubs) continue;
    names.add(name.toLowerCase());
    doc.stubs.push({ id: newId("stub"), name, note: "", source: "scan", status: "open" });
    stubs += 1;
  }
  saveWorldDoc(campaignId, doc);
  return { created: refs.size, links: linked, stubs, skipped };
}
