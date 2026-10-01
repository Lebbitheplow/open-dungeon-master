// Life between adventures (SRD 5.1, Between Adventures): what a character's
// lifestyle costs each day, and the downtime activities with their costs,
// progress and results. The tools are set_lifestyle and downtime
// (src/lib/dm/explore-tools.ts); pass_time and a long rest charge the
// lifestyle for each dawn they cross (src/lib/dm/world-tools.ts,
// src/lib/dm/rest-tools.ts).
//
// Lifestyle Expenses: wretched free, squalid 1 sp, poor 2 sp, modest 1 gp,
// comfortable 2 gp, wealthy 4 gp, aristocratic 10 gp a day. A character with
// no lifestyle chosen is on the road, living off their supplies, and pays
// nothing here.
// Downtime Activities: at least 8 hours a day for a day to count.
//   Crafting: nonmagical objects, proficiency with the tools; 5 gp of market
//     value a day per crafter, raw materials worth half the value; a modest
//     lifestyle is free while crafting (comfortable at half cost).
//   Practicing a Profession: a modest lifestyle is free (comfortable with an
//     organization behind them, wealthy for a proficient performer).
//   Recuperating: after three days a DC 15 CON save; on a success, end one
//     effect that prevents regaining hit points, or advantage on saves
//     against one disease or poison for 24 hours.
//   Researching: 1 gp a day on top of the lifestyle; what is learned is the
//     DM's to say.
//   Training: a language or a tool, 250 days at 1 gp a day.

