import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { createNpcFromDraft, deleteNpc, getNpcById, listNpcs, renameNpc, setNpcPlace, setNpcPortrait, updateNpcFromDraft } from "@/lib/db/npcs";
import { getLocation, getLocationByName, insertKnownLocation, listLocations, renameLocation, setLocationLayout } from "@/lib/db/locations";
import { deleteFaction, getFaction, insertFaction, listFactions, updateFaction } from "@/lib/db/factions";
import { deleteLoreEntry, getLoreEntry, insertLoreEntry, listLoreEntries, updateLoreEntry } from "@/lib/db/lore";
import { draftFrom, normalizeNpcDraft } from "@/lib/npcs/forge";
import { isUploadedImagePath } from "@/lib/uploads";
import { LORE_BODY_MAX, type WorldLoreCategory, type WorldLoreEntry } from "@/lib/dm/world-lore-logic";
import { applyRowOps, type DocOps } from "@/lib/worldforge/ops";
import {
  SLICES,
  emptyDoc,
  parseRef,
  pruneDoc,
  readDoc,
  readBindings,
  readEntry,
  readSlice,
  refOf,
  typeFor,
  type Binding,
  type Entry,
  type Secret,
  type Shelf,
  type Slice,
  type WorldDoc,
  type WorldType,
} from "@/lib/worldforge/model";
import { playAdapters, playLink, type PlayAdapter, type PlayField } from "@/lib/worldforge/play-fields";
import { editableOf, mergeAgainst, type Editable, type EntryConflict } from "@/lib/worldforge/entry-merge";
import { entriesBoundTo, resolveBinding, type BoundRecord } from "@/lib/db/world-bindings";
import { byName, textKey } from "@/lib/language/text-logic";

// The workshop's WorldForge: one document beside the records it describes
// (src/lib/worldforge/model.ts says why). Everything that writes a record
// goes through that record's own module, so a Cast member made here is the
// same row the Cast panel edits and the DM plays.

export type WorldEntity = {
  ref: string;
  shelf: Shelf;
  id: string;
  name: string;
  // Cast and factions: the one line their own row keeps (trait, blurb).
  tagline: string;
  // Places and lore: their own long text (layout, body).
  text: string;
  aliases: string[];
  tags: string[];
  portrait: string;
  entry: Entry;
  createdAt: string;
  // What the table plays with, shown beside the article and edited in the
  // record's own tool.
  table: Record<string, string | number | boolean>;
  // The playable records the entry links to, resolved for this table
  // (src/lib/db/world-bindings.ts). Empty for an entry with no links.
  bound: BoundRecord[];
  // A Cast member's faction and home as play reads them, beside the World
  // links that speak to them (src/lib/worldforge/play-fields.ts). Empty for
  // every other shelf, and for a Cast member no such link starts at.
  inPlay: PlayAdapter[];
};

// ---- the document ----

export function getWorldDoc(campaignId: string): WorldDoc {
  const row = getDatabase().prepare(`SELECT doc_json FROM world_forge WHERE campaign_id = ?`).get(campaignId) as { doc_json: string } | undefined;
  return row ? readDoc(parseJson<unknown>(row.doc_json, {})) : emptyDoc();
}

export function hasWorldDoc(campaignId: string): boolean {
  return Boolean(getDatabase().prepare(`SELECT 1 FROM world_forge WHERE campaign_id = ?`).get(campaignId));
}

export function saveWorldDoc(campaignId: string, doc: WorldDoc) {
  getDatabase()
    .prepare(
      `INSERT INTO world_forge (campaign_id, doc_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(campaign_id) DO UPDATE SET doc_json = excluded.doc_json, updated_at = excluded.updated_at`,
    )
    .run(campaignId, JSON.stringify(doc), nowIso());
}

