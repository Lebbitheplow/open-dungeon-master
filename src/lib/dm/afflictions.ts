// Diseases and madness from the SRD 5.1 Running the Game chapter, held by the
// engine: the afflict tool lays them on (src/lib/dm/explore-tools.ts), the
// clock brings a disease's symptoms and ends a long madness
// (src/lib/db/clock.ts), a long rest rolls the disease's save
// (src/lib/dm/rest-tools.ts), and damage brings cackle fever's laughter and
// a madness's confusion (src/lib/dm/pc-damage.ts). Poisons are
// src/lib/dm/affliction-poisons.ts.
//
// The state is on the clock (src/lib/dm/between-state.ts), the effects are
// conditions on the sheet with rows in src/lib/srd/affliction-conditions.ts.
// A record whose conditions are all gone from the sheet was cured by other
// means (lesser restoration, clear_condition) and is dropped when next read.

import { getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getClock } from "@/lib/db/clock";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { removeConditions } from "@/lib/dm/condition-logic";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { exhaustionPatch } from "@/lib/dm/vitals-logic";
import {
  DISEASES,
  INDEFINITE_MADNESS,
  INDEFINITE_MADNESS_CONDITION,
  LONG_TERM_MADNESS,
  SHORT_TERM_MADNESS,
  madnessConditions,
  madnessEntry,
  type Disease,
  type DiseaseId,
  type DiseaseSpec,
  type MadnessKind,
} from "@/lib/srd/afflictions";
import type { Affliction } from "@/lib/dm/between-state";
import {
  afflictionsOf,
  characterSave,
  publicDie,
  publishSheetOf,
  tableNote,
  writeAfflictions,
} from "@/lib/dm/between-io";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

const MINUTES_PER_DAY = 1440;
const lower = (text: string) => text.trim().toLowerCase();
const holds = (sheet: Pick<CharacterSheet, "conditions">, name: string) =>
  sheet.conditions.some((entry) => lower(entry) === lower(name));

// ---- conditions ----

// A condition laid on through the condition engine (immunities, a broken
// concentration), with the affliction as its source.
export function afflictCondition(
  campaign: Campaign,
  turnId: string,
  sheetId: string,
  condition: string,
  options: { minutes?: number; rounds?: number; saveAbility?: "con" | "wis"; saveDc?: number; endsOnDamage?: boolean; source: string },
): boolean {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return false;
  }
  const applied = handleSetCondition(
    campaign,
    turnId,
    sheet,
    {
      condition,
      ...(options.minutes ? { minutes: Math.min(1440, Math.max(1, Math.round(options.minutes))) } : {}),
      ...(options.rounds ? { rounds: options.rounds } : {}),
      ...(options.saveAbility && options.saveDc ? { saveAbility: options.saveAbility, saveDc: options.saveDc } : {}),
    },
    options.source,
    { spellEffect: { source: options.source.slice(0, 80), ...(options.endsOnDamage ? { endsOnDamage: true } : {}) } },
  );
  return !("error" in applied);
}

export function dropConditions(campaignId: string, sheetId: string, names: string[]) {
  const sheet = getSheetById(sheetId);
  if (!sheet || !names.length) {
    return;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, names);
  patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  publishSheetOf(campaignId, sheet.id);
}

function addExhaustion(campaignId: string, sheetId: string, levels: number) {
  const sheet = getSheetById(sheetId);
  if (!sheet || !levels) {
    return;
  }
  patchSheet(sheet.id, exhaustionPatch(sheet, (sheet.exhaustion ?? 0) + levels));
  publishSheetOf(campaignId, sheet.id);
}

// ---- reading the records ----

