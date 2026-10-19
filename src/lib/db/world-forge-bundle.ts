import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWorldDoc, hasWorldDoc, saveWorldDoc } from "@/lib/db/world-forge";
import { decodeBundleImage } from "@/lib/workshop/bundle";
import { parseRef, readDoc, refOf, remapDoc, type Binding, type Shelf } from "@/lib/worldforge/model";
import { recordMediaFile } from "@/lib/media-access";

// A workshop's WorldForge inside a workshop bundle. A bundle carries its
// rows as lists without ids, so a ref travels as the row's place in its
// list ("npc:#3" is the fourth NPC of the bundle) and lands as the id that
// row became. A ref to a row the bundle does not carry is dropped. The
// atlas's pictures and each entry's own picture (a place's illustration,
// which lives in the document rather than the place's row) travel inline
// beside the document, so a bundle opened on another server needs none of
// this one's files.

export type BundleWorld = { doc: Record<string, unknown>; images: Record<string, string>; entryImages: Record<string, string> };

// `portable` turns a link to the author's own record into one that travels
// by name ("homebrew:@monster:Tidewyrm"), or null when it cannot.
export function worldForBundle(
  workshopId: string,
  order: Record<Shelf, string[]>,
  inline: (path: string) => string,
  portable: (binding: Binding) => Binding | null = (binding) => binding,
): BundleWorld | null {
  if (!hasWorldDoc(workshopId)) {
    return null;
  }
  const at = Object.fromEntries(
    Object.entries(order).map(([shelf, ids]) => [shelf, new Map(ids.map((id, index) => [id, index]))]),
  ) as Record<Shelf, Map<string, number>>;
  const doc = remapDoc(getWorldDoc(workshopId), (ref) => {
    const parsed = parseRef(ref);
    const index = parsed ? at[parsed.shelf].get(parsed.id) : undefined;
    return parsed && index !== undefined ? refOf(parsed.shelf, `#${index}`) : null;
  });
  // Where imported rows came from names sources and ids on this server
  // only (src/lib/worldforge/import-merge.ts): a bundle starts fresh.
  delete doc.origins;
  const images: Record<string, string> = {};
  for (const atlas of doc.maps) {
    const image = atlas.image ? inline(atlas.image) : "";
    if (image) images[atlas.id] = image;
  }
  const entryImages: Record<string, string> = {};
  const entries = Object.fromEntries(
    Object.entries(doc.entries).map(([ref, entry]) => {
      const image = entry.image ? inline(entry.image) : "";
      if (image) entryImages[ref] = image;
      const bindings = entry.bindings.map(portable).filter((binding): binding is Binding => binding !== null);
      return [ref, { ...entry, image: "", bindings }];
    }),
  );
  return { doc: { ...doc, entries, maps: doc.maps.map((atlas) => ({ ...atlas, image: "" })) }, images, entryImages };
}

// Returns how many entries, links and events it brought, for the count.
// `arrived` names the id a monster or item of the bundle's shelf landed as
// here (src/lib/db/workshop-bundle-shelf.ts), for an entry's links, and
// `rows` the ids the bundle's battle maps and encounters landed as, in the
// bundle's order, for a place's.
export function worldFromBundle(
  workshopId: string,
  world: BundleWorld,
  ids: Record<Shelf, string[]>,
  arrived: (kind: string, name: string) => string | null = () => null,
  rows: { maps: string[]; encounters: string[] } = { maps: [], encounters: [] },
  // Writes one picture and answers its path. The bundle import passes its
  // own, which writes each distinct picture once and cleans up after a
  // failed import (src/lib/db/workshop-bundle.ts).
  save?: (dataUrl: string | undefined) => string,
): number {
  const land = (ref: string) => {
    const parsed = parseRef(ref);
    const index = parsed && /^#\d+$/.test(parsed.id) ? Number(parsed.id.slice(1)) : -1;
    const id = parsed ? ids[parsed.shelf][index] : undefined;
    return parsed && id ? refOf(parsed.shelf, id) : null;
  };
  const doc = remapDoc(readDoc(world.doc), land);
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");
  const write = save ?? ((url: string | undefined) => {
    const image = decodeBundleImage(url ?? "");
    if (!image) return "";
    mkdirSync(dir, { recursive: true });
    const filename = `${crypto.randomUUID()}.${image.ext}`;
    writeFileSync(path.join(/*turbopackIgnore: true*/ dir, filename), image.bytes);
    recordMediaFile(`/uploads/${filename}`);
    return `/uploads/${filename}`;
  });
  doc.maps = doc.maps.map((atlas) => ({ ...atlas, image: write(world.images[atlas.id]) }));
  // A path from the other server names nothing here: an entry keeps a
  // picture only if the bundle carried its bytes.
  // A link travels by name and lands on the arrived copy; a link to a record
  // that did not travel is dropped, and a rulebook link stays as it is.
  const landBinding = (binding: Binding): Binding | null => {
    if (binding.kind === "map" || binding.kind === "encounter") {
      // Only a row the bundle carried: an id from the other server names
      // nothing here, or worse, another table's row.
      const index = /^@(map|encounter):#(\d+)$/.exec(binding.ref);
      const id = index && index[1] === binding.kind ? (binding.kind === "map" ? rows.maps : rows.encounters)[Number(index[2])] : undefined;
      return id ? { kind: binding.kind, ref: id } : null;
    }
    const portable = /^homebrew:@(monster|item):(.+)$/.exec(binding.ref);
    if (portable) {
      const id = arrived(portable[1], portable[2]);
      return id ? { kind: binding.kind, ref: `homebrew:${id}` } : null;
    }
    return binding.ref.startsWith("homebrew:") ? null : binding;
  };
  for (const [ref, entry] of Object.entries(doc.entries)) {
    doc.entries[ref] = { ...entry, image: "", bindings: entry.bindings.map(landBinding).filter((binding): binding is Binding => binding !== null) };
  }
  for (const [bundleRef, url] of Object.entries(world.entryImages ?? {})) {
    const ref = land(bundleRef);
    if (ref && doc.entries[ref]) doc.entries[ref] = { ...doc.entries[ref], image: write(url) };
  }
  saveWorldDoc(workshopId, doc);
  return Object.keys(doc.entries).length + doc.links.length + doc.events.length;
}