// Changes the slices given, each read through its floor. Entries are not a
// slice a client may send whole: they change one record at a time through
// updateWorldEntity. `ops` is the editor's way: row operations against what
// it last saw (src/lib/worldforge/ops.ts), so concurrent editors keep each
// other's work and a row changed under them is named in `conflicts`. A
// whole slice is still taken (an older client, a script), and replaces the
// stored one. `moveFolder` re-homes the entries of a deleted folder.
export function patchWorldDoc(campaignId: string, patch: Record<string, unknown>): { doc: WorldDoc; conflicts: string[] } {
  let doc = getWorldDoc(campaignId);
  let conflicts: string[] = [];
  if (patch.ops && typeof patch.ops === "object" && !Array.isArray(patch.ops)) {
    const applied = applyRowOps(doc, patch.ops as DocOps);
    doc = applied.doc;
    conflicts = applied.conflicts;
  }
  for (const slice of SLICES) {
    if (slice !== "entries" && patch[slice] !== undefined) {
      (doc as Record<Slice, unknown>)[slice] = readSlice(slice, patch[slice]);
    }
  }
  const move = (patch.moveFolder ?? null) as { from?: unknown; to?: unknown } | null;
  if (move && typeof move.from === "string" && move.from) {
    const to = typeof move.to === "string" && doc.folders.some((folder) => folder.id === move.to) ? move.to : "";
    for (const entry of Object.values(doc.entries)) if (entry.folderId === move.from) entry.folderId = to;
  }
  saveWorldDoc(campaignId, doc);
  return { doc, conflicts };
}

// ---- the records, as entries ----

export function worldEntities(campaignId: string, doc: WorldDoc = getWorldDoc(campaignId)): WorldEntity[] {
  const entry = (ref: string) => doc.entries[ref] ?? readEntry({});
  const factionNames = new Map(listFactions(campaignId).map((faction) => [faction.id, faction.name]));
  const places = listLocations(campaignId);
  const out: Array<Omit<WorldEntity, "bound" | "inPlay">> = [];
  // What play holds for each Cast member, as records where it can.
  const held = new Map<string, Record<PlayField, { ref: string; name: string } | null>>();
  for (const npc of listNpcs(campaignId)) {
    const ref = refOf("npc", npc.id);
    const own = entry(ref);
    out.push({
      ref, shelf: "npc", id: npc.id, name: npc.name, tagline: npc.trait, text: "", aliases: npc.aliases, tags: own.tags, portrait: npc.portraitUrl, entry: own, createdAt: npc.createdAt,
      table: { attitude: npc.attitude, statBlock: npc.statBlock, role: npc.role, home: npc.location, faction: factionNames.get(npc.factionId) ?? "", archived: npc.archived },
    });
    const home = npc.location ? places.find((place) => textKey(place.name) === textKey(npc.location)) : undefined;
    held.set(ref, {
      faction: npc.factionId && factionNames.has(npc.factionId) ? { ref: refOf("faction", npc.factionId), name: factionNames.get(npc.factionId)! } : null,
      home: npc.location ? { ref: home ? refOf("location", home.id) : "", name: npc.location } : null,
    });
  }
  for (const place of places) {
    const ref = refOf("location", place.id);
    const own = entry(ref);
    out.push({
      ref, shelf: "location", id: place.id, name: place.name, tagline: "", text: place.layoutDescription, aliases: own.aliases, tags: own.tags, portrait: own.image, entry: own, createdAt: place.createdAt,
      table: { visited: place.visited, here: place.isCurrent, connections: place.connections.join(", ") },
    });
  }
  for (const faction of listFactions(campaignId)) {
    const ref = refOf("faction", faction.id);
    const own = entry(ref);
    out.push({
      ref, shelf: "faction", id: faction.id, name: faction.name, tagline: faction.blurb, text: "", aliases: own.aliases, tags: faction.tags, portrait: faction.portraitPath, entry: own, createdAt: faction.createdAt,
      table: { attitude: faction.attitude, power: faction.power, goal: faction.goal },
    });
  }
  for (const lore of listLoreEntries(campaignId)) {
    const ref = refOf("lore", lore.id);
    const own = entry(ref);
    out.push({
      ref, shelf: "lore", id: lore.id, name: lore.title, tagline: "", text: lore.body, aliases: own.aliases, tags: lore.tags, portrait: lore.imagePath, entry: own, createdAt: lore.createdAt,
      table: { category: lore.category, visibility: lore.visibility, pinned: lore.pinned },
    });
  }
  const names = new Map(out.map((entity) => [entity.ref, entity.name]));
  return out
    .map((entity) => ({
      ...entity,
      bound: entity.entry.bindings.map((binding) => resolveBinding(campaignId, binding)),
      inPlay: entity.shelf === "npc" ? playAdapters(doc, entity.ref, held.get(entity.ref)!, names) : [],
    }))
    .sort(byName);
}

// The document with whatever points at a deleted record dropped, and the
// records it describes.
export function worldView(campaignId: string): { doc: WorldDoc; entities: WorldEntity[] } {
  const doc = getWorldDoc(campaignId);
  const entities = worldEntities(campaignId, doc);
  // Where imported rows came from is the server's to merge with, not the
  // editor's to carry.
  const shown = pruneDoc(doc, new Set(entities.map((entity) => entity.ref)));
  delete shown.origins;
  return { doc: shown, entities };
}