// A character's afflictions, with any whose conditions are all gone (cured
// some other way) dropped. A disease still incubating, a scheduled poison
// and an indefinite flaw have nothing to lose and are kept.
export function liveAfflictions(campaignId: string, sheet: Pick<CharacterSheet, "id" | "conditions">): Affliction[] {
  const list = afflictionsOf(campaignId, sheet.id);
  const kept = list.filter((entry) =>
    !entry.conditions.length ? entry.onsetAt !== undefined || entry.nextAt !== undefined : entry.conditions.some((name) => holds(sheet, name)),
  );
  if (kept.length !== list.length) {
    writeAfflictions(campaignId, sheet.id, kept);
  }
  return kept;
}

export function diseaseOf(campaignId: string, sheet: Pick<CharacterSheet, "id" | "conditions">, id: DiseaseId): Affliction | null {
  return liveAfflictions(campaignId, sheet).find((entry) => entry.kind === "disease" && entry.id === id && entry.onsetAt === undefined) ?? null;
}

// ---- diseases ----

function sightRotCondition(penalty: number) {
  return `sight rot (-${Math.min(5, Math.max(1, penalty))})`;
}

// Symptoms show: the condition goes on and, for cackle fever and sewer
// plague, a level of exhaustion.
function manifest(campaign: Campaign, turnId: string, sheetId: string, record: Affliction): Affliction {
  if (record.disease) {
    return manifestWorkshop(campaign, turnId, sheetId, record, record.disease);
  }
  const disease = DISEASES[record.id as DiseaseId];
  if (!disease) {
    return record;
  }
  const condition = disease.id === "sight_rot" ? sightRotCondition(1) : disease.condition;
  afflictCondition(campaign, turnId, sheetId, condition, { source: disease.name });
  if (disease.id !== "sight_rot") {
    addExhaustion(campaign.id, sheetId, 1);
  }
  const sheet = getSheetById(sheetId);
  tableNote(campaign, `${sheet?.name ?? "A character"} shows the symptoms of ${disease.name}.`, "cue-bell");
  const { onsetAt: _onset, ...rest } = record;
  void _onset;
  return {
    ...rest,
    conditions: [condition],
    ...(disease.id === "cackle_fever" ? { dc: 13, fails: 0 } : {}),
    ...(disease.id === "sight_rot" ? { penalty: 1, doses: 0 } : {}),
  };
}

// A workshop disease's symptoms: its condition and any standard ones, and
// its levels of exhaustion.
function manifestWorkshop(campaign: Campaign, turnId: string, sheetId: string, record: Affliction, held: { name: string; spec: DiseaseSpec }): Affliction {
  const conditions = [held.spec.condition, ...(held.spec.conditions ?? [])];
  const kept = conditions.filter((condition) => afflictCondition(campaign, turnId, sheetId, condition, { source: held.name }));
  if (held.spec.exhaustion > 0) {
    addExhaustion(campaign.id, sheetId, held.spec.exhaustion);
  }
  const sheet = getSheetById(sheetId);
  tableNote(campaign, `${sheet?.name ?? "A character"} shows the symptoms of ${held.name}.`, "cue-bell");
  const { onsetAt: _onset, ...rest } = record;
  void _onset;
  return { ...rest, conditions: kept.length ? kept : [held.spec.condition], successes: 0 };
}

