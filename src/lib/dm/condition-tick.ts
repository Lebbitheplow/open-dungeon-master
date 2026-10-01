import { settleFrenzies } from "@/lib/dm/frenzy";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { TurnBudget } from "@/lib/dm/action-budget";
import {
  getEncounter,
  listEnemies,
  orderEntryId,
  patchEnemyConditions,
  type Encounter,
} from "@/lib/db/encounters";
import { RAGING } from "@/lib/srd/class-resources";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { allySaveAura } from "@/lib/dm/aura";
import {
  ROUNDS_PER_MINUTE,
  effectiveMaxHp,
  exhaustionRollState,
  mergeAdvantage,
  removeConditions,
  tickConditions,
  turnBoundConditionsEnding,
  type ConditionMetaMap,
} from "@/lib/dm/condition-logic";
import { wakeStable } from "@/lib/dm/death";
import { breakConcentration, LETHARGY, lethargyRounds, spellEndPatch } from "@/lib/dm/concentration";
import { endSpentConcentration } from "@/lib/dm/concentration-upkeep";
import { STABLE_SOURCE, STABLE_WAKE_HOURS_MAX, UNCONSCIOUS } from "@/lib/dm/vitals-logic";
import { holdsFeature, traitSaveAdvantages } from "@/lib/srd/trait-rules";
import { tickEffectRound } from "@/lib/db/active-effects";
import { spellTurnStart } from "@/lib/dm/spell-aura";
import { zoneTurnStart } from "@/lib/dm/zone-triggers";
import { violetRayTurnStart } from "@/lib/dm/prismatic-violet";
import { authoredTurnStart } from "@/lib/dm/authored-turns";
import { readiedSpellOf } from "@/lib/dm/readied-spell";
import { spellKeyOf as castKeyOf } from "@/lib/dm/cast-rules";
import { sweepSummons } from "@/lib/dm/summon-store";

// Condition upkeep: timed conditions count down and expire, save-ends
// conditions get their re-save rolled server-side (enemy saves from stat
// blocks, character saves from real sheet modifiers with a published dice
// card). Two clocks drive it. In combat, advancePointer calls
// tickEncounterConditions when the initiative order wraps, one round at a
// time, and startTurnConditions for the combatants whose turns are starting,
// which ends what lasted until then (Dodge, Shield). Outside combat the in-world clock calls tickClockConditions from
// advanceClock (src/lib/db/clock.ts) with the minutes that passed, so a
// poison that outlasted the fight, or was never in one, still wears off on
// the road or over a night's rest (issue #30). Must not import
// encounter-tools or enemy-damage (the imports point the other way, and the
// clock path would close a cycle through map-tools).

export function tickEncounterConditions(campaign: Campaign, encounter: Encounter) {
  const lines: string[] = [];

  // Active effects count down with conditions, so an effect and a condition
  // applied in the same breath end in the same breath
  // (src/lib/dm/effects-logic.ts).
  for (const expired of tickEffectRound(campaign.id)) {
    lines.push(`${expired.name} wears off.`);
  }

  tickEnemyConditions(campaign, encounter, 1, lines);
  tickSheetConditions(campaign, 1, lines, { encounter });
  if (lines.length) {
    endSpentConcentration(campaign, lines);
  }
  // A frenzy outliving its rage costs its level of exhaustion (frenzy.ts).
  lines.push(...settleFrenzies(campaign));

  if (lines.length) {
    publishPersisted(campaign.id, "encounter_updated", {
      encounter: activePublicEncounter(campaign.id),
    });
    noteAtTable(campaign.id, lines);
  }
}

