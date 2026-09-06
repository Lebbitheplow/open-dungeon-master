"use client";

import { usePackArt } from "@/lib/worlds/use-pack-art";

// The pictures a world pack carries for its places and factions, as a strip
// under the world's name. Renders nothing at all for a pack with no art, so
// a table on a plain pack sees exactly what it saw before.
export function WorldPackGallery({ packId }: { packId: string }) {
  const art = usePackArt(packId);
  if (!art.pack) {
    return null;
  }
  const places = art.pack.locations
    .map((entry) => ({ name: entry.name, url: art.url("location", entry.name) }))
    .filter((entry): entry is { name: string; url: string } => Boolean(entry.url));
  const factions = art.pack.factions
    .map((entry) => ({ name: entry.name, url: art.url("faction", entry.name) }))
    .filter((entry): entry is { name: string; url: string } => Boolean(entry.url));
  if (!places.length && !factions.length) {
    return null;
  }
  return (
    <div className="space-y-2">
      {places.length ? <Strip label="Places" entries={places} wide /> : null}
      {factions.length ? <Strip label="Factions" entries={factions} /> : null}
    </div>
  );
}

function Strip({
  label,
  entries,
  wide = false,
}: {
  label: string;
  entries: Array<{ name: string; url: string }>;
  wide?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2 text-xs">
      <span className="w-16 pt-1 text-stone-500">{label}</span>
      <ul className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
        {entries.map((entry) => (
          <li key={entry.name} className="shrink-0" title={entry.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.url}
              alt={entry.name}
              loading="lazy"
              className={`${wide ? "h-14 w-24" : "size-14"} rounded-md border border-stone-800 object-cover`}
            />
            <span className="mt-0.5 block w-24 truncate text-[10px] text-stone-500">{entry.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