// A disease from the table's workshop (src/lib/srd/table-hazards.ts): the
// save against catching it, its incubation and its symptoms, run by the
// pattern its spec gives; a copy of one of the SRD's three runs as that one.
export function infectWorkshopDisease(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  own: { id: string; name: string; disease: DiseaseSpec },
  input: { save?: boolean; dc?: number; symptomsNow?: boolean },
): Record<string, unknown> {
  const spec = own.disease;
  if (spec.runsAs && DISEASES[spec.runsAs]) {
    return infectDisease(campaign, turnId, sheet, DISEASES[spec.runsAs], input);
  }
  const list = liveAfflictions(campaign.id, sheet);
  if (list.some((entry) => entry.kind === "disease" && entry.id === own.id)) {
    return { ok: true, note: `${sheet.name} already has ${own.name}.` };
  }
  if (input.save !== false) {
    const dc = input.dc ?? spec.infect.dc;
    const save = characterSave(campaign, sheet, { ability: spec.infect.ability, dc, detail: `${sheet.name}: ${spec.infect.ability.toUpperCase()} save vs ${own.name}`, against: "disease", advantage: holds(sheet, "recuperated") });
    if (save.success) {
      return { ok: true, resisted: true, note: `${sheet.name} resists ${own.name} (${spec.infect.ability.toUpperCase()} save ${save.total} vs DC ${dc}).` };
    }
  }
  const clock = getClock(campaign.id);
  const amount = /^\d+$/.test(spec.onset.dice) ? Number(spec.onset.dice) : publicDie(campaign, sheet, spec.onset.dice, `${own.name}: ${spec.onset.unit} until symptoms`);
  const minutes = amount * (spec.onset.unit === "days" ? MINUTES_PER_DAY : 60);
  let record: Affliction = { kind: "disease", id: own.id, conditions: [], onsetAt: clock.instant + minutes, disease: { name: own.name, spec } };
  if (input.symptomsNow || minutes <= 0) {
    record = manifestWorkshop(campaign, turnId, sheet.id, record, record.disease!);
  }
  writeAfflictions(campaign.id, sheet.id, [...list, record]);
  return {
    ok: true,
    infected: own.name,
    ...(record.onsetAt === undefined ? { symptoms: "now" } : { symptomsIn: `${amount} ${spec.onset.unit}` }),
    effect: spec.summary,
    note: record.onsetAt === undefined
      ? `${sheet.name} has ${own.name}; the server holds its effects.`
      : `${sheet.name} is infected with ${own.name}; symptoms show in ${amount} ${spec.onset.unit}, when the clock gets there.`,
  };
}

// A workshop disease's save after a long rest: a success sheds a level of
// exhaustion (cured below one) or counts toward its cure, a failure adds a
// level or does nothing, as its spec says.
function workshopDiseaseAfterRest(campaign: Campaign, sheet: CharacterSheet, entry: Affliction, held: { name: string; spec: DiseaseSpec }, lines: string[]): Affliction | null {
  const rest = held.spec.rest;
  if (!rest) {
    return entry;
  }
  const save = characterSave(campaign, sheet, { ability: rest.ability, dc: rest.dc, detail: `${sheet.name}: ${rest.ability.toUpperCase()} save vs ${held.name} after a long rest`, against: "disease", advantage: holds(sheet, "recuperated") });
  if (save.success) {
    if (rest.onSuccess === "improve") {
      const level = (sheet.exhaustion ?? 0) - 1;
      patchSheet(sheet.id, exhaustionPatch(sheet, level));
      publishSheetOf(campaign.id, sheet.id);
      if (level < 1) {
        dropConditions(campaign.id, sheet.id, entry.conditions);
        lines.push(`${sheet.name} recovers from ${held.name}.`);
        return null;
      }
      lines.push(`${sheet.name} holds ${held.name} back: one level of exhaustion less.`);
      return entry;
    }
    const successes = (entry.successes ?? 0) + 1;
    if (successes >= rest.successes) {
      dropConditions(campaign.id, sheet.id, entry.conditions);
      lines.push(`${sheet.name} recovers from ${held.name}.`);
      return null;
    }
    lines.push(`${sheet.name} fights off ${held.name} (${successes} of ${rest.successes} successes).`);
    return { ...entry, successes };
  }
  if (rest.onFail === "worsen") {
    addExhaustion(campaign.id, sheet.id, 1);
    lines.push(`${sheet.name} worsens with ${held.name}: a level of exhaustion.`);
  } else {
    lines.push(`${sheet.name} fails the save against ${held.name}.`);
  }
  return entry;
}

