// SRD 5.1, Spellcasting, Longer Casting Times: "When you cast a spell with a
// casting time longer than a single action or reaction, you must spend your
// action each turn casting the spell, and you must maintain your
// concentration while you do so. If your concentration is broken, the spell
// fails, but you don't expend a spell slot."
//
// Before this the cast guard refused such a spell outright in a fight
// (issue #570, SPL-10). Now it is begun there and held across the caster's
// turns, with the pieces the engine already has:
// - the caster concentrates on the casting itself, under a label of its own
//   ("casting Identify"), so beginning it ends any other concentration, a
//   concentration spell cast meanwhile ends it, and the concentration
//   display and the CON save on damage carry it as they carry a spell;
// - a "casting" condition on the caster counts the rounds left, ten to the
//   minute (condition-tick.ts counts it as the caster's turns start, as it
//   counts a duration), and holds the action of each of those turns (its
//   row in condition-effects-last.ts; action-budget.ts freshBudget);
// - its instance names the label as the spell that laid it, so whatever ends
//   that concentration takes the casting with it (concentration.ts
//   clearSpellConditionsByName): the spell fails, and nothing was spent;
// - when the rounds run out, as the caster's turn starts, a "casting
//   complete" mark holds the spell and its slot, and the cast door completes
//   it (cast-guard.ts): the slot and the material are spent only then, and
//   no action. A spell use_spell_slot resolves the server completes at once
//   (long-casting.ts); one another tool resolves (a summoning, a heal, a
//   save) is completed by that tool on the caster's turn.
//
// A ritual's ten extra minutes count (SRD 5.1, Rituals: "takes 10 minutes
// longer to cast than normal"). Pure: the sheet and the facts come in as
// values, so scripts/test-cast-rules.mjs walks it without a database.

import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ConditionMeta, ConditionMetaMap } from "@/lib/dm/condition-logic";
import { describeCastingTime, type SpellFacts } from "@/lib/srd/spell-facts";
import { textKey } from "@/lib/language/text-logic";

// The condition that counts a casting's rounds and holds the action.
export const CASTING = "casting";
// The mark a finished casting leaves until its spell is resolved.
export const CASTING_COMPLETE = "casting complete";

const LABEL = "casting ";
const ROUNDS_PER_MINUTE = 10;

// What the caster concentrates on while casting: kept apart from the spell's
// own name so nothing keyed by a running spell (a summoning's recast, a zone,
// a readied spell) mistakes the casting for the spell in effect.
export function castingLabel(spell: string): string {
  return `${LABEL}${spell}`.slice(0, 80);
}

// The rounds a casting takes in a fight, or null for a spell cast with an
// action, a bonus action or a reaction.
export function castingRoundsOf(facts: SpellFacts | null, ritual: boolean): number | null {
  const minutes = typeof facts?.castingTime === "number" ? facts.castingTime : 0;
  const total = ritual ? minutes + 10 : minutes;
  return total > 0 ? total * ROUNDS_PER_MINUTE : null;
}

// How long it takes, as the table would say it.
export function castingTimeWords(facts: SpellFacts | null, ritual: boolean): string {
  const minutes = typeof facts?.castingTime === "number" ? facts.castingTime : 0;
  return ritual ? `${describeCastingTime(minutes + 10)} as a ritual` : describeCastingTime(minutes);
}

export type HeldCasting = {
  label: string;
  spell: string;
  slotLevel: number | null;
  ritual: boolean;
  rounds: number;
};

type Holder = Pick<CharacterSheet, "id" | "conditions" | "conditionMeta">;

function instanceOf(sheet: Holder, name: string): ConditionMeta | null {
  const key = sheet.conditions.find((entry) => entry.trim().toLowerCase() === name);
  return key ? ((sheet.conditionMeta as ConditionMetaMap)[key] ?? null) : null;
}

// The casting a character is in the middle of, or null.
export function castingOf(sheet: Holder): HeldCasting | null {
  const meta = instanceOf(sheet, CASTING);
  if (!meta?.spell?.startsWith(LABEL)) {
    return null;
  }
  return {
    label: meta.spell,
    spell: meta.spell.slice(LABEL.length),
    slotLevel: meta.slotLevel ?? null,
    ritual: meta.ritual === true,
    rounds: meta.rounds ?? 0,
  };
}

// The casting this concentration held, when it is one still in progress.
export function castingHeldBy(sheet: Holder, concentratingOn: string | null | undefined): HeldCasting | null {
  const held = castingOf(sheet);
  return held && textKey(held.label) === textKey(concentratingOn ?? "") ? held : null;
}

