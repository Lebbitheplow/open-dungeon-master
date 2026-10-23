import type { HomebrewKind } from "@/lib/schemas/homebrew";

// Where a saved Homebrew entry is offered, in the words the editor shows
// under it (workshop import audit F06). Saving used to leave the editor open
// with nothing said, and a subclass that "did not appear" was waiting for
// its class's subclass level, or was a player's own at someone else's table.
// The rule is src/lib/content/scope.ts: the author's own shelf in their
// library, and at a table the shelves of whoever runs it.

const WHERE: Partial<Record<HomebrewKind, string>> = {
  class: "in the character builder's class list",
  race: "as a species in the character builder",
  background: "as a background in the character builder",
  feat: "wherever a character takes a feat",
  spell: "in the spell lists of the classes it names",
  item: "in starting gear, shops and inventories",
  hazard: "to the traps, hazards and afflictions a DM sets at the table",
};

export function homebrewAvailability(kind: HomebrewKind, parent?: { name: string; subclassLevel: number | null }): string {
  const where =
    kind === "archetype"
      ? parent
        ? `under ${parent.name} in the character builder${parent.subclassLevel ? ` from level ${parent.subclassLevel}, the level that class picks a subclass, and at that level-up` : ""}`
        : "under its class in the character builder"
      : (WHERE[kind] ?? "where the books' own are");
  return `Offered ${where}: for your own characters, and at every table you run as its owner, DM or assistant DM. At someone else's table it is offered once that table's owner or DM keeps a copy, from a Workshop bundle with your Homebrew in it.`;
}
