import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getWorldDoc, hasWorldDoc, saveWorldDoc } from "@/lib/db/world-forge";
import { decodeBundleImage } from "@/lib/workshop/bundle";
import { parseRef, readDoc, refOf, remapDoc, type Shelf } from "@/lib/worldforge/model";

// A workshop's WorldForge inside a workshop bundle. A bundle carries its
// rows as lists without ids, so a ref travels as the row's place in its
// list ("npc:#3" is the fourth NPC of the bundle) and lands as the id that
// row became. A ref to a row the bundle does not carry is dropped. The
// atlas's pictures travel inline beside the document.

export type BundleWorld = { doc: Record<string, unknown>; images: Record<string, string> };

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
  const images: Record<string, string> = {};
  for (const atlas of doc.maps) {
    const image = atlas.image ? inline(atlas.image) : "";
    if (image) images[atlas.id] = image;
  }
  return { doc: { ...doc, maps: doc.maps.map((atlas) => ({ ...atlas, image: "" })) }, images };
}

// Returns how many entries, links and events it brought, for the count.
export function worldFromBundle(workshopId: string, world: BundleWorld, ids: Record<Shelf, string[]>): number {
  const doc = remapDoc(readDoc(world.doc), (ref) => {
    const parsed = parseRef(ref);
    const index = parsed && /^#\d+$/.test(parsed.id) ? Number(parsed.id.slice(1)) : -1;
    const id = parsed ? ids[parsed.shelf][index] : undefined;
    return parsed && id ? refOf(parsed.shelf, id) : null;
  });
  const dir = path.join(process.cwd(), "public", "uploads");
  doc.maps = doc.maps.map((atlas) => {
    const image = decodeBundleImage(world.images[atlas.id] ?? "");
    if (!image) return { ...atlas, image: "" };
    mkdirSync(dir, { recursive: true });
    const filename = `${crypto.randomUUID()}.${image.ext}`;
    writeFileSync(path.join(dir, filename), image.bytes);
    return { ...atlas, image: `/uploads/${filename}` };
  });
  saveWorldDoc(workshopId, doc);
  return Object.keys(doc.entries).length + doc.links.length + doc.events.length;
}