// The "casting" instance a casting begins with.
export function castingInstance(casterId: string, spell: string, rounds: number, slotLevel: number | null, ritual: boolean): ConditionMeta {
  return {
    spell: castingLabel(spell),
    source: casterId,
    rounds,
    ...(slotLevel ? { slotLevel } : {}),
    ...(ritual ? { ritual: true } : {}),
  };
}

export type CompletedCasting = { spell: string; slotLevel: number | null; ritual: boolean };

// A finished casting of this spell waiting to be resolved, or null.
export function completedCastingOf(sheet: Holder, spell: string): CompletedCasting | null {
  const meta = instanceOf(sheet, CASTING_COMPLETE);
  if (!meta?.spell || textKey(meta.spell) !== textKey(spell)) {
    return null;
  }
  return { spell: meta.spell, slotLevel: meta.slotLevel ?? null, ritual: meta.ritual === true };
}

// The mark a finished casting leaves. In a fight it lasts the caster's turn
// it finished on (turn-end.ts takes it as that turn ends); out of one, a
// minute of the clock.
export function completeMark(casterId: string, held: HeldCasting, inFight: boolean): ConditionMeta {
  return {
    spell: held.spell,
    source: casterId,
    ...(held.slotLevel ? { slotLevel: held.slotLevel } : {}),
    ...(held.ritual ? { ritual: true } : {}),
    ...(inFight ? { untilTurnEndOf: casterId, turnBegun: true } : { rounds: ROUNDS_PER_MINUTE }),
  };
}

// The tool that resolves a spell's effect once its casting is complete, or
// null when use_spell_slot does (a utility spell: the slot is all of it).
// The same reading the cast tools redirect by (cast-redirect.ts).
export function resolvingTool(input: { summons: boolean; resolution?: string | null }): string | null {
  if (input.summons) {
    return "cast_buff, the creature in variant";
  }
  switch (input.resolution) {
    case "buff":
    case "summon":
      return "cast_buff";
    case "heal":
      return "heal (spell, casterId and the slot level)";
    case "save":
    case "auto":
      return "cast_at_enemy (or aoe_damage for several targets)";
    case "attack":
      return "pc_attack";
    default:
      return null;
  }
}

// ---- what the table and the model read ----

// `when` is when the slot goes: "only then" as the casting begins, "then"
// once it is done and waits for its tool.
export function slotWords(slotLevel: number | null, ritual: boolean, when = "only then"): string {
  return ritual ? "As a ritual it spends no slot." : slotLevel ? `Its level ${slotLevel} slot is spent ${when}.` : "It spends no slot.";
}

export function beginLine(who: string, spell: string, time: string, rounds: number, slotLevel: number | null, ritual: boolean): string {
  return `${who} begins casting ${spell}, which takes ${time}: ${rounds} rounds. It has not taken effect, and nothing but this turn's action is spent. ${who}'s action on each of their turns goes on the casting, and their concentration holds it (Concentrating: ${castingLabel(spell)}). When the rounds have passed it takes effect as their turn starts. ${slotWords(slotLevel, ritual)} If their concentration breaks first (a failed save against damage, being incapacitated, another concentration spell, dropping to 0 hit points), the spell fails and no slot is spent. Do not narrate its effect yet.`;
}

export function completeLine(who: string, spell: string, slot: string): string {
  return `${who} finishes casting ${spell}: it takes effect now (${slot}).`;
}

export function resolveLine(who: string, spell: string, tool: string, slotLevel: number | null, ritual: boolean, inFight: boolean): string {
  return `${who} finishes casting ${spell}: resolve it now with ${tool}. ${slotWords(slotLevel, ritual, "then")} It takes no action. If it is not resolved ${inFight ? `by the end of ${who}'s turn` : "within the minute"}, the spell is lost and nothing is spent.`;
}

export function failLine(who: string, spell: string, cause: string): string {
  return `${who}'s casting of ${spell} fails (${cause}): the spell does not take effect, and no spell slot is spent.`;
}

// A long spell sent to a tool other than use_spell_slot in a fight: it is
// begun there, where the server holds it, and this tool resolves it at the end.
export function beginWithSlotTool(who: string, spell: string, time: string): string {
  return `${spell} takes ${time} to cast. In a fight it is begun with use_spell_slot: the server holds the casting across ${who}'s turns (their action on each, their concentration throughout) and spends the slot when it is complete, and then this tool resolves its effect. Nothing was spent.`;
}
