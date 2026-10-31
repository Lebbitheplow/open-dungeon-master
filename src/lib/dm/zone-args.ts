// The four arguments every tool that casts a spell with an area takes to say
// where it goes on the board (use_spell_slot, aoe_damage, cast_at_enemy):
// the tool property the model is offered, the zod fields the handler
// parses, and the placement handed to src/lib/dm/zone-cast.ts. One place,
// so the three tools say the same thing.

import { z } from "zod";

const square = (what: string) => ({ type: "integer", minimum: 0, maximum: 200, description: what });

export const ZONE_ARGS: Record<string, unknown> = {
  atX: square(
    "Column of the area's centre square (or a wall's first), for a spell that leaves an area on the map. Omit to centre it on the creatures caught, else the caster; an aura or line starts at the caster.",
  ),
  atY: square("The row that goes with atX."),
  towardX: square("A wall or a line: the column it runs toward from its first square. Omit for a wall across the caster's view."),
  towardY: square("The row that goes with towardX."),
};

// cast_buff's two: a buff lays no wall or line, only Spiritual Weapon's
// or Arcane Sword's square (issue 659). Short, as every word of the
// trimmed tool set is paid on each turn of a 48K table.
export const BUFF_ZONE_ARGS: Record<string, unknown> = {
  atX: square("Spiritual Weapon, Arcane Sword: the weapon's column; omitted, beside the nearest foe."),
  atY: square("The row that goes with atX."),
};

export const zoneArgsSchema = {
  atX: z.coerce.number().int().min(0).max(200).optional(),
  atY: z.coerce.number().int().min(0).max(200).optional(),
  towardX: z.coerce.number().int().min(0).max(200).optional(),
  towardY: z.coerce.number().int().min(0).max(200).optional(),
};

type ZoneArgs = { atX?: number; atY?: number; towardX?: number; towardY?: number };

// The placement the parsed arguments name; nothing when they name none.
export function zonePlacement(args: ZoneArgs): { at?: { x: number; y: number }; toward?: { x: number; y: number } } {
  return {
    ...(args.atX !== undefined && args.atY !== undefined ? { at: { x: args.atX, y: args.atY } } : {}),
    ...(args.towardX !== undefined && args.towardY !== undefined ? { toward: { x: args.towardX, y: args.towardY } } : {}),
  };
}
