// set_condition: a condition landing on a character, and what lands with it.
//
// Split out of mutations.ts so the rules sit together: exhaustion is a track
// and not a name, a second source of a condition keeps the longer duration,
// the sixteenth condition is refused and not dropped, a condition can name
// who caused it, and one that incapacitates ends the character's
// concentration and lets go of whatever they were grappling.
//
// This module must not import mutations.ts (which imports it).
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, listEnemies, patchEnemyConditions } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { listConditions } from "@/lib/content";
import { publishPersisted } from "@/lib/events";
import { planConditionFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { breakConcentration } from "@/lib/dm/concentration";
import {
  conditionRoundsFrom,
  describeConditionDuration,
  describeExhaustion,
  isIncapacitated,
  removeConditions,
  type ConditionMeta,
  type ConditionMetaMap,
  type SaveAbilityId,
} from "@/lib/dm/condition-logic";
import { exhaustionPatch, namesExhaustion } from "@/lib/dm/vitals-logic";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";

// A sheet holds this many conditions at once (the stored list's own cap).
export const MAX_CONDITIONS = 15;

// Conditions are stored lowercase. The model's wording drifts ("poison",
// "Poisoned by the dart"), so set and clear both map through the SRD names;
// unmatched strings stay as-is because custom story conditions are legal.
export function canonicalCondition(raw: string): string {
  const cleaned = raw.trim().toLowerCase().slice(0, 40);
  if (!cleaned) {
    return cleaned;
  }
  const known = listConditions({ limit: 50 }).map((entry) => entry.name.toLowerCase());
  if (known.includes(cleaned)) {
    return cleaned;
  }
  const prefix = known.find((name) => name.startsWith(cleaned) || cleaned.startsWith(name));
  if (prefix) {
    return prefix;
  }
  return known.find((name) => cleaned.includes(name)) ?? cleaned;
}

// How long one instance of a condition lasts, for comparing two of them. No
// duration at all is until something ends it; save-ends with no count is
// until the save is made, which may be never.
function reach(entry: ConditionMeta | undefined): number {
  if (!entry || (entry.rounds === undefined && !entry.saveEnds && !entry.untilTurnOf)) {
    return Number.POSITIVE_INFINITY;
  }
  if (entry.untilTurnOf) {
    return 1;
  }
  return entry.rounds ?? Number.MAX_SAFE_INTEGER;
}

// Two sources of one condition: the creature keeps it until the last one
// ends (SRD 5.1, Conditions), so the instance that lasts longer is the one
// the sheet keeps counting.
export function longerInstance(
  held: ConditionMeta | undefined,
  incoming: ConditionMeta | undefined,
): { entry: ConditionMeta | undefined; replaced: boolean } {
  return reach(incoming) > reach(held)
    ? { entry: incoming, replaced: true }
    : { entry: held, replaced: false };
}

function audit(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  delta: Record<string, unknown>,
  reason: string,
  patch: Record<string, unknown>,
) {
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind: "set_condition",
    delta,
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
}

function publishSheet(campaign: Campaign, sheetId: string) {
  const updated = patchSheet(sheetId, {});
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// A grapple ends when the grappler is incapacitated (SRD 5.1, Conditions).
// Every grappled condition whose stored source is this combatant is
// released, on enemies and on characters alike. A grapple written before
// sources were kept names nobody and is left for the table to end. Returns
// the names of those let go.
export function releaseGrapplesHeldBy(campaign: Campaign, holderId: string): string[] {
  const released: string[] = [];
  const heldBy = (meta: ConditionMetaMap | undefined) =>
    Object.entries((meta ?? {}) as ConditionMetaMap)
      .filter(([name, entry]) => name.toLowerCase() === "grappled" && entry.source === holderId)
      .map(([name]) => name);
  for (const stale of listSheets(campaign.id)) {
    const names = heldBy(stale.conditionMeta);
    if (!names.length) {
      continue;
    }
    const sheet = getSheetById(stale.id) ?? stale;
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, names);
    const updated = patchSheet(sheet.id, {
      conditions: cleared.conditions,
      conditionMeta: cleared.meta,
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    released.push(sheet.name);
  }
  const encounter = getActiveEncounter(campaign.id);
  let enemiesChanged = false;
  for (const enemy of encounter ? listEnemies(encounter.id) : []) {
    const names = heldBy(enemy.conditionMeta);
    if (!names.length) {
      continue;
    }
    const cleared = removeConditions(enemy.conditions, enemy.conditionMeta, names);
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    released.push(enemy.displayName);
    enemiesChanged = true;
  }
  if (enemiesChanged) {
    publishPersisted(campaign.id, "encounter_updated", {
      encounter: activePublicEncounter(campaign.id),
    });
  }
  return released;
}

// One more level of exhaustion, with what the level does to the body.
export function raiseExhaustion(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  reason: string,
): Record<string, unknown> {
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is dead; exhaustion has nothing left to take.` };
  }
  const patch = exhaustionPatch(sheet, sheet.exhaustion + 1);
  patchSheet(sheet.id, patch as FullPatchSheetInput);
  audit(
    campaign,
    turnId,
    sheet,
    { condition: "exhaustion", level: patch.exhaustion },
    reason,
    patch as Record<string, unknown>,
  );
  publishSheet(campaign, sheet.id);
  if (patch.exhaustion >= 6) {
    breakConcentration(campaign, turnId, sheet.id, "died of exhaustion");
    insertCharacterEvent({
      libraryCharacterId: sheet.libraryCharacterId,
      campaignCharacterId: sheet.id,
      campaignId: campaign.id,
      seq: allocateSeq(campaign.id),
      kind: "death",
      summary: "Died: exhaustion.",
    });
    return {
      ok: true,
      dead: true,
      note: `${sheet.name} reaches exhaustion level 6 and DIES.`,
    };
  }
  return {
    ok: true,
    condition: describeExhaustion(patch.exhaustion),
    ...(patch.currentHp !== undefined
      ? { hp: `${patch.currentHp}/${patch.currentHp}`, halved: "Their hit point maximum is halved while the level lasts." }
      : {}),
    note: "A long rest reduces exhaustion by one level.",
  };
}

export type SetConditionArgs = {
  condition?: string;
  rounds?: number;
  minutes?: number;
  hours?: number;
  saveAbility?: SaveAbilityId;
  saveDc?: number;
  sourceEnemyId?: string;
  sourceCharacterId?: string;
};

export function handleSetCondition(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  args: SetConditionArgs,
  reason: string,
): Record<string, unknown> {
  const raw = args.condition ?? "";
  // Exhaustion is a leveled track, not a stackable condition: each set
  // raises it one level (6 = death), whatever word the caller used for it.
  if (namesExhaustion(raw)) {
    return raiseExhaustion(campaign, turnId, sheet, reason);
  }
  const normalized = canonicalCondition(raw);
  if (!normalized) {
    return { error: "set_condition needs a condition name." };
  }
  if (normalized.startsWith("exhaustion")) {
    return raiseExhaustion(campaign, turnId, sheet, reason);
  }
  if (sheet.deathSaves?.dead) {
    return { error: `${sheet.name} is dead and takes no new conditions.` };
  }
  // Duration metadata: timed conditions tick down at round wrap in combat
  // and against the in-world clock outside it (condition-tick.ts); save-ends
  // conditions re-save server-side each round. Minutes and hours become
  // rounds so there is one unit to count down.
  const rounds = conditionRoundsFrom(args);
  const saveEnds =
    args.saveAbility && args.saveDc ? { ability: args.saveAbility, dc: args.saveDc } : undefined;
  const source = (args.sourceEnemyId ?? args.sourceCharacterId ?? "").trim().slice(0, 80);
  const incoming: ConditionMeta | undefined =
    rounds || saveEnds || source
      ? {
          ...(rounds ? { rounds } : {}),
          ...(saveEnds ? { saveEnds } : {}),
          ...(source ? { source } : {}),
        }
      : undefined;
  const meta = sheet.conditionMeta as ConditionMetaMap;
  const already = sheet.conditions.includes(normalized);

  if (already) {
    // A second source: the longer of the two is what the sheet counts.
    const kept = longerInstance(meta[normalized], incoming);
    if (!kept.replaced) {
      return { ok: true, note: `${sheet.name} is already ${normalized}, for at least as long.` };
    }
    const nextMeta: ConditionMetaMap = { ...meta };
    if (kept.entry) {
      nextMeta[normalized] = kept.entry;
    } else {
      delete nextMeta[normalized];
    }
    patchSheet(sheet.id, { conditionMeta: nextMeta });
    audit(campaign, turnId, sheet, { condition: normalized, extended: true }, reason, {
      conditionMeta: nextMeta,
    });
    publishSheet(campaign, sheet.id);
    return {
      ok: true,
      condition: normalized,
      note: `${sheet.name} was already ${normalized}; the longer duration stands.`,
      ...(kept.entry?.rounds
        ? { duration: `${describeConditionDuration(kept.entry.rounds)}, expires automatically` }
        : {}),
    };
  }

  if (sheet.conditions.length >= MAX_CONDITIONS) {
    return {
      error: `${sheet.name} already holds ${MAX_CONDITIONS} conditions, the most a sheet keeps, so ${normalized} was NOT applied. Clear one that has ended with clear_condition, then set it again.`,
      currentConditions: sheet.conditions,
    };
  }

  const withCondition = [...sheet.conditions, normalized];
  const nextMeta: ConditionMetaMap = incoming ? { ...meta, [normalized]: incoming } : meta;
  patchSheet(sheet.id, { conditions: withCondition, conditionMeta: nextMeta });
  audit(campaign, turnId, sheet, { condition: normalized }, reason, {
    conditions: withCondition,
    conditionMeta: nextMeta,
  });
  publishSheet(campaign, sheet.id);
  {
    const pos = tokenPosition(campaign.id, sheet.id);
    if (pos) {
      publishFx(
        campaign.id,
        planConditionFx({
          to: pos.at,
          toTokenId: pos.tokenId,
          condition: normalized,
          applied: true,
        }),
      );
    }
  }
  // An incapacitated creature cannot concentrate, and cannot hold on to
  // anybody.
  let lost: Record<string, unknown> = {};
  if (isIncapacitated([normalized])) {
    const spell = breakConcentration(campaign, turnId, sheet.id, `became ${normalized}`);
    const released = releaseGrapplesHeldBy(campaign, sheet.id);
    lost = {
      ...(spell ? { concentrationBroken: `${sheet.name} loses concentration on ${spell}.` } : {}),
      ...(released.length
        ? { grappleEnded: `${sheet.name} lets go of ${released.join(", ")}.` }
        : {}),
    };
  }
  return {
    ok: true,
    condition: normalized,
    ...(rounds ? { duration: `${describeConditionDuration(rounds)}, expires automatically` } : {}),
    ...(saveEnds
      ? {
          duration: `until they succeed on a ${saveEnds.ability.toUpperCase()} save (DC ${saveEnds.dc}), re-rolled automatically each round in combat and each time the clock moves outside it`,
        }
      : {}),
    ...lost,
  };
}