export function infectDisease(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  disease: Disease,
  input: { save?: boolean; dc?: number; symptomsNow?: boolean },
): Record<string, unknown> {
  const list = liveAfflictions(campaign.id, sheet);
  if (list.some((entry) => entry.kind === "disease" && entry.id === disease.id)) {
    return { ok: true, note: `${sheet.name} already has ${disease.name}.` };
  }
  if (input.save !== false) {
    const dc = input.dc ?? disease.infectDc;
    const save = characterSave(campaign, sheet, { ability: "con", dc, detail: `${sheet.name}: CON save vs ${disease.name}`, against: "disease", advantage: holds(sheet, "recuperated") });
    if (save.success) {
      return { ok: true, resisted: true, note: `${sheet.name} resists ${disease.name} (CON save ${save.total} vs DC ${dc}).` };
    }
  }
  const clock = getClock(campaign.id);
  const amount = disease.onset.dice === "1" ? 1 : publicDie(campaign, sheet, disease.onset.dice, `${disease.name}: ${disease.onset.unit} until symptoms`);
  const minutes = amount * (disease.onset.unit === "days" ? MINUTES_PER_DAY : 60);
  let record: Affliction = { kind: "disease", id: disease.id, conditions: [], onsetAt: clock.instant + minutes };
  if (input.symptomsNow) {
    record = manifest(campaign, turnId, sheet.id, record);
  }
  writeAfflictions(campaign.id, sheet.id, [...list, record]);
  return {
    ok: true,
    infected: disease.name,
    ...(input.symptomsNow ? { symptoms: "now" } : { symptomsIn: `${amount} ${disease.onset.unit}` }),
    effect: disease.summary,
    note: input.symptomsNow
      ? `${sheet.name} has ${disease.name}; the server holds its effects.`
      : `${sheet.name} is infected with ${disease.name}; symptoms show in ${amount} ${disease.onset.unit}, when the clock gets there.`,
  };
}

// ---- madness ----

export function inflictMadness(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  kind: MadnessKind,
  input: { saveDc?: number; saveAbility?: "wis" | "cha" },
): Record<string, unknown> {
  if (input.saveDc) {
    const ability = input.saveAbility ?? "wis";
    const save = characterSave(campaign, sheet, { ability, dc: input.saveDc, detail: `${sheet.name}: ${ability.toUpperCase()} save against madness`, against: "madness" });
    if (save.success) {
      return { ok: true, resisted: true, note: `${sheet.name} keeps their mind (${ability.toUpperCase()} save ${save.total} vs DC ${input.saveDc}).` };
    }
  }
  const roll = publicDie(campaign, sheet, "1d100", `${sheet.name}: ${kind}-term madness`);
  const list = liveAfflictions(campaign.id, sheet);
  const clock = getClock(campaign.id);
  if (kind === "indefinite") {
    const flaw = madnessEntry(INDEFINITE_MADNESS, roll).text;
    afflictCondition(campaign, turnId, sheet.id, INDEFINITE_MADNESS_CONDITION, { source: "madness" });
    writeAfflictions(campaign.id, sheet.id, [...list, { kind: "madness", id: "indefinite", conditions: [INDEFINITE_MADNESS_CONDITION], flaw }]);
    return { ok: true, madness: "indefinite", roll, flaw, note: `${sheet.name} gains the flaw ${flaw}, until greater restoration or stronger magic. Play it.` };
  }
  const effect = madnessEntry(kind === "short" ? SHORT_TERM_MADNESS : LONG_TERM_MADNESS, roll);
  let conditions = effect.conditions;
  if (!conditions.length) {
    // Long-term 56 to 65: blinded (25%) or deafened (75%).
    conditions = [publicDie(campaign, sheet, "1d4", `${sheet.name}: blinded on a 1, deafened otherwise`) === 1 ? "blinded" : "deafened"];
  }
  const duration = kind === "short"
    ? publicDie(campaign, sheet, "1d10", `${sheet.name}: minutes of short-term madness`)
    : publicDie(campaign, sheet, "1d10", `${sheet.name}: tens of hours of long-term madness`) * 10 * 60;
  const held: string[] = [];
  for (const condition of conditions) {
    // A short madness counts down on the condition itself; a long one (up to
    // a hundred hours) ends on the clock.
    if (afflictCondition(campaign, turnId, sheet.id, condition, { ...(kind === "short" ? { minutes: duration } : {}), endsOnDamage: effect.endsOnDamage, source: `${kind}-term madness` })) {
      held.push(condition);
    }
  }
  writeAfflictions(campaign.id, sheet.id, [
    ...list,
    { kind: "madness", id: kind, conditions: held, endsAt: clock.instant + duration },
  ]);
  return {
    ok: true,
    madness: kind,
    roll,
    effect: `${sheet.name} ${effect.text}`,
    conditions: held,
    lasts: kind === "short" ? `${duration} minutes` : `${duration / 60} hours`,
    note: `The server holds the conditions and ends them when the time is up; lesser restoration ends it sooner.`,
  };
}

