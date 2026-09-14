import { expireBurntLights } from "@/lib/db/battle-maps";
import { publishFx } from "@/lib/dm/fx";
import { publishEphemeral } from "@/lib/events";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Torch and lantern timers (docs/vtt-parity-implementation-plan.md 7.3).
// A carried light is inferred from equipment; a torch burns an hour, a
// candle too, a lantern six on one flask of oil. Everburning things and a
// plain "light" spell entry are the caster's business and do not burn down.

export type CarriedLight = { radius: number; minutes: number };

const SOURCES: Array<{ match: RegExp; radius: number; minutes: number }> = [
  { match: /everburning|sunrod|glowstone/i, radius: 4, minutes: 0 },
  { match: /bullseye lantern/i, radius: 12, minutes: 360 },
  { match: /lantern/i, radius: 6, minutes: 360 },
  { match: /torch/i, radius: 4, minutes: 60 },
  { match: /candle/i, radius: 1, minutes: 60 },
];

export function carriedLight(sheet: Pick<CharacterSheet, "equipment">): CarriedLight {
  for (const source of SOURCES) {
    if (sheet.equipment.some((item) => source.match.test(item.name))) {
      return { radius: source.radius, minutes: source.minutes };
    }
  }
  return { radius: 0, minutes: 0 };
}

// The token fields for a light lit now, at `instant` on the clock.
export function lightPlacement(light: CarriedLight, instant: number): { lightRadius: number; burnsUntil: number; lightMinutes: number } {
  return {
    lightRadius: light.radius,
    burnsUntil: light.radius > 0 && light.minutes > 0 ? instant + light.minutes : 0,
    lightMinutes: light.radius > 0 && light.minutes > 0 ? light.minutes : 0,
  };
}

// What the bar shows: minutes left and the whole, or null for a light that
// does not burn down.
export function lightRemaining(token: { burnsUntil: number; lightMinutes: number; lightRadius: number }, instant: number): { remaining: number; total: number } | null {
  if (token.lightRadius <= 0 || token.burnsUntil <= 0 || token.lightMinutes <= 0) {
    return null;
  }
  return { remaining: Math.max(0, token.burnsUntil - instant), total: token.lightMinutes };
}

// Put out every light that has burnt down by `instant`; the board redraws
// and the FX layer gutters each one out.
export function gutterBurntLights(campaignId: string, instant: number): number {
  const guttered = expireBurntLights(campaignId, instant);
  if (!guttered.length) {
    return 0;
  }
  for (const token of guttered) {
    publishFx(campaignId, {
      id: `gutter-${token.id}-${instant}`,
      kind: "gutter",
      to: { x: token.x, y: token.y },
      toTokenId: token.id,
      label: `${token.name}'s light gutters out`,
      numbers: "all",
      at: Date.now(),
    });
  }
  publishEphemeral(campaignId, "battle_map_updated", {});
  return guttered.length;
}