function ownedBy(campaignId: string, ref: string): boolean {
  const parsed = parseRef(ref);
  if (!parsed) return false;
  const owner =
    parsed.shelf === "npc" ? getNpcById(parsed.id)?.campaignId
    : parsed.shelf === "location" ? getLocation(parsed.id)?.campaignId
    : parsed.shelf === "faction" ? getFaction(parsed.id)?.campaignId
    : getLoreEntry(parsed.id)?.campaignId;
  return owner === campaignId;
}

export type EntityPatch = {
  name?: string;
  tagline?: string;
  text?: string;
  aliases?: string[];
  tags?: string[];
  portrait?: string;
} & Partial<Pick<Entry, "typeId" | "folderId" | "canon" | "article" | "hiddenTruth" | "notes" | "fields" | "bindings">>;

export type EntityResult = { entity: WorldEntity } | { error: string; status?: number; conflicts?: EntryConflict[]; entity?: WorldEntity };

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : undefined);
const cleanList = (value: unknown, max: number, each: number) =>
  Array.isArray(value) ? [...new Set(value.map((item) => clean(item, each)).filter((item): item is string => Boolean(item)))].slice(0, max) : undefined;

type Failure = { error: string; status?: number };

// Makes the record on a type's shelf. No overlay yet.
export function createRecord(campaignId: string, type: WorldType, input: { name?: unknown; tagline?: unknown; text?: unknown }): { ref: string } | Failure {
  const name = clean(input.name, 80) ?? "";
  if (!name) return { error: "An entry needs a name." };
  if (type.shelf === "npc") {
    if (listNpcs(campaignId).some((npc) => textKey(npc.name) === textKey(name))) return { error: `The Cast already has someone called ${name}.`, status: 409 };
    const outcome = normalizeNpcDraft({ name, trait: clean(input.tagline, 200) ?? "" });
    if ("error" in outcome) return { error: outcome.error };
    return { ref: refOf("npc", createNpcFromDraft(campaignId, outcome.draft).id) };
  }
  if (type.shelf === "location") {
    if (getLocationByName(campaignId, name)) return { error: `There is already a place called ${name}.`, status: 409 };
    const place = insertKnownLocation({ campaignId, name, layoutDescription: clean(input.text, 2_000) ?? "" });
    return place ? { ref: refOf("location", place.id) } : { error: "That place could not be made." };
  }
  if (type.shelf === "faction") {
    return { ref: refOf("faction", insertFaction(campaignId, { name, blurb: clean(input.tagline, 400) ?? "" }).id) };
  }
  const lore = insertLoreEntry({ campaignId, category: type.loreCategory, title: name.slice(0, 120), body: clean(input.text, LORE_BODY_MAX) ?? "", tags: [], visibility: "party" });
  return { ref: refOf("lore", lore.id) };
}

// Writes what lives in the record's own row: its name, its line or its
// text, its aliases, tags and picture where the row has columns for them.
export function writeRecord(campaignId: string, ref: string, patch: EntityPatch, lore?: WorldType): Failure | null {
  const parsed = parseRef(ref);
  if (!parsed || !ownedBy(campaignId, ref)) return { error: "No such entry in this workshop.", status: 404 };
  const { shelf, id } = parsed;
  const name = clean(patch.name, 80);
  const tags = cleanList(patch.tags, 8, 40);
  const aliases = cleanList(patch.aliases, 8, 80);
  const portrait = patch.portrait === undefined ? undefined : isUploadedImagePath(patch.portrait) ? patch.portrait : "";
  if (shelf === "npc") {
    const npc = getNpcById(id)!;
    if (name && textKey(name) !== textKey(npc.name) && listNpcs(campaignId).some((other) => textKey(other.name) === textKey(name))) {
      return { error: `The Cast already has someone called ${name}.`, status: 409 };
    }
    if (name || aliases) {
      const called = name || npc.name;
      renameNpc(id, called, (aliases ?? npc.aliases).filter((alias) => textKey(alias) !== textKey(called)));
    }
    if (patch.tagline !== undefined) {
      const outcome = normalizeNpcDraft({ ...draftFrom(getNpcById(id)! as Parameters<typeof draftFrom>[0]), trait: clean(patch.tagline, 200) ?? "" });
      if ("error" in outcome) return { error: outcome.error };
      updateNpcFromDraft(campaignId, id, outcome.draft);
    }
    if (portrait !== undefined) setNpcPortrait(id, portrait);
  } else if (shelf === "location") {
    if (name && !renameLocation(campaignId, id, name)) return { error: `There is already a place called ${name}.`, status: 409 };
    if (patch.text !== undefined) setLocationLayout(id, clean(patch.text, 2_000) ?? "");
  } else if (shelf === "faction") {
    updateFaction(id, {
      ...(name ? { name } : {}),
      ...(patch.tagline !== undefined ? { blurb: clean(patch.tagline, 400) ?? "" } : {}),
      ...(tags ? { tags } : {}),
      ...(portrait !== undefined ? { portraitPath: portrait } : {}),
    });
  } else {
    updateLoreEntry(id, {
      ...(name ? { title: name.slice(0, 120) } : {}),
      ...(patch.text !== undefined ? { body: clean(patch.text, LORE_BODY_MAX) ?? "" } : {}),
      ...(tags ? { tags } : {}),
      ...(portrait !== undefined ? { imagePath: portrait } : {}),
      ...(lore ? { category: lore.loreCategory } : {}),
    });
  }
  return null;
}