// ---- the clock ----

// Symptoms that show and madness that ends as the clock moves; poisons on
// the clock tick in affliction-poisons.ts.
export function afflictionClockTick(campaignId: string, to: number) {
  const clock = getClock(campaignId);
  const all = clock.afflictions ?? {};
  if (!Object.keys(all).length) {
    return;
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return;
  }
  for (const [characterId, list] of Object.entries(all)) {
    const sheet = getSheetById(characterId);
    if (!sheet || sheet.deathSaves?.dead) {
      continue;
    }
    const next: Affliction[] = [];
    let changed = false;
    for (const entry of list) {
      if (entry.kind === "disease" && entry.onsetAt !== undefined && entry.onsetAt <= to) {
        next.push(manifest(campaign, "clock", sheet.id, entry));
        changed = true;
      } else if (entry.kind === "madness" && entry.id === "long" && entry.endsAt !== undefined && entry.endsAt <= to) {
        dropConditions(campaignId, sheet.id, entry.conditions);
        tableNote(campaign, `${sheet.name}'s long-term madness passes.`, "cue-heal");
        changed = true;
      } else {
        next.push(entry);
      }
    }
    if (changed) {
      writeAfflictions(campaignId, sheet.id, next);
    }
  }
}

// ---- a long rest ----

// What a disease does to the long rest itself, before it is written: sewer
// plague restores no hit points, and cackle fever's level of exhaustion
// stays.
export function afflictedRestPatch(sheet: CharacterSheet, patch: FullPatchSheetInput): FullPatchSheetInput {
  const next = { ...patch };
  if (holds(sheet, "sewer plague")) {
    delete next.currentHp;
  }
  if (holds(sheet, "cackle fever") && (next.exhaustion ?? sheet.exhaustion ?? 0) < 1) {
    next.exhaustion = 1;
  }
  return next;
}

