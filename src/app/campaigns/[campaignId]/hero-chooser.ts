// How the hero chooser (HeroChooser.tsx, backlog F5) sorts a player's
// library. Pure, for scripts/test-seat-confirm.mjs.

type Sortable = { role?: "pc" | "companion"; workshopId?: string };

export type ChooserSections<T> = {
  // The player's own heroes, as the library lists them (latest first).
  own: T[];
  // Library heroes filed under a workshop: pregens a DM wrote for an
  // adventure, or ones a bundle import brought (workshop-bundle-parts.ts).
  pregens: T[];
};

export function chooserSections<T extends Sortable>(characters: T[]): ChooserSections<T> {
  // An ally the DM plays is never a player's seat (issue 192).
  const players = characters.filter((character) => character.role !== "companion");
  return {
    own: players.filter((character) => !character.workshopId),
    pregens: players.filter((character) => Boolean(character.workshopId)),
  };
}