// The overlay after a patch. A type change stays on the record's shelf: a
// Character cannot become a place by a dropdown, because they are different
// rows. Field values are checked against the type: a number field keeps a
// number, a pick keeps one of its options.
export function nextEntry(doc: WorldDoc, ref: string, patch: EntityPatch): Entry {
  const shelf = parseRef(ref)!.shelf;
  const before = doc.entries[ref] ?? readEntry({});
  const typeId = patch.typeId && doc.types.some((type) => type.id === patch.typeId && type.shelf === shelf) ? patch.typeId : before.typeId;
  const type = typeFor(doc, shelf, typeId);
  const fields = patch.fields === undefined ? { ...before.fields } : readEntry({ fields: patch.fields }).fields;
  for (const def of type.fields) {
    const value = fields[def.id];
    if (value === undefined) continue;
    const wrongKind = def.kind === "year" ? typeof value !== "object" : def.kind === "number" ? typeof value !== "number" : typeof value !== "string";
    if (wrongKind || (def.kind === "select" && !def.options.includes(value as string))) delete fields[def.id];
  }
  const folderId = patch.folderId ?? before.folderId;
  const portrait = patch.portrait === undefined ? undefined : isUploadedImagePath(patch.portrait) ? patch.portrait : "";
  return readEntry({
    ...before,
    typeId: type.id,
    folderId: doc.folders.some((folder) => folder.id === folderId) ? folderId : "",
    canon: patch.canon ?? before.canon,
    article: patch.article ?? before.article,
    hiddenTruth: patch.hiddenTruth ?? before.hiddenTruth,
    notes: patch.notes ?? before.notes,
    fields,
    aliases: shelf === "npc" ? [] : cleanList(patch.aliases, 8, 80) ?? before.aliases,
    tags: shelf === "npc" || shelf === "location" ? cleanList(patch.tags, 8, 40) ?? before.tags : [],
    image: shelf === "location" && portrait !== undefined ? portrait : before.image,
    // A Cast member's stat block is its own row's (Npc.statBlock): it takes
    // no links of its own.
    bindings: shelf === "npc" ? [] : patch.bindings === undefined ? before.bindings : readBindings(patch.bindings),
  });
}

// A link added by this patch must name a record this table can use: the
// author's own, or the rulebook's. Links the entry already had are kept as
// they are, found or not, so a record removed later never blocks a save.
function unusableLink(campaignId: string, before: Entry | undefined, patch: EntityPatch): Failure | null {
  if (patch.bindings === undefined) return null;
  const had = new Set((before?.bindings ?? []).map((binding) => `${binding.kind}|${binding.ref}`));
  for (const binding of readBindings(patch.bindings)) {
    if (had.has(`${binding.kind}|${binding.ref}`)) continue;
    if (!resolveBinding(campaignId, binding).found) {
      return { error: binding.kind === "monster" ? "That stat block is not one this table can use." : "That item is not one this table can use.", status: 400 };
    }
  }
  return null;
}

function entityOf(campaignId: string, doc: WorldDoc, ref: string): EntityResult {
  const entity = worldEntities(campaignId, doc).find((entry) => entry.ref === ref);
  return entity ? { entity } : { error: "The entry went missing.", status: 404 };
}