// In-world minutes passing with no encounter running. Minute-based active
// effects are already expired by advanceClock; enemies only exist inside
// encounters, so only the party's sheets tick. A save-ends condition gets
// one save per passage of time rather than one per elapsed round: ten
// minutes of walking is not a hundred saving throws, and one honest roll
// per stretch is how a human DM plays "you can try to shake it off again".
export function tickClockConditions(campaign: Campaign, minutes: number) {
  const rounds = Math.floor(Math.max(0, minutes) * ROUNDS_PER_MINUTE);
  if (rounds <= 0) {
    return;
  }
  const lines: string[] = [];
  tickSheetConditions(campaign, rounds, lines, { endTurnBound: true });
  // A creature stabilized before the wait was kept on the sheet has no
  // timer to run out. Four hours in one stretch is the longest 1d4 asks for,
  // so that much time wakes it.
  if (minutes >= STABLE_WAKE_HOURS_MAX * 60) {
    for (const stale of listSheets(campaign.id)) {
      const sheet = getSheetById(stale.id) ?? stale;
      if (sheet.deathSaves?.stable && !stableWaitOf(sheet.conditionMeta)) {
        const woke = wakeStable(campaign, sheet.id);
        if (woke) {
          lines.push(woke);
        }
      }
    }
  }
  if (lines.length) {
    endSpentConcentration(campaign, lines);
  }
  // Creatures whose spell ran out on the clock go (src/lib/dm/summon-store.ts).
  lines.push(...sweepSummons(campaign));
  if (lines.length) {
    noteAtTable(campaign.id, lines);
  }
}

// Whether this sheet's unconscious is the wait of a stabilized creature.
function stableWaitOf(meta: ConditionMetaMap | undefined): boolean {
  return (meta as ConditionMetaMap | undefined)?.[UNCONSCIOUS]?.source === STABLE_SOURCE;
}

