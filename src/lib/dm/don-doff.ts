// How long getting into or out of armor takes, for the clock outside a fight
// (in a fight armor cannot change at all: src/app/api/campaigns/[campaignId]/
// sheet/usage/route.ts).
//
// SRD 5.1, Getting Into and Out of Armor: light armor 1 minute to don and 1
// to doff, medium 5 and 1, heavy 10 and 5; a shield an action either way.
// SRD 5.1, Attunement: a creature ends its attunement on purpose "by spending
// another short rest focused on the item", an hour at the least; letting go
// of an attunement still pending (it never took hold) costs nothing.
// Pure: the usage route moves the clock by what this returns.

import { armorOfRow } from "@/lib/srd/armor";
import type { EquipmentItem } from "@/lib/schemas/sheet";

const MINUTES: Record<"light" | "medium" | "heavy", { don: number; doff: number }> = {
  light: { don: 1, doff: 1 },
  medium: { don: 5, doff: 1 },
  heavy: { don: 10, doff: 5 },
};

const SHORT_REST_MINUTES = 60;

// Minutes the armor changes and the ended attunements asked for take, and a
// line for each. Rows the ask does not change, shields and anything that is
// not armor cost nothing here.
export function armorChangeMinutes(
  equipment: EquipmentItem[],
  gear: Record<string, { equipped?: boolean; attuned?: boolean }>,
): { minutes: number; lines: string[] } {
  const anyExplicit = equipment.some((item) => item.equipped);
  let minutes = 0;
  const lines: string[] = [];
  for (const item of equipment) {
    const entry = gear[item.name];
    if (entry?.attuned === false && item.attuned) {
      minutes += SHORT_REST_MINUTES;
      lines.push(`Ending the attunement to ${item.name} takes a short rest spent with it (1 hour).`);
    }
    if (!entry || entry.equipped === undefined) {
      continue;
    }
    const worn = item.equipped ?? !anyExplicit;
    if (entry.equipped === worn) {
      continue;
    }
    const armor = armorOfRow(item)?.armor ?? null;
    if (!armor || armor.category === "shield") {
      continue;
    }
    const table = MINUTES[armor.category as keyof typeof MINUTES];
    if (!table) {
      continue;
    }
    const taken = entry.equipped ? table.don : table.doff;
    minutes += taken;
    lines.push(`${entry.equipped ? "Putting on" : "Taking off"} ${item.name} takes ${taken} minute${taken === 1 ? "" : "s"}.`);
  }
  return { minutes, lines };
}