// A new entry of a type: the record on the type's shelf, and its overlay.
export function createWorldEntity(campaignId: string, sent: { typeId?: unknown; name?: unknown } & EntityPatch): EntityResult {
  const doc = getWorldDoc(campaignId);
  const type = doc.types.find((entry) => entry.id === sent.typeId) ?? doc.types[0];
  const input = oneLoreText(type.shelf, sent);
  const refused = unusableLink(campaignId, undefined, input);
  if (refused) return refused;
  const made = createRecord(campaignId, type, input);
  if ("error" in made) return made;
  const failed = writeRecord(campaignId, made.ref, { aliases: input.aliases, tags: input.tags, portrait: input.portrait });
  if (failed) return failed;
  doc.entries[made.ref] = nextEntry(doc, made.ref, {
    typeId: type.id,
    folderId: input.folderId,
    canon: input.canon,
    article: input.article,
    hiddenTruth: input.hiddenTruth,
    notes: input.notes,
    fields: input.fields,
    aliases: input.aliases,
    tags: input.tags,
    portrait: input.portrait,
    bindings: input.bindings,
  });
  saveWorldDoc(campaignId, doc);
  return entityOf(campaignId, doc, made.ref);
}

// One World link set into play (audit finding WF-12): a Cast member's
// "member of" link becomes their faction, a "lives in" or "located in"
// link their home, by the place's name as the Cast keeps it. Only when the
// author picks that link; a false belief never, a hidden truth only with
// `truth`. The link and the rest of the record are left as they are.
export function applyPlayLink(campaignId: string, ref: string, field: PlayField, linkId: string, truth: boolean): EntityResult {
  const parsed = parseRef(ref);
  const npc = parsed?.shelf === "npc" ? getNpcById(parsed.id) : null;
  if (!npc || npc.campaignId !== campaignId) return { error: "Only a Cast member has a faction and a home in play.", status: 404 };
  const doc = getWorldDoc(campaignId);
  const chosen = playLink(doc, ref, field, linkId, truth);
  if ("error" in chosen) return { error: chosen.error, status: 400 };
  const target = parseRef(chosen.link.to)!;
  if (field === "faction") {
    const faction = getFaction(target.id);
    if (!faction || faction.campaignId !== campaignId) return { error: "That faction is not in this world any more.", status: 404 };
    setNpcPlace(npc.id, { factionId: faction.id });
  } else {
    const place = getLocation(target.id);
    if (!place || place.campaignId !== campaignId) return { error: "That place is not in this world any more.", status: 404 };
    setNpcPlace(npc.id, { location: place.name });
  }
  return entityOf(campaignId, doc, ref);
}

// "Give it a World entry", from a stat block or an item in its own tool
// (audit finding WF-08): a lore entry named for the record and already
// linked to it, so a monster made in the Bestiary has an article to return
// to and a way into a fight. A record some entry already links to gets that
// entry back rather than a second one. A creature files under a lore type
// the author named for creatures, an item under Artifact or one named for
// items, and otherwise under the shelf's plainest type.
export function createEntryForRecord(campaignId: string, binding: Binding): EntityResult {
  const resolved = resolveBinding(campaignId, binding);
  if (!resolved.found) return { error: binding.kind === "monster" ? "That stat block is not one this table can use." : "That item is not one this table can use.", status: 400 };
  const doc = getWorldDoc(campaignId);
  const already = entriesBoundTo(campaignId, doc, binding.kind, binding.ref)[0];
  if (already) return entityOf(campaignId, doc, already.ref);
  const lore = doc.types.filter((type) => type.shelf === "lore");
  const named = binding.kind === "monster" ? /creature|monster|beast/i : /artifact|item|treasure/i;
  const type = lore.find((entry) => named.test(entry.name)) ?? typeFor(doc, "lore", "");
  if (!lore.some((entry) => entry.id === type.id)) return { error: "This world has no lore type to file it under. Add one in Types.", status: 400 };
  return createWorldEntity(campaignId, { typeId: type.id, name: resolved.name, bindings: [{ kind: binding.kind, ref: binding.ref }] });
}

// A lore entry's account is its body (src/lib/worldforge/account.ts): an
// article sent for one, with no body beside it, is written as the body. An
// article sent with a body, or an empty one, is kept as sent, which is how
// the editor keeps or clears an older article an import left.
function oneLoreText<T extends EntityPatch>(shelf: Shelf | undefined, patch: T): T {
  return shelf === "lore" && patch.article && patch.text === undefined ? { ...patch, text: patch.article, article: "" } : patch;
}

