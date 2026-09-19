// Which picture a workshop wears on the shelf and on the home bench. Every
// workshop used to show the same plate, so a shelf of six was one picture six
// times. The id is hashed into the plates the workshop's own systems already
// use (src/app/workshop/[workshopId]/SystemCards.tsx), so nothing new ships
// and the same workshop always draws the same plate. Pure, so
// scripts/test-workshop-plates.mjs drives it.

const BASE = "/assets/placeholders";

// The nine workshop rooms and the four misc tiles the hub's cards borrow.
export const WORKSHOP_PLATES: readonly string[] = [
  `${BASE}/workshop/workshop.webp`,
  `${BASE}/workshop/maps.webp`,
  `${BASE}/workshop/cast.webp`,
  `${BASE}/workshop/bestiary.webp`,
  `${BASE}/workshop/encounters.webp`,
  `${BASE}/workshop/lore.webp`,
  `${BASE}/workshop/storyboard.webp`,
  `${BASE}/workshop/tables.webp`,
  `${BASE}/workshop/rulesets.webp`,
  `${BASE}/misc/journey.webp`,
  `${BASE}/misc/treasure.webp`,
  `${BASE}/misc/party.webp`,
  `${BASE}/misc/faction.webp`,
];

// FNV-1a over the id: small, stable across servers and apps, and spreads
// uuids that share a prefix.
export function plateIndex(workshopId: string, count: number = WORKSHOP_PLATES.length): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < workshopId.length; index += 1) {
    hash ^= workshopId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return count > 0 ? hash % count : 0;
}

export function workshopPlate(workshopId: string | null | undefined): string {
  const id = String(workshopId ?? "");
  return id ? WORKSHOP_PLATES[plateIndex(id)] : WORKSHOP_PLATES[0];
}
