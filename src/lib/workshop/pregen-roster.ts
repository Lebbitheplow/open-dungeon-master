import type { LibraryCharacter } from "@/lib/db/characters";

// A workshop pregen as its roster shows it (the Party panel,
// src/app/workshop/party/PartyPanel.tsx): what the routes under
// /api/workshops/:id/pregens answer with.
export function publicPregen(character: LibraryCharacter) {
  return {
    id: character.id,
    name: character.name,
    role: character.role,
    race: character.race,
    class: character.class,
    subclass: character.subclass,
    background: character.background,
    level: character.level,
    // Ticked: players joining a table made from this workshop may take it
    // (src/lib/db/pregen-offers.ts).
    offered: character.offered,
    // Drafted by the AI DM and not yet edited (src/lib/dm/pregen-draft.ts).
    drafted: character.aiDrafted,
  };
}