// With a base, the patch is checked against what the entry holds now (see
// src/lib/worldforge/entry-merge.ts): another author's change to a field
// this patch leaves alone survives, and a field both changed differently
// is reported with nothing written. Without one it is written as sent.
export function updateWorldEntity(campaignId: string, ref: string, input: EntityPatch & { base?: unknown }): EntityResult {
  const { base, ...sent } = input;
  const shelf = parseRef(ref)?.shelf;
  let patch: EntityPatch = oneLoreText(shelf, sent);
  const doc = getWorldDoc(campaignId);
  if (base && typeof base === "object" && !Array.isArray(base)) {
    const now = worldEntities(campaignId, doc).find((entry) => entry.ref === ref);
    if (!now) return { error: "No such entry in this workshop.", status: 404 };
    const merged = mergeAgainst(doc, editableOf(doc, now), sent as Partial<Editable>, base as Partial<Editable>);
    if ("conflicts" in merged) {
      const names = merged.conflicts.map((conflict) => conflict.label).join(", ");
      return {
        error: `Someone else changed ${names} while you were editing. Nothing was saved yet; your draft is kept.`,
        status: 409,
        conflicts: merged.conflicts,
        entity: now,
      };
    }
    patch = oneLoreText(shelf, merged.patch as EntityPatch);
  }
  const refused = unusableLink(campaignId, doc.entries[ref], patch);
  if (refused) return refused;
  const lore = patch.typeId ? doc.types.find((type) => type.id === patch.typeId && type.shelf === "lore") : undefined;
  const failed = writeRecord(campaignId, ref, patch, lore);
  if (failed) return failed;
  doc.entries[ref] = nextEntry(doc, ref, patch);
  saveWorldDoc(campaignId, doc);
  return entityOf(campaignId, doc, ref);
}

// Deletes the record itself (the Cast member, the place, the faction, the
// lore entry) and everything in the document that pointed at it.
export function deleteWorldEntity(campaignId: string, ref: string): boolean {
  const parsed = parseRef(ref);
  if (!parsed || !ownedBy(campaignId, ref)) return false;
  const { shelf, id } = parsed;
  if (shelf === "npc") deleteNpc(id);
  else if (shelf === "location") getDatabase().prepare(`DELETE FROM locations WHERE id = ? AND campaign_id = ?`).run(id, campaignId);
  else if (shelf === "faction") deleteFaction(id);
  else deleteLoreEntry(id);
  const doc = getWorldDoc(campaignId);
  const live = new Set(worldEntities(campaignId, doc).map((entity) => entity.ref));
  saveWorldDoc(campaignId, pruneDoc(doc, live));
  return true;
}

// How many things the workshop's WorldForge holds beyond its records, for
// the hub card.
export function worldCounts(campaignId: string): { entries: number; links: number; events: number; secrets: number; maps: number } {
  const { doc, entities } = worldView(campaignId);
  return { entries: entities.length, links: doc.links.length, events: doc.events.length, secrets: doc.secrets.length, maps: doc.maps.length };
}

// ---- a secret told to the party ----

// "Reveal to the party" at a table (audit WF-10): the words the story
// authority chose become a lore entry the whole table reads, and the secret
// is marked learned with the record of when and where it was told. All of it
// is this campaign's own copy: a world brought in from a workshop was copied
// (src/lib/db/content-import.ts), so the workshop's secret is not touched.
// One reveal per secret; a second is refused with the first entry named.
export function revealSecret(
  campaignId: string,
  secretId: string,
  told: { title: string; body: string; category?: WorldLoreCategory },
): { secret: Secret; entry: WorldLoreEntry } | Failure {
  const doc = getWorldDoc(campaignId);
  const secret = doc.secrets.find((entry) => entry.id === secretId);
  if (!secret) return { error: "No such secret in this world.", status: 404 };
  if (secret.revealedAs && getLoreEntry(parseRef(secret.revealedAs)?.id ?? "")?.campaignId === campaignId) {
    return { error: "The party has already been told this one.", status: 409 };
  }
  const entry = insertLoreEntry({ campaignId, category: told.category ?? "other", title: told.title, body: told.body, tags: [], visibility: "party" });
  const revealed: Secret = { ...secret, partyKnows: true, revealedAt: new Date().toISOString(), revealedAs: refOf("lore", entry.id) };
  saveWorldDoc(campaignId, { ...doc, secrets: doc.secrets.map((row) => (row.id === secretId ? revealed : row)) });
  return { secret: revealed, entry };
}
