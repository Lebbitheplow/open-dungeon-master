import { sha256Hex } from "../sha256.ts";
import { IMAGE_DATA_URL, MAX_IMAGE_DATA_URL_CHARS } from "./bundle-schema.ts";

// One picture list for a whole bundle (the plan's "one portable media
// manifest for all roles", WF-05): a bundle may carry `media`, each picture
// once under the hash of its own data URL, and any image field anywhere in
// the bundle may name one as "media:<hash>" instead of carrying the bytes.
// A picture used twice (an Atlas map's art and the Region's backdrop, one
// portrait on two records) then travels once.
//
// This build reads such bundles and still writes pictures inline: a build
// from before the list cannot read "media:" names, so the writer waits until
// servers have this reader (packMedia is that writer, used by the tests).
// The format version does not move, as for every addition before it.
//
// Pure, with no imports beyond its own: the workshop's import preview and
// the DM's share panel read bundles in the browser and in the apps, where
// node:crypto does not exist; the format's tests need no database.

export const MEDIA_REF = /^media:([a-f0-9]{32})$/;
const MEDIA_ID = /^[a-f0-9]{32}$/;
export const MEDIA_MAX = 2_000;

export function mediaId(dataUrl: string): string {
  return sha256Hex(dataUrl).slice(0, 32);
}

function mapStrings(value: unknown, change: (text: string) => string): unknown {
  if (typeof value === "string") return change(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, change));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, change);
    return out;
  }
  return value;
}

// Every picture in a bundle moved into one list, each once.
export function packMedia<T>(bundle: T): T & { media: Record<string, string> } {
  const media: Record<string, string> = {};
  const packed = mapStrings(bundle, (text) => {
    if (!text.startsWith("data:image/") || !IMAGE_DATA_URL.test(text)) return text;
    const id = mediaId(text);
    media[id] = text;
    return `media:${id}`;
  }) as T;
  return { ...packed, media };
}

// A parsed bundle with its picture list laid back into the fields that name
// it, so every later step reads pictures inline as it always has. A bundle
// without a list passes through untouched. A list that is malformed, a
// picture whose bytes do not match its name, or a name the list does not
// carry refuses the whole bundle, before anything is written.
export function unpackMedia(parsed: unknown): { value: unknown } | { error: string } {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !("media" in parsed)) return { value: parsed };
  const { media, ...rest } = parsed as Record<string, unknown>;
  if (!media || typeof media !== "object" || Array.isArray(media)) return { error: "That bundle's picture list is malformed." };
  const entries = Object.entries(media as Record<string, unknown>);
  if (entries.length > MEDIA_MAX) return { error: `That bundle's picture list holds ${entries.length} pictures; a bundle carries ${MEDIA_MAX} at most.` };
  const pictures = new Map<string, string>();
  for (const [id, url] of entries) {
    if (!MEDIA_ID.test(id) || typeof url !== "string" || url.length > MAX_IMAGE_DATA_URL_CHARS || !IMAGE_DATA_URL.test(url)) {
      return { error: `That bundle's picture list is malformed at ${id.slice(0, 40)}.` };
    }
    if (mediaId(url) !== id) return { error: `A picture in that bundle's list does not match its name (${id}).` };
    pictures.set(id, url);
  }
  let missing = "";
  const value = mapStrings(rest, (text) => {
    const match = MEDIA_REF.exec(text);
    if (!match) return text;
    const url = pictures.get(match[1]);
    if (url === undefined && !missing) missing = match[1];
    return url ?? "";
  });
  return missing ? { error: `That bundle names a picture its list does not carry (${missing}).` } : { value };
}
