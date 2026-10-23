// A creature's type, apart from the stat block reader (statblock.ts) so the
// pages that only draw a type's plate or offer the list (the placeholder
// portraits every page shows, the workshop's pickers) load these lines and
// not the reader of a whole pack row.

// The fourteen SRD creature types. They are also the bestiary thumbnail
// plates in public/assets/placeholders/monster, which is why the list is
// closed: a type with no plate would be a monster with no picture.
export const CREATURE_TYPES = [
  "aberration",
  "beast",
  "celestial",
  "construct",
  "dragon",
  "elemental",
  "fey",
  "fiend",
  "giant",
  "humanoid",
  "monstrosity",
  "ooze",
  "plant",
  "undead",
] as const;

export type CreatureType = (typeof CREATURE_TYPES)[number];

// "Humanoid (goblinoid)" -> "humanoid". Open5e files swarms under their own
// type, which has no plate; a swarm of rats is drawn as the beast it is.
export function normalizeCreatureType(raw: unknown): CreatureType | null {
  const word = String(raw ?? "").trim().toLowerCase().split(/[\s(]/)[0];
  if (word === "swarm") {
    return "beast";
  }
  return (CREATURE_TYPES as readonly string[]).includes(word) ? (word as CreatureType) : null;
}

// The type to draw or print for a stat block: its own when it carries one,
// and monstrosity for a synthesized block or a pre-type snapshot, the plate
// that promises the least about what is under it.
export function creatureTypeOf(stats: { type?: string }): CreatureType {
  return normalizeCreatureType(stats.type) ?? "monstrosity";
}
