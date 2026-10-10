// What the AI DM may do by hand and what it must ask the engine for
// (docs/dnd-rules-audit-2026-10-09-extent.md, F17). Damage, healing and the
// conditions that take a creature's turn, its movement or its senses are
// engine-owned: the model asks a tool that rolls them (an attack, a spell, a
// hazard, a save) rather than writing the outcome. The human DM at the
// console and the party lead keep their free hand to correct the table;
// these rules are for a turn whose actor is the model.
//
// Pure by design: no "@/" value imports and no I/O.

// The SRD conditions that bind a creature. The model never lays one without
// a save the server rolls (set_condition / set_enemy_condition with
// saveAbility and saveDc, cast_at_player, cast_at_enemy, a hazard), and never
// lifts one the engine keeps (a save, a duration, a spell holds it).
export const SAVE_GATED_CONDITIONS = new Set([
  "blinded",
  "charmed",
  "deafened",
  "frightened",
  "grappled",
  "incapacitated",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
]);

export function bindsCreature(condition: string): boolean {
  return SAVE_GATED_CONDITIONS.has(condition.trim().toLowerCase());
}

// Whether a condition instance is kept by the engine: something already
// decides when it ends (a count, a save, a turn, a spell, a source creature).
export function engineKept(instance: {
  rounds?: number;
  saveEnds?: unknown;
  untilTurnOf?: string;
  untilTurnEndOf?: string;
  spell?: string;
  source?: string;
}): boolean {
  return Boolean(
    instance.rounds !== undefined ||
      instance.saveEnds ||
      instance.untilTurnOf ||
      instance.untilTurnEndOf ||
      instance.spell ||
      instance.source,
  );
}

export const AI_BIND_REFUSAL = (who: string, condition: string) =>
  `${who} cannot be made ${condition} by narration alone: it is a save the server rolls. Give saveAbility and saveDc (and rounds if it has a set length) and the server rolls ${who}'s save first, laying ${condition} only on a failure; a spell is cast_at_enemy or cast_at_player, an attack's rider is its attack, a trap is apply_hazard.`;

export const AI_CLEAR_REFUSAL = (who: string, condition: string) =>
  `${who}'s ${condition} is held by the engine (a save, a duration or a spell decides when it ends): it ends by itself, or through a cure cast with cast_buff (Lesser Restoration, Greater Restoration, Remove Curse). It was not cleared.`;

// Damage or healing the model sends as a bare number. It must have been
// rolled by the server this turn (a request_roll of kind damage, not yet
// applied), or be sent as dice the server rolls now.
export const AI_NUMBER_REFUSAL = (what: "damage" | "healing") =>
  what === "damage"
    ? "Damage is rolled by the server, never written: an attack is enemy_attack or pc_attack, a spell its cast tool, a trap or a fall apply_hazard. For other harm send dice (\"2d6\") instead of amount and the server rolls them, or roll it first with request_roll kind damage and send that total."
    : "Healing is rolled by the server, never written: a spell goes through heal with spell, a potion through use_item, hit dice through take_rest. For other healing send dice (\"2d4+2\") instead of amount and the server rolls them, or roll it first with request_roll kind damage and send that total.";