// The saves each disease asks at the end of a long rest, for everyone who
// rested. Returns a line per character touched.
export function afflictionsAfterLongRest(campaign: Campaign, turnId: string, restedIds: string[]): string[] {
  const lines: string[] = [];
  for (const id of restedIds) {
    let sheet = getSheetById(id);
    if (!sheet) {
      continue;
    }
    const list = liveAfflictions(campaign.id, sheet);
    const next: Affliction[] = [];
    for (const entry of list) {
      sheet = getSheetById(id) ?? sheet;
      if (entry.kind !== "disease" || entry.onsetAt !== undefined) {
        next.push(entry);
        continue;
      }
      const recuperated = holds(sheet, "recuperated");
      if (entry.disease) {
        const kept = workshopDiseaseAfterRest(campaign, sheet, entry, entry.disease, lines);
        if (kept) {
          next.push(kept);
        }
        continue;
      }
      if (entry.id === "cackle_fever") {
        const dc = entry.dc ?? 13;
        const save = characterSave(campaign, sheet, { ability: "con", dc, detail: `${sheet.name}: CON save vs cackle fever after a long rest`, against: "disease", advantage: recuperated });
        if (save.success) {
          const drop = publicDie(campaign, sheet, "1d6", `${sheet.name}: cackle fever's DC drops`);
          if (dc - drop <= 0) {
            dropConditions(campaign.id, sheet.id, entry.conditions);
            lines.push(`${sheet.name} recovers from cackle fever.`);
            continue;
          }
          next.push({ ...entry, dc: dc - drop });
          lines.push(`${sheet.name} fights off cackle fever: its DC drops to ${dc - drop}.`);
        } else {
          const fails = (entry.fails ?? 0) + 1;
          next.push({ ...entry, fails });
          lines.push(`${sheet.name} fails the save against cackle fever (${fails} of 3).`);
          if (fails === 3) {
            const madness = inflictMadness(campaign, turnId, sheet, "indefinite", {});
            lines.push(`Three failures: ${String(madness.note ?? "indefinite madness")}`);
          }
        }
        continue;
      }
      if (entry.id === "sewer_plague") {
        const save = characterSave(campaign, sheet, { ability: "con", dc: 11, detail: `${sheet.name}: CON save vs sewer plague after a long rest`, against: "disease", advantage: recuperated });
        const level = sheet.exhaustion ?? 0;
        if (save.success) {
          patchSheet(sheet.id, exhaustionPatch(sheet, level - 1));
          publishSheetOf(campaign.id, sheet.id);
          if (level - 1 < 1) {
            dropConditions(campaign.id, sheet.id, entry.conditions);
            lines.push(`${sheet.name} recovers from sewer plague.`);
            continue;
          }
          lines.push(`${sheet.name} holds sewer plague back: one level of exhaustion less.`);
        } else {
          addExhaustion(campaign.id, sheet.id, 1);
          lines.push(`${sheet.name} worsens with sewer plague: a level of exhaustion.`);
        }
        next.push(entry);
        continue;
      }
      if (entry.id === "sight_rot") {
        const dosed = holds(sheet, "eyebright ointment");
        if (dosed) {
          dropConditions(campaign.id, sheet.id, ["eyebright ointment"]);
          const doses = (entry.doses ?? 0) + 1;
          if (doses >= 3) {
            dropConditions(campaign.id, sheet.id, [...entry.conditions, "blinded"]);
            lines.push(`${sheet.name}'s third dose of Eyebright cures sight rot.`);
            continue;
          }
          next.push({ ...entry, doses });
          lines.push(`Eyebright keeps ${sheet.name}'s sight rot from worsening (${doses} of 3 doses).`);
          continue;
        }
        const penalty = Math.min(5, (entry.penalty ?? 1) + 1);
        const condition = sightRotCondition(penalty);
        dropConditions(campaign.id, sheet.id, entry.conditions);
        afflictCondition(campaign, turnId, sheet.id, condition, { source: "Sight Rot" });
        if (penalty >= 5) {
          afflictCondition(campaign, turnId, sheet.id, "blinded", { source: "Sight Rot" });
        }
        next.push({ ...entry, penalty, conditions: [condition] });
        lines.push(`${sheet.name}'s sight rot worsens to -${penalty}${penalty >= 5 ? ": they are blind" : ""}.`);
        continue;
      }
      next.push(entry);
    }
    writeAfflictions(campaign.id, id, next);
  }
  return lines;
}

// Sewer plague: hit dice heal half (SRD 5.1).
export function hitDiceHealingFactor(sheet: Pick<CharacterSheet, "conditions">): number {
  return holds(sheet, "sewer plague") ? 0.5 : 1;
}

// ---- stress and damage ----

let inLaughter = false;

