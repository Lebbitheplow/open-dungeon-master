import type { BuilderRole } from "./steps/FinishStep";

// What the page that opened the library builder already knows, carried in
// /characters/new's query: "Player character" in the workshop knows it is a
// player character, the Party tool knows that and the level its party is
// built for. The builder asks only for what the door leaves open; plain
// /characters/new knows neither: it starts a player character, offers the
// role toggle on the Finish step, and keeps the level select.
// Pure, for scripts/test-builder-door.mjs.

export type BuilderDoor = {
  // Set: the role toggle is not shown and this is saved.
  role?: BuilderRole;
  // Set: the level select opens on it, with `levelNote` beside it.
  level?: number;
  levelNote?: string;
};

// The doors that name a level, and how the level field says where it came
// from.
const LEVEL_FROM = {
  party: (level: number) => `The party is built for level ${level}.`,
} as const;
export type LevelSource = keyof typeof LEVEL_FROM;

export function readBuilderDoor(query: { get(name: string): string | null }): BuilderDoor {
  const door: BuilderDoor = {};
  const role = query.get("as");
  if (role === "pc" || role === "companion") {
    door.role = role;
  }
  const level = Number(query.get("level"));
  if (Number.isInteger(level) && level >= 1 && level <= 20) {
    door.level = level;
    const from = query.get("from");
    if (from && from in LEVEL_FROM) {
      door.levelNote = LEVEL_FROM[from as LevelSource](level);
    }
  }
  return door;
}

export function newCharacterHref(door: { role?: BuilderRole; level?: number; from?: LevelSource } = {}): string {
  const query = new URLSearchParams();
  if (door.role) query.set("as", door.role);
  if (door.level) query.set("level", String(door.level));
  if (door.level && door.from) query.set("from", door.from);
  const text = query.toString();
  return text ? `/characters/new?${text}` : "/characters/new";
}
