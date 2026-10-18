// The plugin browser's thumbnails.
//
// A registry entry may name a small picture by https URL. The server fetches
// it, checks that the bytes really are a PNG, JPEG or WebP, and serves it from
// /api/worlds/registry/thumbnail/<kind>/<id>. A browser never contacts the
// registry's host, so the apps' content policies and an Android page served
// from https://localhost see one more picture from their own server, and the
// set of hosts a server fetches from stays exactly the set its registry names.
//
// The route resolves an id to a URL through the listing, never through
// anything the client sent, so it cannot be pointed at an arbitrary address.
import { fetchBytesCapped, fetchRegistryIndex } from "@/lib/worlds/install";
import type { RegistryBundle, RegistryEntry } from "@/lib/worlds/types";

// A 352x200 WebP is about 15 KB; this leaves room for a PNG without letting a
// registry hand the server megabytes per tile.
export const MAX_THUMBNAIL_BYTES = 512 * 1024;
// How long a listing fetched for the browser stays good for resolving its
// thumbnails, so a page of tiles costs one index fetch rather than one each.
const LISTING_TTL_MS = 5 * 60_000;
// Pictures held in memory, oldest dropped first. Thumbnails are small, and a
// registry with more entries than this pages through the cache harmlessly.
const MAX_CACHED_PICTURES = 200;

export type ThumbnailKind = "pack" | "bundle";
export type RegistryListing = { packs: RegistryEntry[]; bundles: RegistryBundle[] };
export type ThumbnailImage = { mime: string; bytes: Buffer };

declare global {
  var __odmRegistryListing: { url: string; at: number; value: RegistryListing } | undefined;
  var __odmRegistryThumbnails: Map<string, ThumbnailImage> | undefined;
}

function pictures(): Map<string, ThumbnailImage> {
  globalThis.__odmRegistryThumbnails ??= new Map();
  return globalThis.__odmRegistryThumbnails;
}

// The browser's own fetch of the index seeds this, so the tiles that follow
// it resolve without a second round trip.
export function rememberRegistryListing(url: string, value: RegistryListing): void {
  globalThis.__odmRegistryListing = { url, at: Date.now(), value };
}

async function currentListing(url: string): Promise<RegistryListing | null> {
  const held = globalThis.__odmRegistryListing;
  if (held && held.url === url && Date.now() - held.at < LISTING_TTL_MS) {
    return held.value;
  }
  const result = await fetchRegistryIndex(url);
  if (!result.ok) {
    return null;
  }
  const value = { packs: result.packs, bundles: result.bundles };
  rememberRegistryListing(url, value);
  return value;
}

// The address a client loads an entry's thumbnail from. The version rides in
// the query string so a picture can be cached for a day and still change the
// moment the registry publishes a new build, the same as a pack's own art.
export function thumbnailPath(kind: ThumbnailKind, id: string, version: string): string {
  return `/api/worlds/registry/thumbnail/${kind}/${encodeURIComponent(id)}?v=${encodeURIComponent(version)}`;
}

// The listing as the browser receives it: every remote thumbnail swapped for
// this server's own address, and an entry without one left without one.
export function withThumbnailPaths(listing: RegistryListing): RegistryListing {
  return {
    packs: listing.packs.map((entry) => ({
      ...entry,
      thumbnail: entry.thumbnail ? thumbnailPath("pack", entry.id, entry.version) : undefined,
    })),
    bundles: listing.bundles.map((entry) => ({
      ...entry,
      thumbnail: entry.thumbnail ? thumbnailPath("bundle", entry.id, entry.version) : undefined,
    })),
  };
}

// What the bytes are, by their signature rather than by whatever the host's
// Content-Type claimed. Anything else is not served.
export function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

// One entry's thumbnail, fetched once and then answered from memory. Null for
// an entry the registry does not list, one without a thumbnail, and one whose
// picture is unreachable, too large, or not an image.
export async function registryThumbnail(
  registryUrl: string,
  kind: ThumbnailKind,
  id: string,
): Promise<ThumbnailImage | null> {
  const listing = await currentListing(registryUrl);
  const entries: Array<RegistryEntry | RegistryBundle> = (kind === "pack" ? listing?.packs : listing?.bundles) ?? [];
  const remote = entries.find((entry) => entry.id === id)?.thumbnail;
  if (!remote) {
    return null;
  }
  const cache = pictures();
  const held = cache.get(remote);
  if (held) {
    return held;
  }
  const fetched = await fetchBytesCapped(remote, {
    maxBytes: MAX_THUMBNAIL_BYTES,
    accept: "image/webp,image/png,image/jpeg",
    tooLarge: "That thumbnail is too large.",
  });
  if (!fetched.ok) {
    return null;
  }
  const mime = sniffImage(fetched.bytes);
  if (!mime) {
    return null;
  }
  const image = { mime, bytes: fetched.bytes };
  if (cache.size >= MAX_CACHED_PICTURES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(remote, image);
  return image;
}