// Great stress (entering combat, taking damage, fear) for a character with
// cackle fever: a save or 1d10 psychic and a minute of mad laughter
// (incapacitated, a save at the end of each turn ends it). Damage also
// brings long-term madness's confusion. Returns a line for each that fired.
export function afflictionStress(campaign: Campaign, turnId: string, sheetId: string, cause: "damage" | "combat" | "fear"): string[] {
  if (inLaughter) {
    return [];
  }
  let sheet = getSheetById(sheetId);
  if (!sheet || sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return [];
  }
  const lines: string[] = [];
  // A condition that ends when the creature takes damage ends now: a
  // madness's paralysis, a poison's sleep, a Sleep spell's slumber.
  if (cause === "damage") {
    const meta = sheet.conditionMeta as Record<string, { endsOnDamage?: boolean } | undefined>;
    const waking = sheet.conditions.filter((name) => meta[name]?.endsOnDamage);
    if (waking.length) {
      dropConditions(campaign.id, sheet.id, waking);
      lines.push(`${sheet.name} is jolted out of it by the blow: no longer ${waking.join(" or ")}.`);
      sheet = getSheetById(sheetId) ?? sheet;
    }
  }
  const fever = diseaseOf(campaign.id, sheet, "cackle_fever");
  if (fever && !holds(sheet, "incapacitated")) {
    const dc = fever.dc ?? 13;
    const save = characterSave(campaign, sheet, { ability: "con", dc, detail: `${sheet.name}: CON save vs cackle fever's laughter`, against: "disease" });
    if (!save.success) {
      inLaughter = true;
      try {
        const psychic = publicDie(campaign, sheet, "1d10", `${sheet.name}: cackle fever's mad laughter`);
        applyPcDamage(campaign, turnId, getSheetById(sheet.id) ?? sheet, { amount: psychic, type: "psychic", reason: "cackle fever's mad laughter" });
        afflictCondition(campaign, turnId, sheet.id, "incapacitated", { rounds: 10, saveAbility: "con", saveDc: dc, source: "cackle fever" });
        lines.push(`${sheet.name} is seized by mad laughter (cackle fever, ${cause}): ${psychic} psychic damage and incapacitated for a minute, a CON save at the end of each turn ends it.`);
      } finally {
        inLaughter = false;
      }
    }
  }
  if (cause === "damage" && holds(sheet, "madness: confusion on damage")) {
    const save = characterSave(campaign, getSheetById(sheet.id) ?? sheet, { ability: "wis", dc: 15, detail: `${sheet.name}: WIS save against madness's confusion`, against: "madness" });
    if (!save.success && afflictCondition(campaign, turnId, sheet.id, "confused", { rounds: 10, source: "long-term madness" })) {
      lines.push(`${sheet.name}'s madness takes hold: confused for 1 minute.`);
    }
  }
  if (lines.length) {
    tableNote(campaign, lines.join(" "), "cue-bell");
  }
  return lines;
}

// Everyone in the fight that just began, for cackle fever's stress.
export function afflictionsAtCombatStart(campaign: Campaign, turnId: string): string[] {
  const afflicted = Object.keys(getClock(campaign.id).afflictions ?? {});
  if (!afflicted.length) {
    return [];
  }
  return listSheets(campaign.id)
    .filter((sheet) => afflicted.includes(sheet.id))
    .flatMap((sheet) => afflictionStress(campaign, turnId, sheet.id, "combat"));
}

// ---- cures and the narrator ----

// The conditions a cure's word reaches on this sheet: "disease" every
// disease, "madness" all a short- or long-term madness holds (its paralysis
// or blindness among them), "indefinite madness" the flaw
// (src/lib/dm/cure-spell.ts). Read from the records, so an SRD condition
// that came some other way is not taken for madness.
export function afflictionConditionsFor(
  campaignId: string,
  sheet: Pick<CharacterSheet, "id" | "conditions">,
  word: string,
): string[] {
  const records = liveAfflictions(campaignId, sheet);
  const names =
    word === "disease"
      ? records.filter((entry) => entry.kind === "disease").flatMap((entry) => entry.conditions)
      : word === "madness"
        ? records.filter((entry) => entry.kind === "madness" && entry.id !== "indefinite").flatMap((entry) => entry.conditions)
        : word === "indefinite madness"
          ? madnessConditions("indefinite")
          : [];
  const wanted = new Set(names.map(lower));
  return sheet.conditions.filter((entry) => wanted.has(lower(entry)));
}
