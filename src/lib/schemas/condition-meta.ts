// The metadata kept beside a sheet's (or an enemy's) plain conditions list.
// Split from sheet.ts, which re-exports the schema and its type.

import { z } from "zod";
import { ABILITIES } from "@/lib/schemas/abilities";

// The longest lifetime a count of rounds can hold: a year. Spells that last
// days (Geas's thirty, Contagion's seven) are counted in rounds like every
// other duration, ten to the minute; "until dispelled" carries no count.
export const ROUND_CEILING = 365 * 24 * 60 * 10;

// One instance of a condition: its lifetime, its source, what ends it.
const conditionInstanceSchema = z.object({
    // Rounds left. A long duration is stored in rounds too (Mage Armor's
    // eight hours is 4800, Geas's thirty days 432000).
    rounds: z.number().int().min(1).max(ROUND_CEILING).optional(),
    // What put the condition there: the spell, feature or hazard by name.
    source: z.string().trim().min(1).max(80).optional(),
    // Set by the engine on a condition it has renewed (a rage kept going).
    stoked: z.boolean().optional(),
    // "Until the start of your next turn" (Dodge, Shield, the Protection
    // style): the id of the combatant whose turn ends it, a characterId or
    // an enemyId. Such a condition is not counted in rounds; the initiative
    // pointer ends it on reaching that combatant
    // (src/lib/dm/condition-tick.ts startTurnConditions).
    untilTurnOf: z.string().trim().min(1).max(80).optional(),
    // "Until the end of your next turn" (Stunning Strike, Guiding Bolt): the
    // combatant whose next turn's END ends it; turnBegun marks that turn as
    // started (src/lib/dm/turn-end.ts).
    untilTurnEndOf: z.string().trim().min(1).max(80).optional(),
    turnBegun: z.boolean().optional(),
    // Flesh to Stone's count of saves (src/lib/dm/spell-turn-end.ts).
    tally: z.object({ passed: z.number().int().min(0).max(3), failed: z.number().int().min(0).max(3) }).optional(),
    saveEnds: z
      .object({
        ability: z.enum(ABILITIES),
        dc: z.number().int().min(1).max(30),
      })
      .optional(),
    // The spell that laid the condition down, and the slot it was cast
    // from (src/lib/dm/spell-effects.ts): a broken concentration ends only
    // that spell's conditions, and an aura rolls the slot's dice.
    spell: z.string().trim().min(1).max(80).optional(),
    slotLevel: z.number().int().min(0).max(9).optional(),
    // Ends when the creature takes damage (Sleep, Hypnotic Pattern), or
    // gives it a new save when it does (Hideous Laughter, Dominate Person).
    endsOnDamage: z.boolean().optional(),
    saveOnDamage: z
      .object({
        ability: z.enum(ABILITIES),
        dc: z.number().int().min(1).max(30),
        advantage: z.boolean().optional(),
      })
      .optional(),
    // Hunter's Mark and Hex: the marked creature's enemyId
    // (src/lib/dm/attack-marks.ts).
    quarry: z.string().trim().min(1).max(80).optional(),
    // A Creation bard's Bardic Inspiration die carries a mote
    // (src/lib/dm/authored-mote.ts).
    mote: z.boolean().optional(),
    // A monster's grapple prints its escape DC, which the escape is rolled
    // against instead of a contest (src/lib/dm/grapple.ts).
    escapeDc: z.number().int().min(1).max(40).optional(),
    // Ends when the creature finishes a long rest (Life Drain, Draining Kiss).
    untilLongRest: z.boolean().optional(),
});

// Duration/save metadata for active conditions, keyed by condition name.
// Lives NEXT TO the plain `conditions` string list so its consumers never
// change; the server maintains both together (src/lib/dm/condition-logic.ts).
// `others` holds further sources of the same condition, each with its own
// lifetime (two casters' Hold Person): the condition holds while any does.
export const conditionMetaSchema = z.record(
  z.string().max(40),
  conditionInstanceSchema.extend({
    others: z.array(conditionInstanceSchema).max(12).optional(),
  }),
);
export type ConditionMetaMap = z.infer<typeof conditionMetaSchema>;
