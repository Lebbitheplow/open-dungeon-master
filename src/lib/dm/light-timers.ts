import { expireBurntLights } from "@/lib/db/battle-maps";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishFx } from "@/lib/dm/fx";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

// Torch and lantern timers (docs/vtt-parity-implementation-plan.md 7.3).
// A carried light is inferred from equipment; a torch burns an hour, a
// candle too, a lantern six on one flask of oil. Everburning things and a
// plain "light" spell entry are the caster's business and do not burn down.
//
// What burns is used up (SRD 5.1, Adventuring Gear): a torch that has
// burned its hour is gone from the pack, a candle too, and a lantern's six
// hours take a flask of oil with them. A lantern with no oil in the pack
// gives no light.

export type CarriedLight = { radius: number; minutes: number };

type Source = { match: RegExp; radius: number; minutes: number; fuel?: RegExp };

// Lamp oil ("Flask of Oil", "Oil (flask)", "Lamp oil"), never a magic oil:
// an Oil of Sharpness or of Etherealness is not burned in a lantern.
const OIL = /\boil\b(?!\s+of\b)/i;

const SOURCES: Source[] = [
  { match: /everburning|sunrod|glowstone/i, radius: 4, minutes: 0 },
  { match: /bullseye lantern/i, radius: 12, minutes: 360, fuel: OIL },
  { match: /lantern/i, radius: 6, minutes: 360, fuel: OIL },
  { match: /torch/i, radius: 4, minutes: 60 },
  { match: /candle/i, radius: 1, minutes: 60 },
];

// The light a pack can give, and what it burns: the source itself, or the
// fuel a lantern needs.
function burningSource(equipment: EquipmentItem[]): { source: Source; burns: EquipmentItem | null } | null {
  for (const source of SOURCES) {
    const lamp = equipment.find((item) => source.match.test(item.name));
    if (!lamp) {
      continue;
    }
    if (!source.fuel) {
      return { source, burns: source.minutes > 0 ? lamp : null };
    }
    const fuel = equipment.find((item) => item !== lamp && source.fuel?.test(item.name));
    if (fuel) {
      return { source, burns: fuel };
    }
  }
  return null;
}

export function carriedLight(sheet: Pick<CharacterSheet, "equipment">): CarriedLight {
  const found = burningSource(sheet.equipment);
  return found ? { radius: found.source.radius, minutes: found.source.minutes } : { radius: 0, minutes: 0 };
}

// A light that burned down takes one of what it burned from the pack.
function burnOne(campaignId: string, sheetId: string) {
  const sheet = getSheetById(sheetId);
  const found = sheet ? burningSource(sheet.equipment) : null;
  if (!sheet || !found?.burns) {
    return;
  }
  const burnt = found.burns;
  const equipment = sheet.equipment.flatMap((item) =>
    item !== burnt ? [item] : item.qty > 1 ? [{ ...item, qty: item.qty - 1 }] : [],
  );
  const updated = patchSheet(sheet.id, { equipment });
  if (updated) {
    publishPersisted(campaignId, "sheet_updated", { sheet: updated });
  }
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
    if (token.kind === "pc") {
      burnOne(campaignId, token.refId);
    }
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
