"use client";

import { MapForge } from "@/app/workshop/maps/MapForge";
import { forgeGenerate } from "@/app/workshop/maps/forge";
import type { LibraryState, PreparedMap } from "@/app/workshop/maps/types";

// The top of the map drawer: name a map, then roll it, start it blank,
// import a drawing, or keep what is on the table. Since the visual overhaul
// this is the Map Forge (MapForge.tsx) in its library dress; the file stays so
// the DM console's drawer and the workshop gallery mount it as they always
// have, with the heading on in the one and off in the other.

export function MapCreateControls({
  busy,
  board,
  genre,
  showHeading = true,
  onCreate,
  onImport,
}: {
  busy: boolean;
  board: LibraryState["board"];
  // The campaign's setting: the generator reads it, and it picks the skin.
  genre?: string | null;
  showHeading?: boolean;
  // Resolves with the created map so the name field can clear itself only
  // when something was actually made.
  onCreate: (body: Record<string, unknown>) => Promise<{ map?: PreparedMap } | null>;
  onImport: (file: File) => void;
}) {
  return (
    <MapForge
      surface="library"
      genre={genre}
      busy={busy}
      board={board}
      showHeading={showHeading}
      onCreate={onCreate}
      onImport={onImport}
      // The same generator, seed and words the server saves with.
      generate={(roll) => forgeGenerate(roll, genre)}
    />
  );
}
