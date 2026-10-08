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
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { rollCharacterSave, rollEnemySave } from "@/lib/dm/forced-save";
import {
  ROUNDS_PER_MINUTE,
  effectiveMaxHp,
  instanceIdentity,
  instancesOf,
  removeConditionInstances,
  removeConditions,
  tickConditions,
  type ConditionMeta,
  type ConditionMetaMap,
} from "@/lib/dm/condition-logic";
import { tickConcentrationClocks } from "@/lib/dm/concentration-clock";
import { wakeStable } from "@/lib/dm/death";
import { breakConcentration, LETHARGY, lethargyMeta } from "@/lib/dm/concentration";
import { endConcentrationOnFadedSummons, endSpentConcentration } from "@/lib/dm/concentration-upkeep";
import { STABLE_SOURCE, STABLE_WAKE_HOURS_MAX, UNCONSCIOUS } from "@/lib/dm/vitals-logic";
import { holdsFeature } from "@/lib/srd/trait-rules";
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

  // What belongs to a turn is counted there (startTurnConditions, and the
  // saves at endTurnSaves): an instance whose source is in the order counts
  // as that source's turn starts, and a holder in the order saves at the end
  // of its own turn. The wrap counts the rest: an instance with no source in
  // the fight, a holder the order does not hold.
  const inOrder = new Set(encounter.order.map((entry) => orderEntryId(entry)));
  const outside: HolderTick = {
    counts: (source) => !source || !inOrder.has(source),
    saves: (holderId) => !inOrder.has(holderId),
  };
  tickEnemyConditions(campaign, encounter, 1, lines, outside);
  tickSheetConditions(campaign, 1, lines, { encounter, ...outside });
  lines.push(...tickConcentrationClocks(campaign, 1, (casterId) => !inOrder.has(casterId)));
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
  // A concentration spell lasts no longer than its duration on the road
  // either (src/lib/dm/concentration-clock.ts).
  lines.push(...tickConcentrationClocks(campaign, rounds, () => true));
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
  // Creatures whose spell ran out on the clock go (src/lib/dm/summon-store.ts),
  // and with the last of them the concentration that held them.
  const faded = sweepSummons(campaign);
  lines.push(...faded);
  if (faded.length) {
    endConcentrationOnFadedSummons(campaign, lines);
  }
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
  const starting = new Set(combatantIds);
  let enemiesChanged = false;
  for (const enemy of listEnemies(encounter.id)) {
    const ended = endInstancesBoundTo(enemy.conditions, enemy.conditionMeta as ConditionMetaMap, starting);
    if (ended.changed) {
      patchEnemyConditions(enemy.id, ended.conditions, ended.meta);
      enemiesChanged = true;
    }
  }
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const ended = endInstancesBoundTo(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, starting);
    const ending = ended.ended;
    if (!ended.changed) {
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
    const updated = patchSheet(sheet.id, {
      conditions: ended.conditions,
      conditionMeta: ended.meta,
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  // A count that belongs to these turns runs down now: "for 1 minute" from
  // a caster's (or a monster's) turn ends ten of its turns later, where it
  // began (SRD 5.1); a concentration spell's clock with them.
  const counted: string[] = [];
  const ownTurn: HolderTick = { counts: (source) => Boolean(source && starting.has(source)), saves: () => false };
  tickEnemyConditions(campaign, encounter, 1, counted, ownTurn);
  tickSheetConditions(campaign, 1, counted, { encounter, ...ownTurn });
  counted.push(...tickConcentrationClocks(campaign, 1, (casterId) => starting.has(casterId)));
  if (counted.length) {
    endSpentConcentration(campaign, counted);
    enemiesChanged = true;
    noteAtTable(campaign.id, counted);
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

// Which instances a tick counts and which holders save in it (tickConditions).
type HolderTick = {
  counts?: (source: string | undefined) => boolean;
  saves?: (holderId: string) => boolean;
  // Only these holders are looked at.
  only?: Set<string>;
};

function tickEnemyConditions(campaign: Campaign, encounter: Encounter, by: number, lines: string[], options: HolderTick = {}) {
  for (const enemy of listEnemies(encounter.id)) {
    if (enemy.status !== "alive" || !enemy.conditions.length || (options.only && !options.only.has(enemy.id))) {
      continue;
    }
    const tick = tickConditions(enemy.conditions, enemy.conditionMeta, by, {
      counts: options.counts,
      saves: options.saves ? options.saves(enemy.id) : true,
    });
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
        [LETHARGY]: lethargyMeta(enemy.id),
      };
      lines.push(`${enemy.displayName} is overcome by lethargy as Haste ends and loses its next turn.`);
    }
    for (const due of tick.savesDue) {
      if (!conditions.includes(due.name)) {
        continue;
      }
      // Each source's hold asks its own save; this is one of them.
      const holds = (instance: ConditionMeta) => instanceIdentity(instance) === due.key && instance.saveEnds?.dc === due.dc;
      const instance = instancesOf((meta as ConditionMetaMap)[due.name]).find(holds);
      if (!instance) {
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
          magical: Boolean(instance.spell),
          // A creature with Legendary Resistance spends one to end what binds
          // it, as it would against the first save (src/lib/dm/legendary-tools.ts).
          resist: true,
          // On the record like every roll, for the DM's eyes (enemy saves are
          // rolled silently at the table).
          record: { detail: `${enemy.displayName}: ${due.ability.toUpperCase()} save to end ${due.name}` },
        },
      );
      const shown = outcome.total === null ? "an automatic failure" : String(outcome.total);
      if (outcome.success) {
        const removed = removeConditionInstances(conditions, meta, due.name, holds);
        conditions = removed.conditions;
        meta = removed.meta;
        lines.push(
          removed.ended
            ? `${enemy.displayName} shakes off ${due.name} (${due.ability.toUpperCase()} save ${shown} vs DC ${due.dc}).`
            : `${enemy.displayName} throws off one hold of ${due.name} (${due.ability.toUpperCase()} save ${shown} vs DC ${due.dc}); another still holds it.`,
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
  // `encounter` is the fight being ticked; the clock path has none.
  options?: { endTurnBound?: boolean; encounter?: Encounter } & HolderTick,
) {
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (!sheet.conditions.length || !Object.keys(sheet.conditionMeta).length || (options?.only && !options.only.has(sheet.id))) {
      continue;
    }
    const tick = tickConditions(sheet.conditions, sheet.conditionMeta, by, {
      endTurnBound: options?.endTurnBound,
      counts: options?.counts,
      saves: options?.saves ? options.saves(sheet.id) : true,
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
      conditions = [...conditions, LETHARGY];
      // In a fight the lethargy holds through the creature's next turn and
      // ends with it; on the clock it is the one round of six seconds.
      meta = { ...meta, [LETHARGY]: options?.encounter ? lethargyMeta(sheet.id) : { rounds: 1, source: "haste" } };
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
      // The save every other save is (src/lib/dm/forced-save.ts): a
      // paladin's aura, Bless and Bane, exhaustion, lasting effects, a held
      // die, a halfling's Lucky, and the traits keyed to what it resists
      // (Brave against fear, Fey Ancestry against charm).
      const heldBefore = new Set(getSheetById(sheet.id)?.conditions ?? sheet.conditions);
      const save = rollCharacterSave(
        campaign,
        null,
        getSheetById(sheet.id) ?? sheet,
        due.ability,
        due.dc,
        `${due.ability.toUpperCase()} save to end ${due.name}`,
        due.name,
      );
      // A carrier the save spent (an inspiration die) is gone from the
      // stored sheet; the conditions this tick writes back must not restore it.
      const heldAfter = new Set(getSheetById(sheet.id)?.conditions ?? []);
      const spent = [...heldBefore].filter((name) => !heldAfter.has(name));
      if (spent.length) {
        const cleared = removeConditions(conditions, meta, spent);
        conditions = cleared.conditions;
        meta = cleared.meta;
      }
      const shown = save.total ?? "failed";
      if (save.success) {
        // This source's hold goes; another source's keeps the condition.
        const removed = removeConditionInstances(
          conditions,
          meta,
          due.name,
          (instance) => instanceIdentity(instance) === due.key && instance.saveEnds?.dc === due.dc,
        );
        conditions = removed.conditions;
        meta = removed.meta;
        lines.push(
          removed.ended
            ? `${sheet.name} shakes off ${due.name} (${due.ability.toUpperCase()} save ${shown} vs DC ${due.dc}).`
            : `${sheet.name} throws off one hold of ${due.name} (${due.ability.toUpperCase()} save ${shown} vs DC ${due.dc}); another still holds it.`,
        );
      } else {
        lines.push(
          `${sheet.name} stays ${due.name} (${due.ability.toUpperCase()} save ${shown} vs DC ${due.dc}).`,
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
      });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
}

// These combatants' turns have ended: each makes the saves its save-ends
// conditions grant "at the end of each of its turns" (SRD 5.1, Hold Person),
// one per source holding it. advancePointer calls this as the pointer moves:
// for the character whose turn it was, the ones it walked past, and the
// enemies whose turns the DM turn since the last move has taken.
export function endTurnSaves(campaign: Campaign, encounter: Encounter, holderIds: string[]) {
  if (!holderIds.length) {
    return;
  }
  const ending = new Set(holderIds);
  const lines: string[] = [];
  const ownSave: HolderTick = { counts: () => false, saves: (holderId) => ending.has(holderId), only: ending };
  tickEnemyConditions(campaign, encounter, 0, lines, ownSave);
  tickSheetConditions(campaign, 0, lines, { encounter, ...ownSave });
  if (lines.length) {
    endSpentConcentration(campaign, lines);
    publishPersisted(campaign.id, "encounter_updated", {
      encounter: activePublicEncounter(campaign.id),
    });
    noteAtTable(campaign.id, lines);
  }
}

// The instances that end because these combatants' turns are starting
// (Dodge, Shield, the Protection style: untilTurnOf). A condition another
// source still holds stays.
function endInstancesBoundTo(
  conditions: string[],
  meta: ConditionMetaMap,
  starting: Set<string>,
): { conditions: string[]; meta: ConditionMetaMap; ended: string[]; changed: boolean } {
  let nextConditions = conditions;
  let nextMeta = meta;
  const ended: string[] = [];
  let changed = false;
  for (const name of conditions) {
    const result = removeConditionInstances(nextConditions, nextMeta, name, (instance) =>
      Boolean(instance.untilTurnOf && starting.has(instance.untilTurnOf)),
    );
    if (result.removed) {
      changed = true;
      nextConditions = result.conditions;
      nextMeta = result.meta;
      if (result.ended) {
        ended.push(name);
      }
    }
  }
  return { conditions: nextConditions, meta: nextMeta, ended, changed };
}

function noteAtTable(campaignId: string, lines: string[]) {
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    glyph: "cue-bell",
    content: lines.join(" "),
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
}