// The turns of these combatants are starting: whatever lasted "until the
// start of their next turn" ends now. advancePointer calls this with every
// combatant the pointer reached or walked past, since an enemy's turn is
// taken inside the DM turn that follows the move. Quiet on purpose: a Dodge
// ending is not news, and the sheet update carries it to the table.
export function startTurnConditions(
  campaign: Campaign,
  encounter: Encounter,
  combatantIds: string[],
  // The turn that is ending, as the pointer held it before it moved on.
  // advancePointer passes it; a caller that does not leaves the stored row
  // to be read, which holds it until the pointer's save.
  endedTurn?: { budget: TurnBudget | null },
) {
  if (!combatantIds.length) {
    return;
  }
  endTurnRage(campaign, encounter, combatantIds[0], endedTurn);
  startTurnFeatures(campaign, combatantIds);
  let enemiesChanged = false;
  for (const enemy of listEnemies(encounter.id)) {
    const ending = turnBoundConditionsEnding(enemy.conditions, enemy.conditionMeta, combatantIds);
    if (ending.length) {
      const removed = removeConditions(enemy.conditions, enemy.conditionMeta, ending);
      patchEnemyConditions(enemy.id, removed.conditions, removed.meta);
      enemiesChanged = true;
    }
  }
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const ending = turnBoundConditionsEnding(sheet.conditions, sheet.conditionMeta, combatantIds);
    if (!ending.length) {
      continue;
    }
    // A readied spell never released is lost, and the concentration that
    // held it ends with it (src/lib/dm/readied-spell.ts).
    const lostSpell = ending.some((name) => name.toLowerCase() === "readied")
      ? readiedSpellOf(sheet)?.spell
      : undefined;
    if (lostSpell && castKeyOf(sheet.concentratingOn ?? "") === castKeyOf(lostSpell)) {
      breakConcentration(campaign, null, sheet.id, "the readied spell was never released");
    }
    const removed = removeConditions(sheet.conditions, sheet.conditionMeta, ending);
    const updated = patchSheet(sheet.id, {
      conditions: removed.conditions,
      conditionMeta: removed.meta,
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  // Running spells act at the start of a turn: Spirit Guardians around its
  // caster, Phantasmal Killer's dread, Heroism's temporary hit points
  // (src/lib/dm/spell-aura.ts).
  // With them, the authored subclass features' (Elder Champion, Aura of Conquest, Dread Lord): authored-hooks.ts.
  const spellLines = [...spellTurnStart(campaign, encounter, combatantIds), ...authoredTurnStart(campaign, encounter, combatantIds)];
  // The spell areas on the board: those that ran out go, the rest strike (zone-triggers.ts).
  spellLines.push(...zoneTurnStart(campaign, encounter, combatantIds));
  // Prismatic Spray's violet ray asks its WIS save as the caster's turn starts (prismatic.ts).
  spellLines.push(...violetRayTurnStart(campaign, combatantIds));
  if (enemiesChanged || spellLines.length) {
    publishPersisted(campaign.id, "encounter_updated", {
      encounter: activePublicEncounter(campaign.id),
    });
  }
  if (spellLines.length) {
    noteAtTable(campaign.id, spellLines);
  }
}

// What a character's features do at the start of their turn. Survivor
// (Champion 18): at or under half their hit points and above 0, they regain
// 5 + their Constitution modifier.
function startTurnFeatures(campaign: Campaign, combatantIds: string[]) {
  const lines: string[] = [];
  for (const id of combatantIds) {
    const sheet = getSheetById(id);
    if (!sheet || sheet.deathSaves?.dead || !holdsFeature(sheet, "survivor")) {
      continue;
    }
    const max = effectiveMaxHp(sheet);
    if (sheet.currentHp <= 0 || sheet.currentHp > Math.floor(max / 2)) {
      continue;
    }
    const regained = Math.max(0, 5 + computeSheetDerived(sheet).abilityMods.con);
    const currentHp = Math.min(max, sheet.currentHp + regained);
    if (currentHp === sheet.currentHp) {
      continue;
    }
    const updated = patchSheet(sheet.id, { currentHp });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    lines.push(`${sheet.name} regains ${currentHp - sheet.currentHp} hit points (Survivor).`);
  }
  if (lines.length) {
    noteAtTable(campaign.id, lines);
  }
}

// A rage ends early when the barbarian's turn ends and they have neither
// attacked a hostile creature since their last turn nor taken damage since
// then (SRD 5.1, Rage). Persistent Rage (barbarian 15) lifts that.
//
// The turn that just ended belongs to the combatant before the first one
// starting. What they did with it is on the turn budget, which the pointer
// clears in memory as it moves and saves afterwards, so the stored row still
// holds the budget of the turn that ended: it is read from there. No budget
// of theirs means nothing was spent, an attack least of all.
function endTurnRage(
  campaign: Campaign,
  encounter: Encounter,
  firstStarting: string,
  endedTurn?: { budget: TurnBudget | null },
) {
  const place = encounter.order.findIndex((entry) => orderEntryId(entry) === firstStarting);
  if (place < 0 || encounter.order.length < 2) {
    return;
  }
  const ended = encounter.order[(place - 1 + encounter.order.length) % encounter.order.length];
  if (ended.kind !== "pc") {
    return;
  }
  const sheet = getSheetById(ended.characterId);
  const ragingAs = sheet?.conditions.find((entry) => entry.toLowerCase() === RAGING);
  if (!sheet || !ragingAs) {
    return;
  }
  if (sheet.features.some((feature) => feature.name.toLowerCase().includes("persistent rage"))) {
    return;
  }
  const meta = sheet.conditionMeta as ConditionMetaMap;
  const budget = endedTurn ? endedTurn.budget : (getEncounter(encounter.id)?.turnBudget ?? null);
  const attacked = budget !== null && budget.ownerId === sheet.id && budget.attacksMade > 0;
  if (attacked || meta[ragingAs]?.stoked) {
    // Fed this turn: the count starts again for the next one.
    if (meta[ragingAs]?.stoked) {
      const rest = { ...meta[ragingAs] };
      delete rest.stoked;
      patchSheet(sheet.id, { conditionMeta: { ...meta, [ragingAs]: rest } });
    }
    return;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [ragingAs]);
  const updated = patchSheet(sheet.id, {
    conditions: cleared.conditions,
    conditionMeta: cleared.meta,
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  noteAtTable(campaign.id, [
    `${sheet.name}'s rage ends: their turn passed with no attack made and no damage taken.`,
  ]);
}

function tickEnemyConditions(campaign: Campaign, encounter: Encounter, by: number, lines: string[]) {
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive" || !enemy.conditions.length) {
      continue;
    }
    const tick = tickConditions(enemy.conditions, enemy.conditionMeta, by);
    let conditions = tick.conditions;
    let meta = tick.meta;
    for (const name of tick.expired) {
      lines.push(`${enemy.displayName} is no longer ${name} (the effect ran its course).`);
    }
    // Haste running out costs an enemy its next turn as it costs a character
    // (tickSheetConditions below). This clock only runs at the round wrap.
    const hastedAs = tick.expired.find((name) => name.toLowerCase() === "hasted");
    if (hastedAs && !conditions.includes(LETHARGY)) {
      conditions = [...conditions, LETHARGY];
      meta = {
        ...meta,
        [LETHARGY]: { rounds: lethargyRounds(encounter, enemy.id, true), source: "haste" },
      };
      lines.push(`${enemy.displayName} is overcome by lethargy as Haste ends and loses its next turn.`);
    }
    for (const due of tick.savesDue) {
      if (!conditions.includes(due.name)) {
        continue;
      }
      // The creature's full save (src/lib/dm/forced-save.ts), as the first
      // one was: its conditions (restrained is DEX disadvantage), a spell a
      // character left on it (Bane's d4), lasting effects, and Magic
      // Resistance against a spell's hold.
      const outcome = rollEnemySave(
        campaign.id,
        { ...enemy, conditions, conditionMeta: meta },
        due.ability,
        due.dc,
        {
          magical: Boolean((meta as ConditionMetaMap)[due.name]?.spell),
          // On the record like every roll, for the DM's eyes (enemy saves are
          // rolled silently at the table).
          record: { detail: `${enemy.displayName}: ${due.ability.toUpperCase()} save to end ${due.name}` },
        },
      );
      const shown = outcome.total === null ? "an automatic failure" : String(outcome.total);
      if (outcome.success) {
        const removed = removeConditions(conditions, meta, [due.name]);
        conditions = removed.conditions;
        meta = removed.meta;
        lines.push(
          `${enemy.displayName} shakes off ${due.name} (${due.ability.toUpperCase()} save ${shown} vs DC ${due.dc}).`,
        );
      } else {
        lines.push(
          `${enemy.displayName} stays ${due.name} (${due.ability.toUpperCase()} save ${shown} vs DC ${due.dc}).`,
        );
      }
    }
    if (
      conditions.length !== enemy.conditions.length ||
      JSON.stringify(meta) !== JSON.stringify(enemy.conditionMeta)
    ) {
      patchEnemyConditions(enemy.id, conditions, meta);
    }
  }
}

function tickSheetConditions(
  campaign: Campaign,
  by: number,
  lines: string[],
  // `encounter` is the fight whose round just wrapped; the clock path has none.
  options?: { endTurnBound?: boolean; encounter?: Encounter },
) {
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (!sheet.conditions.length || !Object.keys(sheet.conditionMeta).length) {
      continue;
    }
    const tick = tickConditions(sheet.conditions, sheet.conditionMeta, by, {
      endTurnBound: options?.endTurnBound,
    });
    let conditions = tick.conditions;
    let meta = tick.meta;
    // SRD 5.1, Haste: when the spell ends, however it ends, the target cannot
    // move or take actions until after its next turn. A broken concentration
    // applies it in concentration.ts; running out applies it here. Time that
    // went on past the end (a long stretch on the clock) has already used up
    // the lethargy's one round.
    const hastedAs = tick.expired.find((name) => name.toLowerCase() === "hasted");
    const hasteLeft = hastedAs
      ? ((sheet.conditionMeta as ConditionMetaMap)[hastedAs]?.rounds ?? by)
      : 0;
    if (hastedAs && by - hasteLeft < 1 && !conditions.includes(LETHARGY)) {
      const rounds = options?.encounter ? lethargyRounds(options.encounter, sheet.id, true) : 1;
      conditions = [...conditions, LETHARGY];
      meta = { ...meta, [LETHARGY]: { rounds, source: "haste" } };
      lines.push(`${sheet.name} is overcome by lethargy as Haste ends and loses their next turn.`);
    }
    // The wait of a stabilized creature ran out: it regains its hit point
    // and wakes, which writes the conditions itself.
    if (tick.expired.includes(UNCONSCIOUS) && stableWaitOf(sheet.conditionMeta)) {
      const woke = wakeStable(campaign, sheet.id);
      if (woke) {
        lines.push(woke);
        tick.expired.splice(tick.expired.indexOf(UNCONSCIOUS), 1);
      }
    }
    for (const name of tick.expired) {
      lines.push(`${sheet.name} is no longer ${name} (the effect ran its course).`);
    }
    for (const due of tick.savesDue) {
      if (!conditions.includes(due.name)) {
        continue;
      }
      // A nearby paladin's aura rides re-saves too (map-scoped).
      const aura = allySaveAura(campaign.id, sheet);
      const saveMod = computeSheetDerived(sheet).saves[due.ability] + (aura?.bonus ?? 0);
      // The traits keyed to what the save resists (Brave against fear, Fey
      // Ancestry against charm, Dwarven Resilience against poison).
      const traits = traitSaveAdvantages(sheet, due.ability, due.name);
      const brave = traits.length > 0;
      // Exhaustion level 3 costs every saving throw disadvantage, this one
      // included; the two cancel to a straight roll when both apply.
      const tired = exhaustionRollState(sheet.exhaustion ?? 0, "saving_throw");
      const advantage = mergeAdvantage([brave ? "advantage" : "none", tired.advantage]);
      const outcome = rollExpression(d20Expression(saveMod, advantage));
      const roll = insertRoll({
        campaignId: campaign.id,
        characterId: sheet.id,
        requestedBy: "dm",
        kind: "saving_throw",
        detail: `${due.ability.toUpperCase()} save to end ${due.name}${
          brave ? ` (${traits.join("; ")})` : ""
        }${tired.note ? ` (${tired.note})` : ""}`,
        dc: due.dc,
        ...(advantage === "none" ? {} : { advantage }),
        result: outcome,
      });
      publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
        roll,
        source: "digital",
      });
      if (outcome.total >= due.dc) {
        const removed = removeConditions(conditions, meta, [due.name]);
        conditions = removed.conditions;
        meta = removed.meta;
        lines.push(
          `${sheet.name} shakes off ${due.name} (${due.ability.toUpperCase()} save ${outcome.total} vs DC ${due.dc}).`,
        );
      } else {
        lines.push(
          `${sheet.name} stays ${due.name} (${due.ability.toUpperCase()} save ${outcome.total} vs DC ${due.dc}).`,
        );
      }
    }
    if (
      conditions.length !== sheet.conditions.length ||
      JSON.stringify(meta) !== JSON.stringify(sheet.conditionMeta)
    ) {
      // Polymorph's duration running out reverts the transformation with
      // the condition.
      const polymorphEnded =
        sheet.wildShape?.kind === "polymorph" &&
        sheet.conditions.some((name) => name.toLowerCase() === "polymorphed") &&
        !conditions.some((name) => name.toLowerCase() === "polymorphed");
      if (polymorphEnded) {
        lines.push(`${sheet.name} reverts to their own body as the polymorph ends.`);
      }
      const updated = patchSheet(sheet.id, {
        conditions,
        conditionMeta: meta,
        ...(polymorphEnded ? { wildShape: null } : {}),
        // Aid running out takes back the hit points it gave.
        ...spellEndPatch(sheet, tick.expired),
      });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
}

function noteAtTable(campaignId: string, lines: string[]) {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: lines.join(" "),
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
}
