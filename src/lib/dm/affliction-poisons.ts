// The SRD 5.1 poisons (Running the Game, Poisons) on a character, held by
// the engine: the save, the damage, the conditions and how long they last,
// the repeated saves, and Midnight Tears waiting for midnight. The afflict
// tool applies an ingested, inhaled or contact poison (src/lib/dm/
// explore-tools.ts); an injury poison coats a weapon through use_item
// (src/lib/dm/attack-onhit.ts) and this module resolves it on a character
// when a creature's poisoned blow lands.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getSheetById } from "@/lib/db/sheets";
import { breakDown } from "@/lib/dm/calendar";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import type { Affliction } from "@/lib/dm/between-state";
import { afflictionsOf, characterSave, publicDie, tableNote, writeAfflictions } from "@/lib/dm/between-io";
import { afflictCondition, dropConditions, liveAfflictions } from "@/lib/dm/afflictions";
import type { Poison } from "@/lib/srd/afflictions";
import { POISONS } from "@/lib/srd/afflictions";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const MINUTES_PER_DAY = 1440;

function damage(campaign: Campaign, turnId: string, sheetId: string, dice: string, half: boolean, poison: Poison): number {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return 0;
  }
  const rolled = publicDie(campaign, sheet, dice, `${sheet.name}: ${poison.name}`);
  const amount = half ? Math.floor(rolled / 2) : rolled;
  if (amount > 0) {
    applyPcDamage(campaign, turnId, sheet, { amount, type: "poison", reason: poison.name });
  }
  return amount;
}

// The instant of the next midnight after `instant`.
function nextMidnight(campaignId: string, instant: number): number {
  const clock = getClock(campaignId);
  const { hour, minute } = breakDown(clock.calendar, instant);
  return instant + (24 - hour) * 60 - minute;
}

// A workshop poison rides on its record as it stood, so the clock can run
// its daily save after the table's cache has moved on.
const workshopSnapshot = (poison: Poison) => (POISONS.some((row) => row.id === poison.id) ? {} : { poison });

export function applyPoison(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  poison: Poison,
  input: { save?: boolean },
): Record<string, unknown> {
  const clock = getClock(campaign.id);
  if (poison.atMidnight) {
    const at = nextMidnight(campaign.id, clock.instant);
    writeAfflictions(campaign.id, sheet.id, [...liveAfflictions(campaign.id, sheet), { kind: "poison", id: poison.id, conditions: [], nextAt: at, ...workshopSnapshot(poison) }]);
    return { ok: true, poison: poison.name, note: `${poison.name} does nothing yet: at the stroke of midnight (in ${Math.round((at - clock.instant) / 60)} h) the server rolls ${sheet.name}'s DC ${poison.dc} CON save, unless it is neutralized first.` };
  }
  const recuperated = sheet.conditions.some((entry) => entry.toLowerCase() === "recuperated");
  const save = input.save === false
    ? { success: false, total: 0, failBy: 99, autoFailed: true }
    : characterSave(campaign, sheet, { ability: "con", dc: poison.dc, detail: `${sheet.name}: CON save vs ${poison.name}`, against: "poison", advantage: recuperated });
  const lines: string[] = [];
  if (save.success) {
    if (poison.damage && poison.halfOnSave) {
      const dealt = damage(campaign, turnId, sheet.id, poison.damage, true, poison);
      lines.push(`${sheet.name} resists ${poison.name} (CON ${save.total} vs DC ${poison.dc}) and takes ${dealt} poison damage.`);
    } else {
      lines.push(`${sheet.name} resists ${poison.name} (CON ${save.total} vs DC ${poison.dc}).`);
    }
    if (!poison.repeat || poison.repeat.every !== "turn_start") {
      return { ok: true, poison: poison.name, resisted: true, note: lines.join(" ") };
    }
  } else {
    if (poison.damage) {
      const dealt = damage(campaign, turnId, sheet.id, poison.damage, false, poison);
      lines.push(`${sheet.name} fails the save against ${poison.name} and takes ${dealt} poison damage.`);
    } else {
      lines.push(`${sheet.name} fails the save against ${poison.name}.`);
    }
    const minutes = poison.hoursDice ? publicDie(campaign, sheet, poison.hoursDice, `${sheet.name}: hours of ${poison.name}`) * 60 : poison.minutes;
    const conditions = [...(poison.conditions ?? [])];
    if (poison.unconsciousIfFailBy && save.failBy >= poison.unconsciousIfFailBy) {
      conditions.push("unconscious");
    }
    const lingers = poison.repeat?.every === "day";
    const held: string[] = [];
    for (const condition of conditions) {
      const endsOnDamage = poison.wakesOnDamage === true && condition === "unconscious";
      const turnEnds = poison.repeat?.every === "turn_end" && condition === "paralyzed";
      if (afflictCondition(campaign, turnId, sheet.id, condition, {
        ...(minutes && !lingers ? { minutes } : {}),
        ...(turnEnds ? { rounds: 10, saveAbility: "con", saveDc: poison.dc } : {}),
        endsOnDamage,
        source: poison.name,
      })) {
        held.push(condition);
      }
    }
    if (held.length) {
      lines.push(`${held.join(" and ")}${minutes && !lingers ? ` for ${minutes >= 60 ? `${minutes / 60} hours` : `${minutes} minutes`}` : ""}.`);
    }
    if (lingers) {
      writeAfflictions(campaign.id, sheet.id, [
        ...afflictionsOf(campaign.id, sheet.id),
        { kind: "poison", id: poison.id, conditions: held, nextAt: clock.instant + MINUTES_PER_DAY, successes: 0, ...workshopSnapshot(poison) },
      ]);
      lines.push(`Every 24 hours the server rolls the save again (1d6 on a failure) until ${poison.repeat?.successes} successes. Until it ends, the damage this poison deals cannot be healed by any means: do not heal it.`);
    }
  }
  // Burnt Othur Fumes: the save again at the start of each turn, 1d6 on a
  // failure, until three successes. Rolled through here at once.
  if (poison.repeat?.every === "turn_start") {
    let successes = save.success ? 1 : 0;
    let rounds = 0;
    while (successes < poison.repeat.successes && rounds < 30) {
      rounds += 1;
      const fresh = getSheetById(sheet.id);
      if (!fresh || fresh.deathSaves?.dead || fresh.currentHp <= 0) {
        break;
      }
      const again = characterSave(campaign, fresh, { ability: "con", dc: poison.dc, detail: `${fresh.name}: CON save vs ${poison.name}, round ${rounds + 1}`, against: "poison" });
      if (again.success) {
        successes += 1;
      } else if (poison.repeat.damage) {
        damage(campaign, turnId, fresh.id, poison.repeat.damage, false, poison);
      }
    }
    lines.push(`The fumes linger ${rounds} more round${rounds === 1 ? "" : "s"} until ${sheet.name} shakes them off (rolled by the server).`);
  }
  return { ok: true, poison: poison.name, resisted: save.success, note: lines.join(" ") };
}

