// The four arguments every tool that casts a spell with an area takes to say
// where it goes on the board (use_spell_slot, aoe_damage, cast_at_enemy):
// the tool property the model is offered, the zod fields the handler
// parses, and the placement handed to src/lib/dm/zone-cast.ts. One place,
// so the three tools say the same thing.

import { z } from "zod";

const square = (what: string) => ({ type: "integer", minimum: 0, maximum: 200, description: what });

export const ZONE_ARGS: Record<string, unknown> = {
  atX: square(
    "For a spell that leaves an area on the battle map (Web, Fog Cloud, Darkness, Silence, Spike Growth, Moonbeam, Cloudkill, a wall): the column of the area's centre square, or of a wall's first square. Omit to centre it on the creatures caught (or the caster's own square); an aura (Spirit Guardians) and a line (Gust of Wind) start at the caster.",
  ),
  atY: square("The row that goes with atX."),
  towardX: square("A wall or a line: the column it runs toward from its first square (a line from the caster). Omit for a wall across the caster's view of the point."),
  towardY: square("The row that goes with towardX."),
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
