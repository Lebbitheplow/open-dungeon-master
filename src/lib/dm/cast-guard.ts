// The one door every spell a character casts goes through.
//
// use_spell_slot, cast_at_enemy, cast_buff, aoe_damage with a spell, the
// spell branch of pc_attack, heal with a spell and a reaction spell all call
// castSpell (through use_spell_slot in src/lib/dm/mutations.ts), so the
// questions are asked once and in one order: may the caster act at all
// (can-act.ts), do they hold the spell, can they cast in the state they are
// in, can they say and gesture it, can they pay for its material, have they
// the slot, and has their turn the room for its casting time. Every refusal
// comes before anything is written, and a dry run asks the questions
// without writing, for a tool that has refusals of its own still to ask.
//
// A concentration spell already running whose effect comes again on a later
// turn (Call Lightning's bolt, Heat Metal, Moonbeam) is not a new casting:
// it costs what the spell says of the turn and no slot, at the slot level
// the casting was made from. A warlock's cast with no level named is made at
// the pact level, and a wizard's mastered spell spends no slot
// (cast-rules.ts slotPlan).
//
// The rules themselves are pure and live in src/lib/dm/cast-rules.ts; this
// module reads the live state and writes the spend. It must not import
// mutations.ts (which imports it).

import { subclassExtrasForTable } from "@/lib/db/subclass-extras";
import { enemyCounterspell } from "@/lib/dm/enemy-reactions";
import { endInvisibilityOnCast } from "@/lib/dm/attack-marks";
import { endSanctuaryOnHarm } from "@/lib/dm/spell-defenses";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, type Encounter } from "@/lib/db/encounters";
import { patchSheet } from "@/lib/db/sheets";
import { advanceClock } from "@/lib/db/clock";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { materialPatch } from "@/lib/dm/cast-material";
import { freeCastCounter, signatureCounter, spendSignature } from "@/lib/dm/caster-features";
import { spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { castShares } from "@/lib/srd/spell-mechanics";
import { describeCastingTime, type SpellFacts } from "@/lib/srd/spell-facts";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { canAct } from "@/lib/dm/can-act";
import { incapacitatedBy } from "@/lib/dm/condition-logic";
import { attacksAllowedFor, budgetFor, markReactionUsed, storeBudget } from "@/lib/dm/turn-budget";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { droppedLine, setConcentration } from "@/lib/dm/concentration";
import { repeatSpell } from "@/lib/dm/cast-repeat";
import {
  casterStateProblem,
  componentProblem,
  focusProblem,
  longCastingProblem,
  materialPlan,
  openCastOf,
  ritualProblem,
  slotPlan,
  spellHeldProblem,
  reactionSpellOnOwnTurn,
  turnCharge,
  withOpenCast,
  bonusCastOf,
  MANTLE_OF_MAJESTY,
  type BonusCast,
  type SlotPlan,
} from "@/lib/dm/cast-rules";
import type { TurnBudget } from "@/lib/dm/action-budget";
import { paidByManualTick } from "@/lib/dm/manual-ticks";
import { reactionRefusal } from "@/lib/dm/reaction-gate";
import { reactionTimingOf } from "@/lib/dm/reaction-kinds";
import { readiedRelease, releaseReadied } from "@/lib/dm/readied-spell";
import { heldBySlow, markSlowedCast, slowHoldsCast } from "@/lib/dm/slow-cast";
import { antimagicProblem, silenceProblem } from "@/lib/dm/zone-rules";
import { placeSpellZone } from "@/lib/dm/zone-cast";
import { spellSaveDcFor } from "@/lib/srd";
import { castTempHp } from "@/lib/dm/authored-spells";
import { authoredSlotRefund } from "@/lib/srd/authored-effects-more";
import { takeItemCast } from "@/lib/srd/item-cast-credit";
import { castFromItem } from "@/lib/dm/item-casts";
import { summonSlotProblem } from "@/lib/srd/summon-spells";
import { spellSupportLine } from "@/lib/srd/spell-support";
import { wardOnCast } from "@/lib/dm/arcane-ward";
import { casterCost } from "@/lib/dm/spell-self";
import { toolError, type ToolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { holdsFeature } from "@/lib/srd/feature-names";
import { revisedOnlySpell, revisedOnlySpellProblem } from "@/lib/content/edition";
import { isConditionNamed } from "@/lib/srd/feature-names";

// Which tool the cast came through. It decides two things only: whether a
// casting whose shares are resolved one call at a time (Eldritch Blast's
// beams, Bane's targets) may continue an open one, and whether the caller
// spends the reaction itself (use_reaction does).
export type CastVia = "slot" | "enemy" | "buff" | "aoe" | "attack" | "heal" | "reaction";

export type CastInput = {
  spell: string;
  level?: number;
  ritual?: boolean;
  // A homebrew spell the server knows nothing of: the caller says whether it
  // holds concentration.
  concentration?: boolean;
  via?: CastVia;
  dryRun?: boolean;
  // How many of the casting's shares this call resolves (Magic Missile's
  // darts at one target); one when absent.
  uses?: number;
  // What a material counts by: creatures affected, corpses, the target's
  // Hit Dice (src/lib/dm/cast-materials.ts).
  units?: number;
  // Where a spell with an area is laid on the board (src/lib/dm/zone-cast.ts).
  at?: { x: number; y: number };
  toward?: { x: number; y: number };
};

export type CastHooks = {
  // Writes the audit row for the spend (mutations.ts keeps the audit helper).
  record: (delta: Record<string, unknown>, patch: Record<string, unknown>) => void;
  publish: () => void;
};

export type CastResult = ToolResult;

function inRunningFight(encounter: Encounter | null): encounter is Encounter {
  return Boolean(encounter && encounter.status === "active" && (encounter.kind ?? "fight") === "fight");
}

function slotLine(plan: SlotPlan): string {
  if (plan.kind === "none") {
    return plan.note;
  }
  return `${plan.kind === "pact" ? "pact slot " : ""}level ${plan.level}: ${plan.state.max - plan.state.used}/${plan.state.max} left`;
}

// A slot spent with no spell named: Divine Smite, and a weak tool call the
// server tolerates (docs/rules-coverage.md). Only the slot and the caster's
// ability to act at all are asked.
function namelessSlot(
  sheet: CharacterSheet,
  input: CastInput,
  hooks: CastHooks,
): CastResult {
  if (input.ritual) {
    return { error: "A ritual is a named spell with the ritual tag; name the spell being cast.", retry: true };
  }
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is ${sheet.deathSaves?.dead ? "dead" : "at 0 HP"} and cannot spend a spell slot.`, refused: "rules" };
  }
  const stopped = incapacitatedBy(sheet.conditions);
  if (stopped) {
    return { error: `${sheet.name} is ${stopped} and cannot spend a spell slot until the condition ends.`, refused: "rules" };
  }
  const state = casterStateProblem(sheet);
  if (state && sheet.wildShape) {
    return state;
  }
  const plan = slotPlan(sheet, "", null, input.level);
  if ("error" in plan) {
    return plan;
  }
  if (input.dryRun || plan.kind === "none") {
    return { ok: true, dryRun: Boolean(input.dryRun) };
  }
  const spellcasting = spellcastingAfter(sheet, plan);
  patchSheet(sheet.id, { spellcasting });
  hooks.record({ level: plan.level, used: plan.state.used, max: plan.state.max }, { spellcasting });
  hooks.publish();
  return { ok: true, slot: slotLine(plan) };
}

function spellcastingAfter(sheet: CharacterSheet, plan: SlotPlan): CharacterSheet["spellcasting"] {
  const casting = sheet.spellcasting;
  if (!casting || plan.kind === "none") {
    return casting;
  }
  return plan.kind === "pact"
    ? { ...casting, pact: { level: plan.level, ...plan.state } }
    : { ...casting, slots: { ...casting.slots, [String(plan.level)]: plan.state } };
}

// What the turn is charged, worked out before any write.
type TurnPlan =
  | { kind: "free" }
  | { kind: "budget"; budget: TurnBudget; cost: string; note?: string }
  | { kind: "reaction"; budget?: TurnBudget }
  // use_reaction spent the reaction; the cast only marks the caster's own turn.
  | { kind: "mark"; budget: TurnBudget };

// The feature that lets this one-action spell take the bonus action
// (cast-rules.ts bonusCastOf), with the spell's school from the pack.
function bonusCastFor(sheet: CharacterSheet, facts: SpellFacts | null, spell: string): BonusCast | null {
  return bonusCastOf(sheet, facts, facts ? spellSchoolFor(facts.runsAs ?? facts.name ?? spell) : null);
}

function planTurn(
  sheet: CharacterSheet,
  encounter: Encounter | null,
  facts: SpellFacts | null,
  spell: string,
  slotLevel: number | null,
  via: CastVia,
): TurnPlan | ToolError {
  if (!inRunningFight(encounter)) {
    return { kind: "free" };
  }
  const time = facts?.castingTime ?? "action";
  const budget = budgetFor(
    encounter,
    sheet.id,
    attacksAllowedFor(sheet),
    conditionTurnShape(sheet.conditions),
  );
  if (time === "reaction") {
    // On the caster's own turn a reaction spell is the turn's other spell
    // (cast-rules.ts, reactionSpellOnOwnTurn).
    const own = reactionSpellOnOwnTurn(budget, sheet.name, facts?.name ?? spell);
    if ("error" in own) {
      return own;
    }
    if (via === "reaction") {
      // use_reaction checks and spends the reaction itself.
      return own.budget ? { kind: "mark", budget: own.budget } : { kind: "free" };
    }
    if (encounter.reactionsUsed.includes(sheet.id)) {
      return {
        error: `${sheet.name} has already used their reaction; it comes back at the start of their next turn. ${facts?.name ?? spell} is not cast.`,
        refused: "rules",
      };
    }
    return { kind: "reaction", ...(own.budget ? { budget: own.budget } : {}) };
  }
  const charge = turnCharge({
    who: sheet.name,
    facts,
    spell,
    slotLevel,
    inFight: true,
    budget,
    reactionSpent: false,
    bonusCast: bonusCastFor(sheet, facts, spell),
  });
  if ("error" in charge) {
    return charge;
  }
  if (charge.kind === "budget") {
    return { kind: "budget", budget: charge.budget, cost: charge.cost, ...(charge.note ? { note: charge.note } : {}) };
  }
  return { kind: "free" };
}

// Casts a named spell for `sheet`, or spends a nameless slot. The sheet is
// the fresh pre-cast state.
export function castSpell(
  campaign: Campaign,
  turnId: string,
  sheet: CharacterSheet,
  input: CastInput,
  hooks: CastHooks,
): CastResult {
  const spell = input.spell.trim();
  // Divine Smite is a paladin's feature under the 2014 rules, not a spell: a
  // slot spent naming it is the nameless slot the feature burns.
  if (!spell || (revisedOnlySpell(spell) === "Divine Smite" && holdsFeature(sheet, "Divine Smite"))) {
    return namelessSlot(sheet, input, hooks);
  }
  // A spell only the 2024 rules print, still on a sheet from before they
  // were taken out, is not cast here (src/lib/content/edition.ts).
  const revised = revisedOnlySpellProblem(spell);
  if (revised) {
    return { error: `${revised} Nothing was spent.`, refused: "rules" };
  }
  const via = input.via ?? "slot";
  const authors = spellAuthorsFor(campaign);
  const facts = spellFactsFor(spell, authors);
  const name = facts?.name ?? spell;
  // The published spell a table's workshop copy runs as: what every engine
  // that keys a spell by name reads (src/lib/content/index.ts
  // spellEngineName). The copy's own name is what is spent and held.
  const engine = facts?.runsAs ?? name;
  const encounter = getActiveEncounter(campaign.id);
  const inFight = inRunningFight(encounter);
  const reactionTime = facts?.castingTime === "reaction" || via === "reaction";
  // A summoning spell's creatures come through cast_buff (summon-cast.ts).
  const summoning = via === "slot" && !input.dryRun ? summonSlotProblem(engine) : null;
  if (summoning) {
    return summoning;
  }
  // A reaction spell answers its trigger through use_reaction, which checks
  // the trigger and applies the spell (src/lib/dm/reaction-spells.ts): cast
  // by any other tool it would spend its slot on nothing.
  // A spell they cannot cast is told so here, as use_reaction would (a cast
  // an item pays for aside), not sent there to hear it.
  if (facts?.castingTime === "reaction" && via !== "reaction") {
    const unheld = takeItemCast(sheet.id, name, { dryRun: true }) ? null : spellHeldProblem(sheet, spell, facts, { extras: subclassExtrasForTable(campaign.id, sheet.userId) });
    return unheld ?? { error: `${name} is cast as a reaction: use_reaction with feature "${name}" when its trigger happens; the server checks the trigger and applies it. Nothing was spent.`, retry: true };
  }

  // A slot level named is a real one. Level 0 is how some callers name a
  // cantrip, and passes for one.
  if (input.level !== undefined && !(input.level >= 1 && input.level <= 9)) {
    const cantrip =
      facts?.level === 0 ||
      [sheet.spellcasting, ...(sheet.spellcasting?.casters ?? [])].some((entry) =>
        (entry?.cantrips ?? []).some((name) => textKey(name) === textKey(spell)),
      );
    if (!(input.level === 0 && cantrip)) {
      return {
        error: `A spell slot has a level from 1 to 9, not ${input.level}. Name the slot ${name} is cast from, or leave the level out for the spell's own.`,
        retry: true,
      };
    }
  }

  // A concentration spell already running whose effect comes again on a
  // later turn (Call Lightning's bolt, Heat Metal, Moonbeam): no new
  // casting, so no slot, no material, and concentration is not reset. What
  // it costs of the turn the spell says (src/lib/srd/spell-mech-rows.ts).
  const mech = spellMechanicsFor({ spell: name, userIds: authors })?.mech ?? null;
  if (
    mech?.repeat &&
    via !== "slot" &&
    sheet.concentratingOn &&
    textKey(sheet.concentratingOn) === textKey(name)
  ) {
    return repeatSpell(sheet, inRunningFight(encounter) ? encounter : null, facts, name, mech.repeat, input);
  }

  // A readied spell released off turn: the reaction, no second slot
  // (src/lib/dm/readied-spell.ts).
  const readied = readiedRelease(sheet, encounter, name);
  if (readied && encounter) {
    return releaseReadied(campaign, sheet, encounter, readied, Boolean(input.dryRun));
  }

  // A spell use_item just cast from a scroll or a wand: no slot, no
  // components, the action already paid (src/lib/dm/item-casts.ts).
  const fromItem = takeItemCast(sheet.id, name, { dryRun: Boolean(input.dryRun) });
  if (fromItem) {
    return castFromItem(campaign, turnId, sheet, facts, name, fromItem, input);
  }

  // ---- refusals, in the order a person would give them ----
  // A reaction spell is asked through the one reaction gate, with the
  // spell's own timing (src/lib/dm/reaction-kinds.ts, issue 233): Shield cast
  // as the hit that dropped the caster lands is judged as they stood before
  // it; Hellish Rebuke is not.
  if (reactionTime) {
    const refused = reactionRefusal(campaign.id, sheet, encounter, name, reactionTimingOf(engine));
    if (refused) {
      return refused;
    }
  } else {
    const able = canAct({ sheet, encounter, kind: "cast" });
    if (!able.ok) {
      return toolError(able);
    }
  }
  const held = spellHeldProblem(sheet, spell, facts, {
    ritual: input.ritual,
    extras: subclassExtrasForTable(campaign.id, sheet.userId),
  });
  if (held) {
    return held;
  }
  const state = casterStateProblem(sheet);
  if (state) {
    return state;
  }
  const voice = componentProblem(sheet, facts) ?? focusProblem(sheet, facts) ?? silenceProblem(campaign.id, sheet.id, sheet.name, facts) ?? antimagicProblem(campaign.id, sheet.id, sheet.name);
  if (voice) {
    return voice;
  }
  if (input.ritual) {
    const ritual = ritualProblem(sheet, spell, facts, inFight);
    if (ritual) {
      return ritual;
    }
  } else {
    const long = longCastingProblem(facts, inFight);
    if (long) {
      return long;
    }
  }
  const material = materialPlan(sheet, facts, { inFight, units: input.units, slotLevel: input.level ?? facts?.level ?? null });
  if ("error" in material) {
    return material;
  }

  // A casting whose beams or targets come one call at a time: the later
  // calls of the same casting on the same turn spend nothing more. A slot
  // spent through use_spell_slot and then resolved by the tool that applies
  // the spell (the older way to call the tools) is one casting too.
  const shared = via !== "slot" && via !== "reaction";
  const liveBudget =
    inFight && shared
      ? budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions))
      : null;
  const open = liveBudget ? openCastOf(liveBudget, name) : null;
  if (open && liveBudget) {
    if (input.dryRun) {
      return { ok: true, dryRun: true, spell: name, slotLevel: open.slotLevel, continuing: true };
    }
    const uses = Math.max(1, Math.min(open.left, Math.floor(input.uses ?? 1)));
    storeBudget(encounter as Encounter, withOpenCast(liveBudget, { ...open, left: open.left - uses }));
    return {
      ok: true,
      spell: name,
      slotLevel: open.slotLevel,
      uses,
      sharesLeft: open.left - uses,
      continuing: `${name}: more of the same casting (${open.left - uses} left); nothing more is spent.`,
    };
  }

  // The casting Slow held back last turn, completed now for this turn's
  // action and no slot, at the slot it was cast from (slow-cast.ts).
  const slowHeld = input.ritual ? null : heldBySlow(sheet, name);
  // Signature Spells (wizard 20): the chosen 3rd level spells, once each per
  // short rest at 3rd level, spend their counter instead of a slot.
  const signature = input.ritual || slowHeld ? null : signatureCounter(sheet, facts, input.level);
  // A feat's free cast (Fey Touched's misty step, Magic Initiate's spell)
  // spends its once-a-day counter instead of a slot while one is left
  // (src/lib/srd/feat-spells.ts); with the counter spent, a slot pays.
  const freeCast = input.ritual || signature ? null : freeCastCounter(sheet, spell, facts, input.level);
  // Mantle of Majesty's Command costs no slot while the mantle holds.
  const mantled =
    !input.ritual && !signature && !freeCast && /^command$/i.test(engine.trim()) &&
    sheet.conditions.some((entry) => isConditionNamed(entry, MANTLE_OF_MAJESTY));
  const slot: SlotPlan | ToolError = input.ritual
    ? { kind: "none", note: `${name} cast as a ritual: no slot spent.` }
    : slowHeld
      ? { kind: "none", note: `${name} completes the casting Slow held back: no slot spent.` }
    : signature
      ? { kind: "none", note: `${name} is a Signature Spell: cast at 3rd level with no slot, once until a short rest.` }
      : freeCast
        ? { kind: "none", note: `${name} is cast without a slot (a feat's free cast): once until a long rest.` }
        : mantled
          ? { kind: "none", note: `${name} is cast through Mantle of Majesty: no slot spent.` }
        : // A slot the player marked spent by hand for this cast pays for it.
          paidByManualTick(sheet, slotPlan(sheet, spell, facts, input.level), input.level ?? facts?.level, facts?.level, Boolean(input.dryRun));
  if ("error" in slot) {
    // A cast the turn cannot pay for is refused for that first: which slot
    // to spend is moot when the action is gone.
    const barred = planTurn(sheet, encounter, facts, spell, input.level ?? facts?.level ?? null, via);
    return barred && "error" in barred ? barred : slot;
  }
  const slotLevel = slowHeld ? slowHeld.slotLevel : slot.kind === "none" ? null : slot.level;
  const turn = input.ritual ? ({ kind: "free" } as const) : planTurn(sheet, encounter, facts, spell, slotLevel, via);
  if ("error" in turn) {
    return turn;
  }
  if (input.dryRun) {
    return { ok: true, dryRun: true, spell: name, slotLevel };
  }

  // ---- the spend: nothing below refuses ----
  const result: CastResult = { ok: true, spell: name, slotLevel, slot: slotLine(slot) };
  // What the server leaves to the DM of this spell (src/lib/srd/spell-support.ts).
  const manual = spellSupportLine(name);
  if (manual) {
    result.manual = manual;
  }
  const patch: FullPatchSheetInput = {};
  if (slot.kind !== "none") {
    patch.spellcasting = spellcastingAfter(sheet, slot);
  }
  Object.assign(patch, materialPatch(sheet, material, result));
  if (signature) {
    patch.resources = spendSignature(sheet.resources, signature);
  }
  if (freeCast) {
    patch.resources = spendSignature(sheet.resources, freeCast);
  }
  // Expert Divination (School of Divination 6): a divination spell of 2nd
  // level or higher cast with a slot gives back one spent slot of a lower
  // level, 5th at most.
  const refund =
    slot.kind !== "none" && patch.spellcasting ? authoredSlotRefund(sheet, { school: spellSchoolFor(spell, authors), slotLevel }, patch.spellcasting.slots) : null;
  if (refund && patch.spellcasting) {
    const slots = patch.spellcasting.slots;
    const row = slots[String(refund.level)];
    patch.spellcasting = { ...patch.spellcasting, slots: { ...slots, [String(refund.level)]: { ...row, used: row.used - 1 } } };
    result.slotRefund = `${refund.feature}: a spent level ${refund.level} slot comes back.`;
  }
  if (Object.keys(patch).length) {
    patchSheet(sheet.id, patch);
    hooks.record(
      {
        spell: name,
        ...(slot.kind !== "none" ? { level: slot.level, used: slot.state.used, max: slot.state.max } : {}),
        ...(input.ritual ? { ritual: true } : {}),
        ...(signature ? { signature, level: 3 } : {}),
        ...(freeCast ? { freeCast } : {}),
      },
      patch,
    );
    hooks.publish();
  }

  if (turn.kind === "budget" && encounter) {
    let budget = turn.budget;
    // aoe_damage resolves every creature in the area in its one call, so
    // nothing of the casting is left open for a second call to reuse.
    const shares =
      via === "aoe"
        ? 1
        : castShares(mech, {
            spellLevel: facts?.level ?? slotLevel ?? 0,
            slotLevel,
            casterLevel: sheet.level,
          });
    // use_spell_slot resolves nothing itself, so every share is still to come.
    const uses = Math.max(1, Math.min(shares, Math.floor(input.uses ?? 1)));
    const left = via === "slot" ? shares : shares - uses;
    if (left > 0) {
      budget = withOpenCast(budget, { spell: name, slotLevel, left });
    }
    result.sharesLeft = left;
    result.uses = uses;
    if (shares > 1) {
      result.shares = `${name} holds ${shares} ${mech?.attacks ? "attack rolls" : mech?.darts ? "darts" : "targets"} from this one casting; ${left} left for more calls this turn, spending nothing more.`;
    }
    storeBudget(encounter, budget);
    result.cost = turn.cost === "bonus action" ? "their bonus action" : "their action";
    if (turn.note) {
      result.costNote = turn.note;
    }
  } else if (turn.kind === "reaction" && encounter) {
    if (turn.budget) {
      encounter.turnBudget = turn.budget;
    }
    markReactionUsed(encounter, sheet.id);
    result.cost = "their reaction";
  } else if (turn.kind === "mark" && encounter) {
    storeBudget(encounter, turn.budget);
  }

  if (slowHeld) {
    markSlowedCast(campaign.id, sheet.id, null);
  } else if (
    inFight && !input.ritual && facts?.castingTime === "action" && turn.kind === "budget" &&
    conditionTurnShape(sheet.conditions).slowed && slowHoldsCast(campaign, sheet, name)
  ) {
    // Slow: paid for, and nothing happens until the caster's next turn.
    markSlowedCast(campaign.id, sheet.id, { spell: name, slotLevel });
    return {
      error: `Slow holds ${name} back (the d20 came up 11 or higher): the slot and this turn's action are spent and the spell does not take effect yet. On ${sheet.name}'s next turn, cast it again with its tool to complete it: that spends their action and no slot. If they do not, the spell is wasted. Do not resolve it now.`,
      refused: "rules",
    };
  }

  // A monster whose block lists Counterspell answers a spell cast at its
  // side, after the slot and the action are spent (enemy-reactions.ts).
  if (inFight && encounter && slotLevel && !input.ritual && (via === "enemy" || via === "aoe" || via === "attack")) {
    const answered = enemyCounterspell(campaign.id, null, encounter, sheet, name, slotLevel);
    if (answered?.countered) {
      // A countered casting holds nothing more: no ray, dart or target of it
      // is left for a later call.
      const open = encounter.turnBudget ? openCastOf(encounter.turnBudget, name) : null;
      if (open && encounter.turnBudget) {
        storeBudget(encounter, withOpenCast(encounter.turnBudget, { ...open, left: 0 }));
      }
      return { error: answered.note, refused: "rules", countered: true, slotSpent: result.slot };
    }
    if (answered) {
      result.counterspell = answered.note;
    }
  }

  if (input.ritual) {
    // Ten minutes longer than the spell's own casting time.
    const minutes = 10 + (typeof facts?.castingTime === "number" ? facts.castingTime : 0);
    advanceClock(campaign.id, minutes, "minutes");
    result.note = `${name} cast as a ritual: ${minutes} minutes of casting, no slot spent. The clock moved on.`;
  } else if (typeof facts?.castingTime === "number") {
    advanceClock(campaign.id, facts.castingTime, "minutes");
    result.castingTime = `${describeCastingTime(facts.castingTime)} of casting; the clock moved on.`;
  }

  const concentrates = input.concentration === true || facts?.concentration === true;
  if (concentrates) {
    // The first spell ends, and with it every effect it held in place: an
    // earlier casting of this same spell too.
    const { displaced } = setConcentration(campaign, turnId, sheet.id, name, slotLevel);
    result.concentration = true;
    if (displaced) {
      result.droppedConcentration = droppedLine(displaced, name);
    }
  }
  // Contact Other Plane's toll on its caster (spell-self.ts).
  Object.assign(result, casterCost(campaign, sheet, engine, name));
  // An abjurer's Arcane Ward rises or recovers with an abjuration spell (arcane-ward.ts).
  Object.assign(result, wardOnCast(campaign, sheet.id, spellSchoolFor(name, authors), slotLevel ?? (facts?.level || null)));
  // Grasping Tentacles: casting the guarded spell gives temporary hit points
  // (src/lib/dm/authored-spells.ts).
  const guardedCast = castTempHp(campaign, sheet, engine, name);
  if (guardedCast) {
    result.subclassFeature = guardedCast;
  }
  // Casting a spell ends Invisibility (src/lib/dm/attack-marks.ts), and one
  // cast at an enemy ends Sanctuary (src/lib/dm/spell-defenses.ts).
  endInvisibilityOnCast(campaign.id, sheet.id);
  if (via === "enemy" || via === "aoe" || via === "attack") {
    endSanctuaryOnHarm(campaign.id, sheet.id);
  }
  // Its area on the board; aoe_damage and cast_at_enemy lay theirs after the saves.
  const zone = via === "slot" || via === "buff" ? placeSpellZone(campaign, { spell: name, runsAs: facts?.runsAs, caster: { kind: "pc", id: sheet.id, name: sheet.name }, slotLevel, dc: spellSaveDcFor(sheet, name), at: input.at, toward: input.toward }) : null;
  return zone ? { ...result, area: zone } : result;
}
