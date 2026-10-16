import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWorldDoc, hasWorldDoc, saveWorldDoc } from "@/lib/db/world-forge";
import { decodeBundleImage } from "@/lib/workshop/bundle";
import { parseRef, readDoc, refOf, remapDoc, type Shelf } from "@/lib/worldforge/model";
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

export function worldForBundle(workshopId: string, order: Record<Shelf, string[]>, inline: (path: string) => string): BundleWorld | null {
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
      return [ref, { ...entry, image: "" }];
    }),
  );
  return { doc: { ...doc, entries, maps: doc.maps.map((atlas) => ({ ...atlas, image: "" })) }, images, entryImages };
}

// Returns how many entries, links and events it brought, for the count.
export function worldFromBundle(workshopId: string, world: BundleWorld, ids: Record<Shelf, string[]>): number {
  const land = (ref: string) => {
    const parsed = parseRef(ref);
    const index = parsed && /^#\d+$/.test(parsed.id) ? Number(parsed.id.slice(1)) : -1;
    const id = parsed ? ids[parsed.shelf][index] : undefined;
    return parsed && id ? refOf(parsed.shelf, id) : null;
  };
  const doc = remapDoc(readDoc(world.doc), land);
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", "uploads");
  const write = (url: string | undefined) => {
    const image = decodeBundleImage(url ?? "");
    if (!image) return "";
    mkdirSync(dir, { recursive: true });
    const filename = `${crypto.randomUUID()}.${image.ext}`;
    writeFileSync(path.join(/*turbopackIgnore: true*/ dir, filename), image.bytes);
    recordMediaFile(`/uploads/${filename}`);
    return `/uploads/${filename}`;
  };
  doc.maps = doc.maps.map((atlas) => ({ ...atlas, image: write(world.images[atlas.id]) }));
  // A path from the other server names nothing here: an entry keeps a
  // picture only if the bundle carried its bytes.
  for (const [ref, entry] of Object.entries(doc.entries)) doc.entries[ref] = { ...entry, image: "" };
  for (const [bundleRef, url] of Object.entries(world.entryImages ?? {})) {
    const ref = land(bundleRef);
    if (ref && doc.entries[ref]) doc.entries[ref] = { ...doc.entries[ref], image: write(url) };
  }
  saveWorldDoc(workshopId, doc);
  return Object.keys(doc.entries).length + doc.links.length + doc.events.length;
}
