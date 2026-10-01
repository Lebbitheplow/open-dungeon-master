// Food and water, under the `supplies` variant rule (off by default: the
// party is assumed fed and watered, as it is assumed to have arrows).
//
// SRD 5.1, Food and Water: a character needs a pound of food a day and can
// go without for 3 + Constitution modifier days (at least 1); at the end of
// each day beyond that it gains a level of exhaustion, and a normal day of
// eating resets the count. With less than half the water it needs, a
// character gains a level of exhaustion at the end of the day. Exhaustion
// from going without cannot be removed until the character eats and drinks
// (the long rest keeps it: src/lib/dm/rest-tools.ts).
//
// The day ends at dawn: each dawn the clock crosses, every living character
// eats a ration from their pack and drinks from what they carry. A waterskin
// is taken as refilled on the way; a character with no waterskin and no
// water goes dry. When the DM says water is scarce (pass_time or travel with
// water "half" or "none", kept on the clock until they say "plenty"), a day
// on half the water is a DC 15 Constitution save against a level of
// exhaustion, and a day with none is a level whatever is carried; a
// character already exhausted takes two levels in either case.

import { getCampaignById } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { characterSave } from "@/lib/dm/between-io";
import { listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { exhaustionPatch } from "@/lib/dm/vitals-logic";
import { abilityMod } from "@/lib/srd";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

export type Hunger = { food: number; water: number };

const RATION = /\b(ration|rations|trail ?rations?|iron rations?|food)\b/i;
const WATERSKIN = /\bwater ?skin\b|\bcanteen\b|\bflask of water\b|\bwater\b/i;

// How many days a character can go without food before each further day
// costs a level of exhaustion.
export function daysWithoutFood(sheet: Pick<CharacterSheet, "abilities">): number {
  return Math.max(1, 3 + abilityMod(sheet.abilities.con));
}

// One day's upkeep for one character: what they ate from the pack, whether
// they drank, and the exhaustion the day costs. Pure.
export function dayOfUpkeep(
  sheet: Pick<CharacterSheet, "abilities" | "equipment"> & { exhaustion?: number | null },
  hunger: Hunger,
  // How much water there is to be found ("half", "none"), when scarce.
  waterRation?: "half" | "none",
): { equipment: EquipmentItem[] | null; hunger: Hunger; exhaustion: number; notes: string[]; halfWater: boolean } {
  const notes: string[] = [];
  let equipment: EquipmentItem[] | null = null;
  let food = hunger.food;
  const ration = sheet.equipment.find((item) => RATION.test(item.name) && item.qty > 0);
  if (ration) {
    equipment = sheet.equipment.flatMap((item) =>
      item !== ration ? [item] : item.qty > 1 ? [{ ...item, qty: item.qty - 1 }] : [],
    );
    food = 0;
    notes.push(`ate a ${ration.name}`);
  } else {
    food += 1;
    notes.push(`went a day without food (${food})`);
  }
  const drank = waterRation !== "none" && sheet.equipment.some((item) => WATERSKIN.test(item.name));
  // Half the water: the day's save is the caller's to roll.
  const halfWater = drank && waterRation === "half";
  const water = drank ? 0 : hunger.water + 1;
  if (!drank) {
    notes.push("went a day without water");
  }
  let exhaustion = 0;
  if (food > daysWithoutFood(sheet)) {
    exhaustion += 1;
  }
  // A day without water is a level, and two for a character already
  // exhausted (SRD 5.1, Water: "the character takes two levels in either
  // case").
  if (!drank) {
    exhaustion += (sheet.exhaustion ?? 0) >= 1 ? 2 : 1;
  }
  return { equipment, hunger: { food, water }, exhaustion, notes, halfWater };
}

// Whether a character is going without, so a long rest does not lift their
// exhaustion.
export function goingWithout(hunger: Hunger | undefined): boolean {
  return Boolean(hunger && (hunger.food > 0 || hunger.water > 0));
}

// Every dawn between two instants, the day's upkeep for the table, when the
// variant is on. Returns the new hunger by character for the clock.
export function upkeepAtDawns(
  campaignId: string,
  dawns: number,
  hunger: Record<string, Hunger>,
): Record<string, Hunger> | null {
  const campaign = getCampaignById(campaignId);
  if (!dawns || !campaign?.gameSettings.variantRules.supplies) {
    return null;
  }
  const next = { ...hunger };
  const waterRation = getClock(campaignId).waterRation;
  for (const stale of listSheets(campaignId)) {
    if (stale.deathSaves?.dead) {
      continue;
    }
    let sheet = stale;
    for (let day = 0; day < Math.min(dawns, 30); day += 1) {
      const upkeep = dayOfUpkeep(sheet, next[sheet.id] ?? { food: 0, water: 0 }, waterRation);
      next[sheet.id] = upkeep.hunger;
      if (upkeep.halfWater) {
        const save = characterSave(campaign, sheet, { ability: "con", dc: 15, detail: `${sheet.name}: CON save on half water`, against: "thirst" });
        if (!save.success) {
          upkeep.exhaustion += (sheet.exhaustion ?? 0) >= 1 ? 2 : 1;
        }
      }
      const patch = {
        ...(upkeep.equipment ? { equipment: upkeep.equipment } : {}),
        ...(upkeep.exhaustion
          ? exhaustionPatch(
              { ...sheet, exhaustion: sheet.exhaustion ?? 0 },
              (sheet.exhaustion ?? 0) + upkeep.exhaustion,
            )
          : {}),
      };
      if (!Object.keys(patch).length) {
        continue;
      }
      const updated = patchSheet(sheet.id, patch);
      if (updated) {
        sheet = updated;
        publishPersisted(campaignId, "sheet_updated", { sheet: updated });
      }
      if (sheet.deathSaves?.dead) {
        break;
      }
    }
  }
  return next;
}
