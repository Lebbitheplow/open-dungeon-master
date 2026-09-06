// Pack art: the thumbnails a world pack carries for itself and for the things
// it names, and the one place the key scheme is written down.
//
// A pack stays one JSON file (docs/worlds.md). Art rides inside it as a map of
// key to data URL, the same shape a workshop bundle uses for its portraits
// (src/lib/workshop/bundle.ts), so the same hosting, install and file-upload
// paths carry it and nothing new has to be fetched from anywhere. The server
// lifts the images out of the manifest at load time (src/lib/worlds/index.ts)
// and serves them from /api/worlds/<id>/art/<key>, so the pack a client
// downloads for its reskin tables is prose again.
//
// Keys are derived, never chosen: `monster-<slug>` for a monster, `race-<id>`
// for a race, and so on, so a renderer, the validator and every consumer agree
// on which picture belongs to which entry without a manifest of their own.
//
// Client-safe on purpose: no fs, no Buffer, no database.

export const PACK_ART_KEY = /^[a-z0-9][a-z0-9-]{0,79}$/;

// A thumbnail, not a poster. 256 KB of WebP is a 700 px landscape at high
// quality; the pack's own byte cap (MAX_MANIFEST_BYTES) bounds the total.
export const MAX_PACK_ART_BYTES = 256 * 1024;
export const MAX_PACK_ART_KEYS = 400;
// A little over MAX_PACK_ART_BYTES * 4/3: base64 overhead plus the header.
export const MAX_PACK_ART_DATA_URL_CHARS = 360_000;

export const PACK_ART_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const PACK_ART_KINDS = [
  "cover",
  "race",
  "class",
  "background",
  "monster",
  "location",
  "faction",
] as const;

export type PackArtKind = (typeof PACK_ART_KINDS)[number];

// Landscape plates are scenes; everything else is a square tile. The sizes
// mirror scripts/generate-placeholders.mjs so a pack's art and the default
// plates are interchangeable in every slot.
export const PACK_ART_ASPECT: Record<PackArtKind, "square" | "landscape"> = {
  cover: "landscape",
  race: "square",
  class: "square",
  background: "square",
  monster: "square",
  location: "landscape",
  faction: "square",
};

// The file-safe stem a name or id becomes. Locations and factions have no id,
// so their key is their name folded this way; the validator refuses a pack
// whose two locations fold to the same key.
export function artSlug(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function packArtKey(kind: PackArtKind, ref = ""): string {
  if (kind === "cover") {
    return "cover";
  }
  const slug = artSlug(ref);
  return slug ? `${kind}-${slug}` : "";
}

// Where a pack's art is served. The version rides along as a cache-buster so
// an Update in the plugin browser is not shown through yesterday's tiles.
export function packArtUrl(packId: string, key: string, version = ""): string {
  const suffix = version ? `?v=${encodeURIComponent(version)}` : "";
  return `/api/worlds/${encodeURIComponent(packId)}/art/${encodeURIComponent(key)}${suffix}`;
}

// The subset of a pack this module needs, so it can be fed a parsed pack, a
// hand-written draft, or the raw JSON a script is about to render for.
export type ArtNamedPack = {
  races: Array<{ id: string }>;
  classes: Array<{ id: string }>;
  backgrounds: Array<{ id: string }>;
  monsters: Array<{ slug: string }>;
  locations: Array<{ name: string }>;
  factions: Array<{ name: string }>;
};

export type PackArtSlot = { key: string; kind: PackArtKind; ref: string };

// Every key a pack could carry given what it names, in the order a renderer
// should produce them: the cover first, then the things a player meets in the
// builder, then the bestiary, then the places. A key a pack carries that is
// not in this list is art for something the pack no longer names.
export function packArtSlots(pack: ArtNamedPack): PackArtSlot[] {
  const slots: PackArtSlot[] = [{ key: "cover", kind: "cover", ref: "" }];
  const push = (kind: PackArtKind, ref: string) => {
    const key = packArtKey(kind, ref);
    if (key) {
      slots.push({ key, kind, ref });
    }
  };
  for (const entry of pack.races) push("race", entry.id);
  for (const entry of pack.classes) push("class", entry.id);
  for (const entry of pack.backgrounds) push("background", entry.id);
  for (const entry of pack.monsters) push("monster", entry.slug);
  for (const entry of pack.locations) push("location", entry.name);
  for (const entry of pack.factions) push("faction", entry.name);
  return slots;
}

// The art a look resolves to, or null when the pack carries none for it. The
// same precedence as characterPlaceholder (src/lib/placeholders.ts): the class
// is what a player recognises their character by, so it wins over the race.
export function packCharacterArtKey(
  artKeys: readonly string[],
  look: { race?: string | null; class?: string | null },
): string | null {
  const byClass = look.class ? packArtKey("class", look.class) : "";
  if (byClass && artKeys.includes(byClass)) {
    return byClass;
  }
  const byRace = look.race ? packArtKey("race", look.race) : "";
  if (byRace && artKeys.includes(byRace)) {
    return byRace;
  }
  return null;
}
