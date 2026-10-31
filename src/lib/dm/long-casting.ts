// The table side of a spell of a minute or more cast in a fight
// (src/lib/dm/long-casting-logic.ts has the rule and its words): beginning
// the casting once the cast guard has asked its refusals, finishing it as
// its rounds run out (condition-tick.ts) or as
// the fight ends (enemy-damage.ts finishEncounter), and the turn budget that
// shows its hold on the action from the moment the caster's turn starts.
//
// Must not import cast-guard.ts, which imports this, nor the clock, which
// reaches this through condition-tick.ts: the cast door that completes a
// use_spell_slot spell comes through the runner cast-guard registers, as the
// fight a turncoat starts comes through the starter encounter-tools
// registers (turncoat.ts).

import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { Encounter } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { insertCampaignMessage } from "@/lib/db/messages";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { spellEngineName, spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { summonSpellFor } from "@/lib/srd/summon-spells";
import { addConditionInstance, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { breakConcentration, droppedLine, setConcentration } from "@/lib/dm/concentration";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import { endInvisibilityOnCast } from "@/lib/dm/attack-marks";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { TurnBudget } from "@/lib/dm/action-budget";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import {
  CASTING,
  CASTING_COMPLETE,
  beginLine,
  castingInstance,
  castingLabel,
  castingOf,
  castingTimeWords,
  completeLine,
  completeMark,
  failLine,
  resolveLine,
  resolvingTool,
  type HeldCasting,
} from "@/lib/dm/long-casting-logic";

// The cast door, as cast-guard.ts registers it: completes the casting the
// "casting complete" mark holds, spending its slot and no action.
type Completion = (campaign: Campaign, sheetId: string, spell: string) => ToolResult;
let completion: Completion | null = null;

export function registerCastingCompletion(run: Completion) {
  completion = run;
}

function writeConditions(campaign: Campaign, sheetId: string, next: { conditions: string[]; meta: ConditionMetaMap }) {
  const updated = patchSheet(sheetId, { conditions: next.conditions, conditionMeta: next.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Begins a casting: the caster concentrates on it, which ends what they held
// before, and the "casting" condition counts its rounds. The cast guard has
// spent the turn's action and nothing else.
export function beginLongCasting(
  campaign: Campaign,
  turnId: string | null,
  sheetId: string,
  input: { spell: string; rounds: number; slotLevel: number | null; ritual: boolean },
): { displaced: string | null; failedCasting: string | null } {
  const dropped = setConcentration(campaign, turnId, sheetId, castingLabel(input.spell));
  const fresh = getSheetById(sheetId);
  if (fresh) {
    const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, [CASTING]);
    writeConditions(
      campaign,
      sheetId,
      addConditionInstance(cleared.conditions, cleared.meta, CASTING, castingInstance(sheetId, input.spell, input.rounds, input.slotLevel, input.ritual)),
    );
  }
  return dropped;
}

// SRD 5.1, Longer Casting Times: the cast guard (cast-guard.ts castSpell) has
// asked every refusal and planned the turn; the casting begins with this
// turn's action and nothing else is spent. The slot and any material wait
// for the spell to take effect.
export function beginHeldCasting(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  encounter: Encounter,
  spent: { budget: TurnBudget; note?: string } | null,
  cast: { name: string; facts: SpellFacts | null; slotLevel: number | null; ritual: boolean; rounds: number },
): ToolResult {
  if (spent) {
    storeBudget(encounter, spent.budget);
  }
  // Casting a spell ends Invisibility, a casting begun as much as one done.
  endInvisibilityOnCast(campaign.id, sheet.id);
  const { displaced, failedCasting } = beginLongCasting(campaign, turnId, sheet.id, {
    spell: cast.name,
    rounds: cast.rounds,
    slotLevel: cast.slotLevel,
    ritual: cast.ritual,
  });
  return {
    ok: true,
    spell: cast.name,
    casting: beginLine(sheet.name, cast.name, castingTimeWords(cast.facts, cast.ritual), cast.rounds, cast.slotLevel, cast.ritual),
    roundsLeft: cast.rounds,
    slot: "none spent yet",
    ...(spent ? { cost: "their action" } : {}),
    ...(spent?.note ? { costNote: spent.note } : {}),
    ...(displaced
      ? { droppedConcentration: failedCasting ? failLine(sheet.name, failedCasting, `${castingLabel(cast.name)} took the concentration`) : droppedLine(displaced, cast.name) }
      : {}),
  };
}

// Takes the mark of a completed casting off once its spell is resolved.
export function clearCompletedCasting(campaign: Campaign, sheetId: string) {
  const sheet = getSheetById(sheetId);
  if (sheet && sheet.conditions.some((entry) => entry.trim().toLowerCase() === CASTING_COMPLETE)) {
    writeConditions(campaign, sheetId, removeConditions(sheet.conditions, sheet.conditionMeta, [CASTING_COMPLETE]));
  }
}

// A casting whose rounds have run out, or whose fight has ended: the spell
// takes effect now. Its "casting" condition is already gone. Returns the
// line for the table.
export function finishCasting(campaign: Campaign, sheetId: string, held: HeldCasting, inFight: boolean): string | null {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return null;
  }
  // A concentration that ended without taking the condition along (a sheet
  // edited by hand, a rest) still broke the casting.
  if (textKey(sheet.concentratingOn ?? "") !== textKey(held.label)) {
    return failLine(sheet.name, held.spell, "their concentration on it was gone");
  }
  // The mark the cast door completes it by (cast-guard.ts), laid before the
  // concentration on the casting is let go.
  writeConditions(campaign, sheetId, addConditionInstance(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, CASTING_COMPLETE, completeMark(sheetId, held, inFight)));
  // The casting is over, so is the concentration it took; a concentration
  // spell starts its own as it takes effect.
  breakConcentration(campaign, null, sheetId, `the casting of ${held.spell} is complete`);
  const authors = spellAuthorsFor(campaign);
  const engine = spellEngineName(held.spell, authors);
  const tool = resolvingTool({
    summons: Boolean(summonSpellFor(engine)) || textKey(engine) === "find familiar",
    resolution: spellMechanicsFor({ spell: held.spell, userIds: authors })?.mech.resolution ?? null,
  });
  if (tool || !completion) {
    return resolveLine(sheet.name, held.spell, tool ?? "use_spell_slot", held.slotLevel, held.ritual, inFight);
  }
  const done = completion(campaign, sheetId, held.spell);
  if (typeof done.error === "string") {
    clearCompletedCasting(campaign, sheetId);
    return `${sheet.name} finishes casting ${held.spell}, but it cannot take effect: ${done.error}`;
  }
  const manual = typeof done.manual === "string" ? ` ${done.manual}` : "";
  return `${completeLine(sheet.name, held.spell, String(done.slot ?? "no slot"))}${manual}`;
}

// The fight is over with castings still going. Their remaining rounds pass
// as it winds down and each spell takes effect now, its slot spent then. The
// world clock does not count those rounds, as it counts none of a fight's
// (no fight moves it), so the table is not handed minutes of waiting that
// nobody else spends; and a casting is never left running outside a fight,
// where no turn would hold the caster's action.
export function finishCastingsAtFightEnd(campaign: Campaign): string[] {
  const lines: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const held = castingOf(sheet);
    if (!held) {
      continue;
    }
    writeConditions(campaign, sheet.id, removeConditions(sheet.conditions, sheet.conditionMeta, [CASTING]));
    const line = finishCasting(campaign, sheet.id, held, false);
    if (line) {
      lines.push(line);
    }
  }
  if (lines.length) {
    const seq = allocateSeq(campaign.id);
    const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "cue-bell", content: lines.join(" ") });
    publishWithSeq(campaign.id, seq, "message_added", { message });
  }
  return lines;
}

// The budget of the turn now starting for a caster in the middle of a
// casting, its action already spent on it, so the board's turn pips and
// GAME STATE (which read the stored budget) show it from the turn's first
// moment. Null for anyone else.
export function castingTurnBudget(encounter: Encounter, combatantId: string): TurnBudget | null {
  const sheet = getSheetById(combatantId);
  if (!sheet || !castingOf(sheet)) {
    return null;
  }
  return budgetFor(encounter, combatantId, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
}