import type { Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { addCopper, formatCopper } from "@/lib/srd/currency";
import type { DowntimeProgress, Lifestyle } from "@/lib/dm/between-state";
import { LIFESTYLES } from "@/lib/dm/between-state";
import {
  characterSave,
  downtimeOf,
  lifestyleOf,
  publishSheetOf,
  writeDowntime,
} from "@/lib/dm/between-io";
import { afflictCondition, dropConditions, liveAfflictions } from "@/lib/dm/afflictions";
import { writeAfflictions } from "@/lib/dm/between-io";
import { listPriceCp } from "@/lib/dm/trade-value";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { grantItemMath } from "@/lib/dm/mutation-math";
import type { CharacterSheet } from "@/lib/schemas/sheet";

export const LIFESTYLE_COST_CP: Record<Lifestyle, number> = {
  wretched: 0,
  squalid: 10,
  poor: 20,
  modest: 100,
  comfortable: 200,
  wealthy: 400,
  aristocratic: 1000,
};

const purseOf = (sheet: Pick<CharacterSheet, "gold" | "copper">) => sheet.gold * 100 + (sheet.copper ?? 0);

function pay(campaignId: string, sheet: CharacterSheet, copper: number) {
  if (copper <= 0) {
    return;
  }
  const paid = addCopper({ gold: sheet.gold, copper: sheet.copper ?? 0 }, -copper).purse;
  patchSheet(sheet.id, { gold: paid.gold, copper: paid.copper });
  publishSheetOf(campaignId, sheet.id);
}

// `days` of this character's lifestyle, less what their work covers each
// day. A purse that cannot keep it up lives the best lifestyle it can pay
// for instead, down to wretched (free). Returns a line for the result, or
// null for a character with no lifestyle chosen.
export function chargeLifestyle(
  campaign: Campaign,
  sheetId: string,
  days: number,
  coveredCp = 0,
): { paidCp: number; lived: Lifestyle; line: string } | null {
  const sheet = getSheetById(sheetId);
  const chosen = sheet ? lifestyleOf(campaign.id, sheet.id) : null;
  if (!sheet || !chosen || days <= 0 || sheet.deathSaves?.dead) {
    return null;
  }
  const daily = (lifestyle: Lifestyle) => Math.max(0, LIFESTYLE_COST_CP[lifestyle] - coveredCp);
  const purse = purseOf(sheet);
  const affordable = [...LIFESTYLES]
    .slice(0, LIFESTYLES.indexOf(chosen) + 1)
    .reverse()
    .find((lifestyle) => daily(lifestyle) * days <= purse) ?? "wretched";
  const paidCp = daily(affordable) * days;
  pay(campaign.id, sheet, paidCp);
  const covered = coveredCp > 0 ? ` (their work covers ${formatCopper(coveredCp)} a day)` : "";
  const line =
    affordable === chosen
      ? `${sheet.name} lives ${chosen} for ${days} day${days === 1 ? "" : "s"}: ${formatCopper(paidCp)}${covered}.`
      : `${sheet.name} cannot keep up a ${chosen} lifestyle and lives ${affordable} for ${days} day${days === 1 ? "" : "s"}: ${formatCopper(paidCp)}${covered}.`;
  return { paidCp, lived: affordable, line };
}

// ---- downtime ----

export type DowntimeActivity = "crafting" | "profession" | "recuperating" | "research" | "training";

export type DowntimeEntry = {
  characterId: string;
  activity: DowntimeActivity;
  item?: string;
  tool?: string;
  helperIds?: string[];
  subject?: string;
  kind?: "language" | "tool";
  topic?: string;
  recover?: "advantage" | "end_effect";
  organization?: boolean;
  perform?: boolean;
};

const proficientWith = (sheet: CharacterSheet, tool: string) => {
  const wanted = tool.trim().toLowerCase();
  return (sheet.proficiencies.tools ?? []).some((entry) => {
    const held = entry.trim().toLowerCase();
    return held === wanted || held.includes(wanted) || wanted.includes(held);
  });
};

// Why this entry cannot be done, checked before any time passes.
export function downtimeProblem(campaign: Campaign, sheet: CharacterSheet, entry: DowntimeEntry): string | null {
  if (sheet.deathSaves?.dead) {
    return `${sheet.name} is dead and spends no downtime.`;
  }
  if (entry.activity === "crafting") {
    if (!entry.item?.trim() || !entry.tool?.trim()) {
      return `Crafting needs the item to make and the tool it is made with (smith's tools, leatherworker's tools...).`;
    }
    if (matchMagicItem(entry.item)) {
      return `${entry.item} is a magic item; downtime crafting makes nonmagical objects only (SRD 5.1, Crafting).`;
    }
    if (!listPriceCp(entry.item)) {
      return `The server has no market value for "${entry.item}"; name an item from the equipment lists so its crafting can be measured.`;
    }
    for (const id of [sheet.id, ...(entry.helperIds ?? [])]) {
      const crafter = id === sheet.id ? sheet : getSheetById(id);
      if (!crafter || crafter.campaignId !== campaign.id) {
        return `Unknown helper ${id}; use characterIds from GAME STATE.`;
      }
      if (!proficientWith(crafter, entry.tool)) {
        return `${crafter.name} is not proficient with ${entry.tool}; only a character proficient with the tools can craft or help craft with them.`;
      }
    }
    const progress = downtimeOf(campaign.id, sheet.id).crafting;
    const starting = !progress || progress.item.toLowerCase() !== entry.item.trim().toLowerCase();
    const materials = Math.floor((listPriceCp(entry.item) ?? 0) / 2);
    if (starting && purseOf(sheet) < materials) {
      return `${sheet.name} needs ${formatCopper(materials)} of raw materials (half the market value) to start crafting ${entry.item}, and has ${formatCopper(purseOf(sheet))}.`;
    }
  }
  if (entry.activity === "training") {
    if (!entry.subject?.trim()) {
      return "Training needs the language or tool to learn (subject) and whether it is a language or a tool (kind).";
    }
    const known = entry.kind === "tool"
      ? (sheet.proficiencies.tools ?? []).some((tool) => tool.toLowerCase() === entry.subject?.trim().toLowerCase())
      : (sheet.proficiencies.languages ?? []).some((language) => language.toLowerCase() === entry.subject?.trim().toLowerCase());
    if (known) {
      return `${sheet.name} already knows ${entry.subject}.`;
    }
  }
  if (entry.activity === "research" && !entry.topic?.trim()) {
    return "Research needs the topic being researched.";
  }
  return null;
}

// What `days` of this activity cover of the lifestyle, in copper a day.
function coverOf(sheet: CharacterSheet, entry: DowntimeEntry): number {
  if (entry.activity === "crafting") {
    return LIFESTYLE_COST_CP.modest;
  }
  if (entry.activity === "profession") {
    if (entry.perform && (sheet.proficiencies.skills ?? []).includes("performance")) {
      return LIFESTYLE_COST_CP.wealthy;
    }
    return entry.organization ? LIFESTYLE_COST_CP.comfortable : LIFESTYLE_COST_CP.modest;
  }
  return 0;
}

// `days` of the activity, after the clock has moved. Returns the lines for
// the result.
export function spendDowntime(campaign: Campaign, turnId: string, entry: DowntimeEntry, days: number): string[] {
  const sheet = getSheetById(entry.characterId);
  if (!sheet) {
    return [];
  }
  const lines: string[] = [];
  const living = chargeLifestyle(campaign, sheet.id, days, coverOf(sheet, entry));
  if (living) {
    lines.push(living.line);
  } else if (entry.activity === "profession") {
    lines.push(`${sheet.name}'s work keeps them for ${days} day${days === 1 ? "" : "s"}.`);
  }
  const progress: DowntimeProgress = { ...downtimeOf(campaign.id, sheet.id) };
  if (entry.activity === "crafting" && entry.item && entry.tool) {
    const item = entry.item.trim();
    const valueCp = listPriceCp(item) ?? 0;
    let crafting = progress.crafting;
    if (!crafting || crafting.item.toLowerCase() !== item.toLowerCase()) {
      if (crafting) {
        lines.push(`${sheet.name} sets aside the unfinished ${crafting.item}; its materials are spent.`);
      }
      const materials = Math.floor(valueCp / 2);
      pay(campaign.id, getSheetById(sheet.id) ?? sheet, materials);
      lines.push(`${sheet.name} buys ${formatCopper(materials)} of raw materials for ${item}.`);
      crafting = { item, valueCp, progressCp: 0, tool: entry.tool.trim() };
    }
    const crafters = 1 + (entry.helperIds ?? []).length;
    const progressCp = Math.min(crafting.valueCp, crafting.progressCp + 500 * crafters * days);
    if (progressCp >= crafting.valueCp) {
      const fresh = getSheetById(sheet.id) ?? sheet;
      patchSheet(fresh.id, { equipment: grantItemMath(fresh.equipment, crafting.item, 1).equipment });
      publishSheetOf(campaign.id, fresh.id);
      delete progress.crafting;
      lines.push(`${sheet.name} finishes crafting ${crafting.item}; it is in their pack.`);
    } else {
      progress.crafting = { ...crafting, progressCp };
      lines.push(`${sheet.name} crafts ${crafting.item}: ${formatCopper(progressCp)} of ${formatCopper(crafting.valueCp)} done (5 gp a day per crafter).`);
    }
  }
  if (entry.activity === "training" && entry.subject) {
    const subject = entry.subject.trim();
    const kind = entry.kind === "tool" ? "tool" : "language";
    const training = progress.training && progress.training.subject.toLowerCase() === subject.toLowerCase() ? progress.training : { subject, kind, days: 0 };
    const affordable = Math.min(days, Math.floor(purseOf(getSheetById(sheet.id) ?? sheet) / 100));
    pay(campaign.id, getSheetById(sheet.id) ?? sheet, affordable * 100);
    const total = Math.min(250, training.days + affordable);
    if (affordable < days) {
      lines.push(`${sheet.name} can pay for only ${affordable} of the ${days} days of training (1 gp a day).`);
    }
    if (total >= 250) {
      const fresh = getSheetById(sheet.id) ?? sheet;
      const proficiencies = kind === "tool"
        ? { ...fresh.proficiencies, tools: [...(fresh.proficiencies.tools ?? []), subject].slice(0, 12) }
        : { ...fresh.proficiencies, languages: [...(fresh.proficiencies.languages ?? []), subject].slice(0, 12) };
      patchSheet(fresh.id, { proficiencies });
      publishSheetOf(campaign.id, fresh.id);
      delete progress.training;
      lines.push(`${sheet.name} completes 250 days of training: they ${kind === "tool" ? "are proficient with" : "speak"} ${subject}.`);
    } else {
      progress.training = { ...training, kind, days: total };
      lines.push(`${sheet.name} trains in ${subject}: ${total} of 250 days.`);
    }
  }
  if (entry.activity === "research" && entry.topic) {
    const affordable = Math.min(days, Math.floor(purseOf(getSheetById(sheet.id) ?? sheet) / 100));
    pay(campaign.id, getSheetById(sheet.id) ?? sheet, affordable * 100);
    const topic = entry.topic.trim();
    const research = progress.research && progress.research.topic.toLowerCase() === topic.toLowerCase() ? progress.research : { topic, days: 0 };
    progress.research = { topic, days: research.days + affordable };
    lines.push(`${sheet.name} researches ${topic}: ${progress.research.days} day${progress.research.days === 1 ? "" : "s"} so far (1 gp a day paid). What they find is yours to say.`);
  }
  if (entry.activity === "recuperating") {
    const total = (progress.recuperating?.days ?? 0) + days;
    const saves = Math.floor(total / 3);
    progress.recuperating = { days: total % 3 };
    if (!progress.recuperating.days) {
      delete progress.recuperating;
    }
    for (let index = 0; index < Math.min(saves, 5); index += 1) {
      const fresh = getSheetById(sheet.id) ?? sheet;
      const save = characterSave(campaign, fresh, { ability: "con", dc: 15, detail: `${fresh.name}: CON save after recuperating` });
      if (!save.success) {
        lines.push(`${sheet.name} recuperates three days but fails the DC 15 CON save (${save.total}).`);
        continue;
      }
      if (entry.recover === "end_effect") {
        const blocking = liveAfflictions(campaign.id, fresh).find((record) => record.kind === "poison" && record.id === "pale_tincture");
        if (blocking) {
          dropConditions(campaign.id, fresh.id, blocking.conditions);
          writeAfflictions(campaign.id, fresh.id, liveAfflictions(campaign.id, getSheetById(fresh.id) ?? fresh).filter((record) => record !== blocking && record.id !== "pale_tincture"));
          lines.push(`${sheet.name} recuperates: the pale tincture that kept their wounds from healing is gone.`);
          continue;
        }
      }
      afflictCondition(campaign, turnId, fresh.id, "recuperated", { minutes: 1440, source: "recuperating" });
      lines.push(`${sheet.name} recuperates: advantage on saving throws against their disease or poison for 24 hours.`);
    }
    if (!saves) {
      lines.push(`${sheet.name} recuperates ${total} of 3 days before the save.`);
    }
  }
  writeDowntime(campaign.id, sheet.id, progress);
  return lines;
}

// One line of lifestyle and downtime for the GAME STATE block, or null.
export function lifestyleLine(campaignId: string, sheetId: string): string | null {
  const lifestyle = lifestyleOf(campaignId, sheetId);
  const progress = downtimeOf(campaignId, sheetId);
  const parts = [
    ...(lifestyle ? [`lifestyle ${lifestyle} (${formatCopper(LIFESTYLE_COST_CP[lifestyle])} a day, paid at each dawn in town)`] : []),
    ...(progress.crafting ? [`crafting ${progress.crafting.item} ${formatCopper(progress.crafting.progressCp)} of ${formatCopper(progress.crafting.valueCp)}`] : []),
    ...(progress.training ? [`training ${progress.training.subject} ${progress.training.days}/250 days`] : []),
    ...(progress.research ? [`researching ${progress.research.topic} (${progress.research.days} days)`] : []),
    ...(progress.recuperating ? [`recuperating ${progress.recuperating.days}/3 days`] : []),
  ];
  return parts.length ? parts.join("; ") : null;
}