// Pale Tincture's daily save and Midnight Tears at midnight, as the clock
// moves.
export function poisonClockTick(campaignId: string, to: number) {
  const all = getClock(campaignId).afflictions ?? {};
  const campaign = Object.values(all).some((list) => list.some((entry) => entry.kind === "poison")) ? getCampaignById(campaignId) : null;
  if (!campaign) {
    return;
  }
  for (const [characterId, list] of Object.entries(all)) {
    const next: Affliction[] = [];
    let changed = false;
    for (const entry of list) {
      const poison = entry.kind === "poison" ? (entry.poison ?? POISONS.find((row) => row.id === entry.id)) : null;
      if (!poison || entry.nextAt === undefined || entry.nextAt > to) {
        next.push(entry);
        continue;
      }
      changed = true;
      const sheet = getSheetById(characterId);
      if (!sheet || sheet.deathSaves?.dead) {
        continue;
      }
      if (poison.atMidnight) {
        const save = characterSave(campaign, sheet, { ability: "con", dc: poison.dc, detail: `${sheet.name}: CON save vs ${poison.name} at midnight`, against: "poison" });
        const dealt = damage(campaign, "clock", sheet.id, poison.damage ?? "9d6", save.success, poison);
        tableNote(campaign, `Midnight: ${poison.name} takes ${sheet.name} (${dealt} poison damage).`, "cue-bell");
        continue;
      }
      let current = entry;
      while (current.nextAt !== undefined && current.nextAt <= to) {
        const fresh = getSheetById(characterId);
        if (!fresh || fresh.deathSaves?.dead) {
          break;
        }
        const save = characterSave(campaign, fresh, { ability: "con", dc: poison.dc, detail: `${fresh.name}: daily CON save vs ${poison.name}`, against: "poison" });
        const successes = (current.successes ?? 0) + (save.success ? 1 : 0);
        if (!save.success && poison.repeat?.damage) {
          damage(campaign, "clock", fresh.id, poison.repeat.damage, false, poison);
        }
        current = { ...current, successes, nextAt: current.nextAt + MINUTES_PER_DAY };
        if (successes >= (poison.repeat?.successes ?? 1)) {
          dropConditions(campaignId, fresh.id, current.conditions);
          tableNote(campaign, `${fresh.name} is free of ${poison.name}.`, "cue-heal");
          current = { ...current, nextAt: undefined };
          break;
        }
      }
      if (current.nextAt !== undefined) {
        next.push(current);
      }
    }
    if (changed) {
      writeAfflictions(campaignId, characterId, next);
    }
  }
}
